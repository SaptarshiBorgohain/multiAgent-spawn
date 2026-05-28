# Graph Report - /Users/saptarshiborgohain/Documents/multiagent-AI_planner  (2026-05-29)

## Corpus Check
- 0 files · ~19,477 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 342 nodes · 622 edges · 26 communities (18 shown, 8 thin omitted)
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 147 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Trip Planning API (context, replan, orchestration)|Trip Planning API (context, replan, orchestration)]]
- [[_COMMUNITY_Frontend UI (Next.js components, agent cards)|Frontend UI (Next.js components, agent cards)]]
- [[_COMMUNITY_Expenses API (create, split, settle)|Expenses API (create, split, settle)]]
- [[_COMMUNITY_API Routers Registry (all FastAPI routers)|API Routers Registry (all FastAPI routers)]]
- [[_COMMUNITY_Trip CRUD & Clarification|Trip CRUD & Clarification]]
- [[_COMMUNITY_Custom Agent Editor (AI-gen, config, lint)|Custom Agent Editor (AI-gen, config, lint)]]
- [[_COMMUNITY_WebSocket  Real-time Events|WebSocket / Real-time Events]]
- [[_COMMUNITY_Worker & Sandbox (RestrictedPython, tools)|Worker & Sandbox (RestrictedPython, tools)]]
- [[_COMMUNITY_Frontend TypeScript Config|Frontend TypeScript Config]]
- [[_COMMUNITY_Members & Invites API|Members & Invites API]]
- [[_COMMUNITY_Orchestrator  Planner (DAG, context compressor)|Orchestrator / Planner (DAG, context compressor)]]
- [[_COMMUNITY_Auth (magic link, JWT)|Auth (magic link, JWT)]]
- [[_COMMUNITY_Elasticsearch Cache (places, index)|Elasticsearch Cache (places, index)]]
- [[_COMMUNITY_Settlement Utilities|Settlement Utilities]]
- [[_COMMUNITY_Config & Settings|Config & Settings]]
- [[_COMMUNITY_DB Migration & CustomAgent Model|DB Migration & CustomAgent Model]]
- [[_COMMUNITY_Apple Icon Asset|Apple Icon Asset]]
- [[_COMMUNITY_App Icon Asset|App Icon Asset]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_Budget Watchdog (replanning)|Budget Watchdog (replanning)]]
- [[_COMMUNITY_Redis Task Stream & Context|Redis Task Stream & Context]]
- [[_COMMUNITY_CORS Middleware Rationale|CORS Middleware Rationale]]
- [[_COMMUNITY_Frontend Docker Service|Frontend Docker Service]]
- [[_COMMUNITY_Redis Connection Singleton|Redis Connection Singleton]]

## God Nodes (most connected - your core abstractions)
1. `frontend_app_page_tsx` - 34 edges
2. `db_models_trip` - 27 edges
3. `uuid` - 20 edges
4. `db_models_user` - 19 edges
5. `basemodel` - 18 edges
6. `backend_api_custom_agents_py` - 18 edges
7. `frontend_tsconfig_compileroptions` - 16 edges
8. `db_models_tripmember` - 16 edges
9. `db_models_customagent` - 15 edges
10. `backend_api_expenses_py` - 15 edges

## Surprising Connections (you probably didn't know these)
- `uuid` --conceptually_related_to--> `api_expenses_create_expense`  [INFERRED 0.16]
  backend/api/expenses.py → backend/api/expenses.py  _High betweenness node: 0.1606_
- `backend_workers_tools_py` --conceptually_related_to--> `uuid`  [INFERRED 0.07]
  backend/workers/tools.py → backend/api/expenses.py  _High betweenness node: 0.0696_
- `fastapi` --conceptually_related_to--> `backend_api_auth_py`  [INFERRED 0.05]
  backend/main.py → backend/api/auth.py  _High betweenness node: 0.0511_
- `db_models_trip` --conceptually_related_to--> `api_expenses_createexpenserequest`  [INFERRED 0.05]
  backend/db/models.py → backend/api/expenses.py  _High betweenness node: 0.0509_
- `backend_api_custom_agents_py` --conceptually_related_to--> `api_custom_agents_rationale_1`  [INFERRED 0.05]
  backend/api/custom_agents.py → backend/api/custom_agents.py  _High betweenness node: 0.0481_

## Hyperedges (group relationships)
- **Trip Planning DAG (6 built-in stages)** — models_trip, redis_client_task_stream, docker_worker_service, redis_client_trip_context, api_trips_router [INFERRED 0.85]
- **Magic Link Auth Flow** — auth_magic_link, auth_jwt, models_magic_token, models_user [EXTRACTED 0.95]
- **Custom Agent Editor Stack** — models_custom_agent, api_custom_agents_router, custom_agent_lint_endpoint, custom_agent_ai_generate_endpoint, req_restricted_python [INFERRED 0.88]
- **Tool Registry DAG (6 built-in stages)** — tools_destination_research, tools_transport_planning, tools_hotel_planning, tools_food_discovery, tools_itinerary_optimization, tools_budget_optimizer, tools_tool_registry [EXTRACTED 0.95]
- **Custom Agent Sandbox Stack** — tools_run_custom_agent, tools_sandbox, sandbox_restricted_python, sandbox_guarded_iter, sandbox_getitem_hook, tools_safe_http_get, tools_safe_http_post [EXTRACTED 0.95]
- **Planner DAG Orchestration** — planner_plan_trip, planner_build_dag, planner_task_dependency_map, planner_handle_budget_exceeded, planner_monitor_replan [EXTRACTED 0.95]
- **Worker Execution Loop (Redis → tool → ACK)** — worker_runner, worker_run_worker, worker_check_deps, tools_tool_registry [EXTRACTED 0.90]
- **Elasticsearch Write-Through Cache** — tools_places_search, es_search_knowledge, es_index_result [EXTRACTED 0.95]

