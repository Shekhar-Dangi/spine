"""
Chapter deep-explain service — multi-mode implementation.
Supports 5 learning modes: story, first_principles, systems, derivation, synthesis.
Each mode is independently cached in chapter_explains(chapter_id, mode).
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
You are a first-principles tutor. Your job is to teach through historical and conceptual discovery.

Core principles:
- Never present concepts as finished objects. Reconstruct them as solutions to problems.
- For every major idea: first describe the real-world problem, then early attempts, why those failed, then the new invention.
- Define concepts at the moment they are invented — not before.
- Teach as if the reader is inventing the system alongside history.
- Use cause-and-effect structure. Progress chronologically and causally.
- If math appears, derive it as if we are discovering it together.
- No artificial word targets. Depth over length.
"""

_STORY_TEMPLATE = """\
Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Write this explanation as a causal story of discovery.

Use this structure:

# 1. The World Before the Problem
What did the world look like before this idea existed?
What constraints were people facing?

# 2. The Core Problem
What specific limitation or crisis forced innovation?

# 3. Early Attempts (And Why They Failed)
Describe the first solutions.
Explain their weaknesses clearly.

# 4. The Breakthrough
Who changed the rules?
What new structure or idea was invented?
Define the concept at the moment it appears.

# 5. New Problems Created
How did this solution introduce new risks or distortions?

# 6. Repeated Pattern
Show how this cycle repeats in later history.

# 7. What This Means Today
Connect back to the present without moralizing.

Rules:
- Introduce concepts only when needed.
- Do not front-load terminology.
- Keep progression chronological and causal.
- Use short recaps after each major shift.
"""

_FIRST_PRINCIPLES_TEMPLATE = """\
Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Teach this chapter from first principles — starting from concrete problems and building up to the solution.

Use this structure:

# 1. The Concrete Problem
What specific real-world situation or constraint motivated this idea?
Make it tangible. No abstractions yet.

# 2. The Constraints
What are the fundamental limits we cannot escape?
What is physically, mathematically, or logically impossible to avoid?

# 3. The Naive Approach
What is the obvious, simple solution a smart person would first try?
Why does it break down?

# 4. The Core Abstraction
What new concept or model must we invent to make progress?
Define it at the moment it becomes necessary.

# 5. The Mechanism
How does the solution actually work, step by step?
Be precise. If there is math, derive it from scratch.

# 6. Trade-offs
What does this approach give up? What does it cost?
Every solution has a price.

# 7. Failure Modes
Under what conditions does this approach fail?
What edge cases break the model?

# 8. Scaling
How does behavior change at scale — more data, more users, more complexity?

Rules:
- Build knowledge bottom-up. Never assume the reader knows the answer.
- Each step should feel inevitable given the previous step.
- Derive, do not assert.
"""

_SYSTEMS_TEMPLATE = """\
Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Analyze this chapter as a system — identify its components, flows, and dynamics.

Use this structure:

# 1. Components
What are the distinct parts of this system?
What role does each play?

# 2. Incentives
What does each component want to maximize or minimize?
What drives its behavior?

# 3. Information Flow
How does information move through the system?
What does each component know, and when?

# 4. Resource Flow
What resources (energy, money, time, attention) flow through the system?
Where do they accumulate? Where do they deplete?

# 5. Feedback Loops
What feedback loops exist — reinforcing (amplifying) and balancing (stabilizing)?
Trace each loop explicitly.

# 6. Failure Dynamics
How does the system fail?
Which feedback loops become destructive under stress?

# 7. Leverage Points
Where could a small change produce a large effect?
What interventions would restructure the system's behavior?

Rules:
- Be specific. Name the actual components, not generic abstractions.
- Show how loops interact — they rarely operate in isolation.
- Prioritize dynamics over static structure.
"""

