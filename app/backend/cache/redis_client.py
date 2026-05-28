"""
Redis client + helpers for:
  - Task streams (Redis Streams)
  - Shared trip context (Redis Hashes, TTL)
  - Pub/Sub for real-time frontend updates
"""
import json
from typing import Any

import redis.asyncio as aioredis

from config import settings

_redis: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = await aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_timeout=30,        # must exceed block_ms used in xreadgroup
            socket_connect_timeout=5,
        )
    return _redis


# ── Context (Layer 1) ──────────────────────────────────────────────────────

CONTEXT_TTL = 60 * 60 * 6  # 6 hours


async def set_trip_context(trip_id: str, data: dict) -> None:
    r = await get_redis()
    key = f"trip:{trip_id}:context"
    await r.hset(key, mapping={k: json.dumps(v) for k, v in data.items()})
    await r.expire(key, CONTEXT_TTL)


async def get_trip_context(trip_id: str) -> dict:
    r = await get_redis()
    key = f"trip:{trip_id}:context"
    raw = await r.hgetall(key)
    return {k: json.loads(v) for k, v in raw.items()}


async def update_trip_context(trip_id: str, updates: dict) -> None:
    r = await get_redis()
    key = f"trip:{trip_id}:context"
    await r.hset(key, mapping={k: json.dumps(v) for k, v in updates.items()})
    await r.expire(key, CONTEXT_TTL)


# ── Task Streams ───────────────────────────────────────────────────────────

TASK_STREAM = "tripweave:tasks"
WORKER_GROUP = "workers"


async def publish_task(task: dict) -> str:
    """Push a task onto the Redis Stream. Returns the message ID."""
    r = await get_redis()
    msg_id = await r.xadd(TASK_STREAM, {"payload": json.dumps(task)})
    return msg_id


async def ensure_consumer_group() -> None:
    r = await get_redis()
    try:
        await r.xgroup_create(TASK_STREAM, WORKER_GROUP, id="0", mkstream=True)
    except Exception as exc:
        if "BUSYGROUP" not in str(exc):
            # Group already exists is fine; anything else is not
            print(f"[redis] ensure_consumer_group warning: {exc}")


async def read_tasks(consumer_name: str, count: int = 5, block_ms: int = 2000):
    r = await get_redis()
    messages = await r.xreadgroup(
        WORKER_GROUP,
        consumer_name,
        {TASK_STREAM: ">"},
        count=count,
        block=block_ms,
    )
    return messages


async def ack_task(msg_id: str) -> None:
    r = await get_redis()
    await r.xack(TASK_STREAM, WORKER_GROUP, msg_id)


# ── Agent Status ───────────────────────────────────────────────────────────

async def set_agent_status(trip_id: str, task_type: str, status: str) -> None:
    r = await get_redis()
    key = f"trip:{trip_id}:agents"
    await r.hset(key, task_type, status)
    await r.expire(key, CONTEXT_TTL)


async def get_all_agent_statuses(trip_id: str) -> dict:
    r = await get_redis()
    return await r.hgetall(f"trip:{trip_id}:agents")


# ── Pub/Sub (real-time frontend) ──────────────────────────────────────────

async def publish_event(trip_id: str, event: dict) -> None:
    r = await get_redis()
    channel = f"trip:{trip_id}:events"
    await r.publish(channel, json.dumps(event))
