"""
FastAPI routes for trip planning sessions.
"""
import asyncio
import json
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from openai import AsyncOpenAI, AuthenticationError, OpenAIError, RateLimitError
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from cache.redis_client import get_trip_context, publish_event, set_trip_context
from config import settings
from db.database import AsyncSessionLocal, get_db
from db.models import Trip
from orchestrator.planner import plan_trip, monitor_and_replan

router = APIRouter(prefix="/api/trips", tags=["trips"])


class StartTripRequest(BaseModel):
    user_query: str
    model: str = "deepseek-v4-flash"
    clarification_answers: dict[str, str] = {}   # question → answer pairs
    custom_agent_ids: list[str] = []              # UUIDs of CustomAgent rows to include


class ClarifyRequest(BaseModel):
    user_query: str


class ClarifyResponse(BaseModel):
    questions: list[dict]   # [{id, question, placeholder}]


class StartTripResponse(BaseModel):
    session_id: str
    tasks_created: int
    message: str


_clarify_llm: AsyncOpenAI | None = None

def _get_clarify_llm() -> AsyncOpenAI:
    global _clarify_llm
    if _clarify_llm is None:
        _clarify_llm = AsyncOpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")
    return _clarify_llm


@router.post("/clarify", response_model=ClarifyResponse)
async def clarify_trip(body: ClarifyRequest):
    """
    Given a raw trip brief, return 3-4 targeted clarifying questions that would
    help the planning agents produce a better itinerary.
    """
    llm = _get_clarify_llm()
    prompt = f"""You are a travel planning assistant. A user has described a trip they want to take.
Your job is to identify 3-4 short, specific clarifying questions that would significantly improve the trip plan.

User brief: {body.user_query}

Rules:
- Only ask things NOT already answered in the brief
- Keep each question under 12 words
- Make placeholder text a concrete short example answer
- Return ONLY valid JSON, no prose, no markdown code fences

Return a JSON array exactly like this:
[
  {{"id": "travel_style", "question": "What travel style do you prefer?", "placeholder": "e.g. backpacker, mid-range, luxury"}},
  {{"id": "companions", "question": "Who are you travelling with?", "placeholder": "e.g. solo, couple, family with kids"}},
  {{"id": "interests", "question": "What are your top interests or must-dos?", "placeholder": "e.g. street food, historical sites, hiking"}},
  {{"id": "avoid", "question": "Anything you want to avoid?", "placeholder": "e.g. crowded tourist traps, spicy food, long walks"}}
]"""

    resp = await llm.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=400,
    )
    raw = resp.choices[0].message.content or "[]"
    # Strip accidental markdown fences
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        questions = json.loads(raw.strip())
    except Exception:
        # Fallback questions if LLM response is malformed
        questions = [
            {"id": "travel_style", "question": "What travel style do you prefer?", "placeholder": "e.g. backpacker, mid-range, luxury"},
            {"id": "companions", "question": "Who are you travelling with?", "placeholder": "e.g. solo, couple, family"},
            {"id": "interests", "question": "Top interests or must-dos?", "placeholder": "e.g. street food, history, beaches"},
        ]
    return ClarifyResponse(questions=questions)


async def _run_plan_in_background(
    session_id: str, user_query: str, model: str, custom_agent_ids: list[str]
) -> None:
    """
    Run plan_trip in the background so the POST can return immediately.
    Any LLM errors are published as a planning_failed WS event instead of
    surfacing as HTTP errors (the request is already gone).
    """
    try:
        await plan_trip(session_id, user_query, model, custom_agent_ids)
    except (RateLimitError, AuthenticationError, OpenAIError) as exc:
        error_msg = str(exc)
        if isinstance(exc, RateLimitError):
            error_msg = "DeepSeek quota exceeded."
        elif isinstance(exc, AuthenticationError):
            error_msg = "DeepSeek API key is invalid or missing."
        await publish_event(session_id, {"type": "planning_failed", "error": error_msg})
    except Exception as exc:
        await publish_event(session_id, {"type": "planning_failed", "error": f"Unexpected error: {exc}"})


@router.post("/start", response_model=StartTripResponse)
async def start_trip(
    body: StartTripRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    session_id = str(uuid.uuid4())

    # Enrich the query with any clarification answers the user provided
    enriched_query = body.user_query
    if body.clarification_answers:
        answers_text = "\n".join(f"- {q}: {a}" for q, a in body.clarification_answers.items() if a.strip())
        if answers_text:
            enriched_query = f"{body.user_query}\n\nAdditional preferences:\n{answers_text}"

    trip = Trip(session_id=session_id, user_query=enriched_query, status="planning")
    db.add(trip)
    await db.commit()

    background_tasks.add_task(
        _run_plan_in_background, session_id, enriched_query, body.model, body.custom_agent_ids
    )

    return StartTripResponse(
        session_id=session_id,
        tasks_created=5,  # DAG always produces 5 tasks; exact count arrives via planning_started WS event
        message="Trip planning started. Connect to WebSocket for live updates.",
    )


@router.get("/{session_id}/context")
async def get_context(session_id: str):
    context = await get_trip_context(session_id)
    if not context:
        raise HTTPException(status_code=404, detail="Session not found or expired.")
    return context


class RerunAgentRequest(BaseModel):
    task_type: str
    user_instructions: str = ""  # optional refinement hint for the agent


@router.post("/{session_id}/rerun-agent")
async def rerun_agent(session_id: str, body: RerunAgentRequest):
    from orchestrator.planner import TASK_DEPENDENCY_MAP
    from cache.redis_client import publish_task, set_agent_status

    context = await get_trip_context(session_id)
    if not context:
        raise HTTPException(status_code=404, detail="Session not found or expired.")

    tasks_to_rerun = [body.task_type]
    if body.task_type != "itinerary_optimization":
        tasks_to_rerun.append("itinerary_optimization")

    intent = {k: context[k] for k in ["destination", "budget_inr", "travel_style", "duration_days", "model"] if k in context}

    for tt in tasks_to_rerun:
        await set_agent_status(session_id, tt, "waiting")

    for tt in tasks_to_rerun:
        task_payload: dict = {
            "task_id": str(uuid.uuid4()),
            "session_id": session_id,
            "task_type": tt,
            "depends_on": TASK_DEPENDENCY_MAP.get(tt, []),
            "context_scope": session_id,
            "intent": intent,
        }
        # Only forward user_instructions to the directly requested agent
        if tt == body.task_type and body.user_instructions:
            task_payload["user_instructions"] = body.user_instructions
        await publish_task(task_payload)

    return {"queued": tasks_to_rerun}


@router.post("/{session_id}/replan")
async def replan(session_id: str):
    await monitor_and_replan(session_id)
    return {"status": "replan_triggered"}