_DERIVATION_TEMPLATE = """\
Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Derive the central idea or result of this chapter from scratch, step by step.

Use this structure:

# 1. Define the Variables
What quantities, objects, or concepts are we working with?
Define each precisely before using it.

# 2. State the Assumptions
What do we assume to be true?
Which assumptions are load-bearing — what breaks if they fail?

# 3. Step-by-Step Derivation
Show every step. No skipping.
Justify each transition: why does this step follow from the previous?
If this is conceptual rather than mathematical, trace the logical chain.

# 4. Intuitive Meaning
Now that we have the result — what does it actually mean?
Translate the formal result into plain intuition.

# 5. Edge Cases
What happens at the boundaries?
Test the result against extreme or degenerate cases.

# 6. Limitations
Where does this derivation break down?
What assumptions were we making that might not hold in practice?

Rules:
- Show your work at every step.
- If a step requires justification, provide it.
- Distinguish between what is derived and what is assumed.
- Prioritize clarity of reasoning over brevity.
"""

_SYNTHESIS_TEMPLATE = """\
Book: "{book_title}" by {author}
Chapter {chapter_num}: "{chapter_title}"

Chapter text:
---
{chapter_text}
---

Synthesize the essential insight of this chapter — compress it to its irreducible core.

Use this structure:

# 1. The Core Thesis
In one or two sentences: what is the single most important claim this chapter makes?
Not a summary — the sharpest possible statement of the central idea.

# 2. The Primary Mechanism
What is the causal engine behind this thesis?
How does it actually produce the claimed effect?

# 3. Key Evidence
What are the 2-3 pieces of evidence or examples that most strongly support the thesis?
Be specific — name the actual cases, data, or arguments.

# 4. Central Trade-offs
What does accepting this idea cost?
What must you give up, ignore, or accept as a downside?

# 5. One Mental Model
If you could take away only one reusable mental model from this chapter — one pattern that transfers to other domains — what would it be?
State it in a form that could be applied elsewhere.

Rules:
- Resist the urge to summarize everything. Synthesize, don't recap.
- Every sentence should earn its place. Cut what doesn't add insight.
- The goal is a model the reader can carry and reuse — not a complete account.
"""

_MODE_PROMPTS: dict[str, str] = {
    "story": _STORY_TEMPLATE,
    "first_principles": _FIRST_PRINCIPLES_TEMPLATE,
    "systems": _SYSTEMS_TEMPLATE,
    "derivation": _DERIVATION_TEMPLATE,
    "synthesis": _SYNTHESIS_TEMPLATE,
}

VALID_MODES = frozenset(_MODE_PROMPTS.keys())

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
    mode: str = "story",
    force: bool = False,
) -> AsyncIterator[str]:
    if mode not in VALID_MODES:
        yield f"Error: unknown explain mode '{mode}'."
        return

    book = await db.get(Book, book_id)
    chapter = await db.get(Chapter, chapter_id)

    if not book or not chapter:
        yield "Error: book or chapter not found."
        return

    # Return cached result if available and not forcing regeneration
    if not force:
        result = await db.execute(
            select(ChapterExplain).where(
                ChapterExplain.chapter_id == chapter_id,
                ChapterExplain.mode == mode,
            )
        )
        cached = result.scalar_one_or_none()
        if cached:
            yield cached.content
            return

    chapter_text = await _load_chapter_text(book_id, chapter, db)

    if not chapter_text.strip():
        yield "No text found for this chapter. It may be image-based or empty."
        return

    template = _MODE_PROMPTS[mode]
    prompt = template.format(
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
    async for delta in provider.stream_text(messages, max_tokens=16000):
        accumulated.append(delta)
        yield delta

    # Persist to DB after stream completes
    full_content = "".join(accumulated)
    if full_content.strip():
        result = await db.execute(
            select(ChapterExplain).where(
                ChapterExplain.chapter_id == chapter_id,
                ChapterExplain.mode == mode,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.content = full_content
            existing.generated_at = datetime.now(timezone.utc)
        else:
            db.add(ChapterExplain(
                book_id=book_id,
                chapter_id=chapter_id,
                mode=mode,
                content=full_content,
                generated_at=datetime.now(timezone.utc),
            ))
        await db.commit()


async def _load_chapter_text(book_id: int, chapter: Chapter, db: AsyncSession) -> str:
    """Load chapter text from filesystem; fall back to DB chunks."""
    text_file = Path(settings.parsed_path) / str(book_id) / \
        f"chapter_{chapter.chapter_index}.txt"
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
