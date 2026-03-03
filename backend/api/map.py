"""
Chapter concept map endpoints.
"""
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db, AsyncSessionLocal
from db.models import Book, Chapter, ChapterMap, IngestStatus
from services import map as map_svc

router = APIRouter(prefix="/api/books", tags=["map"])


@router.post("/{book_id}/chapters/{chapter_id}/map/generate", response_model=dict)
async def generate_map(
    book_id: int,
    chapter_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    book = await db.get(Book, book_id)
    if not book or book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready.")

    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    from providers.registry import get_provider_for_task
    provider = await get_provider_for_task("map_extract", db)

    async def _task():
        async with AsyncSessionLocal() as bg_db:
            await map_svc.generate_map(book_id, chapter_id, bg_db, provider)

    background_tasks.add_task(_task)
    return {"book_id": book_id, "chapter_id": chapter_id, "status": "generating"}


@router.get("/{book_id}/chapters/{chapter_id}/map", response_model=dict)
async def get_map(
    book_id: int,
    chapter_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChapterMap).where(
            ChapterMap.book_id == book_id,
            ChapterMap.chapter_id == chapter_id,
        )
    )
    chapter_map = result.scalar_one_or_none()
    if not chapter_map:
        raise HTTPException(status_code=404, detail="Map not generated yet.")

    return {
        "id": chapter_map.id,
        "book_id": book_id,
        "chapter_id": chapter_id,
        "nodes": json.loads(chapter_map.nodes_json),
        "edges": json.loads(chapter_map.edges_json),
        "generated_at": chapter_map.generated_at.isoformat() if chapter_map.generated_at else None,
    }
