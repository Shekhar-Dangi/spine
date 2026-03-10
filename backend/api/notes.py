"""
Notes endpoints — CRUD for user notes, passage anchors, and history migration.

Routes:
  POST   /api/notes                              create standalone note
  GET    /api/notes                              list user notes (with filters)
  GET    /api/notes/{note_id}                    get single note
  PATCH  /api/notes/{note_id}                    update title or content
  DELETE /api/notes/{note_id}                    delete note
  POST   /api/notes/{note_id}/links              add backlink to another note
  DELETE /api/notes/{note_id}/links/{target_id}  remove backlink

  POST   /api/books/{book_id}/anchors            create passage anchor
  POST   /api/books/{book_id}/anchors/{anchor_id}/note  create note from anchor

  POST   /api/books/{book_id}/migrate-history    import existing Q&A + explain turns
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.deps import get_current_user
from db.database import get_db
from db.models import Book, Note, NoteLink, PassageAnchor, User
from services import notes as notes_svc

router = APIRouter(tags=["notes"])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class CreateNoteIn(BaseModel):
    title: str | None = None
    content: str


class UpdateNoteIn(BaseModel):
    title: str | None = None
    content: str | None = None


class AddLinkIn(BaseModel):
    to_note_id: int


class CreateAnchorIn(BaseModel):
    chunk_id: int
    char_start: int
    char_end: int
    selected_text: str


class CreateAnchorNoteIn(BaseModel):
    title: str | None = None
    extra_content: str = ""


class MigrateHistoryIn(BaseModel):
    include_qa: bool = True
    include_explain: bool = True


class CreateAnchorNoteFromTextIn(BaseModel):
    selected_text: str
    title: str | None = None
    extra_content: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _note_out(note: Note) -> dict:
    return {
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "origin_type": note.origin_type.value if note.origin_type else None,
        "origin_id": note.origin_id,
        "last_indexed_at": note.last_indexed_at.isoformat() if note.last_indexed_at else None,
        "created_at": note.created_at.isoformat(),
        "updated_at": note.updated_at.isoformat(),
    }


def _anchor_out(anchor: PassageAnchor) -> dict:
    return {
        "id": anchor.id,
        "chunk_id": anchor.chunk_id,
        "char_start": anchor.char_start,
        "char_end": anchor.char_end,
        "selected_text": anchor.selected_text,
        "created_at": anchor.created_at.isoformat(),
    }


async def _get_note_for_user(note_id: int, user_id: int, db: AsyncSession) -> Note:
    note = await db.get(Note, note_id)
    if not note or note.user_id != user_id:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note


# ---------------------------------------------------------------------------
# Note CRUD
# ---------------------------------------------------------------------------


@router.post("/api/notes", status_code=201)
async def create_note(
    body: CreateNoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.content.strip():
        raise HTTPException(status_code=422, detail="Content cannot be empty.")
    note = await notes_svc.create_note(
        user_id=current_user.id,
        content=body.content,
        title=body.title,
        db=db,
    )
    return _note_out(note)


@router.get("/api/notes")
async def list_notes(
    origin_type: str | None = Query(None, description="Filter by origin_type"),
    search: str | None = Query(None, description="Case-insensitive text search in title+content"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Note).where(Note.user_id == current_user.id)

    if origin_type:
        query = query.where(Note.origin_type == origin_type)

    if search:
        term = f"%{search}%"
        from sqlalchemy import or_
        query = query.where(
            or_(
                Note.title.ilike(term),
                Note.content.ilike(term),
            )
        )

    query = query.order_by(Note.updated_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    notes = result.scalars().all()
    return {"notes": [_note_out(n) for n in notes], "total": len(notes)}


@router.get("/api/notes/{note_id}")
async def get_note(
    note_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = await _get_note_for_user(note_id, current_user.id, db)

    # Include backlinks
    links_out_result = await db.execute(
        select(NoteLink).where(NoteLink.from_note_id == note_id)
    )
    links_in_result = await db.execute(
        select(NoteLink).where(NoteLink.to_note_id == note_id)
    )

    data = _note_out(note)
    data["links_to"] = [lnk.to_note_id for lnk in links_out_result.scalars().all()]
    data["linked_from"] = [lnk.from_note_id for lnk in links_in_result.scalars().all()]
    return data


@router.patch("/api/notes/{note_id}")
async def update_note(
    note_id: int,
    body: UpdateNoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = await _get_note_for_user(note_id, current_user.id, db)

    if body.title is not None:
        note.title = body.title
    if body.content is not None:
        if not body.content.strip():
            raise HTTPException(status_code=422, detail="Content cannot be empty.")
        note.content = body.content
        # Mark note as needing re-indexing on next retrieval
        note.last_indexed_at = None

    await db.commit()
    await db.refresh(note)
    return _note_out(note)


@router.delete("/api/notes/{note_id}", status_code=204)
async def delete_note(
    note_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = await _get_note_for_user(note_id, current_user.id, db)
    await db.delete(note)
    await db.commit()


# ---------------------------------------------------------------------------
# Note links
# ---------------------------------------------------------------------------


@router.post("/api/notes/{note_id}/links", status_code=201)
async def add_link(
    note_id: int,
    body: AddLinkIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        link = await notes_svc.add_note_link(
            from_note_id=note_id,
            to_note_id=body.to_note_id,
            user_id=current_user.id,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=404, detail=str(e))
    from sqlalchemy.exc import IntegrityError
    return {"from_note_id": link.from_note_id, "to_note_id": link.to_note_id}


@router.delete("/api/notes/{note_id}/links/{target_note_id}", status_code=204)
async def remove_link(
    note_id: int,
    target_note_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        await notes_svc.remove_note_link(
            from_note_id=note_id,
            to_note_id=target_note_id,
            user_id=current_user.id,
            db=db,
        )
    except PermissionError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------------------------------------------------------------------------
# Passage anchors
# ---------------------------------------------------------------------------


@router.post("/api/books/{book_id}/anchors", status_code=201)
async def create_anchor(
    book_id: int,
    body: CreateAnchorIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a stable passage anchor from a text selection in a book chunk."""
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")

    if not body.selected_text.strip():
        raise HTTPException(status_code=422, detail="selected_text cannot be empty.")
    if body.char_start < 0 or body.char_end <= body.char_start:
        raise HTTPException(status_code=422, detail="Invalid char_start / char_end range.")

    try:
        anchor = await notes_svc.create_passage_anchor(
            user_id=current_user.id,
            chunk_id=body.chunk_id,
            char_start=body.char_start,
            char_end=body.char_end,
            selected_text=body.selected_text,
            db=db,
        )
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=404, detail=str(e))

    return _anchor_out(anchor)


