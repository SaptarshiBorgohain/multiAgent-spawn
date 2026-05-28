"""
Tool registry.

Each tool is a simple async function. Workers look up the right tool
by name and call it with the task context.
"""
import hashlib
import json
import uuid
from typing import Any

import httpx

from cache.redis_client import get_trip_context, update_trip_context
from config import settings
from search.es_client import index_result, search_knowledge


async def places_search(task: dict) -> dict:
    """
    Cache-first: query Elasticsearch first.
    Fall back to Google Places API only on cache miss.
    """
    intent = task.get("intent", {})
    destination = intent.get("destination", "")
    query = task.get("search_query", f"places in {destination}")
    index = task.get("es_index", "places_index")

    cached = await search_knowledge(index, query, destination)
    if cached:
        return {"source": "cache", "results": cached}

    results = await _google_places_search(query, destination)
    for item in results:
        place_id = hashlib.md5(item["name"].encode()).hexdigest()
        await index_result(index, place_id, item, destination)

    return {"source": "live", "results": results}


async def _google_places_search(query: str, destination: str) -> list[dict]:
    if not settings.google_places_api_key:
        return [{"name": f"Sample place in {destination}", "tags": [], "rating": 4.0}]

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://maps.googleapis.com/maps/api/place/textsearch/json",
            params={"query": f"{query} {destination}", "key": settings.google_places_api_key},
        )
        data = resp.json()
        results = []
        for r in data.get("results", [])[:10]:
            loc = r.get("geometry", {}).get("location", {})
            results.append({
                "name": r.get("name"),
                "rating": r.get("rating", 0),
                "tags": r.get("types", []),
                "location": {"lat": loc.get("lat", 0), "lon": loc.get("lng", 0)},
            })
        return results


async def destination_research(task: dict) -> dict:
    from openai import AsyncOpenAI

    intent = task.get("intent", {})
    destination = intent.get("destination", "")
    travel_style = intent.get("travel_style", "general")
    llm = AsyncOpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")

    # Run Google Places and LLM knowledge lookup in parallel
    places_coro = places_search({
        **task,
        "search_query": f"top attractions tourist places in {destination}",
        "es_index": "attractions_index",
    })
    llm_coro = llm.chat.completions.create(
        model=intent.get("model", "deepseek-v4-flash"),
        messages=[{
            "role": "user",
            "content": (
                f"For a {travel_style} traveller visiting {destination}, list 5 must-know "
                "cultural highlights, neighbourhoods, and travel tips (not just venue names). "
                "Return as JSON: {\"highlights\": [\"...\"], \"best_areas\": [\"...\"], \"tips\": [\"...\"]}"
            ),
        }],
        response_format={"type": "json_object"},
    )
    import asyncio
    results, llm_resp = await asyncio.gather(places_coro, llm_coro)

    llm_context = json.loads(llm_resp.choices[0].message.content)
    combined = {**results, "llm_context": llm_context}
    await update_trip_context(task["session_id"], {
        "attractions": json.dumps(results["results"][:5]),
        "destination_highlights": json.dumps(llm_context),
    })
    return combined


async def transport_planning(task: dict) -> dict:
    intent = task.get("intent", {})
    destination = intent.get("destination", "")
    results = await places_search({**task, "search_query": f"airports and train stations {destination}", "es_index": "transport_index"})
    await update_trip_context(task["session_id"], {"transport": json.dumps(results["results"][:3])})
    return results


async def hotel_planning(task: dict) -> dict:
    intent = task.get("intent", {})
    destination = intent.get("destination", "")
    budget_constraint = intent.get("budget_constraint", "")
    query = f"{'budget ' if budget_constraint == 'cheaper' else ''}hotels in {destination}"
    results = await places_search({**task, "search_query": query, "es_index": "hotels_index"})
    await update_trip_context(task["session_id"], {"hotels": json.dumps(results["results"][:5])})
    return results


async def food_discovery(task: dict) -> dict:
    intent = task.get("intent", {})
    destination = intent.get("destination", "")
    travel_style = intent.get("travel_style", "")
    query = f"{travel_style} cafes restaurants in {destination}"
    results = await places_search({**task, "search_query": query, "es_index": "cafes_index"})
    await update_trip_context(task["session_id"], {"food": json.dumps(results["results"][:5])})
    return results


