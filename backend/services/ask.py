"""
Global Ask service — scoped retrieval + LLM streaming.

Supported scopes (Phase 2, progressive):
  whole_library — vector search across all this user's book chunks
  current_book  — vector search scoped to one book_id
  notes         — lazy-indexed note_chunks vector search

Notes retrieval:
  Before querying note_chunks, stale notes (last_indexed_at IS NULL or
  last_indexed_at < updated_at) are chunked and embedded. This is lazy
  indexing — it happens synchronously on the first retrieval. Notes are
  small documents so this is fast enough for interactive use.
"""
import logging
from datetime import datetime, timezone
from typing import AsyncIterator

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Book, Note, NoteChunk

log = logging.getLogger(__name__)

_SYSTEM = """\
You are a rigorous knowledge assistant. Answer questions grounded in the \
provided passages from the user's library and notes. Be precise and direct. \
If the context doesn't support a claim, say so explicitly. Never invent facts. \
Cite sources briefly at the end of your answer (e.g. 'Source: [Book Title, Ch N]' \
or 'Source: [Note: title]')."""

_MAX_CHUNK_CHARS = 1500
_NOTE_CHUNK_SIZE = 800  # chars per note chunk for indexing


# ---------------------------------------------------------------------------
# Retrieval helpers
# ---------------------------------------------------------------------------


async def _retrieve_book_chunks(
    *,
    user_id: int,
    book_id: int | None,
    question: str,
    db: AsyncSession,
    embed_provider,
    k: int = 6,
) -> list[tuple[str, str]]:
    """Return (text, source_label) pairs from chunk vector search.

    If book_id is None, searches across the whole user library.
    """
    try:
        query_vec = await embed_provider.embed_query(question)
    except Exception as exc:
        log.warning("Embedding failed for global ask: %s", exc)
        return []

    if book_id is not None:
        sql = text("""
            SELECT c.text, b.title
            FROM chunks c
            JOIN books b ON c.book_id = b.id
            WHERE c.book_id = :book_id
              AND b.user_id = :user_id
              AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> CAST(:query_vec AS vector)
            LIMIT :k
        """)
        params = {"book_id": book_id, "user_id": user_id, "query_vec": str(query_vec), "k": k}
    else:
        sql = text("""
            SELECT c.text, b.title
            FROM chunks c
            JOIN books b ON c.book_id = b.id
            WHERE b.user_id = :user_id
              AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> CAST(:query_vec AS vector)
            LIMIT :k
        """)
        params = {"user_id": user_id, "query_vec": str(query_vec), "k": k}

    try:
        result = await db.execute(sql, params)
        return [(row[0], row[1]) for row in result.fetchall() if row[0]]
    except Exception as exc:
        log.warning("pgvector retrieval failed for global ask: %s", exc)
        return []


async def _ensure_notes_indexed(
    *,
    user_id: int,
    db: AsyncSession,
    embed_provider,
) -> None:
    """Embed all stale notes for this user. Stale = last_indexed_at IS NULL or < updated_at."""
    result = await db.execute(
        select(Note).where(
            Note.user_id == user_id,
            Note.content.isnot(None),
        )
    )
    notes = result.scalars().all()

    stale = [
        n for n in notes
        if n.last_indexed_at is None or n.last_indexed_at < n.updated_at
    ]
    if not stale:
        return

    log.info("Indexing %d stale notes for user %d", len(stale), user_id)

    for note in stale:
        # Delete old chunks for this note
        await db.execute(delete(NoteChunk).where(NoteChunk.note_id == note.id))

        # Split note content into fixed-size chunks
        content = note.content
        slices = [
            content[i: i + _NOTE_CHUNK_SIZE]
            for i in range(0, len(content), _NOTE_CHUNK_SIZE)
        ]
        if not slices:
            continue

        # Embed and persist
        try:
            for idx, chunk_text in enumerate(slices):
                if not chunk_text.strip():
                    continue
                vec = await embed_provider.embed_query(chunk_text)
                db.add(NoteChunk(
                    note_id=note.id,
                    chunk_index=idx,
                    text=chunk_text,
                    embedding=vec,
                ))

            note.last_indexed_at = datetime.now(timezone.utc)
        except Exception as exc:
            log.warning("Failed to index note %d: %s", note.id, exc)

    await db.commit()


async def _retrieve_note_chunks(
    *,
    user_id: int,
    question: str,
    db: AsyncSession,
    embed_provider,
    k: int = 6,
) -> list[tuple[str, str]]:
    """Return (text, source_label) pairs from note_chunks vector search."""
    try:
        query_vec = await embed_provider.embed_query(question)
    except Exception as exc:
        log.warning("Embedding failed for notes retrieval: %s", exc)
        return []

    try:
        result = await db.execute(text("""
            SELECT nc.text, COALESCE(n.title, 'Untitled note')
            FROM note_chunks nc
            JOIN notes n ON nc.note_id = n.id
            WHERE n.user_id = :user_id
              AND nc.embedding IS NOT NULL
            ORDER BY nc.embedding <=> CAST(:query_vec AS vector)
            LIMIT :k
        """), {"user_id": user_id, "query_vec": str(query_vec), "k": k})
        return [(row[0], f"Note: {row[1]}") for row in result.fetchall() if row[0]]
    except Exception as exc:
        log.warning("Note chunk retrieval failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Context assembly
# ---------------------------------------------------------------------------


def _assemble_context(
    question: str,
    passages: list[tuple[str, str]],
) -> str:
    """Build the user-turn content: passages + question."""
    parts: list[str] = []

    if passages:
        formatted = "\n---\n".join(
            f"[Source: {src}]\n{text[:_MAX_CHUNK_CHARS]}"
            for text, src in passages
        )
        parts.append(f"[Relevant passages]\n{formatted}")

    parts.append(f"[Question]\n{question}")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def stream_ask(
    *,
    question: str,
    scope: str,
    book_id: int | None,
    user_id: int,
    db: AsyncSession,
    chat_provider,
    embed_provider,
) -> AsyncIterator[str]:
    """Stream an answer grounded in the requested scope."""
    passages: list[tuple[str, str]] = []

    if scope == "notes":
        await _ensure_notes_indexed(user_id=user_id, db=db, embed_provider=embed_provider)
        passages = await _retrieve_note_chunks(
            user_id=user_id, question=question, db=db, embed_provider=embed_provider
        )
    elif scope in ("whole_library", "current_book"):
        effective_book_id = book_id if scope == "current_book" else None
        passages = await _retrieve_book_chunks(
            user_id=user_id,
            book_id=effective_book_id,
            question=question,
            db=db,
            embed_provider=embed_provider,
        )

    if not passages:
        yield "I couldn't find relevant passages for your question in the selected scope."
        return

    context = _assemble_context(question, passages)
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": context},
    ]

    try:
        async for delta in chat_provider.stream_text(messages, max_tokens=1024):
            yield delta
    except Exception as exc:
        log.error("Global ask stream failed: %s", exc)
        yield f"[ERROR] {exc}"
