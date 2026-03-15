"""
Extraction service — LLM knowledge extraction from notes and source documents.

Supported input paths (ExtractionJob):
  note_ids       — extract from one or more saved notes (original path)
  source_doc_id  — extract from a background SourceDocument (Phase 4a)
  source_content — DEPRECATED: direct content, kept for backward compat only

Flow:
  1. Load input content (note, source_doc, or legacy source_content)
  2. Load existing nodes so the LLM can reference them exactly
  3. Run LLM extraction:
     - Short content  → single LLM call
     - Long source_doc → per-chunk calls, results merged
  4. Normalize and deduplicate entity names from LLM output
  5. Build Suggestion rows (new_node, new_edge, enrich_node)
  6. Post-hoc quote scan — attach evidence excerpts at zero LLM cost
  7. Post-hoc merge detection — cosine compare new names vs existing nodes
  8. Mark processed notes with last_extracted_at
  9. Update job status (completed / failed)
"""
import json
import logging
import math
import re
import traceback
from datetime import datetime, timezone

from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import (
    ExtractionJob,
    JobStatus,
    KnowledgeNode,
    Note,
    SourceDocument,
    Suggestion,
    SuggestionStatus,
    SuggestionType,
)
from services.source_docs import split_text as split_source_text

# Maximum existing nodes to include in the prompt (name+type pairs are short).
_MAX_EXISTING_NODES_IN_PROMPT = 300

# Character limit for combined note content in a single LLM call.
# source_doc chunks are bounded by _CHUNK_SIZE in source_docs.py instead.
_MAX_NOTE_CHARS = 4000

# Cosine similarity threshold for merge detection.
_SIMILARITY_THRESHOLD = 0.88

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a knowledge extraction engine. "
    "You always respond with valid JSON only — no markdown, no prose, no code fences."
)

_EXTRACTION_PROMPT = """\
Extract knowledge from the content below and integrate it with an existing knowledge graph.

{existing_nodes_section}\
Respond with ONLY this JSON object — no markdown, no code fences, no explanation:
{{"nodes":[{{"type":"concept|person|event|place|era","name":"...","description":"...","aliases":[]}}],"edges":[{{"from_name":"...","to_name":"...","relation":"..."}}],"updates":[{{"name":"...","description":"...","aliases":[]}}]}}

Rules:
- "nodes": ONLY genuinely new concepts not in the existing nodes list above.
- "edges": relationships between any named concepts — existing OR new. Use the exact "name" value from existing nodes.
- "updates": existing nodes where you found a better description or new aliases. Use exact "name" from existing nodes.
- Return bare names only — never append type annotations like (place) or [concept].
- Only include what you are confident about from the text.
- Keep names concise (< 60 chars). Descriptions: 1-2 sentences max.
- If nothing meaningful found, return: {{"nodes":[],"edges":[],"updates":[]}}

Content:
---
{note_content}
---
"""

_EXISTING_NODES_SECTION = """\
EXISTING NODES already in the knowledge graph (do NOT add these to "nodes" — \
reference them by their exact "name" value in "edges" or "updates"):
{node_list}

"""


# ---------------------------------------------------------------------------
# Name normalization
# ---------------------------------------------------------------------------

_TYPE_SUFFIX_RE = re.compile(
    r'\s*[\(\[]\s*(?:concept|person|event|place|era|thing|entity|organization|work)\s*[\)\]]\s*$',
    re.IGNORECASE,
)


def _normalize_name(name: str) -> str:
    """Strip type suffixes, surrounding quotes/brackets, and collapse whitespace.

    Examples:
      "Venice (place)"            → "Venice"
      '"Napoleon Bonaparte"'      → "Napoleon Bonaparte"
      "[Industrial Revolution]"   → "Industrial Revolution"
    """
    name = _TYPE_SUFFIX_RE.sub("", name)
    name = name.strip('"\'\u201c\u201d\u2018\u2019`')
    name = name.strip("[](){}")
    name = re.sub(r"\s+", " ", name).strip()
    return name


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def run_extraction_job(job_id: int, chat_provider, embed_provider=None) -> None:
    """BackgroundTask: run LLM extraction and write Suggestion rows.

    Opens its own DB session since it runs outside the request lifecycle.
    embed_provider is optional — if None, merge detection is skipped silently.
    """
    async with AsyncSessionLocal() as db:
        job = await db.get(ExtractionJob, job_id)
        if not job:
            log.warning("Extraction job %d not found", job_id)
            return

        job.status = JobStatus.RUNNING
        await db.commit()
        await db.refresh(job)

        try:
            suggestions = await _extract_and_build_suggestions(
                job=job,
                db=db,
                chat_provider=chat_provider,
                embed_provider=embed_provider,
            )

            for s in suggestions:
                db.add(s)

            job.status = JobStatus.COMPLETED
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()
            log.info("Extraction job %d completed: %d suggestions", job_id, len(suggestions))

        except Exception as exc:
            tb = traceback.format_exc()
            log.error("Extraction job %d failed: %s\n%s", job_id, exc, tb)
            job.status = JobStatus.FAILED
            job.error_message = f"{type(exc).__name__}: {exc}"
            job.completed_at = datetime.now(timezone.utc)
            await db.commit()