@router.post("/api/books/{book_id}/anchors/{anchor_id}/note", status_code=201)
async def create_note_from_anchor(
    book_id: int,
    anchor_id: int,
    body: CreateAnchorNoteIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a note anchored to an existing passage anchor."""
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")

    try:
        note = await notes_svc.create_anchor_note(
            user_id=current_user.id,
            anchor_id=anchor_id,
            title=body.title,
            extra_content=body.extra_content,
            db=db,
        )
    except PermissionError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return _note_out(note)


# ---------------------------------------------------------------------------
# History migration
# ---------------------------------------------------------------------------


@router.post("/api/books/{book_id}/chapters/{chapter_id}/anchor-note", status_code=201)
async def create_anchor_note_from_text(
    book_id: int,
    chapter_id: int,
    body: CreateAnchorNoteFromTextIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create an anchor + note from selected text in the reader.

    The frontend sends the selected text; the backend resolves which chunk it
    belongs to. Falls back to a standalone note if text spans chunk boundaries.
    """
    from db.models import Chapter
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")

    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    if not body.selected_text.strip():
        raise HTTPException(status_code=422, detail="selected_text cannot be empty.")

    try:
        note = await notes_svc.create_anchor_note_from_text(
            user_id=current_user.id,
            chapter_id=chapter_id,
            selected_text=body.selected_text,
            title=body.title,
            extra_content=body.extra_content,
            db=db,
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    return _note_out(note)


@router.post("/api/books/{book_id}/migrate-history")
async def migrate_history(
    book_id: int,
    body: MigrateHistoryIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import existing Q&A and Deep Explain turns for a book as notes.

    Idempotent — already-saved turns are skipped. Returns counts.
    """
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")

    try:
        result = await notes_svc.migrate_book_history(
            book_id=book_id,
            user_id=current_user.id,
            include_qa=body.include_qa,
            include_explain=body.include_explain,
            db=db,
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    return result
