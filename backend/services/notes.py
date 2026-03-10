"""
Notes service — create, retrieve, and save notes from various sources.

A note is either:
  - standalone:      created directly by the user
  - passage_anchor:  anchored to a highlighted passage in a book
  - explain_turn:    promoted from a single Deep Explain chat Q&A turn
  - qa_turn:         promoted from a single Q&A conversation turn

All save-from-source operations validate ownership before creating a note.
The note content captures the full relevant text at save time so it remains
readable even if the underlying source is later deleted or modified.
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import (
    Book,
    Chunk,
    Conversation,
    ExplainConversation,
    ExplainMessage,
    Message,
    MessageRole,
    Note,
    NoteLink,
    NoteOriginType,
    PassageAnchor,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _auto_title(text: str, max_len: int = 60) -> str:
    """Generate a title from the first line or first N chars of text."""
    first_line = text.strip().split("\n")[0].strip()
    if len(first_line) <= max_len:
        return first_line
    return first_line[:max_len].rstrip() + "…"


# ---------------------------------------------------------------------------
# Core create
# ---------------------------------------------------------------------------


async def create_note(
    *,
    user_id: int,
    content: str,
    title: str | None = None,
    origin_type: NoteOriginType | None = None,
    origin_id: int | None = None,
    db: AsyncSession,
) -> Note:
    note = Note(
        user_id=user_id,
        title=title or _auto_title(content),
        content=content,
        origin_type=origin_type,
        origin_id=origin_id,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return note


# ---------------------------------------------------------------------------
# Passage anchor
# ---------------------------------------------------------------------------


def _make_fingerprint(text: str) -> str:
    """First 80 + last 80 chars of text, separated by a sentinel."""
    text = text.strip()
    if len(text) <= 160:
        return text
    return text[:80] + "…" + text[-80:]


async def create_passage_anchor(
    *,
    user_id: int,
    chunk_id: int,
    char_start: int,
    char_end: int,
    selected_text: str,
    db: AsyncSession,
) -> PassageAnchor:
    """Create a stable passage anchor from a user's text selection."""
    # Verify the chunk belongs to a book owned by this user
    chunk = await db.get(Chunk, chunk_id)
    if not chunk:
        raise ValueError("Chunk not found.")
    book = await db.get(Book, chunk.book_id)
    if not book or book.user_id != user_id:
        raise PermissionError("Not authorized.")

    anchor = PassageAnchor(
        user_id=user_id,
        chunk_id=chunk_id,
        char_start=char_start,
        char_end=char_end,
        text_fingerprint=_make_fingerprint(selected_text),
        selected_text=selected_text,
    )
    db.add(anchor)
    await db.commit()
    await db.refresh(anchor)
    return anchor


async def create_anchor_note_from_text(
    *,
    user_id: int,
    chapter_id: int,
    selected_text: str,
    title: str | None = None,
    extra_content: str = "",
    db: AsyncSession,
) -> Note:
    """Create a passage anchor + note from selected text in the reader.

    Resolves chunk_id server-side by searching for the selected_text within
    the chapter's chunks. The frontend does not need to know chunk boundaries.
    Falls back to a standalone note if the text cannot be matched to a chunk
    (e.g., if it spans chunk boundaries).
    """
    from sqlalchemy import select as _select
    from db.models import Chunk

    # Find the chunk that contains this selection
    result = await db.execute(
        _select(Chunk)
        .where(Chunk.chapter_id == chapter_id)
        .order_by(Chunk.id)
    )
    chunks = result.scalars().all()

    matched_chunk: Chunk | None = None
    char_start = 0
    char_end = 0

    for chunk in chunks:
        idx = chunk.text.find(selected_text)
        if idx != -1:
            matched_chunk = chunk
            char_start = idx
            char_end = idx + len(selected_text)
            break

    if matched_chunk:
        # Verify the chunk's book belongs to this user
        book = await db.get(Book, matched_chunk.book_id)
        if not book or book.user_id != user_id:
            raise PermissionError("Not authorized.")

        anchor = PassageAnchor(
            user_id=user_id,
            chunk_id=matched_chunk.id,
            char_start=char_start,
            char_end=char_end,
            text_fingerprint=_make_fingerprint(selected_text),
            selected_text=selected_text,
        )
        db.add(anchor)
        await db.flush()  # get anchor.id without full commit

        if extra_content.strip():
            content = f"{selected_text}\n\n---\n\n{extra_content.strip()}"
        else:
            content = selected_text

        note = Note(
            user_id=user_id,
            title=title or _auto_title(selected_text),
            content=content,
            origin_type=NoteOriginType.PASSAGE_ANCHOR,
            origin_id=anchor.id,
        )
        db.add(note)
        await db.commit()
        await db.refresh(note)
        return note
    else:
        # Text not found in any single chunk (e.g., spans boundaries).
        # Save as standalone note with the selected text as content.
        if extra_content.strip():
            content = f"{selected_text}\n\n---\n\n{extra_content.strip()}"
        else:
            content = selected_text

        return await create_note(
            user_id=user_id,
            content=content,
            title=title or _auto_title(selected_text),
            db=db,
        )


