"""
Custom Agent CRUD API.

Lets users create, edit, delete, and test-run their own agents.
Each custom agent can have:
  - system_prompt: fed to DeepSeek with the trip context
  - code: a Python snippet run via RestrictedPython; must assign `result = {...}`
  - api_keys: {KEY: value} dict injected as `secrets` in the sandbox and
              available in prompts
Both fields are optional; if both are provided, the code runs first and its
output is passed as extra context to the LLM.
"""
import ast
import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cache.redis_client import get_trip_context
from config import settings
from db.database import get_db
from db.models import CustomAgent

router = APIRouter(prefix="/api/custom-agents", tags=["custom-agents"])


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class CustomAgentCreate(BaseModel):
    name: str
    description: str = ""
    system_prompt: str = ""
    code: str = ""
    api_keys: dict = {}


class CustomAgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    code: str | None = None
    api_keys: dict | None = None


class CustomAgentOut(BaseModel):
    id: str
    name: str
    description: str
    system_prompt: str
    code: str
    api_keys: dict

    class Config:
        from_attributes = True


class TestRunRequest(BaseModel):
    session_id: str = ""          # optional — loads trip context if provided
    user_instructions: str = ""


class AIGenerateRequest(BaseModel):
    field: str                    # "prompt" or "code"
    description: str              # what the user wants the agent to do
    agent_name: str = ""
    current_value: str = ""       # existing content (for refinement)


class LintRequest(BaseModel):
    code: str


# ─── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CustomAgentOut])
async def list_custom_agents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CustomAgent).order_by(CustomAgent.created_at))
    return [
        CustomAgentOut(
            id=str(r.id), name=r.name, description=r.description or "",
            system_prompt=r.system_prompt or "", code=r.code or "",
            api_keys=r.api_keys or {}
        )
        for r in result.scalars().all()
    ]


@router.post("", response_model=CustomAgentOut, status_code=201)
async def create_custom_agent(body: CustomAgentCreate, db: AsyncSession = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="name is required")
    agent = CustomAgent(
        name=body.name.strip(),
        description=body.description,
        system_prompt=body.system_prompt,
        code=body.code,
        api_keys=body.api_keys,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return CustomAgentOut(
        id=str(agent.id), name=agent.name, description=agent.description or "",
        system_prompt=agent.system_prompt or "", code=agent.code or "",
        api_keys=agent.api_keys or {}
    )


# ─── AI-assisted generation ───────────────────────────────────────────────────
# NOTE: these routes MUST be declared before /{agent_id} routes to avoid
# FastAPI matching "ai-generate" or "lint" as an agent_id path parameter.

@router.post("/ai-generate")
async def ai_generate(body: AIGenerateRequest):
    """
    Use DeepSeek to generate or refine a system_prompt or Python code snippet
    for a custom agent.
    """
    from openai import AsyncOpenAI

    llm = AsyncOpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")

    if body.field == "prompt":
        system = (
            "You are an expert at writing concise LLM system prompts for travel-planning agents. "
            "The agent receives a trip context (destination, budget, itinerary, etc.) and must return "
            "a JSON object. Write ONLY the system prompt text — no preamble, no explanation."
        )
        user_parts = [f"Agent name: {body.agent_name}" if body.agent_name else ""]
        user_parts.append(f"What this agent should do: {body.description}")
        if body.current_value.strip():
            user_parts.append(f"\nRefine this existing prompt:\n{body.current_value}")
        user_parts.append(
            "\nRemember: the prompt should instruct the agent to return a structured JSON object. "
            "Be specific about what fields to include."
        )
    elif body.field == "code":
        system = (
            "You are an expert Python developer writing short sandbox scripts for a travel AI. "
            "The script runs in RestrictedPython. Available globals:\n"
            "  context (dict) — trip data: destination, budget_inr, itinerary, transport, hotels, food\n"
            "  secrets (dict) — user API keys by name\n"
            "  http_get(url, headers={}) → dict — makes a GET request and returns parsed JSON\n"
            "  http_post(url, data={}, headers={}) → dict — makes a POST request\n"
            "  json — json module\n"
            "No imports are allowed. The script MUST assign `result = {...}` at the end. "
            "Write ONLY the Python code — no markdown fences, no explanation."
        )
        user_parts = [f"Agent name: {body.agent_name}" if body.agent_name else ""]
        user_parts.append(f"What this code should do: {body.description}")
        if body.current_value.strip():
            user_parts.append(f"\nRefine this existing code:\n{body.current_value}")
    else:
        raise HTTPException(status_code=422, detail="field must be 'prompt' or 'code'")

    resp = await llm.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": "\n".join(p for p in user_parts if p)},
        ],
        temperature=0.3,
        max_tokens=600,
    )
    content = (resp.choices[0].message.content or "").strip()
    # Strip any accidental markdown code fences
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return {"content": content}


