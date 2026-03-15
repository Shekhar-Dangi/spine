"""
Source document service — create, chunk, and embed background source records.

SourceDocuments are the canonical persistence unit for extraction inputs that
are NOT saved notes: direct Q&A sessions, explain outputs, book passages, and
manually pasted text. They are not visible in the Notes product.

Flow:
  1. create_source_document()    — persists raw content as a SourceDocument
  2. chunk_and_embed()           — splits into SourceChunks + embeds (optional)

Chunking uses _CHUNK_SIZE / _CHUNK_OVERLAP consistent with note_chunks to keep
embedding dimensions and search behaviour uniform across content types.
"""
import logging

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import SourceChunk, SourceDocument, SourceDocType

log = logging.getLogger(__name__)

# Character-based chunk sizing. At ~4 chars/token, _CHUNK_SIZE ≈ 200 tokens —
# small enough for dense extraction, large enough to hold a coherent passage.
_CHUNK_SIZE = 800
_CHUNK_OVERLAP = 100


async def create_source_document(
    *,
    user_id: int,
    source_type: SourceDocType,
    content: str,
    title: str | None = None,
    origin_ref: dict | None = None,
    db: AsyncSession,
) -> SourceDocument:
    """Persist a background source document. Does not create chunks."""
    doc = SourceDocument(
        user_id=user_id,
        source_type=source_type,
        title=title,
        content=content,
        origin_ref=origin_ref or {},
    )
    db.add(doc)
    await db.flush()
    return doc


async def chunk_and_embed(
    source_doc: SourceDocument,
    *,
    db: AsyncSession,
    embed_provider=None,
) -> list[SourceChunk]:
    """Split source_doc.content into SourceChunk rows and optionally embed them.

    Safe to call multiple times — existing chunks are deleted first.
    If embed_provider is None, chunks are stored without embeddings.
    """
    # Delete existing chunks so re-calling is idempotent
    await db.execute(
        delete(SourceChunk).where(SourceChunk.source_doc_id == source_doc.id)
    )

    raw_chunks = split_text(source_doc.content)
    if not raw_chunks:
        return []

    vectors: list | None = None
    if embed_provider and raw_chunks:
        try:
            vectors = await embed_provider.embed_texts(raw_chunks)
        except Exception as exc:
            log.warning(
                "Embedding failed for source_doc %d: %s — storing chunks without embeddings",
                source_doc.id, exc,
            )

    chunks: list[SourceChunk] = []
    for i, text in enumerate(raw_chunks):
        sc = SourceChunk(
            source_doc_id=source_doc.id,
            chunk_index=i,
            text=text,
            embedding=vectors[i] if vectors else None,
        )
        db.add(sc)
        chunks.append(sc)

    return chunks


def split_text(text: str) -> list[str]:
    """Split text into overlapping character-based chunks.

    Returns a single-element list for short texts (len <= _CHUNK_SIZE).
    Adjacent chunks share _CHUNK_OVERLAP characters to avoid cutting concepts
    that straddle a boundary.
    """
    if not text:
        return []
    if len(text) <= _CHUNK_SIZE:
        return [text]

    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + _CHUNK_SIZE, len(text))
        chunks.append(text[start:end])
        if end == len(text):
            break
        start += _CHUNK_SIZE - _CHUNK_OVERLAP

    return chunks
