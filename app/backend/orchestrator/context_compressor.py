"""
Context compression service.

Every N interactions, compress raw trip chat into structured memory
and persist to PostgreSQL. This prevents:
  - Exploding token context
  - Repeated prompts
  - Memory duplication
"""
import json

from openai import AsyncOpenAI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from cache.redis_client import get_trip_context, update_trip_context
from config import settings
from db.models import Trip

_llm: AsyncOpenAI | None = None


def _get_llm() -> AsyncOpenAI:
    global _llm
    if _llm is None:
        _llm = AsyncOpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")
    return _llm

COMPRESS_EVERY_N = 5  # interactions before compression


async def maybe_compress(session_id: str, interaction_count: int, db: AsyncSession) -> None:
    if interaction_count % COMPRESS_EVERY_N != 0:
        return
    await compress_context(session_id, db)


async def compress_context(session_id: str, db: AsyncSession) -> dict:
    """
    Pull active context from Redis, compress via LLM, persist to Postgres,
    and update Redis with the compressed summary.
    """
    raw_context = await get_trip_context(session_id)

    prompt = (
        "Compress this travel planning context into a concise JSON with keys: "
        "user_preferences (food, budget_type, transport), confirmed_details, open_questions. "
        f"Context: {json.dumps(raw_context)}"
    )
    response = await _get_llm().chat.completions.create(
        model="deepseek-v4-flash",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    compressed = json.loads(response.choices[0].message.content)

    # Persist compressed context to PostgreSQL
    await db.execute(
        update(Trip)
        .where(Trip.session_id == session_id)
        .values(compressed_context=compressed)
    )
    await db.commit()

    # Update Redis with compressed version (overwrites raw)
    await update_trip_context(session_id, {"compressed_summary": json.dumps(compressed)})

    return compressed