async def itinerary_optimization(task: dict) -> dict:
    from openai import AsyncOpenAI

    session_id = task["session_id"]
    context = await get_trip_context(session_id)
    intent = task.get("intent", context)

    destination = intent.get("destination", context.get("destination", "the destination"))
    duration = intent.get("duration_days", context.get("duration_days", 3))
    budget = intent.get("budget_inr", context.get("budget_inr", ""))
    travel_style = intent.get("travel_style", context.get("travel_style", "general"))

    # Summarise what the specialist agents collected
    attractions = context.get("attractions", "[]")
    transport   = context.get("transport", "[]")
    hotels      = context.get("hotels", "[]")
    food        = context.get("food", "[]")

    budget_note = f"Total budget \u20b9{budget}." if budget else ""

    # User refinement instructions (from re-run with custom instructions)
    user_instructions = task.get("user_instructions", "").strip()
    instructions_section = (
        f"\n\nAdditional instructions from the traveller (follow these carefully):\n{user_instructions}"
        if user_instructions
        else ""
    )

    prompt = f"""You are an expert travel planner with deep knowledge of {destination}.

Trip details:
- Destination: {destination}
- Duration: {duration} days
- Travel style: {travel_style}
- {budget_note}

Real venue data collected by specialist agents (use these specific names/places in the plan):
- Attractions: {attractions}
- Transport hubs: {transport}
- Hotels (recommend the best fit): {hotels}
- Dining options: {food}

Using BOTH the venue data above AND your own knowledge of {destination} (culture, neighbourhoods, hidden gems, best times to visit each attraction, local tips), create a detailed day-by-day itinerary.{instructions_section}

CRITICAL RULES — you MUST follow these exactly:
1. Every field in each day object MUST be a plain string (1-3 sentences). NEVER use a nested object or array.
2. Include at least one specific venue name in every morning/afternoon/evening field.
3. Return valid JSON only — no markdown, no code fences.

Example of a perfectly correct day object:
{{
  "day": 1,
  "theme": "Arrival & Iconic Landmarks",
  "morning": "Start at Gateway of India (open 24/7, best before 9am to beat crowds). Take a 30-min ferry to Elephanta Caves.",
  "afternoon": "Explore Colaba Causeway market for souvenirs, then lunch at Leopold Cafe on Colaba Causeway Road.",
  "evening": "Walk along Marine Drive to Nariman Point for the sunset skyline. Dinner at Bademiya street food stall behind the Taj.",
  "tips": "Carry cash for street food. Use Uber or Ola for AC comfort in Mumbai heat."
}}

Return a JSON object with this exact structure:
{{
  "destination": "{destination}",
  "duration_days": {duration},
  "summary": "2-3 sentence trip overview",
  "recommended_hotel": "hotel name from the list above",
  "daily_budget_inr": <number or null>,
  "itinerary": [
    {{
      "day": 1,
      "theme": "theme string",
      "morning": "morning activity string with venue name",
      "afternoon": "afternoon activity string with venue name",
      "evening": "evening activity or dining string",
      "tips": "local tip or cultural note"
    }}
  ],
  "travel_tips": ["tip1", "tip2", "tip3"]
}}"""

    llm = AsyncOpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")
    response = await llm.chat.completions.create(
        # Use deepseek-chat (not flash) for reliable structured JSON output
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    itinerary = json.loads(response.choices[0].message.content)
    await update_trip_context(session_id, {"itinerary": json.dumps(itinerary)})
    return itinerary


async def budget_optimizer(task: dict) -> dict:
    """
    Reads the finished itinerary + trip context and produces actionable money-saving
    tips broken down by category (transport, hotel, food, activities).
    Runs after itinerary_optimization is complete.
    """
    from openai import AsyncOpenAI

    intent  = task.get("intent", {})
    session_id = task["session_id"]
    context = await get_trip_context(session_id)

    destination  = intent.get("destination", context.get("destination", "the destination"))
    budget_inr   = intent.get("budget_inr",  context.get("budget_inr", "unspecified"))
    travel_style = intent.get("travel_style", context.get("travel_style", "mid-range"))
    duration     = intent.get("duration_days", context.get("duration_days", ""))
    itinerary    = context.get("itinerary", "[]")
    transport    = context.get("transport", "[]")
    hotels       = context.get("hotels",    "[]")
    user_instructions = task.get("user_instructions", "")

    llm = AsyncOpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")

    prompt = f"""You are a budget travel expert. Analyse the following trip plan and produce a tight, practical budget breakdown with money-saving tips.

Destination: {destination}
Duration: {duration} days
Budget: ₹{budget_inr}
Travel style: {travel_style}
{f"Extra instructions: {user_instructions}" if user_instructions else ""}

Transport options: {transport[:800]}
Hotels: {hotels[:800]}
Itinerary: {itinerary[:1200]}

Return ONLY a JSON object (no markdown fences) with this exact shape:
{{
  "estimated_total_inr": 95000,
  "breakdown": {{
    "flights": 30000,
    "hotels": 28000,
    "food": 15000,
    "transport_local": 8000,
    "activities": 10000,
    "misc": 4000
  }},
  "savings_tips": [
    "Book flights 6-8 weeks in advance to save ₹4,000-8,000",
    "Stay in guesthouses in the old city; avoid 5-star zones near airports",
    "Eat at local dhabas and street stalls — budget ₹300-500/day per person",
    "Use metro/bus passes instead of taxis; saves ~₹200/day"
  ],
  "verdict": "Your ₹95,000 budget is achievable with mid-range choices. Biggest lever: accommodation — switching to guesthouses saves ₹8,000."
}}"""

    resp = await llm.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=600,
    )
    raw = (resp.choices[0].message.content or "{}").strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        result = json.loads(raw.strip())
    except Exception:
        result = {"verdict": raw[:300], "savings_tips": [], "breakdown": {}, "estimated_total_inr": 0}

    await update_trip_context(session_id, {"budget_analysis": json.dumps(result)})
    return result