## Communities (26 total, 8 thin omitted)

### Community 0 - "Trip Planning API (context, replan, orchestration)"
Cohesion: 0.09
Nodes (42): get_context(), Run plan_trip in the background so the POST can return immediately.     Any LLM, replan(), rerun_agent(), _run_plan_in_background(), str, int, str (+34 more)

### Community 1 - "Frontend UI (Next.js components, agent cards)"
Cohesion: 0.06
Nodes (21): AGENT_LABEL, AGENT_THOUGHTS, AgentNode, AgentStatus, AuthUser, Balance, CATEGORY_ICONS, CodeEditor() (+13 more)

### Community 2 - "Expenses API (create, split, settle)"
Cohesion: 0.21
Nodes (28): create_expense(), CreateExpenseRequest, delete_expense(), get_balances(), get_settlement(), _get_trip(), list_expenses(), mark_settled() (+20 more)

### Community 3 - "API Routers Registry (all FastAPI routers)"
Cohesion: 0.08
Nodes (27): Custom Agents API (CRUD + lint + AI gen), Expenses API (Splitwise-style), Members & Invites API, Trips API Router, WebSocket Router (SSE/WS events), JWT Token Auth, Magic Link Auth Flow, POST /ai-generate (DeepSeek prompt/code gen) (+19 more)

### Community 4 - "Trip CRUD & Clarification"
Cohesion: 0.14
Nodes (23): clarify_trip(), ClarifyRequest, ClarifyResponse, _get_clarify_llm(), FastAPI routes for trip planning sessions., Given a raw trip brief, return 3-4 targeted clarifying questions that would, RerunAgentRequest, start_trip() (+15 more)

### Community 5 - "Custom Agent Editor (AI-gen, config, lint)"
Cohesion: 0.18
Nodes (23): ai_generate(), AIGenerateRequest, Config, create_custom_agent(), CustomAgentCreate, CustomAgentOut, CustomAgentUpdate, delete_custom_agent() (+15 more)

### Community 6 - "WebSocket / Real-time Events"
Cohesion: 0.12
Nodes (19): WebSocket endpoint for real-time trip updates.  Subscribes to Redis Pub/Sub chan, trip_websocket(), AsyncElasticsearch, str, lifespan(), TripWeave FastAPI entrypoint., int, str (+11 more)

### Community 7 - "Worker & Sandbox (RestrictedPython, tools)"
Cohesion: 0.16
Nodes (21): str, update_trip_context(), budget_optimizer(), destination_research(), food_discovery(), _google_places_search(), hotel_planning(), itinerary_optimization() (+13 more)

### Community 8 - "Frontend TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 9 - "Members & Invites API"
Cohesion: 0.23
Nodes (18): add_member(), create_invite(), _get_trip(), join_trip(), JoinRequest, list_members(), Trip membership, invite links, and collaboration., Directly add a member by user_id (owner action). (+10 more)

### Community 10 - "Orchestrator / Planner (DAG, context compressor)"
Cohesion: 0.12
Nodes (17): context_compressor (summarise old context), _build_dag (6 built-in + N custom agents), plan_trip (intent extract + DAG publish), TASK_DEPENDENCY_MAP (DAG topology), _getitem_ sandbox hook (subscript access), guarded_iter_unpack_sequence (RestrictedPython >= 7.0), RestrictedPython compile_restricted + safe_globals, budget_optimizer (cost breakdown + tips) (+9 more)

### Community 11 - "Auth (magic link, JWT)"
Cohesion: 0.28
Nodes (15): decode_jwt(), get_current_user(), get_optional_user(), _issue_jwt(), me(), Magic-link authentication.  Flow:   POST /api/auth/send   → create/find User, ge, Decode and verify a JWT. Raises jwt.ExpiredSignatureError / jwt.InvalidTokenErro, send_magic_link() (+7 more)

### Community 12 - "Elasticsearch Cache (places, index)"
Cohesion: 0.29
Nodes (7): index_result (write-through cache), search_knowledge (Elasticsearch cache lookup), destination_research (parallel Places + DeepSeek), food_discovery, hotel_planning (budget-aware), places_search (cache-first ES → Google Places), transport_planning

### Community 13 - "Settlement Utilities"
Cohesion: 0.33
Nodes (5): str, float, minimize_cash_flow(), Debt minimisation algorithm for group expense settlement.  Given a dict of {user, Greedy O(n²) algorithm: always pair the biggest creditor with the biggest debtor

### Community 14 - "Config & Settings"
Cohesion: 0.50
Nodes (3): Config, Settings, BaseSettings

### Community 15 - "DB Migration & CustomAgent Model"
Cohesion: 0.50
Nodes (4): Lifespan Startup (DB + ES init), Idempotent api_keys JSONB Migration, CustomAgent Model (api_keys JSONB), RestrictedPython>=7.0 (sandbox)

## Knowledge Gaps
- **83 isolated node(s):** `nextConfig`, `target`, `lib`, `allowJs`, `skipLibCheck` (+78 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_