async def create_anchor_note(
    *,
    user_id: int,
    anchor_id: int,
    title: str | None = None,
    extra_content: str = "",
    db: AsyncSession,
) -> Note:
    """Create a note anchored to a previously created passage anchor.

    The note content is: the selected text, plus any extra_content the user
    typed (e.g., their annotation). If no extra_content, the selected text
    alone is the note body.
    """
    anchor = await db.get(PassageAnchor, anchor_id)
    if not anchor or anchor.user_id != user_id:
        raise PermissionError("Anchor not found or not authorized.")

    if extra_content.strip():
        content = f"{anchor.selected_text}\n\n---\n\n{extra_content.strip()}"
    else:
        content = anchor.selected_text

    return await create_note(
        user_id=user_id,
        content=content,
        title=title,
        origin_type=NoteOriginType.PASSAGE_ANCHOR,
        origin_id=anchor_id,
        db=db,
    )


# ---------------------------------------------------------------------------
# Save from Q&A turn
# ---------------------------------------------------------------------------


async def _get_qa_message_with_auth(
    message_id: int, user_id: int, db: AsyncSession
) -> Message:
    """Load a Q&A Message and verify it belongs to the requesting user."""
    msg = await db.get(Message, message_id)
    if not msg:
        raise ValueError("Message not found.")
    conv = await db.get(Conversation, msg.conversation_id)
    if not conv:
        raise ValueError("Conversation not found.")
    book = await db.get(Book, conv.book_id)
    if not book or book.user_id != user_id:
        raise PermissionError("Not authorized.")
    return msg


async def save_qa_turn_as_note(
    *,
    message_id: int,
    user_id: int,
    title: str | None = None,
    db: AsyncSession,
) -> Note:
    """Save a single Q&A message as a note.

    Works for both user and assistant messages. When the selected message is
    an assistant response, we look for the preceding user question in the same
    conversation to include it as context in the note body.
    """
    msg = await _get_qa_message_with_auth(message_id, user_id, db)

    if msg.role == MessageRole.ASSISTANT:
        # Find the most recent user message before this one in the same conversation
        result = await db.execute(
            select(Message)
            .where(
                Message.conversation_id == msg.conversation_id,
                Message.role == MessageRole.USER,
                Message.id < msg.id,
            )
            .order_by(Message.id.desc())
            .limit(1)
        )
        user_msg = result.scalar_one_or_none()
        if user_msg:
            content = f"**Q:** {user_msg.content.strip()}\n\n**A:** {msg.content.strip()}"
        else:
            content = msg.content.strip()
    else:
        content = msg.content.strip()

    return await create_note(
        user_id=user_id,
        content=content,
        title=title,
        origin_type=NoteOriginType.QA_TURN,
        origin_id=message_id,
        db=db,
    )


async def save_multiple_qa_turns_as_note(
    *,
    message_ids: list[int],
    user_id: int,
    title: str | None = None,
    db: AsyncSession,
) -> Note:
    """Save multiple Q&A messages as a single merged note.

    Messages are included in ID order. Validates each message belongs to the
    same user. Uses the first message_id as origin_id.
    """
    if not message_ids:
        raise ValueError("No message IDs provided.")

    messages: list[Message] = []
    for mid in sorted(set(message_ids)):
        msg = await _get_qa_message_with_auth(mid, user_id, db)
        messages.append(msg)

    parts: list[str] = []
    for msg in messages:
        role_label = "**Q:**" if msg.role == MessageRole.USER else "**A:**"
        parts.append(f"{role_label} {msg.content.strip()}")

    content = "\n\n".join(parts)

    return await create_note(
        user_id=user_id,
        content=content,
        title=title,
        origin_type=NoteOriginType.QA_TURN,
        origin_id=messages[0].id,
        db=db,
    )


# ---------------------------------------------------------------------------
# Save from Deep Explain turn
# ---------------------------------------------------------------------------


async def _get_explain_message_with_auth(
    message_id: int, user_id: int, db: AsyncSession
) -> ExplainMessage:
    """Load an ExplainMessage and verify it belongs to the requesting user."""
    msg = await db.get(ExplainMessage, message_id)
    if not msg:
        raise ValueError("Message not found.")
    conv = await db.get(ExplainConversation, msg.conversation_id)
    if not conv:
        raise ValueError("Conversation not found.")
    book = await db.get(Book, conv.book_id)
    if not book or book.user_id != user_id:
        raise PermissionError("Not authorized.")
    return msg


