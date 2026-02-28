"""
Local embedding service using fastembed + BAAI/bge-small-en-v1.5.

Why local:
  - Zero cost — no API calls for embedding.
  - OpenRouter doesn't support the embeddings endpoint.
  - bge-small-en-v1.5 is state-of-the-art at its size (384 dims, ~130MB).
  - Runs on CPU; fast enough for book-sized workloads.

The model is loaded once and reused across all ingest + retrieval calls.
"""
from __future__ import annotations

from fastembed import TextEmbedding

MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIM = 384

_model: TextEmbedding | None = None


def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        _model = TextEmbedding(MODEL_NAME)
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns list of float vectors."""
    model = _get_model()
    return [vec.tolist() for vec in model.embed(texts)]


def embed_query(text: str) -> list[float]:
    """Embed a single query string."""
    return embed_texts([text])[0]
