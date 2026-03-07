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

from auth.deps import get_current_user
from config import settings
from db.database import get_db, AsyncSessionLocal
from db.models import Book, BookFormat, Chapter, IngestStatus, User
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


class BookUpdateIn(BaseModel):
    title: str | None = None
    author: str | None = None


class TocSuggestIn(BaseModel):
    toc_pdf_page: int              # 1-indexed physical PDF page (start of TOC)
    toc_pdf_page_end: int | None = None  # 1-indexed end page if TOC spans multiple pages
    page_offset: int = 0           # filler pages: pdf_page = book_page + page_offset


class ChapterUpdateIn(BaseModel):
    title: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/upload", response_model=dict)
async def upload_book(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save file, create Book row, trigger background parse."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".pdf", ".epub"}:
        raise HTTPException(
            status_code=400, detail="Only PDF and EPUB files are supported.")

    # Enforce file size limit (100 MB)
    MAX_UPLOAD_BYTES = 100 * 1024 * 1024
    file.file.seek(0, 2)  # seek to end
    size = file.file.tell()
    file.file.seek(0)  # seek back
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413, detail=f"File too large ({size // (1024*1024)} MB). Max is 100 MB.")

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
        user_id=current_user.id,
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
async def list_books(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Book)
        .where(Book.user_id == current_user.id)
        .order_by(Book.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{book_id}", response_model=BookOut)
async def get_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    return book


@router.get("/{book_id}/chapters", response_model=list[dict])
async def get_chapters(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
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
    current_user: User = Depends(get_current_user),
):
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    text_file = Path(settings.parsed_path) / str(book_id) / \
        f"chapter_{chapter.chapter_index}.txt"
    if not text_file.exists():
        raise HTTPException(
            status_code=404, detail="Chapter text not yet available.")

    return {"chapter_id": chapter_id, "text": text_file.read_text(encoding="utf-8")}


@router.post("/{book_id}/toc/confirm", response_model=dict)
async def confirm_toc(
    book_id: int,
    body: TocConfirmIn,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """User submits validated TOC → triggers chunk + embed in background."""
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.ingest_status != IngestStatus.PENDING_TOC_REVIEW:
        raise HTTPException(
            status_code=409,
            detail=f"Book is not awaiting TOC review (current status: {book.ingest_status}).",
        )

    chapters_data = [c.model_dump() for c in body.chapters]

    user_id = current_user.id

    async def _confirm_task():
        async with AsyncSessionLocal() as bg_db:
            await ingest_svc.confirm_toc(book_id, chapters_data, bg_db, user_id)

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
    current_user: User = Depends(get_current_user),
):
    """Re-run the embedding step for a FAILED book that already has chunks in DB."""
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.ingest_status not in (IngestStatus.FAILED,):
        raise HTTPException(
            status_code=409,
            detail=f"Book is not in a failed state (current status: {book.ingest_status}).",
        )

    retry_user_id = current_user.id

    async def _task():
        async with AsyncSessionLocal() as bg_db:
            await ingest_svc.retry_embed(book_id, bg_db, retry_user_id)

    background_tasks.add_task(_task)

    book.ingest_status = IngestStatus.INGESTING
    book.ingest_error = None
    await db.commit()

    return {"book_id": book_id, "status": "ingesting"}


@router.patch("/{book_id}", response_model=BookOut)
async def update_book_metadata(
    book_id: int,
    body: BookUpdateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit book title and/or author."""
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    if body.title is not None:
        t = body.title.strip()
        if not t:
            raise HTTPException(
                status_code=422, detail="Title cannot be empty.")
        book.title = t[:512]
    if body.author is not None:
        book.author = body.author.strip()[:256] or None
    await db.commit()
    await db.refresh(book)
    return book


@router.post("/{book_id}/toc/suggest", response_model=dict)
async def suggest_toc(
    book_id: int,
    body: TocSuggestIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Extract text from a PDF TOC page and ask the LLM to parse it into chapters.
    Returns a suggestion list — does NOT save anything. The user reviews in the UI
    and calls /toc/confirm to persist.
    """
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.format != BookFormat.PDF:
        raise HTTPException(
            status_code=400,
            detail="TOC suggestion is only available for PDF books.",
        )

    from services.toc_suggest import suggest_toc as _suggest
    try:
        chapters = await _suggest(
            file_path=book.file_path,
            toc_pdf_page=body.toc_pdf_page,
            toc_pdf_page_end=body.toc_pdf_page_end,
            page_offset=body.page_offset,
            db=db,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        # Covers AuthenticationError, connection errors, etc.
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}")

    return {"chapters": chapters}


@router.patch("/{book_id}/chapters/{chapter_id}", response_model=dict)
async def update_chapter(
    book_id: int,
    chapter_id: int,
    body: ChapterUpdateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit a chapter title (post-ingestion, title-only)."""
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")
    t = body.title.strip()
    if not t:
        raise HTTPException(status_code=422, detail="Title cannot be empty.")
    chapter.title = t[:512]
    await db.commit()
    return {
        "id": chapter.id,
        "index": chapter.chapter_index,
        "title": chapter.title,
        "start_page": chapter.start_page,
        "end_page": chapter.end_page,
        "start_anchor": chapter.start_anchor,
        "end_anchor": chapter.end_anchor,
        "confirmed": chapter.confirmed,
        "token_estimate": chapter.token_estimate,
    }


@router.post("/{book_id}/reset-toc", response_model=dict)
async def reset_toc(
    book_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Wipe all derived data (chunks, chapters, embeddings, explains, maps) and
    re-run parsing so the user can review and confirm the TOC again.
    Only allowed when the book is not currently parsing or ingesting.
    """
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.ingest_status in (IngestStatus.PARSING, IngestStatus.INGESTING):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot reset while book is {book.ingest_status}. Wait for it to finish.",
        )

    # Optimistically flip to PARSING so the UI poll loop activates
    book.ingest_status = IngestStatus.PARSING
    book.ingest_error = None
    await db.commit()

    async def _task():
        async with AsyncSessionLocal() as bg_db:
            await ingest_svc.reset_and_reparse(book_id, bg_db)

    background_tasks.add_task(_task)
    return {"book_id": book_id, "status": "parsing"}


@router.delete("/{book_id}", response_model=dict)
async def delete_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    await ingest_svc.delete_book_artefacts(book_id, book.file_path, db)
    return {"deleted": book_id}