# ---------------------------------------------------------------------------
# Core extraction logic
# ---------------------------------------------------------------------------


async def _load_existing_nodes(user_id: int, db) -> list[KnowledgeNode]:
    result = await db.execute(
        select(KnowledgeNode)
        .where(KnowledgeNode.user_id == user_id)
        .order_by(KnowledgeNode.name)
        .limit(_MAX_EXISTING_NODES_IN_PROMPT)
    )
    return list(result.scalars().all())


def _build_existing_nodes_section(existing_nodes: list[KnowledgeNode]) -> str:
    if not existing_nodes:
        return ""
    # Structured JSON per node — prevents the LLM from echoing "Venice (place)"
    node_list = "\n".join(
        json.dumps({"name": n.name, "type": n.type.value}, ensure_ascii=False)
        for n in existing_nodes
    )
    return _EXISTING_NODES_SECTION.replace("{node_list}", node_list)


async def _extract_and_build_suggestions(
    *,
    job: ExtractionJob,
    db,
    chat_provider,
    embed_provider=None,
) -> list[Suggestion]:
    """Load content, call LLM, return Suggestion objects."""

    contents: list[str] = []          # text blocks for combined single-call extraction
    chunked_contents: list[str] = []  # pre-split chunks for per-chunk extraction
    note_content_map: dict[int, str] = {}  # note_id → raw content for quote scan
    processed_notes: list[Note] = []
    use_chunked = False

    # --- Path A: source_document (Phase 4a) --------------------------------
    if job.source_doc_id is not None:
        source_doc: SourceDocument | None = await db.get(SourceDocument, job.source_doc_id)
        if not source_doc or source_doc.user_id != job.user_id:
            raise RuntimeError(
                f"SourceDocument {job.source_doc_id} not found for user {job.user_id}"
            )

        header = f"[{source_doc.source_type.value}: {source_doc.title or 'Untitled'}]\n"
        text_chunks = split_source_text(source_doc.content)

        if len(text_chunks) > 1:
            # Long content: extract per chunk, then merge
            use_chunked = True
            chunked_contents = [header + c for c in text_chunks]
            log.debug(
                "source_doc %d split into %d chunks for chunked extraction",
                source_doc.id, len(text_chunks),
            )
        else:
            contents = [header + source_doc.content]

    # --- Path B: deprecated source_content ---------------------------------
    elif job.source_content:
        log.warning(
            "Job %d uses deprecated source_content field — use source_doc_id for new jobs",
            job.id,
        )
        contents = [job.source_content[: _MAX_NOTE_CHARS * 2]]

    # --- Path C: notes (original path) -------------------------------------
    else:
        for note_id in job.note_ids:
            note = await db.get(Note, note_id)
            if not note or note.user_id != job.user_id:
                continue

            if note.last_extracted_at and note.last_extracted_at >= note.updated_at:
                log.debug("Skipping note %d (unchanged since last extraction)", note_id)
                continue

            trimmed = note.content[:_MAX_NOTE_CHARS]
            header = f"[Note: {note.title or 'Untitled'}]\n" if note.title else ""
            contents.append(header + trimmed)
            processed_notes.append(note)
            note_content_map[note_id] = note.content

    if not contents and not chunked_contents:
        log.info("Extraction job %d: nothing to process", job.id)
        return []

    # Load existing nodes
    existing_nodes = await _load_existing_nodes(job.user_id, db)
    # Use normalized names as keys so "Venice (place)" matches existing "Venice"
    existing_name_to_id: dict[str, int] = {
        _normalize_name(n.name).lower(): n.id for n in existing_nodes
    }
    existing_nodes_section = _build_existing_nodes_section(existing_nodes)

    # Run LLM
    if use_chunked:
        parsed = await _extract_from_chunks(
            chunked_contents,
            existing_nodes_section=existing_nodes_section,
            chat_provider=chat_provider,
        )
    else:
        combined = "\n\n---\n\n".join(contents)
        content_trimmed = combined[: _MAX_NOTE_CHARS * 2]
        parsed = await _single_llm_extract(
            content_trimmed, existing_nodes_section, chat_provider
        )

    suggestions = _build_suggestions(parsed, job, existing_name_to_id)

    # Post-hoc: attach quotes (note path only — source_doc quotes are unsupported yet)
    _extract_quotes_for_suggestions(suggestions, note_content_map)

    # Post-hoc: detect near-duplicate nodes via embedding cosine similarity
    if embed_provider is not None:
        new_node_suggestions = [s for s in suggestions if s.type == SuggestionType.NEW_NODE]
        merge_suggestions = await _detect_merge_candidates(
            new_node_suggestions, job=job, db=db, embed_provider=embed_provider
        )
        suggestions.extend(merge_suggestions)

    # Mark processed notes so unchanged ones are skipped next time
    now = datetime.now(timezone.utc)
    for note in processed_notes:
        note.last_extracted_at = now

    return suggestions


