"""
Worker runner — starts a fixed pool of long-lived workers.
Each worker loops forever, blocking on the Redis Stream until a task arrives.
"""
import asyncio

from workers.worker import run_worker

CONCURRENCY = 4  # parallel workers


async def main() -> None:
    print(f"Worker runner started with concurrency={CONCURRENCY}")
    await asyncio.gather(
        *[run_worker(f"worker-{i}") for i in range(CONCURRENCY)]
    )


if __name__ == "__main__":
    asyncio.run(main())
