"""
TripWeave FastAPI entrypoint.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.trips import router as trips_router
from api.websocket import router as ws_router
from api.auth import router as auth_router
from api.expenses import router as expenses_router
from api.members import router as members_router
from api.custom_agents import router as custom_agents_router
from db.database import engine, Base
from search.es_client import setup_indexes


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create DB tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent column migration for existing deployments
        await conn.execute(
            __import__("sqlalchemy").text(
                "ALTER TABLE custom_agents ADD COLUMN IF NOT EXISTS api_keys JSONB DEFAULT '{}'::jsonb"
            )
        )
    # Setup Elasticsearch indexes
    await setup_indexes()
    yield


app = FastAPI(title="TripWeave API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trips_router)
app.include_router(ws_router)
app.include_router(auth_router)
app.include_router(expenses_router)
app.include_router(members_router)
app.include_router(custom_agents_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
