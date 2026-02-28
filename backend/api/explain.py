"""
Chapter deep-explain endpoint — SSE streaming + cached result retrieval.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Book, Chapter, ChapterExplain, IngestStatus
from services import explain as explain_svc

router = APIRouter(prefix="/api/books", tags=["explain"])


@router.get("/{book_id}/chapters/{chapter_id}/explain")
async def get_cached_explain(
    book_id: int,
    chapter_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Return the cached explanation for a chapter, if one exists."""
    result = await db.execute(
        select(ChapterExplain).where(ChapterExplain.chapter_id == chapter_id)
    )
    cached = result.scalar_one_or_none()
    if not cached or cached.book_id != book_id:
        raise HTTPException(status_code=404, detail="No cached explanation found.")
    return {"content": cached.content, "generated_at": cached.generated_at}


@router.post("/{book_id}/chapters/{chapter_id}/explain")
async def explain_chapter(
    book_id: int,
    chapter_id: int,
    force: bool = Query(False, description="Regenerate even if a cached result exists"),
    db: AsyncSession = Depends(get_db),
):
    book = await db.get(Book, book_id)
    if not book or book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready.")

    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    from providers.registry import get_active_provider
    provider = await get_active_provider(db)

    async def event_stream():
        try:
            async for delta in explain_svc.stream_explain(
                book_id, chapter_id, db, provider, force=force
            ):
                # Escape newlines so each SSE data line carries a clean delta
                escaped = delta.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            err = str(exc).replace("\n", " ")
            yield f"data: [ERROR] {err}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
