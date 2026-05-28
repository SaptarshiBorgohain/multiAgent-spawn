from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from db.database import Base


class Trip(Base):
    __tablename__ = "trips"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(String, unique=True, nullable=False)
    user_query = Column(Text, nullable=False)
    destination = Column(String)
    status = Column(String, default="planning")  # planning | in_progress | completed
    compressed_context = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class TaskRecord(Base):
    __tablename__ = "task_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id = Column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    task_type = Column(String, nullable=False)
    task_payload = Column(JSON, nullable=False)
    result = Column(JSON)
    status = Column(String, default="pending")  # pending | running | done | failed
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Itinerary(Base):
    __tablename__ = "itineraries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id = Column(UUID(as_uuid=True), ForeignKey("trips.id"), nullable=False)
    day = Column(String)
    content = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ─── Auth ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False, default="Traveller")
    avatar_color = Column(String, default="#6366f1")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class MagicToken(Base):
    __tablename__ = "magic_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ─── Collaboration ────────────────────────────────────────────────────────────

class TripMember(Base):
    __tablename__ = "trip_members"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id = Column(UUID(as_uuid=True), ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False, default="viewer")  # owner | editor | viewer
    joined_at = Column(DateTime(timezone=True), server_default=func.now())


class TripInvite(Base):
    __tablename__ = "trip_invites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id = Column(UUID(as_uuid=True), ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(48), unique=True, nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    role_to_grant = Column(String, default="viewer")
    expires_at = Column(DateTime(timezone=True), nullable=True)
    uses_count = Column(Integer, default=0)
    max_uses = Column(Integer, default=100)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ─── Expenses ─────────────────────────────────────────────────────────────────

class Expense(Base):
    __tablename__ = "expenses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trip_id = Column(UUID(as_uuid=True), ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    paid_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    category = Column(String, default="other")  # food | transport | hotel | activity | other
    expense_date = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    expense_id = Column(UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount_owed = Column(Numeric(10, 2), nullable=False)
    is_settled = Column(Boolean, default=False, nullable=False)
    settled_at = Column(DateTime(timezone=True), nullable=True)


# ─── Custom Agents ─────────────────────────────────────────────────────────────

class CustomAgent(Base):
    __tablename__ = "custom_agents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    description = Column(Text, default="")
    system_prompt = Column(Text, default="")
    code = Column(Text, default="")   # optional Python body; sets `result = {...}`
    api_keys = Column(JSON, default=dict)  # {"KEY_NAME": "value"} injected as secrets
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
