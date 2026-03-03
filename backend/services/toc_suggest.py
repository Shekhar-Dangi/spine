"""
LLM-assisted TOC suggestion service.

Extracts text from a user-specified PDF page, sends it to the LLM,
and returns a structured list of {title, book_page, pdf_page, start_page, ...}
that the TocEditor can pre-populate for user review.
"""
import json
import re

import fitz  # PyMuPDF
from sqlalchemy.ext.asyncio import AsyncSession

from providers.registry import get_provider_for_task

_PROMPT = """\
You are a table-of-contents extractor for PDFs.

Given raw text from a book's table of contents page, extract all accessible chapter entries.

Return ONLY a valid JSON array — no explanation, no markdown code fences, nothing else. Format:
[
  {{"title": "Chapter Title", "page": 1}},
  ...
]

Rules:
- "page" is the page number as printed in the book's table of contents (integer).
- Include all entries that have a page number listed (chapters, parts, sections).
- Skip entries with no readable page number (e.g. blank lines, decorative text).
- Preserve the exact titles as printed.

Raw TOC text:
{text}"""


async def suggest_toc(
    file_path: str,
    toc_pdf_page: int,   # 1-indexed physical PDF page
    page_offset: int,    # filler pages before content: pdf_page = book_page + page_offset
    db: AsyncSession,
) -> list[dict]:
    """
    Return a list of suggested chapters from the given PDF TOC page.

    Each entry:
      index       — 0-based order
      title       — extracted chapter title
      book_page   — page number as printed in the TOC
      pdf_page    — 1-indexed physical PDF page (= book_page + page_offset)
      start_page  — 0-indexed fitz page number (= pdf_page - 1)
      end_page    — None (user/backend fills this on confirm)
      start_anchor, end_anchor — None (PDF-only path)
    """
    doc = fitz.open(file_path)
    total_pages = len(doc)
    page_idx = toc_pdf_page - 1  # convert to 0-indexed

    if page_idx < 0 or page_idx >= total_pages:
        doc.close()
        raise ValueError(
            f"Page {toc_pdf_page} is out of range — book has {total_pages} pages."
        )

    page_text = doc[page_idx].get_text("text")
    doc.close()

    if not page_text.strip():
        raise ValueError(
            "The specified page appears to be empty or image-only. "
            "Only text-based PDFs are supported."
        )

    provider = await get_provider_for_task("toc_extract", db)

    response = await provider.generate_text(
        messages=[{"role": "user", "content": _PROMPT.format(text=page_text)}],
        max_tokens=2048,
    )

    # Strip accidental markdown fences
    cleaned = re.sub(r"```(?:json)?|```", "", response).strip()

    # Find the first JSON array
    match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if not match:
        raise ValueError(
            f"LLM did not return a valid JSON array. "
            f"Response preview: {response[:400]}"
        )

    raw_entries = json.loads(match.group(0))

    result: list[dict] = []
    for i, entry in enumerate(raw_entries):
        book_page = int(entry.get("page", 0))
        pdf_page = book_page + page_offset          # 1-indexed physical PDF page
        start_page_0idx = max(0, pdf_page - 1)      # 0-indexed for fitz

        result.append(
            {
                "index": i,
                "title": str(entry.get("title", f"Chapter {i + 1}")).strip(),
                "book_page": book_page,
                "pdf_page": pdf_page,
                # Fields expected by TocChapter / confirm_toc:
                "start_page": start_page_0idx,
                "end_page": None,
                "start_anchor": None,
                "end_anchor": None,
                "confirmed": False,
            }
        )

    return result
