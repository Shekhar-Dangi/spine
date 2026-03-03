"""
Chapter deep-explain endpoint — SSE streaming + cached result retrieval.
Supports multiple explain modes: story, first_principles, systems, derivation, synthesis.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Book, Chapter, ChapterExplain, IngestStatus
from services import explain as explain_svc

router = APIRouter(prefix="/api/books", tags=["explain"])


@router.get("/{book_id}/chapters/{chapter_id}/explain/modes")
async def get_explain_modes(
    book_id: int,
    chapter_id: int,
    db: AsyncSession = Depends(get_db),
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
    force: bool = Query(
        False, description="Regenerate even if a cached result exists"),
    db: AsyncSession = Depends(get_db),
):
    book = await db.get(Book, book_id)
    if not book or book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready.")

    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    if mode not in explain_svc.VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Unknown explain mode '{mode}'.")

    from providers.registry import get_provider_for_task
    provider = await get_provider_for_task("explain", db)

    async def event_stream():
        try:
            async for delta in explain_svc.stream_explain(
                book_id, chapter_id, db, provider, mode=mode, force=force
            ):
                # Escape newlines so each SSE data line carries a clean delta
                escaped = delta.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            err = str(exc).replace("\n", " ")
            yield f"data: [ERROR] {err}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
