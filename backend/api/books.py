"""
Book management endpoints.
"""
from pathlib import Path

import shutil
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.database import get_db, AsyncSessionLocal
from db.models import Book, BookFormat, Chapter, IngestStatus
from services import ingest as ingest_svc

router = APIRouter(prefix="/api/books", tags=["books"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class BookOut(BaseModel):
    id: int
    title: str
    author: str | None
    format: str
    page_count: int | None
    ingest_status: str
    ingest_error: str | None
    ingest_quality_json: str | None

    class Config:
        from_attributes = True


class TocChapterIn(BaseModel):
    index: int
    title: str
    start_page: int | None = None
    end_page: int | None = None
    start_anchor: str | None = None
    end_anchor: str | None = None


class TocConfirmIn(BaseModel):
    chapters: list[TocChapterIn]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/upload", response_model=dict)
async def upload_book(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Save file, create Book row, trigger background parse."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".pdf", ".epub"}:
        raise HTTPException(status_code=400, detail="Only PDF and EPUB files are supported.")

    fmt = BookFormat.PDF if ext == ".pdf" else BookFormat.EPUB
    dest_name = f"{uuid.uuid4().hex}{ext}"
    dest_path = Path(settings.uploads_path) / dest_name

    with dest_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    book = Book(
        title=Path(file.filename or dest_name).stem,
        format=fmt,
        file_path=str(dest_path),
        ingest_status=IngestStatus.UPLOADED,
    )
    db.add(book)
    await db.commit()
    await db.refresh(book)

    book_id = book.id

    async def _parse_task():
        async with AsyncSessionLocal() as bg_db:
            await ingest_svc.parse_book(book_id, bg_db)

    background_tasks.add_task(_parse_task)
    return {"book_id": book_id, "status": book.ingest_status}


@router.get("", response_model=list[BookOut])
async def list_books(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Book).order_by(Book.created_at.desc()))
    return result.scalars().all()


@router.get("/{book_id}", response_model=BookOut)
async def get_book(book_id: int, db: AsyncSession = Depends(get_db)):
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    return book


@router.get("/{book_id}/chapters", response_model=list[dict])
async def get_chapters(book_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Chapter)
        .where(Chapter.book_id == book_id)
        .order_by(Chapter.chapter_index)
    )
    return [
        {
            "id": c.id,
            "index": c.chapter_index,
            "title": c.title,
            "start_page": c.start_page,
            "end_page": c.end_page,
            "start_anchor": c.start_anchor,
            "end_anchor": c.end_anchor,
            "confirmed": c.confirmed,
            "token_estimate": c.token_estimate,
        }
        for c in result.scalars().all()
    ]


@router.get("/{book_id}/chapters/{chapter_id}/text", response_model=dict)
async def get_chapter_text(
    book_id: int,
    chapter_id: int,
    db: AsyncSession = Depends(get_db),
):
    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    text_file = Path(settings.parsed_path) / str(book_id) / f"chapter_{chapter.chapter_index}.txt"
    if not text_file.exists():
        raise HTTPException(status_code=404, detail="Chapter text not yet available.")

    return {"chapter_id": chapter_id, "text": text_file.read_text(encoding="utf-8")}


@router.post("/{book_id}/toc/confirm", response_model=dict)
async def confirm_toc(
    book_id: int,
    body: TocConfirmIn,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """User submits validated TOC → triggers chunk + embed in background."""
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.ingest_status != IngestStatus.PENDING_TOC_REVIEW:
        raise HTTPException(
            status_code=409,
            detail=f"Book is not awaiting TOC review (current status: {book.ingest_status}).",
        )

    chapters_data = [c.model_dump() for c in body.chapters]

    async def _confirm_task():
        async with AsyncSessionLocal() as bg_db:
            await ingest_svc.confirm_toc(book_id, chapters_data, bg_db)

    background_tasks.add_task(_confirm_task)

    # Optimistically flip status so the UI knows ingestion is underway
    book.ingest_status = IngestStatus.INGESTING
    await db.commit()

    return {"book_id": book_id, "status": "ingesting"}


@router.post("/{book_id}/retry-embed", response_model=dict)
async def retry_embed(
    book_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Re-run the embedding step for a FAILED book that already has chunks in DB."""
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.ingest_status not in (IngestStatus.FAILED,):
        raise HTTPException(
            status_code=409,
            detail=f"Book is not in a failed state (current status: {book.ingest_status}).",
        )

    async def _task():
        async with AsyncSessionLocal() as bg_db:
            await ingest_svc.retry_embed(book_id, bg_db)

    background_tasks.add_task(_task)

    book.ingest_status = IngestStatus.INGESTING
    book.ingest_error = None
    await db.commit()

    return {"book_id": book_id, "status": "ingesting"}


@router.delete("/{book_id}", response_model=dict)
async def delete_book(book_id: int, db: AsyncSession = Depends(get_db)):
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    await ingest_svc.delete_book_artefacts(book_id, book.file_path, db)
    return {"deleted": book_id}
