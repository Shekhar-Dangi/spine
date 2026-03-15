"""
Unified semantic search service.

GET /api/search?q=<query>&limit=<int>

Strategy
--------
1. Embed the query.
2. For each source table (chunks, note_chunks, source_chunks):
   a. Semantic pass  — cosine similarity via pgvector, best chunk per source.
   b. Keyword pass   — PostgreSQL tsvector full-text, best chunk per source.
3. Merge all candidates, fuse scores, deduplicate by source, rank, return top N.

Score fusion
------------
  final = 0.7 * semantic_score + 0.3 * keyword_boost
  keyword_boost = 1.0 if the chunk matched the keyword query, else 0.0

Deduplication
-------------
Before the semantic query, per-source deduplication happens in SQL using
ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY distance).
This prevents 10 chunks from the same book swamping the results.

Old-data compatibility
----------------------
tsvector columns are generated/maintained by PostgreSQL, so all existing rows
are covered after migration 010. No data backfill needed.
"""
import logging
import re

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from services.ask import _ensure_notes_indexed

log = logging.getLogger(__name__)

_K_CANDIDATES = 20   # per-source candidates before merge (raised from 10 for better coverage)
_EXCERPT_LEN   = 400
_SEMANTIC_W    = 0.7
_KEYWORD_W     = 0.3


def _tsquery_safe(q: str) -> str:
    """Convert a raw query string to a safe plainto_tsquery expression.

    plainto_tsquery handles multi-word input and strips special chars,
    so it's safe to pass user input directly.
    """
    # Extra safety: strip characters that plainto_tsquery doesn't accept
    q = re.sub(r"[^\w\s]", " ", q)
    return q.strip() or "unknown"


