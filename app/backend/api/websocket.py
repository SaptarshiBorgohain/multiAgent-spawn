"""
WebSocket endpoint for real-time trip updates.

Subscribes to Redis Pub/Sub channel `trip:{session_id}:events`
and streams events to the browser.
"""
import asyncio
import json

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis.exceptions import TimeoutError as RedisTimeoutError

from config import settings

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/{session_id}")
async def trip_websocket(websocket: WebSocket, session_id: str):
    await websocket.accept()

    # Dedicated client with no socket timeout — pubsub must block indefinitely
    r = await aioredis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_timeout=None,
        socket_connect_timeout=5,
    )
    pubsub = r.pubsub()
    await pubsub.subscribe(f"trip:{session_id}:events")

    try:
        while True:
            try:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=30)
            except (RedisTimeoutError, asyncio.TimeoutError):
                # No message within 30 s — send a keepalive ping and loop
                try:
                    await websocket.send_text('{"type":"ping"}')
                except Exception:
                    break
                continue

            if message is None:
                # Idle window elapsed — ping browser to keep connection alive
                try:
                    await websocket.send_text('{"type":"ping"}')
                except Exception:
                    break
                continue

            if message["type"] == "message":
                await websocket.send_text(message["data"])

    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(f"trip:{session_id}:events")
        await r.aclose()
