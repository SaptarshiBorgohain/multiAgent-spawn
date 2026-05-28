# 🧵 TripWeave

**Autonomous Multi-Agent Travel Orchestration Runtime**

---

## Architecture

```
Frontend (Next.js + WebSocket)
        │
        ▼
FastAPI API  ──────────────────────────────────────────────────┐
        │                                                       │
        ▼                                                       │
Planner/Orchestrator (Task DAG generator)                      │
        │                                                       │
        ▼                                                       │
Redis Streams (Task Bus)                                        │
   │         │         │                                        │
   ▼         ▼         ▼                                        │
Worker    Worker    Worker  (ephemeral, one task each)          │
   └─────────┴─────────┘                                        │
              │                                                  │
              ▼                                                  │
     Redis Memory Layer ◄───────────────────────────────────────┘
   ┌───────────────────┐
   │ Active Context    │  (trip:123:context  — TTL hash)
   │ Agent Statuses    │  (trip:123:agents   — running/done)
   │ Pub/Sub Events    │  (trip:123:events   — → WebSocket)
   └─────────┬─────────┘
             │ compress every N interactions
             ▼
     PostgreSQL  (trips, task_records, itineraries)
             │
             ▼
   Elasticsearch  (places / cafes / hotels / transport)
                  Sharded by region (asia / europe / india)
```

---

## Memory Layers

| Layer | Store | What |
|-------|-------|------|
| 1 — Active Runtime | Redis Hash (TTL 6h) | destination, budget, style, selections |
| 2 — Compressed Context | PostgreSQL | compressed_context JSON, user prefs |
| 3 — Semantic Knowledge | Elasticsearch | places, hotels, cafes, transport |

---

## Dynamic Worker Model

No predefined agents. The planner emits tasks like:
```json
{
  "task_type": "food_discovery",
  "intent": { "destination": "Tokyo", "travel_style": "anime + cafes" },
  "session_id": "uuid",
  "depends_on": ["destination_research"]
}
```
Workers:
1. Pull one task from Redis Streams
2. Check upstream dependencies (Redis agent statuses)
3. Execute the right tool (cache-first via Elasticsearch → Google Places fallback)
4. Write results to Redis context
5. Publish real-time event to WebSocket
6. ACK and exit

---

## Search: Cache-First Retrieval

```
Worker needs "cafes in Tokyo"
        │
        ▼
Query Elasticsearch  (cafes_index, asia shard, last_updated < 7d)
        │
    HIT ─────────────► return cached results
        │
    MISS
        │
        ▼
Google Places API
        │
        ▼
Normalize + index into Elasticsearch
        │
        ▼
return results
```

---

## Autonomous Replanning

If `estimated_cost > budget_inr` the orchestrator autonomously spawns a
`hotel_planning` task with `budget_constraint: "cheaper"` — no human input needed.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 + Tailwind |
| API | FastAPI + WebSockets |
| Orchestrator | Python async |
| Task Bus | Redis Streams + Consumer Groups |
| Shared Memory | Redis Hashes + Pub/Sub |
| Persistent DB | PostgreSQL (SQLAlchemy async) |
| Knowledge Store | Elasticsearch 8 (geo sharded) |
| LLM | OpenAI gpt-4o-mini |
| External Search | Google Places API |

---

## Running Locally

```bash
cp .env.example .env
# fill in OPENAI_API_KEY and GOOGLE_PLACES_API_KEY

docker compose up --build
```

Services:
- Frontend: http://localhost:3000
- API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Elasticsearch: http://localhost:9200

---

## Project Structure

```
app/
├── backend/
│   ├── main.py                    # FastAPI entrypoint
│   ├── config.py                  # Settings (pydantic-settings)
│   ├── worker_runner.py           # Spawns N concurrent ephemeral workers
│   ├── api/
│   │   ├── trips.py               # REST: start trip, get context, replan
│   │   └── websocket.py           # WS: real-time event stream
│   ├── orchestrator/
│   │   ├── planner.py             # DAG generator + autonomous replanning
│   │   └── context_compressor.py  # LLM compression → Postgres
│   ├── workers/
│   │   ├── worker.py              # Ephemeral task consumer
│   │   └── tools.py               # Tool registry (places, hotels, food…)
│   ├── cache/
│   │   └── redis_client.py        # Streams, Hashes, Pub/Sub helpers
│   ├── search/
│   │   └── es_client.py           # Elasticsearch sharded knowledge layer
│   └── db/
│       ├── database.py            # Async SQLAlchemy engine
│       └── models.py              # Trip, TaskRecord, Itinerary
└── frontend/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx               # Chat UI + live agent feed
    │   └── globals.css
    ├── next.config.js
    └── package.json
```
