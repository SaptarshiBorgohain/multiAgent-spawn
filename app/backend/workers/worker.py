"""
Dynamic Worker

Lifecycle:
  1. Connect to Redis Stream consumer group
  2. Read task
  3. Check dependencies satisfied (peer statuses in Redis)
  4. Execute via tool registry
  5. Update shared context + publish real-time event
  6. ACK message
  7. Exit (ephemeral by design — runner spawns new workers)
"""
import asyncio
import json
import uuid

from cache.redis_client import (
    ack_task,
    ensure_consumer_group,
    get_all_agent_statuses,
    publish_event,
    read_tasks,
    set_agent_status,
)
from workers.tools import TOOL_REGISTRY


async def _check_dependencies(task: dict) -> str:
    """
    Returns:
      'ready'  — all deps done, proceed
      'wait'   — deps pending, re-queue later
      'cancel' — a dep has failed, cascade-fail this task
    """
    session_id = task.get("session_id", "")
    depends_on: list[str] = task.get("depends_on", [])
    if not depends_on:
        return "ready"
    statuses = await get_all_agent_statuses(session_id)
    if any(statuses.get(dep) == "failed" for dep in depends_on):
        return "cancel"
    if all(statuses.get(dep) == "done" for dep in depends_on):
        return "ready"
    return "wait"


async def run_worker(worker_id: str | None = None) -> None:
    """Long-running worker: blocks on the Redis Stream and processes tasks indefinitely."""
    worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
    await ensure_consumer_group()

    print(f"[{worker_id}] started, waiting for tasks...")

    while True:
        try:
            messages = await read_tasks(worker_id, count=1, block_ms=5000)
        except Exception as exc:
            print(f"[{worker_id}] redis read error: {exc}, retrying in 5s...")
            await asyncio.sleep(5)
            continue

        if not messages:
            # block_ms elapsed with no tasks — loop back and block again
            continue

        for _stream, entries in messages:
            for msg_id, data in entries:
                task = json.loads(data["payload"])
                session_id = task.get("session_id", "unknown")
                task_type = task.get("task_type", "unknown")

                print(f"[{worker_id}] received task {task_type} for session {session_id}")

                dep_result = await _check_dependencies(task)

                if dep_result == "cancel":
                    failed_deps = [
                        d for d in task.get("depends_on", [])
                        if (await get_all_agent_statuses(session_id)).get(d) == "failed"
                    ]
                    reason = f"dependency failed: {', '.join(failed_deps)}"
                    print(f"[{worker_id}] cancelling {task_type}: {reason}")
                    await set_agent_status(session_id, task_type, "failed")
                    await publish_event(session_id, {
                        "type": "task_failed",
                        "task_type": task_type,
                        "error": reason,
                    })
                    await ack_task(msg_id)
                    continue

                if dep_result == "wait":
                    print(f"[{worker_id}] dependencies not met for {task_type}, requeueing...")
                    # ACK the current delivery and re-publish so it enters the stream fresh.
                    # This prevents the message piling up in the PEL.
                    from cache.redis_client import publish_task
                    await publish_task(task)
                    await ack_task(msg_id)
                    await asyncio.sleep(1)
                    continue

                await set_agent_status(session_id, task_type, "running")
                await publish_event(session_id, {"type": "task_started", "task_type": task_type})

                try:
                    handler = TOOL_REGISTRY.get(task_type)
                    # Custom agents have task_type "custom:{uuid}" — dispatch dynamically
                    if handler is None and task_type.startswith("custom:"):
                        from workers.tools import run_custom_agent
                        handler = run_custom_agent
                    if handler is None:
                        raise ValueError(f"No tool registered for task_type={task_type}")

                    result = await handler(task)

                    await set_agent_status(session_id, task_type, "done")

                    # Build a human-readable summary and include full data for itinerary
                    if task_type == "itinerary_optimization" and isinstance(result, dict):
                        result_summary = result.get("summary", "Itinerary generated")[:200]
                    elif isinstance(result, dict) and "results" in result:
                        cnt = len(result.get("results", []))
                        result_summary = f"{cnt} place{'s' if cnt != 1 else ''} found"
                    else:
                        result_summary = str(result)[:200]

                    event_data: dict = {
                        "type": "task_completed",
                        "task_type": task_type,
                        "result_summary": result_summary,
                    }
                    if task_type == "itinerary_optimization" and isinstance(result, dict):
                        event_data["result_full"] = result

                    await publish_event(session_id, event_data)
                    print(f"[{worker_id}] completed {task_type}")

                except Exception as exc:
                    await set_agent_status(session_id, task_type, "failed")
                    await publish_event(session_id, {
                        "type": "task_failed",
                        "task_type": task_type,
                        "error": str(exc),
                    })
                    print(f"[{worker_id}] FAILED {task_type}: {exc}")

                finally:
                    await ack_task(msg_id)