async def save_explain_turn_as_note(
    *,
    message_id: int,
    user_id: int,
    title: str | None = None,
    db: AsyncSession,
) -> Note:
    """Save a single Deep Explain chat message as a note.

    When the selected message is an assistant response, the preceding user
    question is included in the note body for full context.
    """
    msg = await _get_explain_message_with_auth(message_id, user_id, db)

    if msg.role == MessageRole.ASSISTANT:
        result = await db.execute(
            select(ExplainMessage)
            .where(
                ExplainMessage.conversation_id == msg.conversation_id,
                ExplainMessage.role == MessageRole.USER,
                ExplainMessage.id < msg.id,
            )
            .order_by(ExplainMessage.id.desc())
            .limit(1)
        )
        user_msg = result.scalar_one_or_none()
        if user_msg:
            content = f"**Q:** {user_msg.content.strip()}\n\n**A:** {msg.content.strip()}"
        else:
            content = msg.content.strip()
    else:
        content = msg.content.strip()

    return await create_note(
        user_id=user_id,
        content=content,
        title=title,
        origin_type=NoteOriginType.EXPLAIN_TURN,
        origin_id=message_id,
        db=db,
    )


# ---------------------------------------------------------------------------
# History migration (per-book, user opt-in)
# ---------------------------------------------------------------------------


async def migrate_book_history(
    *,
    book_id: int,
    user_id: int,
    include_qa: bool = True,
    include_explain: bool = True,
    db: AsyncSession,
) -> dict:
    """Import existing Q&A and explain turns for a book as notes.

    Skips messages that have already been saved as notes (matched by
    origin_type + origin_id). Returns counts of notes created vs skipped.
    """
    book = await db.get(Book, book_id)
    if not book or book.user_id != user_id:
        raise PermissionError("Book not found or not authorized.")

    created = 0
    skipped = 0

    if include_qa:
        # Find the book's conversation
        conv_result = await db.execute(
            select(Conversation).where(Conversation.book_id == book_id)
        )
        conv = conv_result.scalar_one_or_none()
        if conv:
            # Get all assistant messages (each represents a Q&A turn answer)
            msg_result = await db.execute(
                select(Message)
                .where(
                    Message.conversation_id == conv.id,
                    Message.role == MessageRole.ASSISTANT,
                )
                .order_by(Message.id)
            )
            assistant_msgs = msg_result.scalars().all()

            for msg in assistant_msgs:
                # Check if already saved
                existing = await db.execute(
                    select(Note).where(
                        Note.user_id == user_id,
                        Note.origin_type == NoteOriginType.QA_TURN,
                        Note.origin_id == msg.id,
                    )
                )
                if existing.scalar_one_or_none():
                    skipped += 1
                    continue

                await save_qa_turn_as_note(
                    message_id=msg.id, user_id=user_id, db=db
                )
                created += 1

    if include_explain:
        # Get all explain conversations for this book
        conv_result = await db.execute(
            select(ExplainConversation).where(
                ExplainConversation.book_id == book_id
            )
        )
        explain_convs = conv_result.scalars().all()

        for econv in explain_convs:
            msg_result = await db.execute(
                select(ExplainMessage)
                .where(
                    ExplainMessage.conversation_id == econv.id,
                    ExplainMessage.role == MessageRole.ASSISTANT,
                )
                .order_by(ExplainMessage.id)
            )
            assistant_msgs = msg_result.scalars().all()

            for msg in assistant_msgs:
                existing = await db.execute(
                    select(Note).where(
                        Note.user_id == user_id,
                        Note.origin_type == NoteOriginType.EXPLAIN_TURN,
                        Note.origin_id == msg.id,
                    )
                )
                if existing.scalar_one_or_none():
                    skipped += 1
                    continue

                await save_explain_turn_as_note(
                    message_id=msg.id, user_id=user_id, db=db
                )
                created += 1

    return {"created": created, "skipped": skipped}


# ---------------------------------------------------------------------------
# Note links
# ---------------------------------------------------------------------------


async def add_note_link(
    *,
    from_note_id: int,
    to_note_id: int,
    user_id: int,
    db: AsyncSession,
) -> NoteLink:
    """Create a manual backlink between two notes owned by the same user."""
    if from_note_id == to_note_id:
        raise ValueError("A note cannot link to itself.")

    from_note = await db.get(Note, from_note_id)
    to_note = await db.get(Note, to_note_id)

    if not from_note or from_note.user_id != user_id:
        raise PermissionError("Source note not found or not authorized.")
    if not to_note or to_note.user_id != user_id:
        raise PermissionError("Target note not found or not authorized.")

    link = NoteLink(from_note_id=from_note_id, to_note_id=to_note_id)
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return link


async def remove_note_link(
    *,
    from_note_id: int,
    to_note_id: int,
    user_id: int,
    db: AsyncSession,
) -> None:
    """Remove a backlink between two notes."""
    from_note = await db.get(Note, from_note_id)
    if not from_note or from_note.user_id != user_id:
        raise PermissionError("Note not found or not authorized.")

    result = await db.execute(
        select(NoteLink).where(
            NoteLink.from_note_id == from_note_id,
            NoteLink.to_note_id == to_note_id,
        )
    )
    link = result.scalar_one_or_none()
    if link:
        await db.delete(link)
        await db.commit()