# ─── Custom agent sandbox ─────────────────────────────────────────────────────

_DEFAULT_HEADERS = {"User-Agent": "TripWeave/1.0 (custom-agent; +https://tripweave.app)"}


def _safe_http_get(url: str, headers: dict | None = None) -> dict:
    """Safe outbound GET — callable from inside the sandbox."""
    import urllib.request
    merged = {**_DEFAULT_HEADERS, **(headers or {})}
    req = urllib.request.Request(url, headers=merged)
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
        raw = resp.read()
        try:
            return json.loads(raw.decode())
        except Exception:
            return {"_text": raw.decode(errors="replace")}


def _safe_http_post(url: str, data: dict | None = None, headers: dict | None = None) -> dict:
    """Safe outbound POST — callable from inside the sandbox."""
    import urllib.request
    body = json.dumps(data or {}).encode()
    merged_headers = {"Content-Type": "application/json", **_DEFAULT_HEADERS, **(headers or {})}
    req = urllib.request.Request(url, data=body, headers=merged_headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
        raw = resp.read()
        try:
            return json.loads(raw.decode())
        except Exception:
            return {"_text": raw.decode(errors="replace")}


def _run_code_sandbox(code: str, context: dict, secrets: dict | None = None) -> dict:
    """
    Execute user-supplied Python in a RestrictedPython sandbox.
    The code runs in a stripped-down namespace; it must assign `result = {...}`.
    Returns the `result` dict or raises on error.

    Globals available to user code:
      context   — trip context dict
      secrets   — agent api_keys dict (read-only)
      http_get(url, headers={})       — outbound GET → dict
      http_post(url, data={}, headers={}) — outbound POST → dict
      json      — json module
    """
    from RestrictedPython import compile_restricted, safe_globals, safe_builtins
    from RestrictedPython.Guards import guarded_iter_unpack_sequence

    byte_code = compile_restricted(code, "<custom_agent>", "exec")

    glb: dict = {
        **safe_globals,
        "__builtins__": safe_builtins,
        "_getiter_": iter,
        "_getitem_": lambda obj, key: obj[key],
        "_getattr_": getattr,
        "_write_": lambda obj: obj,
        "_inplacevar_": lambda op, x, y: x + y if op == "+=" else x - y if op == "-=" else x,
        "_unpack_sequence_": guarded_iter_unpack_sequence,
        # stdlib helpers
        "json": json,
        # trip data
        "context": context,
        # user api keys
        "secrets": secrets or {},
        # safe HTTP helpers
        "http_get": _safe_http_get,
        "http_post": _safe_http_post,
        # result placeholder
        "result": {},
    }
    exec(byte_code, glb)  # noqa: S102  (intentionally sandboxed)
    return glb.get("result", {})


async def run_custom_agent(task: dict) -> dict:
    """
    Generic handler for user-defined agents.

    Execution order:
      1. If agent has Python `code` → run in RestrictedPython sandbox;
         `result` dict is available as extra context for step 2.
      2. If agent has `system_prompt` → call DeepSeek, passing trip context
         + code result as the user message.
      3. Return merged result.

    The agent definition arrives via task["_agent_def"]:
      {name, system_prompt, code}
    or is fetched from DB by parsing task_type "custom:{uuid}".
    """
    from openai import AsyncOpenAI
    from db.database import AsyncSessionLocal
    from db.models import CustomAgent as CustomAgentModel
    from sqlalchemy import select

    session_id = task.get("session_id", "")
    user_instructions = task.get("user_instructions", "")
    context = await get_trip_context(session_id) if session_id else {}

    # Resolve agent definition
    agent_def = task.get("_agent_def")
    if agent_def is None:
        # Parse task_type "custom:{uuid}"
        task_type = task.get("task_type", "")
        agent_id_str = task_type.removeprefix("custom:")
        try:
            agent_uuid = uuid.UUID(agent_id_str)
        except ValueError:
            raise ValueError(f"Cannot parse custom agent id from task_type: {task_type}")
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(CustomAgentModel).where(CustomAgentModel.id == agent_uuid)
            )
            record = res.scalar_one_or_none()
        if record is None:
            raise ValueError(f"Custom agent {agent_id_str} not found in DB")
        agent_def = {
            "name": record.name,
            "system_prompt": record.system_prompt or "",
            "code": record.code or "",
            "api_keys": record.api_keys or {},
        }

    code: str = agent_def.get("code", "")
    system_prompt: str = agent_def.get("system_prompt", "")
    agent_name: str = agent_def.get("name", "Custom Agent")
    secrets: dict = agent_def.get("api_keys", {})

    code_result: dict = {}
    if code.strip():
        code_result = _run_code_sandbox(code, dict(context), secrets)

    llm_result: dict = {}
    if system_prompt.strip():
        llm = AsyncOpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")
        ctx_summary = json.dumps({k: str(v)[:300] for k, v in context.items()}, indent=2)
        user_msg_parts = [
            f"Trip context:\n{ctx_summary}",
        ]
        if code_result:
            user_msg_parts.append(f"\nPython sandbox output:\n{json.dumps(code_result, indent=2)}")
        if user_instructions:
            user_msg_parts.append(f"\nExtra instructions: {user_instructions}")
        user_msg_parts.append("\nReturn your response as a JSON object.")

        resp = await llm.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": "\n".join(user_msg_parts)},
            ],
            temperature=0.4,
            max_tokens=800,
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        try:
            llm_result = json.loads(raw.strip())
        except Exception:
            llm_result = {"output": raw[:500]}

    merged = {**code_result, **llm_result, "_agent": agent_name}
    if session_id:
        safe_key = f"custom_{agent_def.get('name', 'agent').lower().replace(' ', '_')[:30]}"
        await update_trip_context(session_id, {safe_key: json.dumps(merged)})
    return merged


# Registry maps task_type → handler function
TOOL_REGISTRY: dict[str, Any] = {
    "destination_research": destination_research,
    "transport_planning": transport_planning,
    "hotel_planning": hotel_planning,
    "food_discovery": food_discovery,
    "itinerary_optimization": itinerary_optimization,
    "budget_optimizer": budget_optimizer,
    "places_search": places_search,
}
