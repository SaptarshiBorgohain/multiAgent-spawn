"""
Magic-link authentication.

Flow:
  POST /api/auth/send   → create/find User, generate MagicToken, send Resend email
  GET  /api/auth/verify → validate token, mark used, return JWT
  GET  /api/auth/me     → decode JWT from Authorization header, return user payload
"""
import asyncio
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.database import get_db
from db.models import MagicToken, User

router = APIRouter(prefix="/api/auth", tags=["auth"])

_ALGO = "HS256"
_TOKEN_TTL_MINUTES = 15
_JWT_TTL_DAYS = 30


# ─── JWT helpers ─────────────────────────────────────────────────────────────


def _issue_jwt(user: User) -> str:
    exp = datetime.now(tz=timezone.utc) + timedelta(days=_JWT_TTL_DAYS)
    return jwt.encode(
        {
            "user_id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "avatar_color": user.avatar_color,
            "exp": exp,
        },
        settings.secret_key,
        algorithm=_ALGO,
    )


def decode_jwt(token: str) -> dict:
    """Decode and verify a JWT. Raises jwt.ExpiredSignatureError / jwt.InvalidTokenError."""
    return jwt.decode(token, settings.secret_key, algorithms=[_ALGO])


# ─── FastAPI auth dependencies ────────────────────────────────────────────────


def get_optional_user(authorization: Optional[str] = Header(None)) -> dict | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return decode_jwt(authorization.split(" ", 1)[1])
    except Exception:
        return None


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    user = get_optional_user(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user


# ─── Request/response models ──────────────────────────────────────────────────


class SendMagicLinkRequest(BaseModel):
    email: EmailStr
    display_name: str = "Traveller"


class SendResponse(BaseModel):
    message: str


# ─── Routes ──────────────────────────────────────────────────────────────────


@router.post("/send", response_model=SendResponse)
async def send_magic_link(body: SendMagicLinkRequest, db: AsyncSession = Depends(get_db)):
    # Upsert user
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user:
        user = User(email=body.email, display_name=body.display_name)
        db.add(user)
        await db.flush()

    # Create token (64-char hex, expires in 15 min)
    raw_token = secrets.token_hex(32)
    magic = MagicToken(
        user_id=user.id,
        token=raw_token,
        expires_at=datetime.now(tz=timezone.utc) + timedelta(minutes=_TOKEN_TTL_MINUTES),
    )
    db.add(magic)
    await db.commit()

    magic_url = f"{settings.app_url}/?auth_token={raw_token}"

    if settings.resend_api_key:
        try:
            import resend  # optional dependency

            resend.api_key = settings.resend_api_key
            html_body = f"""
            <div style="font-family:monospace;max-width:480px;margin:0 auto;background:#09090b;color:#e4e4e7;padding:32px;border-radius:12px">
              <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#71717a;margin-bottom:24px">TripWeave</div>
              <p style="font-size:14px;color:#a1a1aa">Hi {user.display_name},</p>
              <p style="font-size:14px;color:#71717a">Click below to sign in. Link expires in {_TOKEN_TTL_MINUTES} minutes.</p>
              <a href="{magic_url}" style="display:inline-block;margin-top:16px;background:#f59e0b;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700">
                Open TripWeave →
              </a>
              <p style="margin-top:24px;font-size:11px;color:#3f3f46">If you didn't request this, ignore this email.</p>
            </div>
            """
            await asyncio.to_thread(
                resend.Emails.send,
                {
                    "from": "TripWeave <noreply@resend.dev>",
                    "to": [body.email],
                    "subject": "Your TripWeave magic link 🗺",
                    "html": html_body,
                },
            )
        except Exception as exc:
            # Non-fatal — dev can use the log link
            print(f"[auth] Resend error: {exc}")
            print(f"[auth] MAGIC LINK (fallback): {magic_url}")
    else:
        # Dev mode: print the link to stdout
        print(f"\n[auth] ─── MAGIC LINK (dev mode) ───")
        print(f"[auth] {magic_url}\n")

    return SendResponse(message="Magic link sent. Check your email (or server logs in dev mode).")


@router.get("/verify")
async def verify_magic_link(token: str = Query(...), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MagicToken).where(MagicToken.token == token))
    magic = result.scalar_one_or_none()

    if not magic or magic.used:
        raise HTTPException(status_code=400, detail="Invalid or already-used token.")

    # Compare timezone-aware datetimes
    expires = magic.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(tz=timezone.utc):
        raise HTTPException(status_code=400, detail="Token has expired.")

    magic.used = True

    user_result = await db.execute(select(User).where(User.id == magic.user_id))
    user = user_result.scalar_one()
    await db.commit()

    return {
        "jwt": _issue_jwt(user),
        "user": {
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "avatar_color": user.avatar_color,
        },
    }


@router.get("/me")
async def me(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header.")
    try:
        payload = decode_jwt(authorization.split(" ", 1)[1])
        return {
            "id": payload["user_id"],
            "email": payload["email"],
            "display_name": payload["display_name"],
            "avatar_color": payload.get("avatar_color", "#6366f1"),
        }
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired.")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token.")
