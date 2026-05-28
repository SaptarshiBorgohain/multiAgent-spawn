"""
Expense tracking API: create, list, delete expenses; compute balances and optimal settlement.
"""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Expense, ExpenseSplit, Trip, TripMember, User
from utils.settlement import minimize_cash_flow

router = APIRouter(prefix="/api/trips", tags=["expenses"])


# ─── Helpers ──────────────────────────────────────────────────────────────────


async def _get_trip(session_id: str, db: AsyncSession) -> Trip:
    result = await db.execute(select(Trip).where(Trip.session_id == session_id))
    trip = result.scalar_one_or_none()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found.")
    return trip


async def _user_name(user_id: uuid.UUID, db: AsyncSession) -> tuple[str, str]:
    """Returns (display_name, avatar_color) for a user id."""
    r = await db.execute(select(User).where(User.id == user_id))
    u = r.scalar_one_or_none()
    return (u.display_name if u else "Unknown", u.avatar_color if u else "#6366f1")


# ─── Request / response models ────────────────────────────────────────────────


class SplitEntry(BaseModel):
    user_id: str
    amount: float


class CreateExpenseRequest(BaseModel):
    paid_by_user_id: str
    description: str
    amount: float
    category: str = "other"  # food | transport | hotel | activity | other
    expense_date: Optional[str] = None  # ISO date string e.g. "2025-07-01"
    split_equal: bool = True
    custom_splits: list[SplitEntry] = []


class SettleRequest(BaseModel):
    from_user_id: str
    to_user_id: str
    amount: float


# ─── Routes ──────────────────────────────────────────────────────────────────
# IMPORTANT: static sub-paths (/balances, /settlement, /settle) MUST be
# declared before the parameterised route (/{expense_id}) so FastAPI matches
# them correctly.


@router.get("/{session_id}/expenses/balances")
async def get_balances(session_id: str, db: AsyncSession = Depends(get_db)):
    """Returns {user_id, display_name, avatar_color, net_balance} per member."""
    trip = await _get_trip(session_id, db)

    expenses_r = await db.execute(select(Expense).where(Expense.trip_id == trip.id))
    net: dict[str, float] = {}

    for exp in expenses_r.scalars():
        payer_id = str(exp.paid_by)
        net[payer_id] = net.get(payer_id, 0.0) + float(exp.amount)

        splits_r = await db.execute(select(ExpenseSplit).where(ExpenseSplit.expense_id == exp.id))
        for s in splits_r.scalars():
            uid = str(s.user_id)
            net[uid] = net.get(uid, 0.0) - float(s.amount_owed)

    result = []
    for uid, balance in net.items():
        name, color = await _user_name(uuid.UUID(uid), db)
        result.append(
            {
                "user_id": uid,
                "display_name": name,
                "avatar_color": color,
                "net_balance": round(balance, 2),
            }
        )

    return sorted(result, key=lambda x: x["net_balance"], reverse=True)


@router.get("/{session_id}/expenses/settlement")
async def get_settlement(session_id: str, db: AsyncSession = Depends(get_db)):
    """Returns the minimum set of transactions needed to settle all debts."""
    balances = await get_balances(session_id, db=db)
    net = {b["user_id"]: b["net_balance"] for b in balances}
    txns = minimize_cash_flow(net)

    enriched = []
    for t in txns:
        from_name, from_color = await _user_name(uuid.UUID(t["from"]), db)
        to_name, to_color = await _user_name(uuid.UUID(t["to"]), db)
        enriched.append(
            {
                **t,
                "from_name": from_name,
                "to_name": to_name,
                "from_color": from_color,
                "to_color": to_color,
            }
        )

    return enriched


