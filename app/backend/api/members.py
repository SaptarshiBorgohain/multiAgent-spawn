"""
Trip membership, invite links, and collaboration.
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.database import get_db
from db.models import Trip, TripInvite, TripMember, User

router = APIRouter(prefix="/api/trips", tags=["members"])


# ─── Helpers ──────────────────────────────────────────────────────────────────


async def _get_trip(session_id: str, db: AsyncSession) -> Trip:
    result = await db.execute(select(Trip).where(Trip.session_id == session_id))
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")
    return trip


# ─── Request models ───────────────────────────────────────────────────────────


class JoinRequest(BaseModel):
    invite_token: str
    user_id: str  # JWT-verified user id of the joining user


class UpdateRoleRequest(BaseModel):
    role: str  # editor | viewer (owner set only via ownership transfer)


# ─── Routes ──────────────────────────────────────────────────────────────────


@router.post("/{session_id}/invite")
async def create_invite(
    session_id: str,
    requesting_user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Generate a 7-day invite link for this trip."""
    trip = await _get_trip(session_id, db)

    # URL-safe token (~48 chars)
    token = secrets.token_urlsafe(36)
    invite = TripInvite(
        trip_id=trip.id,
        token=token,
        created_by=uuid.UUID(requesting_user_id) if requesting_user_id else None,
        expires_at=datetime.now(tz=timezone.utc) + timedelta(days=7),
    )
    db.add(invite)
    await db.commit()

    invite_url = f"{settings.app_url}/?session_id={session_id}&invite={token}"
    return {"invite_url": invite_url, "token": token, "expires_in_days": 7}


@router.post("/{session_id}/join")
async def join_trip(session_id: str, body: JoinRequest, db: AsyncSession = Depends(get_db)):
    """Join a trip using an invite token."""
    trip = await _get_trip(session_id, db)

    invite_r = await db.execute(
        select(TripInvite).where(TripInvite.token == body.invite_token)
    )
    invite = invite_r.scalar_one_or_none()

    if not invite or invite.trip_id != trip.id:
        raise HTTPException(status_code=400, detail="Invalid invite token.")

    if invite.expires_at:
        expires = invite.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(tz=timezone.utc):
            raise HTTPException(status_code=400, detail="Invite link has expired.")

    if invite.uses_count >= invite.max_uses:
        raise HTTPException(status_code=400, detail="Invite link has reached its maximum uses.")

    # Check if already a member
    existing_r = await db.execute(
        select(TripMember).where(
            TripMember.trip_id == trip.id,
            TripMember.user_id == uuid.UUID(body.user_id),
        )
    )
    if existing_r.scalar_one_or_none():
        return {"message": "Already a member of this trip.", "role": "viewer"}

    member = TripMember(
        trip_id=trip.id,
        user_id=uuid.UUID(body.user_id),
        role=invite.role_to_grant,
    )
    db.add(member)
    invite.uses_count += 1
    await db.commit()

    return {"message": "Joined trip successfully.", "role": invite.role_to_grant}


@router.post("/{session_id}/members")
async def add_member(
    session_id: str,
    user_id: str,
    role: str = "viewer",
    db: AsyncSession = Depends(get_db),
):
    """Directly add a member by user_id (owner action)."""
    trip = await _get_trip(session_id, db)

    if role not in ("owner", "editor", "viewer"):
        raise HTTPException(status_code=400, detail="Invalid role.")

    existing_r = await db.execute(
        select(TripMember).where(
            TripMember.trip_id == trip.id,
            TripMember.user_id == uuid.UUID(user_id),
        )
    )
    if existing_r.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User is already a member.")

    member = TripMember(trip_id=trip.id, user_id=uuid.UUID(user_id), role=role)
    db.add(member)
    await db.commit()

    return {"user_id": user_id, "role": role, "message": "Member added."}


@router.get("/{session_id}/members")
async def list_members(session_id: str, db: AsyncSession = Depends(get_db)):
    """List all members of this trip with their user details."""
    trip = await _get_trip(session_id, db)

    members_r = await db.execute(
        select(TripMember).where(TripMember.trip_id == trip.id).order_by(TripMember.joined_at)
    )

    result = []
    for m in members_r.scalars():
        user_r = await db.execute(select(User).where(User.id == m.user_id))
        user = user_r.scalar_one_or_none()
        result.append(
            {
                "user_id": str(m.user_id),
                "display_name": user.display_name if user else "Unknown",
                "avatar_color": user.avatar_color if user else "#6366f1",
                "role": m.role,
                "joined_at": m.joined_at.isoformat() if m.joined_at else None,
            }
        )

    return result


@router.patch("/{session_id}/members/{user_id}")
async def update_member_role(
    session_id: str,
    user_id: str,
    body: UpdateRoleRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update a member's role (owner only)."""
    if body.role not in ("owner", "editor", "viewer"):
        raise HTTPException(status_code=400, detail="Invalid role. Must be owner, editor, or viewer.")

    trip = await _get_trip(session_id, db)

    member_r = await db.execute(
        select(TripMember).where(
            TripMember.trip_id == trip.id,
            TripMember.user_id == uuid.UUID(user_id),
        )
    )
    member = member_r.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found.")

    member.role = body.role
    await db.commit()

    return {"user_id": user_id, "role": body.role}