# ---------------------------------------------------------------------------
# LLM call helpers
# ---------------------------------------------------------------------------


async def _single_llm_extract(
    content: str,
    existing_nodes_section: str,
    chat_provider,
) -> dict:
    """Run a single LLM extraction call and return parsed result."""
    prompt = (
        _EXTRACTION_PROMPT
        .replace("{existing_nodes_section}", existing_nodes_section)
        .replace("{note_content}", content)
    )
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    try:
        raw = await chat_provider.generate_json(messages, max_tokens=2048)
    except Exception as exc:
        raise RuntimeError(f"LLM call failed: {exc}") from exc

    log.debug("Extraction raw LLM response: %s", raw[:500])
    return _parse_extraction_json(raw)


async def _extract_from_chunks(
    chunks: list[str],
    *,
    existing_nodes_section: str,
    chat_provider,
) -> dict:
    """Run one LLM call per chunk, merge all parsed results.

    Failures on individual chunks are logged and skipped so a single bad
    chunk does not abort the entire job.
    """
    all_results: list[dict] = []
    for i, chunk in enumerate(chunks):
        prompt = (
            _EXTRACTION_PROMPT
            .replace("{existing_nodes_section}", existing_nodes_section)
            .replace("{note_content}", chunk)
        )
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
        try:
            raw = await chat_provider.generate_json(messages, max_tokens=2048)
            all_results.append(_parse_extraction_json(raw))
            log.debug("Chunk %d/%d extracted successfully", i + 1, len(chunks))
        except Exception as exc:
            log.warning("LLM call failed for chunk %d/%d: %s", i + 1, len(chunks), exc)

    if not all_results:
        raise RuntimeError("All chunk LLM calls failed — no results to merge")

    return _merge_parsed_results(all_results)


def _merge_parsed_results(results: list[dict]) -> dict:
    """Deduplicate nodes, edges, and updates across multi-chunk results.

    Deduplication key:
      nodes / updates — normalized name (lowercased)
      edges           — (normalized from_name, normalized to_name, relation) tuple
    """
    seen_nodes: dict[str, dict] = {}
    seen_edges: dict[tuple, dict] = {}
    seen_updates: dict[str, dict] = {}

    for r in results:
        for node in r.get("nodes", []):
            name = _normalize_name(str(node.get("name", "")))
            if name:
                seen_nodes.setdefault(name.lower(), {**node, "name": name})

        for edge in r.get("edges", []):
            fn = _normalize_name(str(edge.get("from_name", "")))
            tn = _normalize_name(str(edge.get("to_name", "")))
            rel = str(edge.get("relation", "")).strip()
            if fn and tn and rel:
                key = (fn.lower(), tn.lower(), rel.lower())
                seen_edges.setdefault(key, {"from_name": fn, "to_name": tn, "relation": rel})

        for update in r.get("updates", []):
            name = _normalize_name(str(update.get("name", "")))
            if name:
                seen_updates.setdefault(name.lower(), {**update, "name": name})

    return {
        "nodes": list(seen_nodes.values()),
        "edges": list(seen_edges.values()),
        "updates": list(seen_updates.values()),
    }


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------