@router.post("/{session_id}/expenses/settle")
async def mark_settled(session_id: str, body: SettleRequest, db: AsyncSession = Depends(get_db)):
    """Mark the debtor's outstanding splits as settled (up to the settled amount)."""
    trip = await _get_trip(session_id, db)

    expenses_r = await db.execute(select(Expense).where(Expense.trip_id == trip.id))
    remaining = body.amount

    for exp in expenses_r.scalars():
        if remaining <= 0.005:
            break
        splits_r = await db.execute(
            select(ExpenseSplit).where(
                ExpenseSplit.expense_id == exp.id,
                ExpenseSplit.user_id == uuid.UUID(body.from_user_id),
                ExpenseSplit.is_settled == False,  # noqa: E712
            )
        )
        for s in splits_r.scalars():
            if remaining <= 0.005:
                break
            s.is_settled = True
            s.settled_at = datetime.now(tz=timezone.utc)
            remaining -= float(s.amount_owed)

    await db.commit()
    return {"settled_amount": round(body.amount - max(remaining, 0), 2)}


@router.get("/{session_id}/expenses")
async def list_expenses(session_id: str, db: AsyncSession = Depends(get_db)):
    trip = await _get_trip(session_id, db)

    expenses_r = await db.execute(
        select(Expense).where(Expense.trip_id == trip.id).order_by(Expense.created_at.desc())
    )

    result = []
    for exp in expenses_r.scalars():
        paid_by_name, paid_by_color = await _user_name(exp.paid_by, db)
        splits_r = await db.execute(select(ExpenseSplit).where(ExpenseSplit.expense_id == exp.id))
        splits = [
            {
                "user_id": str(s.user_id),
                "amount_owed": float(s.amount_owed),
                "is_settled": s.is_settled,
            }
            for s in splits_r.scalars()
        ]
        result.append(
            {
                "id": str(exp.id),
                "paid_by": str(exp.paid_by),
                "paid_by_name": paid_by_name,
                "paid_by_color": paid_by_color,
                "description": exp.description,
                "amount": float(exp.amount),
                "category": exp.category,
                "expense_date": exp.expense_date.isoformat() if exp.expense_date else None,
                "created_at": exp.created_at.isoformat() if exp.created_at else None,
                "splits": splits,
            }
        )

    return result


@router.post("/{session_id}/expenses")
async def create_expense(
    session_id: str, body: CreateExpenseRequest, db: AsyncSession = Depends(get_db)
):
    trip = await _get_trip(session_id, db)

    # Determine who to split with
    members_r = await db.execute(select(TripMember).where(TripMember.trip_id == trip.id))
    member_ids = [str(m.user_id) for m in members_r.scalars()]

    # Fallback: if no TripMember rows, split only with the payer
    if not member_ids:
        member_ids = [body.paid_by_user_id]

    exp = Expense(
        trip_id=trip.id,
        paid_by=uuid.UUID(body.paid_by_user_id),
        description=body.description,
        amount=Decimal(str(body.amount)),
        category=body.category,
        expense_date=date.fromisoformat(body.expense_date) if body.expense_date else None,
    )
    db.add(exp)
    await db.flush()

    if body.split_equal:
        per_person = round(body.amount / len(member_ids), 2)
        for uid in member_ids:
            db.add(
                ExpenseSplit(
                    expense_id=exp.id,
                    user_id=uuid.UUID(uid),
                    amount_owed=Decimal(str(per_person)),
                )
            )
    else:
        for entry in body.custom_splits:
            db.add(
                ExpenseSplit(
                    expense_id=exp.id,
                    user_id=uuid.UUID(entry.user_id),
                    amount_owed=Decimal(str(entry.amount)),
                )
            )

    await db.commit()
    return {"id": str(exp.id), "message": "Expense created."}


@router.delete("/{session_id}/expenses/{expense_id}")
async def delete_expense(
    session_id: str, expense_id: str, db: AsyncSession = Depends(get_db)
):
    # Cascade deletes splits first (FK constraint), then the expense
    await db.execute(
        delete(ExpenseSplit).where(ExpenseSplit.expense_id == uuid.UUID(expense_id))
    )
    await db.execute(delete(Expense).where(Expense.id == uuid.UUID(expense_id)))
    await db.commit()
    return {"deleted": expense_id}