async def search(
    *,
    query: str,
    user_id: int,
    limit: int = 20,
    db: AsyncSession,
    embed_provider,
) -> list[dict]:
    """Hybrid semantic + keyword search across book chunks, note_chunks, source_chunks.

    Returns a ranked list of dicts:
      source_type    : "book" | "note" | "source_doc"
      title          : str
      chapter_title  : str | None  (book results only)
      excerpt        : str
      score          : float
      meta           : dict  (book_id + chapter_id | note_id | source_doc_id)
    """
    try:
        query_vec = await embed_provider.embed_query(query)
    except Exception as exc:
        log.warning("Embedding failed for search: %s", exc)
        return []

    try:
        await _ensure_notes_indexed(
            user_id=user_id, db=db, embed_provider=embed_provider
        )
    except Exception as exc:
        log.warning("Note indexing pre-search failed: %s", exc)

    vec_str = str(query_vec)
    k = _K_CANDIDATES
    tsq = _tsquery_safe(query)
    params = {"user_id": user_id, "query_vec": vec_str, "k": k, "tsq": tsq}

    # ------------------------------------------------------------------
    # Book chunks — deduplicated to best chunk per book
    # Includes chapter_title for display context.
    # ------------------------------------------------------------------
    _BOOK_SEMANTIC = text("""
        WITH ranked AS (
            SELECT
                c.text,
                b.title                                                  AS book_title,
                COALESCE(ch.title, 'Chapter ' || c.chapter_id::text)     AS chapter_title,
                b.id                                                     AS book_id,
                c.chapter_id,
                1 - (c.embedding <=> CAST(:query_vec AS vector))         AS score,
                ROW_NUMBER() OVER (
                    PARTITION BY b.id
                    ORDER BY c.embedding <=> CAST(:query_vec AS vector)
                ) AS rn
            FROM chunks c
            JOIN books b ON c.book_id = b.id
            LEFT JOIN chapters ch ON ch.id = c.chapter_id
            WHERE b.user_id = :user_id
              AND c.embedding IS NOT NULL
        )
        SELECT text, book_title, chapter_title, book_id, chapter_id, score
        FROM ranked
        WHERE rn = 1
        ORDER BY score DESC
        LIMIT :k
    """)

    _BOOK_KEYWORD = text("""
        WITH ranked AS (
            SELECT
                c.text,
                b.title                                                  AS book_title,
                COALESCE(ch.title, 'Chapter ' || c.chapter_id::text)     AS chapter_title,
                b.id                                                     AS book_id,
                c.chapter_id,
                ROW_NUMBER() OVER (
                    PARTITION BY b.id
                    ORDER BY ts_rank(c.text_search, plainto_tsquery('english', :tsq)) DESC
                ) AS rn
            FROM chunks c
            JOIN books b ON c.book_id = b.id
            LEFT JOIN chapters ch ON ch.id = c.chapter_id
            WHERE b.user_id = :user_id
              AND c.text_search @@ plainto_tsquery('english', :tsq)
        )
        SELECT text, book_title, chapter_title, book_id, chapter_id
        FROM ranked
        WHERE rn = 1
        LIMIT :k
    """)

    # ------------------------------------------------------------------
    # Note chunks — deduplicated to best chunk per note
    # ------------------------------------------------------------------
    _NOTE_SEMANTIC = text("""
        WITH ranked AS (
            SELECT
                nc.text,
                COALESCE(n.title, 'Untitled note')                      AS title,
                n.id                                                     AS note_id,
                1 - (nc.embedding <=> CAST(:query_vec AS vector))        AS score,
                ROW_NUMBER() OVER (
                    PARTITION BY n.id
                    ORDER BY nc.embedding <=> CAST(:query_vec AS vector)
                ) AS rn
            FROM note_chunks nc
            JOIN notes n ON nc.note_id = n.id
            WHERE n.user_id = :user_id
              AND nc.embedding IS NOT NULL
        )
        SELECT text, title, note_id, score
        FROM ranked
        WHERE rn = 1
        ORDER BY score DESC
        LIMIT :k
    """)

    _NOTE_KEYWORD = text("""
        WITH ranked AS (
            SELECT
                nc.text,
                COALESCE(n.title, 'Untitled note')                      AS title,
                n.id                                                     AS note_id,
                ROW_NUMBER() OVER (
                    PARTITION BY n.id
                    ORDER BY ts_rank(nc.text_search, plainto_tsquery('english', :tsq)) DESC
                ) AS rn
            FROM note_chunks nc
            JOIN notes n ON nc.note_id = n.id
            WHERE n.user_id = :user_id
              AND nc.text_search @@ plainto_tsquery('english', :tsq)
        )
        SELECT text, title, note_id
        FROM ranked
        WHERE rn = 1
        LIMIT :k
    """)

    # ------------------------------------------------------------------
    # Source chunks — deduplicated to best chunk per source_doc
    # ------------------------------------------------------------------
    _SOURCE_SEMANTIC = text("""
        WITH ranked AS (
            SELECT
                sc.text,
                COALESCE(sd.title, sd.source_type::text)                AS title,
                sd.id                                                    AS source_doc_id,
                sd.origin_ref,
                1 - (sc.embedding <=> CAST(:query_vec AS vector))       AS score,
                ROW_NUMBER() OVER (
                    PARTITION BY sd.id
                    ORDER BY sc.embedding <=> CAST(:query_vec AS vector)
                ) AS rn
            FROM source_chunks sc
            JOIN source_documents sd ON sc.source_doc_id = sd.id
            WHERE sd.user_id = :user_id
              AND sc.embedding IS NOT NULL
        )
        SELECT text, title, source_doc_id, origin_ref, score
        FROM ranked
        WHERE rn = 1
        ORDER BY score DESC
        LIMIT :k
    """)

    _SOURCE_KEYWORD = text("""
        WITH ranked AS (
            SELECT
                sc.text,
                COALESCE(sd.title, sd.source_type::text)                AS title,
                sd.id                                                    AS source_doc_id,
                sd.origin_ref,
                ROW_NUMBER() OVER (
                    PARTITION BY sd.id
                    ORDER BY ts_rank(sc.text_search, plainto_tsquery('english', :tsq)) DESC
                ) AS rn
            FROM source_chunks sc
            JOIN source_documents sd ON sc.source_doc_id = sd.id
            WHERE sd.user_id = :user_id
              AND sc.text_search @@ plainto_tsquery('english', :tsq)
        )
        SELECT text, title, source_doc_id, origin_ref
        FROM ranked
        WHERE rn = 1
        LIMIT :k
    """)

    # ------------------------------------------------------------------
    # Execute queries, collect candidates keyed by (source_type, source_id)
    # ------------------------------------------------------------------

    # candidates[key] = {source_type, title, excerpt, score, keyword_hit, meta, chapter_title}
    candidates: dict[tuple, dict] = {}

    # --- Book semantic ---
    try:
        rows = (await db.execute(_BOOK_SEMANTIC, params)).fetchall()
        for row in rows:
            key = ("book", row[3])  # (source_type, book_id)
            candidates[key] = {
                "source_type": "book",
                "title": row[1] or "",
                "chapter_title": row[2] or None,
                "excerpt": (row[0] or "")[:_EXCERPT_LEN],
                "score": float(row[5]),
                "keyword_hit": False,
                "meta": {"book_id": row[3], "chapter_id": row[4]},
            }
    except Exception as exc:
        log.warning("Book semantic search failed: %s", exc)

    # --- Book keyword ---
    try:
        rows = (await db.execute(_BOOK_KEYWORD, params)).fetchall()
        for row in rows:
            key = ("book", row[3])
            if key in candidates:
                candidates[key]["keyword_hit"] = True
            else:
                candidates[key] = {
                    "source_type": "book",
                    "title": row[1] or "",
                    "chapter_title": row[2] or None,
                    "excerpt": (row[0] or "")[:_EXCERPT_LEN],
                    "score": 0.0,
                    "keyword_hit": True,
                    "meta": {"book_id": row[3], "chapter_id": row[4]},
                }
    except Exception as exc:
        log.warning("Book keyword search failed: %s", exc)

    # --- Note semantic ---
    try:
        rows = (await db.execute(_NOTE_SEMANTIC, params)).fetchall()
        for row in rows:
            key = ("note", row[2])
            candidates[key] = {
                "source_type": "note",
                "title": row[1] or "",
                "chapter_title": None,
                "excerpt": (row[0] or "")[:_EXCERPT_LEN],
                "score": float(row[3]),
                "keyword_hit": False,
                "meta": {"note_id": row[2]},
            }
    except Exception as exc:
        log.warning("Note semantic search failed: %s", exc)

    # --- Note keyword ---
    try:
        rows = (await db.execute(_NOTE_KEYWORD, params)).fetchall()
        for row in rows:
            key = ("note", row[2])
            if key in candidates:
                candidates[key]["keyword_hit"] = True
            else:
                candidates[key] = {
                    "source_type": "note",
                    "title": row[1] or "",
                    "chapter_title": None,
                    "excerpt": (row[0] or "")[:_EXCERPT_LEN],
                    "score": 0.0,
                    "keyword_hit": True,
                    "meta": {"note_id": row[2]},
                }
    except Exception as exc:
        log.warning("Note keyword search failed: %s", exc)

    # --- Source semantic ---
    try:
        rows = (await db.execute(_SOURCE_SEMANTIC, params)).fetchall()
        for row in rows:
            key = ("source_doc", row[2])
            candidates[key] = {
                "source_type": "source_doc",
                "title": row[1] or "",
                "chapter_title": None,
                "excerpt": (row[0] or "")[:_EXCERPT_LEN],
                "score": float(row[4]),
                "keyword_hit": False,
                "meta": {"source_doc_id": row[2], "origin_ref": row[3] or {}},
            }
    except Exception as exc:
        log.warning("Source semantic search failed: %s", exc)

    # --- Source keyword ---
    try:
        rows = (await db.execute(_SOURCE_KEYWORD, params)).fetchall()
        for row in rows:
            key = ("source_doc", row[2])
            if key in candidates:
                candidates[key]["keyword_hit"] = True
            else:
                candidates[key] = {
                    "source_type": "source_doc",
                    "title": row[1] or "",
                    "chapter_title": None,
                    "excerpt": (row[0] or "")[:_EXCERPT_LEN],
                    "score": 0.0,
                    "keyword_hit": True,
                    "meta": {"source_doc_id": row[2], "origin_ref": row[3] or {}},
                }
    except Exception as exc:
        log.warning("Source keyword search failed: %s", exc)

    # ------------------------------------------------------------------
    # Score fusion + final sort
    # ------------------------------------------------------------------
    results = []
    for c in candidates.values():
        fused = _SEMANTIC_W * c["score"] + _KEYWORD_W * (1.0 if c["keyword_hit"] else 0.0)
        results.append({
            "source_type": c["source_type"],
            "title": c["title"],
            "chapter_title": c["chapter_title"],
            "excerpt": c["excerpt"],
            "score": round(fused, 4),
            "meta": c["meta"],
        })

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:limit]