def _parse_extraction_json(raw: str) -> dict:
    """Parse LLM output into {nodes, edges, updates}.

    Handles clean JSON, markdown code fences, JSON embedded in prose,
    and completely unparseable responses (returns empty arrays, never raises).
    """
    text = raw.strip()

    # Strip markdown code fences if present
    if "```" in text:
        lines = text.split("\n")
        inner = []
        in_fence = False
        for line in lines:
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence or not any(l.strip().startswith("```") for l in lines):
                inner.append(line)
        candidate = "\n".join(inner).strip()
        if candidate:
            text = candidate

    # Attempt 1: parse the whole text
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return {
                "nodes": data.get("nodes", []),
                "edges": data.get("edges", []),
                "updates": data.get("updates", []),
            }
    except (json.JSONDecodeError, ValueError):
        pass

    # Attempt 2: find the outermost { ... } block
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start:end])
            if isinstance(data, dict):
                return {
                    "nodes": data.get("nodes", []),
                    "edges": data.get("edges", []),
                    "updates": data.get("updates", []),
                }
        except (json.JSONDecodeError, ValueError):
            pass

    log.warning(
        "Could not parse extraction JSON. Raw response (first 400 chars): %s", raw[:400]
    )
    return {"nodes": [], "edges": [], "updates": []}


# ---------------------------------------------------------------------------
# Suggestion building
# ---------------------------------------------------------------------------


def _build_suggestions(
    parsed: dict,
    job: ExtractionJob,
    existing_name_to_id: dict[str, int],
) -> list[Suggestion]:
    """Convert parsed LLM output into Suggestion rows.

    existing_name_to_id: normalized-lowercase name → node_id.
    Names from LLM output are normalized before lookup so type suffixes
    like '(place)' don't create phantom duplicate nodes.
    """
    suggestions: list[Suggestion] = []

    for node in parsed.get("nodes", []):
        if not isinstance(node, dict):
            continue
        name = _normalize_name(str(node.get("name", "")))
        if not name:
            continue

        if name.lower() in existing_name_to_id:
            log.debug("Skipping new_node '%s' — already in graph", name)
            continue

        node_type = str(node.get("type", "concept")).strip().lower()
        if node_type not in ("concept", "person", "event", "place", "era"):
            node_type = "concept"

        suggestions.append(Suggestion(
            user_id=job.user_id,
            job_id=job.id,
            type=SuggestionType.NEW_NODE,
            status=SuggestionStatus.PENDING,
            payload={
                "type": node_type,
                "name": name,
                "description": str(node.get("description", "")).strip(),
                "aliases": [
                    str(a) for a in node.get("aliases", [])
                    if isinstance(a, str) and a.strip()
                ],
                "metadata": {},
            },
        ))

    for edge in parsed.get("edges", []):
        if not isinstance(edge, dict):
            continue
        from_name = _normalize_name(str(edge.get("from_name", "")))
        to_name = _normalize_name(str(edge.get("to_name", "")))
        relation = str(edge.get("relation", "")).strip()
        if not from_name or not to_name or not relation:
            continue

        # Carry note_ids for evidence attachment on approval (empty for source_doc path)
        note_ids: list[int] = list(job.note_ids) if job.note_ids else []

        suggestions.append(Suggestion(
            user_id=job.user_id,
            job_id=job.id,
            type=SuggestionType.NEW_EDGE,
            status=SuggestionStatus.PENDING,
            payload={
                "from_name": from_name,
                "to_name": to_name,
                "relation": relation,
                "note_ids": note_ids,
                "source_doc_id": job.source_doc_id,
            },
        ))

    for update in parsed.get("updates", []):
        if not isinstance(update, dict):
            continue
        name = _normalize_name(str(update.get("name", "")))
        if not name:
            continue
        node_id = existing_name_to_id.get(name.lower())
        if not node_id:
            log.debug("Ignoring update for '%s' — not found in existing nodes", name)
            continue

        description = str(update.get("description", "")).strip()
        aliases = [
            str(a) for a in update.get("aliases", [])
            if isinstance(a, str) and a.strip()
        ]
        if not description and not aliases:
            continue

        suggestions.append(Suggestion(
            user_id=job.user_id,
            job_id=job.id,
            type=SuggestionType.ENRICH_NODE,
            status=SuggestionStatus.PENDING,
            payload={
                "node_id": node_id,
                "name": name,
                "description": description,
                "aliases": aliases,
            },
        ))

    return suggestions


# ---------------------------------------------------------------------------
# Post-hoc quote extraction (note path only)
# ---------------------------------------------------------------------------