# ─── Lint ─────────────────────────────────────────────────────────────────────

@router.post("/lint")
async def lint_code(body: LintRequest):
    """
    Parse Python code with ast.parse and return any syntax errors.
    Returns {ok: true} or {ok: false, errors: [{line, col, message}]}.
    """
    if not body.code.strip():
        return {"ok": True, "errors": []}
    try:
        ast.parse(body.code, filename="<custom_agent>")
        return {"ok": True, "errors": []}
    except SyntaxError as e:
        return {
            "ok": False,
            "errors": [{"line": e.lineno or 0, "col": e.offset or 0, "message": e.msg}],
        }
    except Exception as e:
        return {"ok": False, "errors": [{"line": 0, "col": 0, "message": str(e)}]}


# ─── Parameterized CRUD ───────────────────────────────────────────────────────

@router.put("/{agent_id}", response_model=CustomAgentOut)
async def update_custom_agent(
    agent_id: str, body: CustomAgentUpdate, db: AsyncSession = Depends(get_db)
):
    try:
        uid = uuid.UUID(agent_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid agent_id")
    result = await db.execute(select(CustomAgent).where(CustomAgent.id == uid))
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    if body.name is not None:
        agent.name = body.name.strip()
    if body.description is not None:
        agent.description = body.description
    if body.system_prompt is not None:
        agent.system_prompt = body.system_prompt
    if body.code is not None:
        agent.code = body.code
    if body.api_keys is not None:
        agent.api_keys = body.api_keys
    await db.commit()
    await db.refresh(agent)
    return CustomAgentOut(
        id=str(agent.id), name=agent.name, description=agent.description or "",
        system_prompt=agent.system_prompt or "", code=agent.code or "",
        api_keys=agent.api_keys or {}
    )


@router.delete("/{agent_id}", status_code=204)
async def delete_custom_agent(agent_id: str, db: AsyncSession = Depends(get_db)):
    try:
        uid = uuid.UUID(agent_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid agent_id")
    result = await db.execute(select(CustomAgent).where(CustomAgent.id == uid))
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    await db.delete(agent)
    await db.commit()


# ─── Test-run ─────────────────────────────────────────────────────────────────

@router.post("/{agent_id}/test")
async def test_run_agent(
    agent_id: str, body: TestRunRequest, db: AsyncSession = Depends(get_db)
):
    """
    Runs the agent against a live trip context (if session_id provided) or
    an empty context, and returns the raw output.  Useful for debugging before
    attaching the agent to a real plan.
    """
    try:
        uid = uuid.UUID(agent_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid agent_id")

    result = await db.execute(select(CustomAgent).where(CustomAgent.id == uid))
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    context: dict = {}
    if body.session_id:
        context = await get_trip_context(body.session_id) or {}

    fake_task = {
        "session_id": body.session_id or "test",
        "task_type": f"custom:{agent_id}",
        "intent": context,
        "user_instructions": body.user_instructions,
        "_agent_def": {
            "name": agent.name,
            "system_prompt": agent.system_prompt or "",
            "code": agent.code or "",
            "api_keys": agent.api_keys or {},
        },
    }

    from workers.tools import run_custom_agent
    try:
        output = await run_custom_agent(fake_task)
        return {"ok": True, "result": output}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

