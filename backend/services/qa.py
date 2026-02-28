"""
Selection Q&A service — Phase 3 implementation target.

Responsibilities:
  stream_selection_qa() — relevance-gated retrieval → anchored Q&A stream
"""
from typing import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncSession


async def stream_selection_qa(
    book_id: int,
    chapter_id: int,
    selected_text: str,
    question: str,
    db: AsyncSession,
    provider,
) -> AsyncIterator[str]:
    """
    Answer a question grounded in the selected passage.

    Steps:
      1. Embed selected_text for retrieval seed.
      2. Retrieve candidate chunks (chapter + dossier + prior chat).
      3. Two-stage relevance gate:
         a. Semantic threshold filter on ChromaDB scores.
         b. LLM relevance judge (relevant / not relevant + confidence).
      4. Build prompt with selected text, local context, gated wider context.
      5. Stream via provider.stream_text(task="qa", ...).
      6. Yield deltas for SSE.
    """
    raise NotImplementedError
    yield


async def stream_node_qa(
    book_id: int,
    chapter_id: int,
    node_label: str,
    question: str,
    db: AsyncSession,
    provider,
) -> AsyncIterator[str]:
    """
    Answer a question anchored to a concept map node.
    Same pipeline as stream_selection_qa but seeded from node_label.
    """
    raise NotImplementedError
    yield
