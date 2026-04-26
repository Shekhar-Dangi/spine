"""
LLM usage statistics — per-user aggregated view of llm_calls.

GET /api/llm-stats?period=7d|30d|90d|all
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth.deps import get_current_user
from db.database import get_db
from db.models import LlmCall, User

router = APIRouter(prefix="/api/llm-stats", tags=["llm-stats"])

_PERIODS = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
}


def _period_start(period: str) -> datetime | None:
    days = _PERIODS.get(period)
    if days is None:
        return None
    return datetime.now(timezone.utc) - timedelta(days=days)


@router.get("")
async def get_llm_stats(
    period: str = Query("30d", description="Time window: 7d, 30d, 90d, or all"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    since = _period_start(period)

    base_filter = [LlmCall.user_id == current_user.id]
    if since:
        base_filter.append(LlmCall.created_at >= since)

    # --- Summary ---
    summary_row = await db.execute(
        select(
            func.count(LlmCall.id).label("total_calls"),
            func.count(LlmCall.id).filter(LlmCall.status == "error").label("error_count"),
            func.sum(LlmCall.prompt_tokens).label("total_prompt_tokens"),
            func.sum(LlmCall.completion_tokens).label("total_completion_tokens"),
            func.sum(LlmCall.estimated_cost_usd).label("total_cost"),
            func.avg(LlmCall.latency_ms).label("avg_latency_ms"),
        ).where(*base_filter)
    )
    s = summary_row.one()
    total_calls = s.total_calls or 0
    error_count = int(s.error_count or 0)

    # --- By task ---
    task_rows = await db.execute(
        select(
            LlmCall.task_name,
            func.count(LlmCall.id).label("calls"),
            func.sum(LlmCall.prompt_tokens).label("prompt_tokens"),
            func.sum(LlmCall.completion_tokens).label("completion_tokens"),
            func.sum(LlmCall.estimated_cost_usd).label("cost"),
        )
        .where(*base_filter)
        .group_by(LlmCall.task_name)
        .order_by(func.count(LlmCall.id).desc())
    )
    by_task = [
        {
            "task_name": row.task_name or "unknown",
            "calls": row.calls,
            "prompt_tokens": row.prompt_tokens or 0,
            "completion_tokens": row.completion_tokens or 0,
            "estimated_cost_usd": round(float(row.cost), 6) if row.cost is not None else None,
        }
        for row in task_rows
    ]

    # --- By model ---
    model_rows = await db.execute(
        select(
            LlmCall.model,
            LlmCall.provider_type,
            func.count(LlmCall.id).label("calls"),
            func.sum(LlmCall.prompt_tokens).label("prompt_tokens"),
            func.sum(LlmCall.completion_tokens).label("completion_tokens"),
            func.sum(LlmCall.estimated_cost_usd).label("cost"),
        )
        .where(*base_filter)
        .group_by(LlmCall.model, LlmCall.provider_type)
        .order_by(func.count(LlmCall.id).desc())
    )
    by_model = [
        {
            "model": row.model,
            "provider_type": row.provider_type,
            "calls": row.calls,
            "prompt_tokens": row.prompt_tokens or 0,
            "completion_tokens": row.completion_tokens or 0,
            "estimated_cost_usd": round(float(row.cost), 6) if row.cost is not None else None,
        }
        for row in model_rows
    ]

    # --- By day (for chart) ---
    day_rows = await db.execute(
        select(
            func.date_trunc("day", LlmCall.created_at).label("day"),
            func.count(LlmCall.id).label("calls"),
            func.sum(LlmCall.prompt_tokens).label("prompt_tokens"),
            func.sum(LlmCall.completion_tokens).label("completion_tokens"),
            func.sum(LlmCall.estimated_cost_usd).label("cost"),
        )
        .where(*base_filter)
        .group_by(text("day"))
        .order_by(text("day"))
    )
    by_day = [
        {
            "date": row.day.date().isoformat(),
            "calls": row.calls,
            "prompt_tokens": row.prompt_tokens or 0,
            "completion_tokens": row.completion_tokens or 0,
            "estimated_cost_usd": round(float(row.cost), 6) if row.cost is not None else None,
        }
        for row in day_rows
    ]

    return {
        "period": period,
        "from_date": since.isoformat() if since else None,
        "to_date": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_calls": total_calls,
            "error_count": error_count,
            "error_rate": round(error_count / total_calls, 4) if total_calls else 0,
            "total_prompt_tokens": int(s.total_prompt_tokens or 0),
            "total_completion_tokens": int(s.total_completion_tokens or 0),
            "estimated_cost_usd": round(float(s.total_cost), 6) if s.total_cost is not None else None,
            "avg_latency_ms": round(float(s.avg_latency_ms or 0)),
        },
        "by_task": by_task,
        "by_model": by_model,
        "by_day": by_day,
    }
