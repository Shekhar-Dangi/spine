"""
Chapter concept map service — Phase 4 implementation target.

Responsibilities:
  generate_map() — LLM structured JSON extraction → validated graph → stored
"""
from sqlalchemy.ext.asyncio import AsyncSession


async def generate_map(book_id: int, chapter_id: int, db: AsyncSession, provider) -> dict:
    """
    Generate the concept map for a chapter.

    Steps:
      1. Load chapter chunks.
      2. Prompt provider.generate_text(task="extract", ...) requesting JSON:
         {nodes: [{id, label, explanation, anchors}],
          edges: [{source, target, relation}]}
      3. Validate schema; retry once with stricter prompt on failure.
      4. Persist ChapterMap row.
      5. Return validated graph dict.
    """
    raise NotImplementedError
