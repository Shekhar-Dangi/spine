"""
Chapter deep-explain endpoint — SSE streaming + cached result retrieval.
Supports built-in modes (story, first_principles, systems, derivation, synthesis)
and user-defined custom modes via custom_template in the request body.
"""
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.deps import get_current_user
from db.database import get_db
from db.models import Book, Chapter, ChapterExplain, IngestStatus, User
from services import explain as explain_svc

router = APIRouter(prefix="/api/books", tags=["explain"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class ExplainRequest(BaseModel):
    custom_template: str | None = None


class ExplainChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ExplainChatRequest(BaseModel):
    question: str
    explain_content: str
    history: list[ExplainChatMessage] = []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/{book_id}/chapters/{chapter_id}/explain/modes")
async def get_explain_modes(
    book_id: int,
    chapter_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return which explain modes are cached for this chapter, with timestamps."""
    result = await db.execute(
        select(ChapterExplain).where(
            ChapterExplain.book_id == book_id,
            ChapterExplain.chapter_id == chapter_id,
        )
    )
    rows = result.scalars().all()
    cached_modes = {
        row.mode: row.generated_at.isoformat() if row.generated_at else None
        for row in rows
    }
    return {"cached_modes": cached_modes}


@router.get("/{book_id}/chapters/{chapter_id}/explain")
async def get_cached_explain(
    book_id: int,
    chapter_id: int,
    mode: str = Query("story", description="Explain mode"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the cached explanation for a chapter+mode, if one exists."""
    result = await db.execute(
        select(ChapterExplain).where(
            ChapterExplain.chapter_id == chapter_id,
            ChapterExplain.mode == mode,
        )
    )
    cached = result.scalar_one_or_none()
    if not cached or cached.book_id != book_id:
        raise HTTPException(
            status_code=404, detail="No cached explanation found.")
    return {
        "content": cached.content,
        "generated_at": cached.generated_at,
        "mode": cached.mode,
    }


@router.post("/{book_id}/chapters/{chapter_id}/explain")
async def explain_chapter(
    book_id: int,
    chapter_id: int,
    mode: str = Query("story", description="Explain mode"),
    force: bool = Query(False, description="Regenerate even if a cached result exists"),
    body: ExplainRequest = Body(default_factory=ExplainRequest),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = await db.get(Book, book_id)
    if not book or book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready.")

    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    # Allow any mode key when custom_template is provided; otherwise must be built-in
    if mode not in explain_svc.VALID_MODES and not body.custom_template:
        raise HTTPException(status_code=400, detail=f"Unknown explain mode '{mode}'.")

    if len(mode) > 32:
        raise HTTPException(status_code=400, detail="Mode key must be 32 characters or fewer.")

    from providers.registry import get_provider_for_task
    provider = await get_provider_for_task("explain", db)

    async def event_stream():
        try:
            async for delta in explain_svc.stream_explain(
                book_id, chapter_id, db, provider,
                mode=mode, force=force,
                template_override=body.custom_template,
            ):
                escaped = delta.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            err = str(exc).replace("\n", " ")
            yield f"data: [ERROR] {err}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{book_id}/chapters/{chapter_id}/explain/chat")
async def explain_chat(
    book_id: int,
    chapter_id: int,
    body: ExplainChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream a chat response grounded in the chapter explanation content."""
    book = await db.get(Book, book_id)
    if not book or book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready.")

    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    if not body.question.strip():
        raise HTTPException(status_code=422, detail="Question cannot be empty.")

    from providers.registry import get_provider_for_task
    provider = await get_provider_for_task("explain", db)

    history_dicts = [{"role": m.role, "content": m.content} for m in body.history]

    async def event_stream():
        try:
            async for delta in explain_svc.stream_explain_chat(
                body.question, body.explain_content, history_dicts, provider
            ):
                escaped = delta.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            err = str(exc).replace("\n", " ")
            yield f"data: [ERROR] {err}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
