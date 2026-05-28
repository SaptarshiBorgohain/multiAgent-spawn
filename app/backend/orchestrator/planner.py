"""
Planner / Orchestrator

Responsibilities:
1. Parse user intent via LLM
2. Generate a Task DAG (directed acyclic graph)
3. Publish tasks onto Redis Streams in dependency order
4. Monitor completion and spawn follow-up tasks (e.g. budget exceeded → cheaper hotels)
"""
import json
import uuid

from openai import AsyncOpenAI

from cache.redis_client import (
    get_trip_context,
    publish_task,
    set_trip_context,
    publish_event,
    get_all_agent_statuses,
)
from config import settings

_llm: AsyncOpenAI | None = None


def _get_llm() -> AsyncOpenAI:
    global _llm
    if _llm is None:
        _llm = AsyncOpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")
    return _llm

# Task types and their upstream dependencies
TASK_DEPENDENCY_MAP: dict[str, list[str]] = {
    "destination_research": [],
    "transport_planning": ["destination_research"],
    "hotel_planning": ["destination_research"],
    "food_discovery": ["destination_research"],
    "itinerary_optimization": ["transport_planning", "hotel_planning", "food_discovery"],
    "budget_optimizer": ["itinerary_optimization"],
}


async def plan_trip(
    session_id: str,
    user_query: str,
    model: str = "deepseek-v4-flash",
    custom_agent_ids: list[str] | None = None,
) -> list[dict]:
    """
    1. Extract intent from user query via LLM.
    2. Seed Redis context.
    3. Build and publish the task DAG (built-in + optional custom agents).
    Returns the list of tasks created.
    """
    custom_agent_ids = custom_agent_ids or []
    intent = await _extract_intent(user_query, model)
    intent["model"] = model
    await set_trip_context(session_id, {**intent, "status": "planning"})

    # Fetch custom agent names for the planning_started event
    custom_agent_meta: list[dict] = []
    if custom_agent_ids:
        from db.database import AsyncSessionLocal
        from db.models import CustomAgent
        from sqlalchemy import select
        import uuid as _uuid
        async with AsyncSessionLocal() as db:
            for ca_id in custom_agent_ids:
                try:
                    ca_uuid = _uuid.UUID(ca_id)
                except ValueError:
                    continue
                res = await db.execute(select(CustomAgent).where(CustomAgent.id == ca_uuid))
                record = res.scalar_one_or_none()
                if record:
                    custom_agent_meta.append({"id": ca_id, "name": record.name})

    tasks = _build_dag(session_id, intent, custom_agent_ids)
    for task in tasks:
        await publish_task(task)

    await publish_event(session_id, {
        "type": "planning_started",
        "task_count": len(tasks),
        "task_types": [t["task_type"] for t in tasks],
        "destination": intent.get("destination", ""),
        "duration_days": intent.get("duration_days", ""),
        "budget_inr": intent.get("budget_inr", ""),
        "custom_agents": custom_agent_meta,
    })
    return tasks


async def _extract_intent(user_query: str, model: str) -> dict:
    prompt = (
        "Extract travel intent as JSON with keys: destination, budget_inr, travel_style, duration_days. "
        f"Query: {user_query}"
    )
    response = await _get_llm().chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def _build_dag(session_id: str, intent: dict, custom_agent_ids: list[str] | None = None) -> list[dict]:
    """Returns tasks ordered so dependencies come before dependents."""
    order = [
        "destination_research",
        "transport_planning",
        "hotel_planning",
        "food_discovery",
        "itinerary_optimization",
        "budget_optimizer",
    ]
    # Custom agents run after budget_optimizer (last built-in stage)
    last_builtin = "budget_optimizer"
    for ca_id in (custom_agent_ids or []):
        order.append(f"custom:{ca_id}")

    # Build a full dependency map including custom agents
    dep_map = dict(TASK_DEPENDENCY_MAP)
    for ca_id in (custom_agent_ids or []):
        dep_map[f"custom:{ca_id}"] = [last_builtin]

    tasks = []
    for task_type in order:
        tasks.append({
            "task_id": str(uuid.uuid4()),
            "session_id": session_id,
            "task_type": task_type,
            "depends_on": dep_map.get(task_type, []),
            "context_scope": session_id,
            "intent": intent,
        })
    return tasks


async def handle_budget_exceeded(session_id: str) -> None:
    """Autonomously spawn a cheaper hotel search when budget is exceeded."""
    context = await get_trip_context(session_id)
    task = {
        "task_id": str(uuid.uuid4()),
        "session_id": session_id,
        "task_type": "hotel_planning",
        "depends_on": [],
        "context_scope": session_id,
        "intent": {**context, "budget_constraint": "cheaper"},
    }
    await publish_task(task)
    await publish_event(session_id, {"type": "replanning", "reason": "budget_exceeded"})


async def monitor_and_replan(session_id: str) -> None:
    """
    Called periodically by the API. Checks agent statuses and triggers
    follow-up tasks if needed.
    """
    statuses = await get_all_agent_statuses(session_id)
    context = await get_trip_context(session_id)

    budget = context.get("budget_inr", 0)
    current_cost = context.get("estimated_cost", 0)

    if isinstance(budget, (int, float)) and isinstance(current_cost, (int, float)):
        if current_cost > budget:
            await handle_budget_exceeded(session_id)
