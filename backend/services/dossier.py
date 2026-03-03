"""
Dossier service — pre-reading context generation.

Sections generated:
  1. author_background   — who the author is, biases, motivations
  2. historical_context  — intellectual era, preceding works
  3. topic_significance  — why the topic matters, impact
  4. critiques           — limitations, counterarguments, known criticisms

Web search (Tavily) is optional. If disabled or key missing, each section
is generated from the LLM's parametric knowledge with an honest disclaimer.
"""
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import Book, Dossier, DossierSection

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM = """\
You are a rigorous research assistant helping a reader understand a book before they start reading.
Be specific, honest, and concise. Never pad. Flag speculation or uncertainty explicitly.
If information is genuinely unavailable, say so — don't invent."""

# ---------------------------------------------------------------------------
# Section prompt templates
# {web_context} is either a formatted block of web results or an empty string.
# ---------------------------------------------------------------------------

_PROMPTS: dict[str, str] = {
    "author_background": """\
Book: "{title}" by {author}
{web_context}
Write a focused background on {author}:
- Who they are: education, career, intellectual position in their field
- Their known biases, ideological commitments, or blind spots
- Why they wrote this book and what motivated them
- Their credibility and standing on this topic

Be specific. Flag speculation clearly. If a detail is unknown, say so.
Target: 250–400 words.""",

    "historical_context": """\
Book: "{title}" by {author}
{web_context}
Describe the intellectual and historical context in which this book was written:
- When it was written and what was happening in the field at that time
- Key preceding works, movements, or thinkers that shaped the author's framing
- The intellectual debate or problem the book was responding to
- How the era's assumptions or blind spots may have influenced the argument

Target: 250–400 words.""",

    "topic_significance": """\
Book: "{title}" by {author}
{web_context}
Explain why this book's core topic matters:
- The fundamental problem or question it addresses
- Why this question is important and who it affects
- Real-world applications or consequences of the ideas
- Where the scope of the topic ends — what it does NOT claim to explain

Target: 250–400 words.""",

    "critiques": """\
Book: "{title}" by {author}
{web_context}
Provide a balanced critical assessment of this book:
- What it is most praised for by serious readers and scholars
- Its known weaknesses, limitations, or oversimplifications
- Significant counterarguments from critics or later scholarship
- What has aged well and what has not held up

Be specific. Avoid vague praise or blanket dismissal.
Target: 250–400 words.""",
}

_SECTION_ORDER = [
    "author_background",
    "historical_context",
    "topic_significance",
    "critiques",
]

_NO_WEB_DISCLAIMER = (
    "\n\n[Note: Generated from the model's training knowledge without live web search. "
    "Verify key claims independently.]\n"
)

# ---------------------------------------------------------------------------
# Tavily helpers
# ---------------------------------------------------------------------------


async def _tavily_searches(title: str, author: str) -> dict[str, object]:
    """
    Run one Tavily search per section. Returns a dict keyed by section_type
    with values {"context": str, "citations": list[dict]}.
    Falls back to empty results on any error.
    """
    from tavily import AsyncTavilyClient  # lazy import — only needed if web search enabled

    client = AsyncTavilyClient(api_key=settings.tavily_api_key)

    queries = {
        "author_background": f'"{author}" author biography background intellectual influences',
        "historical_context": f'"{title}" {author} historical intellectual context reception',
        "topic_significance": f'"{title}" significance importance impact legacy',
        "critiques": f'"{title}" {author} criticism limitations critique counterarguments',
    }

    results: dict[str, object] = {}
    for section, query in queries.items():
        try:
            resp = await client.search(query, max_results=4)
            raw = resp.get("results", [])
            context_lines = []
            citations = []
            for i, r in enumerate(raw, 1):
                context_lines.append(
                    f"{i}. {r.get('title', '')} ({r.get('url', '')})\n{r.get('content', '')[:300]}"
                )
                citations.append({
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "snippet": r.get("content", "")[:200],
                })
            results[section] = {
                "context": "\n\n".join(context_lines),
                "citations": citations,
            }
        except Exception as exc:
            log.warning(
                "Tavily search failed for section %s: %s", section, exc)
            results[section] = {"context": "", "citations": []}

    return results


def _format_web_block(context: str) -> str:
    if not context:
        return ""
    return f"\n[Web context]\n{context}\n"


# ---------------------------------------------------------------------------
# Section generation
# ---------------------------------------------------------------------------


async def _generate_section(
    section_type: str,
    title: str,
    author: str,
    web_context: str,
    provider,
) -> str:
    template = _PROMPTS[section_type]
    prompt = template.format(
        title=title,
        author=author,
        web_context=_format_web_block(web_context),
    )
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": prompt},
    ]
    try:
        return await provider.generate_text(messages, max_tokens=1024)
    except Exception as exc:
        log.error("Section generation failed for %s: %s", section_type, exc)
        return f"[Generation failed: {exc}]"


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def generate_dossier(
    book_id: int,
    db: AsyncSession,
    provider,
    use_web_search: bool = True,
) -> None:
    book = await db.get(Book, book_id)
    if not book:
        log.error("generate_dossier: book %d not found", book_id)
        return

    result = await db.execute(select(Dossier).where(Dossier.book_id == book_id))
    dossier = result.scalar_one_or_none()
    if not dossier:
        log.error("generate_dossier: Dossier row missing for book %d", book_id)
        return

    try:
        # Clear any previous sections (regeneration case)
        await db.execute(
            delete(DossierSection).where(
                DossierSection.dossier_id == dossier.id)
        )
        await db.commit()

        # Tavily web searches (optional)
        web_data: dict[str, object] = {}
        if use_web_search and settings.tavily_api_key:
            web_data = await _tavily_searches(book.title, book.author or "Unknown")
        else:
            for s in _SECTION_ORDER:
                web_data[s] = {"context": "", "citations": []}

        # Generate and persist each section
        for section_type in _SECTION_ORDER:
            section_result = web_data.get(section_type, {})
            web_context = section_result.get(
                "context", "")  # type: ignore[union-attr]
            citations = section_result.get(
                "citations", [])  # type: ignore[union-attr]

            content = await _generate_section(
                section_type,
                book.title,
                book.author or "Unknown",
                web_context,
                provider,
            )
            # Append disclaimer when running without web search
            if not web_context:
                content += _NO_WEB_DISCLAIMER

            db.add(DossierSection(
                dossier_id=dossier.id,
                section_type=section_type,
                content=content,
                citations_json=json.dumps(citations) if citations else None,
            ))

        dossier.generated_at = datetime.now(timezone.utc)
        dossier.version = (dossier.version or 0) + 1
        await db.commit()
        log.info("Dossier generated for book %d (version %d)",
                 book_id, dossier.version)

    except Exception as exc:
        log.error("generate_dossier failed for book %d: %s", book_id, exc)
        # Delete the row so the UI resets to "Generate" rather than stuck "generating"
        await db.delete(dossier)
        await db.commit()
