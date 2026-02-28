"""
Chapter deep-explain service — full Phase 3 implementation.
Retrieves chapter text, builds prompt per contract, streams SSE deltas.
Persists result to chapter_explains table; serves cache on repeat calls.
"""
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import Book, Chapter, Chunk, ChapterExplain

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_SYSTEM = """\
You are a rigorous academic tutor. You explain ideas with first-principles clarity,
simple language, and intellectual honesty. You never pad. You never force connections.
You always include a balanced critique."""

_USER_TEMPLATE = """\
Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Write a deep, structured explanation. Follow this EXACT section order with these EXACT headings:

# Core Idea
What is the single most important idea of this chapter? (2–3 sentences)

# Why It Matters
Why does this idea matter — what problem does it solve or what insight does it reveal? (3–4 sentences)

# First Principles
Break the core idea down from its most fundamental assumptions. Number each step.

# Chapter Walkthrough
Walk through the chapter's key arguments and evidence in order. Be thorough — this is the main section.

# Terms You Need First
(Include ONLY if the chapter uses significant technical or domain-specific jargon. Define each term clearly. Omit this section entirely if not needed.)

# Balanced Critique
What does this chapter get right? Where is it weak, oversimplified, or overreaching? Be specific.

# Practical Mental Model
One concrete analogy or mental model the reader can use to remember and apply this idea.

# Evidence and Confidence Notes
Which claims are well-supported by evidence? Which are speculative or asserted without strong backing?

Rules:
- Do not add extra sections or change headings.
- Do not start any section with "In this section..." or similar meta-language.
- Target 1800–2600 words total.
- Use plain language. Preserve correctness.
"""

# Rough character limit to stay within a 128k token context (leaving room for response)
_MAX_CHAPTER_CHARS = 200_000  # ~50k tokens


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


async def stream_explain(
    book_id: int,
    chapter_id: int,
    db: AsyncSession,
    provider,
    force: bool = False,
) -> AsyncIterator[str]:
    book = await db.get(Book, book_id)
    chapter = await db.get(Chapter, chapter_id)

    if not book or not chapter:
        yield "Error: book or chapter not found."
        return

    # Return cached result if available and not forcing regeneration
    if not force:
        result = await db.execute(
            select(ChapterExplain).where(ChapterExplain.chapter_id == chapter_id)
        )
        cached = result.scalar_one_or_none()
        if cached:
            yield cached.content
            return

    chapter_text = await _load_chapter_text(book_id, chapter, db)

    if not chapter_text.strip():
        yield "No text found for this chapter. It may be image-based or empty."
        return

    prompt = _USER_TEMPLATE.format(
        book_title=book.title,
        author=book.author or "Unknown",
        chapter_num=chapter.chapter_index + 1,
        chapter_title=chapter.title,
        chapter_text=chapter_text[:_MAX_CHAPTER_CHARS],
    )

    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": prompt},
    ]

    accumulated: list[str] = []
    async for delta in provider.stream_text("deep_explain", messages, max_tokens=4096):
        accumulated.append(delta)
        yield delta

    # Persist to DB after stream completes
    full_content = "".join(accumulated)
    if full_content.strip():
        result = await db.execute(
            select(ChapterExplain).where(ChapterExplain.chapter_id == chapter_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.content = full_content
            existing.generated_at = datetime.now(timezone.utc)
        else:
            db.add(ChapterExplain(
                book_id=book_id,
                chapter_id=chapter_id,
                content=full_content,
                generated_at=datetime.now(timezone.utc),
            ))
        await db.commit()


async def _load_chapter_text(book_id: int, chapter: Chapter, db: AsyncSession) -> str:
    """Load chapter text from filesystem; fall back to DB chunks."""
    text_file = Path(settings.parsed_path) / str(book_id) / f"chapter_{chapter.chapter_index}.txt"
    if text_file.exists():
        return text_file.read_text(encoding="utf-8")

    # Fallback: concatenate chunks from DB
    result = await db.execute(
        select(Chunk)
        .where(Chunk.chapter_id == chapter.id)
        .order_by(Chunk.id)
    )
    chunks = result.scalars().all()
    return "\n\n".join(c.text for c in chunks)
