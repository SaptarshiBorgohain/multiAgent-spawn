# Graph Report - .  (2026-05-27)

## Corpus Check
- Corpus is ~3,637 words - fits in a single context window. You may not need a graph.

## Summary
- 205 nodes · 269 edges · 28 communities (20 shown, 8 thin omitted)
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 53 edges (avg confidence: 0.74)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Redis Planner Runtime|Redis Planner Runtime]]
- [[_COMMUNITY_TypeScript Compiler Config|TypeScript Compiler Config]]
- [[_COMMUNITY_Trip Session API|Trip Session API]]
- [[_COMMUNITY_Frontend Package Dependencies|Frontend Package Dependencies]]
- [[_COMMUNITY_Autonomous Planning Patterns|Autonomous Planning Patterns]]
- [[_COMMUNITY_FastAPI Lifecycle and ES|FastAPI Lifecycle and ES]]
- [[_COMMUNITY_Backend Settings and Storage|Backend Settings and Storage]]
- [[_COMMUNITY_Worker Tool Handlers|Worker Tool Handlers]]
- [[_COMMUNITY_Memory and Compression Strategy|Memory and Compression Strategy]]
- [[_COMMUNITY_Database Layer Core|Database Layer Core]]
- [[_COMMUNITY_WebSocket Event Streaming|WebSocket Event Streaming]]
- [[_COMMUNITY_Pydantic Settings Model|Pydantic Settings Model]]
- [[_COMMUNITY_Frontend Agent Event UI|Frontend Agent Event UI]]
- [[_COMMUNITY_App Layout Metadata|App Layout Metadata]]
- [[_COMMUNITY_Worker Runner Loop|Worker Runner Loop]]
- [[_COMMUNITY_Next Environment Wiring|Next Environment Wiring]]
- [[_COMMUNITY_Frontend Styling Bridge|Frontend Styling Bridge]]
- [[_COMMUNITY_Async Session Factory|Async Session Factory]]
- [[_COMMUNITY_Declarative Base Anchor|Declarative Base Anchor]]
- [[_COMMUNITY_LLM Itinerary Synthesis|LLM Itinerary Synthesis]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `get_redis()` - 13 edges
3. `Trip` - 10 edges
4. `str` - 9 edges
5. `update_trip_context()` - 9 edges
6. `run_worker()` - 9 edges
7. `places_search()` - 9 edges
8. `plan_trip()` - 9 edges
9. `get_trip_context()` - 8 edges
10. `search_knowledge()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `trip_websocket Real-Time Event Stream` --shares_data_with--> `Redis Streams Task Bus`  [EXTRACTED]
  app/backend/api/websocket.py → docker-compose.yml
- `places_search Cache-First Search Handler` --shares_data_with--> `Elasticsearch Semantic Knowledge Store`  [EXTRACTED]
  app/backend/workers/tools.py → docker-compose.yml
- `Dynamic Worker Model Pattern` --rationale_for--> `run_worker Dynamic Task Consumer`  [EXTRACTED]
  README.md → app/backend/workers/worker.py
- `run_worker Dynamic Task Consumer` --shares_data_with--> `Redis Streams Task Bus`  [EXTRACTED]
  app/backend/workers/worker.py → docker-compose.yml
- `plan_trip Generate Task DAG` --shares_data_with--> `Redis Streams Task Bus`  [EXTRACTED]
  app/backend/orchestrator/planner.py → docker-compose.yml

## Hyperedges (group relationships)
- **Asynchronous Task Processing Pipeline** — page_tsx_component, trips_router_module, redis_client_module, worker_runner_module [INFERRED 0.85]
- **Search & Knowledge Discovery Layer** — elasticsearch_client_module, redis_client_module, database_models_module [INFERRED 0.75]
- **Real-Time Event Streaming System** — page_tsx_component, websocket_router_module, redis_client_module [INFERRED 0.80]
- **Trip Execution Pipeline: API → Planner → Workers → Results** — trips_start_trip, planner_plan_trip, worker_run_worker, stack_redis_streams [EXTRACTED 0.95]
- **Search-Context Flow: Tool handlers → Cache-First Search → Elasticsearch → Result Update** — tools_places_search, stack_elasticsearch, tools_destination_research, tools_transport_planning, tools_hotel_planning, tools_food_discovery [EXTRACTED 0.90]
- **Memory Persistence: Active Context → Compression → Storage** — compressor_maybe_compress, compressor_compress_context, stack_postgresql, stack_redis_streams [EXTRACTED 0.92]

## Communities (28 total, 8 thin omitted)

### Community 0 - "Redis Planner Runtime"
Cohesion: 0.12
Nodes (31): int, str, str, str, bool, ack_task(), ensure_consumer_group(), get_all_agent_statuses() (+23 more)

### Community 1 - "TypeScript Compiler Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 2 - "Trip Session API"
Cohesion: 0.18
Nodes (17): get_context(), FastAPI routes for trip planning sessions., replan(), start_trip(), StartTripRequest, StartTripResponse, AsyncSession, str (+9 more)

### Community 3 - "Frontend Package Dependencies"
Cohesion: 0.11
Nodes (18): dependencies, next, react, react-dom, devDependencies, autoprefixer, postcss, tailwindcss (+10 more)

### Community 4 - "Autonomous Planning Patterns"
Cohesion: 0.11
Nodes (18): Autonomous Replanning Pattern, Dynamic Worker Model Pattern, Task DAG with Explicit Dependencies, get_db Async Session Dependency, TASK_DEPENDENCY_MAP Task Ordering, _build_dag Create Ordered Task List, _extract_intent Parse User Query via LLM, handle_budget_exceeded Spawn Cheaper Hotels (+10 more)

### Community 5 - "FastAPI Lifecycle and ES"
Cohesion: 0.16
Nodes (15): AsyncElasticsearch, lifespan(), TripWeave FastAPI entrypoint., int, str, FastAPI, _get_es(), index_result() (+7 more)

### Community 6 - "Backend Settings and Storage"
Cohesion: 0.19
Nodes (13): Backend Configuration Settings, Database Models (Trip, TaskRecord, Itinerary), Elasticsearch Search Client, Google Places API Integration, Next.js Configuration, OpenAI API Integration, Home Page Component (page.tsx), Redis Client (Task Streams & Context) (+5 more)

### Community 7 - "Worker Tool Handlers"
Cohesion: 0.30
Nodes (11): str, update_trip_context(), destination_research(), food_discovery(), _google_places_search(), hotel_planning(), itinerary_optimization(), places_search() (+3 more)

### Community 8 - "Memory and Compression Strategy"
Cohesion: 0.24
Nodes (11): Cache-First Search Pattern, Three-Layer Memory Architecture, compress_context Summarize and Persist, maybe_compress Periodic Compression, Elasticsearch Semantic Knowledge Store, PostgreSQL Persistent Store, destination_research Task Handler, food_discovery Task Handler (+3 more)

### Community 9 - "Database Layer Core"
Cohesion: 0.33
Nodes (4): Base, Itinerary, TaskRecord, DeclarativeBase

### Community 10 - "WebSocket Event Streaming"
Cohesion: 0.40
Nodes (4): WebSocket endpoint for real-time trip updates.  Subscribes to Redis Pub/Sub chan, trip_websocket(), str, WebSocket

### Community 11 - "Pydantic Settings Model"
Cohesion: 0.50
Nodes (3): Config, Settings, BaseSettings

## Knowledge Gaps
- **61 isolated node(s):** `nextConfig`, `name`, `version`, `private`, `dev` (+56 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `update_trip_context()` connect `Worker Tool Handlers` to `Redis Planner Runtime`, `Trip Session API`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `get_redis()` connect `Redis Planner Runtime` to `WebSocket Event Streaming`, `Worker Tool Handlers`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `places_search()` connect `Worker Tool Handlers` to `FastAPI Lifecycle and ES`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `Trip` (e.g. with `start_trip()` and `StartTripRequest`) actually correct?**
  _`Trip` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `update_trip_context()` (e.g. with `compress_context()` and `destination_research()`) actually correct?**
  _`update_trip_context()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `nextConfig`, `name`, `version` to the rest of the system?**
  _87 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Redis Planner Runtime` be split into smaller, more focused modules?**
  _Cohesion score 0.12299465240641712 - nodes in this community are weakly interconnected._