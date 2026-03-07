"""
Q&A service — context assembly + streaming + persistence.

Context sources (V1):
  1. selected_text  — the user's highlighted anchor (optional)
  2. pgvector chunks — top-5 from the chapter, scored by cosine similarity
  3. recent_turns   — last 6 messages (3 Q&A pairs) from the conversation
"""
import logging
from typing import AsyncIterator

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Book, Chunk, Conversation, Message, MessageRole

log = logging.getLogger(__name__)

_SYSTEM = """\
You are a rigorous reading assistant. Answer questions grounded in the provided \
book passages. Be precise and direct. If the context doesn't support a claim, \
say so explicitly. Never invent facts."""

_MAX_SELECTED_CHARS = 2_000
_MAX_CHUNK_CHARS = 1500


# ---------------------------------------------------------------------------
# Context assembly
# ---------------------------------------------------------------------------


def assemble_context(
    selected_text: str,
    question: str,
    chunks: list[str],
    recent_turns: list[tuple[str, str]],
) -> str:
    parts: list[str] = []

    if selected_text.strip():
        parts.append(f"[Selected passage]\n{selected_text.strip()[:_MAX_SELECTED_CHARS]}")

    if chunks:
        joined = "\n---\n".join(c[:_MAX_CHUNK_CHARS] for c in chunks)
        parts.append(f"[Relevant passages from the book]\n{joined}")

    if recent_turns:
        history = "\n\n".join(f"Q: {u}\nA: {a}" for u, a in recent_turns)
        parts.append(f"[Prior conversation]\n{history}")

    parts.append(f"[Question]\n{question}")

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# pgvector retrieval
# ---------------------------------------------------------------------------


async def _retrieve_chunks(
    book_id: int,
    chapter_id: int,
    query: str,
    db: AsyncSession,
    embed_provider,
    k: int = 5,
) -> list[str]:
    try:
        query_vec = await embed_provider.embed_query(query)
        result = await db.execute(
            text("""
                SELECT text
                FROM chunks
                WHERE chapter_id = :chapter_id
                  AND book_id = :book_id
                  AND embedding IS NOT NULL
                ORDER BY embedding <=> CAST(:query_vec AS vector)
                LIMIT :k
            """),
            {
                "chapter_id": chapter_id,
                "book_id": book_id,
                "query_vec": str(query_vec),
                "k": k,
            },
        )
        rows = result.fetchall()
        return [row[0] for row in rows if row[0]]
    except Exception as exc:
        log.warning("pgvector retrieval failed for book %d chapter %d: %s", book_id, chapter_id, exc)
        return []


# ---------------------------------------------------------------------------
# Conversation helpers
# ---------------------------------------------------------------------------


async def _get_or_create_conversation(book_id: int, db: AsyncSession) -> Conversation:
    result = await db.execute(
        select(Conversation).where(Conversation.book_id == book_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        conv = Conversation(book_id=book_id)
        db.add(conv)
        await db.commit()
        await db.refresh(conv)
    return conv


async def _get_recent_turns(
    conversation_id: int, n_pairs: int, db: AsyncSession
) -> list[tuple[str, str]]:
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.id.desc())
        .limit(n_pairs * 2)
    )
    messages = list(reversed(result.scalars().all()))

    pairs: list[tuple[str, str]] = []
    i = 0
    while i + 1 < len(messages):
        if (
            messages[i].role == MessageRole.USER
            and messages[i + 1].role == MessageRole.ASSISTANT
        ):
            pairs.append((messages[i].content, messages[i + 1].content))
            i += 2
        else:
            i += 1
    return pairs


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def stream_qa(
    book_id: int,
    chapter_id: int,
    selected_text: str,
    question: str,
    db: AsyncSession,
    chat_provider,
    embed_provider,
) -> AsyncIterator[str]:
    book = await db.get(Book, book_id)
    if not book:
        yield "[ERROR] Book not found."
        return

    conv = await _get_or_create_conversation(book_id, db)
    chunks = await _retrieve_chunks(book_id, chapter_id, question, db, embed_provider)
    recent_turns = await _get_recent_turns(conv.id, n_pairs=3, db=db)

    context = assemble_context(selected_text, question, chunks, recent_turns)
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": context},
    ]

    db.add(Message(
        conversation_id=conv.id,
        chapter_id=chapter_id,
        role=MessageRole.USER,
        content=question,
    ))
    await db.commit()

    accumulated: list[str] = []
    try:
        async for delta in chat_provider.stream_text(messages, max_tokens=1024):
            accumulated.append(delta)
            yield delta
    except Exception as exc:
        log.error("QA stream failed for book %d: %s", book_id, exc)
        yield f"[ERROR] {exc}"
        return

    full = "".join(accumulated)
    if full.strip():
        db.add(Message(
            conversation_id=conv.id,
            chapter_id=chapter_id,
            role=MessageRole.ASSISTANT,
            content=full,
        ))
        await db.commit()