def _extract_quotes_for_suggestions(
    suggestions: list[Suggestion],
    note_content_map: dict[int, str],
) -> None:
    """Scan note sentences for matching node names / edge pairs.

    Mutates suggestion payloads in-place by adding a 'quotes' key.
    Zero extra LLM cost — pure case-insensitive string matching.
    Only runs when note_content_map is non-empty (note extraction path).
    """
    if not note_content_map:
        for s in suggestions:
            s.payload.setdefault("quotes", [])
        return

    _MAX_QUOTES = 2
    _MAX_QUOTE_CHARS = 300

    for s in suggestions:
        if s.type == SuggestionType.NEW_NODE:
            name = s.payload.get("name", "")
            aliases = s.payload.get("aliases", [])
            terms = [t for t in ([name] + (aliases if isinstance(aliases, list) else [])) if t]

            quotes: list[dict] = []
            for note_id, content in note_content_map.items():
                for sent in re.split(r"[.!?]\s+", content):
                    if any(t.lower() in sent.lower() for t in terms):
                        trimmed = sent.strip()[:_MAX_QUOTE_CHARS]
                        if trimmed:
                            quotes.append({"note_id": note_id, "text": trimmed})
                        if len(quotes) >= _MAX_QUOTES:
                            break
                if len(quotes) >= _MAX_QUOTES:
                    break
            s.payload["quotes"] = quotes

        elif s.type == SuggestionType.NEW_EDGE:
            from_name = str(s.payload.get("from_name", ""))
            to_name = str(s.payload.get("to_name", ""))
            if not from_name or not to_name:
                s.payload["quotes"] = []
                continue

            quotes = []
            for note_id, content in note_content_map.items():
                for sent in re.split(r"[.!?]\s+", content):
                    lower = sent.lower()
                    if from_name.lower() in lower and to_name.lower() in lower:
                        trimmed = sent.strip()[:_MAX_QUOTE_CHARS]
                        if trimmed:
                            quotes.append({"note_id": note_id, "text": trimmed})
                        if len(quotes) >= _MAX_QUOTES:
                            break
                if len(quotes) >= _MAX_QUOTES:
                    break
            s.payload["quotes"] = quotes

        else:
            s.payload.setdefault("quotes", [])


# ---------------------------------------------------------------------------
# Merge detection (embedding cosine comparison)
# ---------------------------------------------------------------------------


async def _detect_merge_candidates(
    new_node_suggestions: list[Suggestion],
    *,
    job: ExtractionJob,
    db,
    embed_provider,
) -> list[Suggestion]:
    """Compare new node names against existing nodes for near-duplicates.

    Batch-embeds all new node names in one call, then cosine-compares each
    against existing nodes that already have embeddings stored.

    Returns MERGE_NODE suggestions for pairs at or above _SIMILARITY_THRESHOLD.
    Wrapped in try/except — if embed_provider is unavailable, returns [] silently.
    """
    if not new_node_suggestions:
        return []

    try:
        names = [str(s.payload.get("name", "")) for s in new_node_suggestions]
        new_vectors = await embed_provider.embed_texts(names)

        result = await db.execute(
            select(KnowledgeNode).where(
                KnowledgeNode.user_id == job.user_id,
                KnowledgeNode.embedding.is_not(None),
            )
        )
        existing_nodes = result.scalars().all()

        if not existing_nodes:
            return []

        merge_suggestions: list[Suggestion] = []
        for new_vec, new_suggestion in zip(new_vectors, new_node_suggestions):
            new_name = str(new_suggestion.payload.get("name", ""))
            new_vec_list = list(new_vec)
            for existing_node in existing_nodes:
                if existing_node.embedding is None:
                    continue
                sim = _cosine_similarity(new_vec_list, list(existing_node.embedding))
                if sim >= _SIMILARITY_THRESHOLD:
                    merge_suggestions.append(Suggestion(
                        user_id=job.user_id,
                        job_id=job.id,
                        type=SuggestionType.MERGE_NODE,
                        status=SuggestionStatus.PENDING,
                        payload={
                            "source_node_name": new_name,
                            "into_node_id": existing_node.id,
                            "into_node_name": existing_node.name,
                            "similarity": round(sim, 4),
                        },
                    ))
                    log.debug(
                        "Merge candidate: %r -> %r (similarity=%.3f)",
                        new_name, existing_node.name, sim,
                    )
                    break  # One merge candidate per new node is sufficient

        return merge_suggestions

    except Exception as exc:
        log.warning("Merge detection skipped (embed_provider unavailable): %s", exc)
        return []


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Pure-Python cosine similarity — no numpy required."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)
