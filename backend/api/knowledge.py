"""
Knowledge endpoints — extraction jobs + suggestion review inbox.

POST   /api/knowledge/extract
       body: { note_id: int }
       Creates an ExtractionJob and fires a BackgroundTask to run LLM extraction.
       Returns: { job_id, status }

GET    /api/knowledge/suggestions
       Returns pending (and optionally rejected) suggestions for the current user.
       Query params: status (default "pending"), limit, offset

POST   /api/knowledge/suggestions/{id}/approve
       Approves a suggestion:
         new_node    → writes KnowledgeNode + optionally embeds name
         new_edge    → resolves or creates nodes by name, writes KnowledgeEdge + Evidence (with quote)
         merge_node  → adds source_name as alias on existing node

POST   /api/knowledge/suggestions/{id}/reject
       Soft-reject (status=rejected). Can be reconsidered.

POST   /api/knowledge/suggestions/{id}/dismiss
       Hard-dismiss (status=dismissed). Not shown again.

GET    /api/knowledge/jobs/{job_id}
       Returns the current status of an extraction job.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth.deps import get_current_user
from db.database import get_db
from db.models import (
    EvidenceSourceType,
    Evidence,
    ExtractionJob,
    JobStatus,
    KnowledgeEdge,
    KnowledgeNode,
    KnowledgeNodeType,
    NodeSource,
    Note,
    SourceDocument,
    SourceDocType,
    Suggestion,
    SuggestionStatus,
    SuggestionType,
    User,
)
from services import extraction as extraction_svc

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ExtractIn(BaseModel):
    # Provide exactly one of: note_id, source_doc_id.
    # source_content is deprecated — use source_doc_id for new integrations.
    note_id: int | None = None
    source_doc_id: int | None = None
    source_content: str | None = None  # deprecated


class SourceDocIn(BaseModel):
    source_type: str  # qa_turn | explain_turn | book_passage | manual_text
    content: str
    title: str | None = None
    # Soft origin reference, e.g. {"book_id": 3, "chapter_id": 7, "message_id": 42}
    origin_ref: dict = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _suggestion_out(s: Suggestion) -> dict:
    return {
        "id": s.id,
        "type": s.type.value,
        "status": s.status.value,
        "payload": s.payload,
        "job_id": s.job_id,
        "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
        "created_at": s.created_at.isoformat(),
    }


async def _chunk_source_doc_bg(source_doc_id: int, embed_provider) -> None:
    """BackgroundTask: chunk + embed a SourceDocument. Opens its own DB session."""
    from db.database import AsyncSessionLocal
    from services.source_docs import chunk_and_embed

    async with AsyncSessionLocal() as db:
        source_doc = await db.get(SourceDocument, source_doc_id)
        if not source_doc:
            log.warning("_chunk_source_doc_bg: SourceDocument %d not found", source_doc_id)
            return
        try:
            chunks = await chunk_and_embed(source_doc, db=db, embed_provider=embed_provider)
            await db.commit()
            log.info(
                "Chunked source_doc %d into %d chunks", source_doc_id, len(chunks)
            )
        except Exception as exc:
            log.error("Chunking failed for source_doc %d: %s", source_doc_id, exc)


async def _get_suggestion_for_user(
    suggestion_id: int, user_id: int, db: AsyncSession
) -> Suggestion:
    s = await db.get(Suggestion, suggestion_id)
    if not s or s.user_id != user_id:
        raise HTTPException(status_code=404, detail="Suggestion not found.")
    return s


def _create_node_sources_from_quotes(
    node_id: int,
    payload: dict,
    db,
) -> None:
    """Create NodeSource rows from the 'quotes' list in a suggestion payload.

    quotes entries have shape: {"note_id": int, "text": str}
    source_doc_id (if present) is used when there are no note quotes.
    """
    quotes: list[dict] = payload.get("quotes", [])
    for q in quotes:
        if not isinstance(q, dict):
            continue
        note_id = q.get("note_id")
        text = q.get("text", "")
        if note_id:
            db.add(NodeSource(
                node_id=node_id,
                source_type=EvidenceSourceType.NOTE.value,
                source_id=note_id,
                excerpt=text or None,
            ))

    # If no note quotes but extraction came from a source_doc, record that
    if not quotes:
        source_doc_id = payload.get("source_doc_id")
        if source_doc_id:
            db.add(NodeSource(
                node_id=node_id,
                source_type=EvidenceSourceType.SOURCE_DOC.value,
                source_id=source_doc_id,
                excerpt=None,
            ))


async def _find_or_create_node(
    name: str, user_id: int, db: AsyncSession
) -> KnowledgeNode:
    """Find an existing node by name (case-insensitive) or create a new one."""
    result = await db.execute(
        select(KnowledgeNode).where(
            KnowledgeNode.user_id == user_id,
            KnowledgeNode.name.ilike(name),
        )
    )
    node = result.scalar_one_or_none()
    if node:
        return node

    node = KnowledgeNode(
        user_id=user_id,
        type=KnowledgeNodeType.CONCEPT,
        name=name,
        aliases=[],
        description=None,
        node_metadata={},
    )
    db.add(node)
    await db.flush()  # get id before commit
    return node


# ---------------------------------------------------------------------------
# Source document creation
# ---------------------------------------------------------------------------


@router.post("/source-docs", status_code=201)
async def create_source_doc(
    body: SourceDocIn,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Persist a background source document for later extraction.

    Returns the source_doc id which can then be passed to POST /extract.
    Chunking + embedding runs as a background task if an embed provider is configured.
    """
    try:
        source_type = SourceDocType(body.source_type)
    except ValueError:
        valid = [t.value for t in SourceDocType]
        raise HTTPException(
            status_code=422,
            detail=f"Invalid source_type. Must be one of: {', '.join(valid)}",
        )

    if not body.content.strip():
        raise HTTPException(status_code=422, detail="content must not be empty.")

    from services.source_docs import create_source_document, chunk_and_embed
    source_doc = await create_source_document(
        user_id=current_user.id,
        source_type=source_type,
        content=body.content,
        title=body.title,
        origin_ref=body.origin_ref,
        db=db,
    )
    await db.commit()
    await db.refresh(source_doc)

    # Kick off chunking + embedding in the background (optional — search only)
    embed_provider = None
    try:
        from providers.registry import get_embedding_provider_for_user
        embed_provider = await get_embedding_provider_for_user(db, current_user.id)
    except RuntimeError:
        pass  # No embed provider configured — chunks will have no embeddings

    if embed_provider:
        background_tasks.add_task(
            _chunk_source_doc_bg, source_doc.id, embed_provider
        )

    return {
        "id": source_doc.id,
        "source_type": source_doc.source_type.value,
        "title": source_doc.title,
        "created_at": source_doc.created_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Extraction trigger
# ---------------------------------------------------------------------------


@router.post("/extract", status_code=202)
async def trigger_extraction(
    body: ExtractIn,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create an ExtractionJob and fire BackgroundTask to run it.

    Provide exactly one of:
      note_id      — extract from a saved note
      source_doc_id — extract from a background source document
      source_content — DEPRECATED: extract from raw content directly
    """
    inputs_provided = sum([
        body.note_id is not None,
        body.source_doc_id is not None,
        bool(body.source_content),
    ])
    if inputs_provided == 0:
        raise HTTPException(
            status_code=422,
            detail="Provide one of: note_id, source_doc_id, or source_content.",
        )
    if inputs_provided > 1:
        raise HTTPException(
            status_code=422,
            detail="Provide only one of: note_id, source_doc_id, or source_content.",
        )

    if body.note_id is not None:
        note = await db.get(Note, body.note_id)
        if not note or note.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Note not found.")

    if body.source_doc_id is not None:
        source_doc = await db.get(SourceDocument, body.source_doc_id)
        if not source_doc or source_doc.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Source document not found.")

    job = ExtractionJob(
        user_id=current_user.id,
        status=JobStatus.PENDING,
        note_ids=[body.note_id] if body.note_id is not None else [],
        source_doc_id=body.source_doc_id,
        source_content=body.source_content or None,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    from providers.registry import get_embedding_provider_for_user, get_provider_for_task
    chat_provider = await get_provider_for_task("extract", db, current_user.id)

    # Embedding provider is optional — if not configured, merge detection is skipped
    embed_provider = None
    try:
        embed_provider = await get_embedding_provider_for_user(db, current_user.id)
    except RuntimeError:
        log.info(
            "No embedding provider for user %d — merge detection will be skipped",
            current_user.id,
        )

    background_tasks.add_task(
        extraction_svc.run_extraction_job, job.id, chat_provider, embed_provider
    )

    return {
        "id": job.id,
        "status": job.status.value,
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat(),
        "completed_at": None,
    }


# ---------------------------------------------------------------------------
# Job status
# ---------------------------------------------------------------------------


@router.get("/jobs/{job_id}")
async def get_job_status(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = await db.get(ExtractionJob, job_id)
    if not job or job.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Job not found.")

    suggestion_count: int | None = None
    if job.status == JobStatus.COMPLETED:
        count_result = await db.execute(
            select(func.count()).select_from(Suggestion).where(
                Suggestion.job_id == job.id,
                Suggestion.status == SuggestionStatus.PENDING,
            )
        )
        suggestion_count = count_result.scalar_one()

    return {
        "id": job.id,
        "status": job.status.value,
        "suggestion_count": suggestion_count,
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat(),
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


# ---------------------------------------------------------------------------
# Suggestions list
# ---------------------------------------------------------------------------


@router.get("/suggestions")
async def list_suggestions(
    status: str = Query("pending", description="Filter by status: pending, rejected, approved, dismissed"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    valid_statuses = {s.value for s in SuggestionStatus}
    if status not in valid_statuses:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(valid_statuses))}",
        )

    query = (
        select(Suggestion)
        .where(
            Suggestion.user_id == current_user.id,
            Suggestion.status == status,
        )
        .order_by(Suggestion.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    suggestions = result.scalars().all()

    return {
        "suggestions": [_suggestion_out(s) for s in suggestions],
        "total": len(suggestions),
    }


# ---------------------------------------------------------------------------
# Suggestion actions
# ---------------------------------------------------------------------------


@router.post("/suggestions/{suggestion_id}/approve")
async def approve_suggestion(
    suggestion_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = await _get_suggestion_for_user(suggestion_id, current_user.id, db)
    if s.status != SuggestionStatus.PENDING:
        raise HTTPException(
            status_code=409,
            detail=f"Suggestion is already {s.status.value}.",
        )

    result: dict = {}

    if s.type == SuggestionType.NEW_NODE:
        payload = s.payload
        node_type_str = payload.get("type", "concept")
        try:
            node_type = KnowledgeNodeType(node_type_str)
        except ValueError:
            node_type = KnowledgeNodeType.CONCEPT

        node = KnowledgeNode(
            user_id=current_user.id,
            type=node_type,
            name=payload.get("name", ""),
            aliases=payload.get("aliases", []),
            description=payload.get("description") or None,
            node_metadata=payload.get("metadata", {}),
        )
        db.add(node)
        await db.flush()

        # Optionally embed the node name for future merge detection
        try:
            from providers.registry import get_embedding_provider_for_user
            embed_provider = await get_embedding_provider_for_user(db, current_user.id)
            vec = await embed_provider.embed_query(node.name)
            node.embedding = vec
        except Exception:
            pass  # embedding is optional; node is still created without it

        # Record which sources mention this node
        _create_node_sources_from_quotes(node.id, payload, db)

        result = {"node_id": node.id, "name": node.name}

    elif s.type == SuggestionType.NEW_EDGE:
        payload = s.payload
        from_name = payload.get("from_name", "")
        to_name = payload.get("to_name", "")
        relation = payload.get("relation", "")
        note_ids: list[int] = payload.get("note_ids", [])

        if not from_name or not to_name or not relation:
            raise HTTPException(
                status_code=422,
                detail="Edge suggestion is missing from_name, to_name, or relation.",
            )

        from_node = await _find_or_create_node(from_name, current_user.id, db)
        to_node = await _find_or_create_node(to_name, current_user.id, db)

        edge = KnowledgeEdge(
            user_id=current_user.id,
            from_node_id=from_node.id,
            to_node_id=to_node.id,
            relation=relation,
        )
        db.add(edge)
        await db.flush()

        # Attach evidence — notes (with inline quotes) or source_doc
        quotes_by_note: dict[int, str] = {
            q["note_id"]: q["text"]
            for q in payload.get("quotes", [])
            if isinstance(q, dict) and "note_id" in q and "text" in q
        }
        for note_id in note_ids:
            db.add(Evidence(
                edge_id=edge.id,
                source_type=EvidenceSourceType.NOTE,
                source_id=note_id,
                quote=quotes_by_note.get(note_id),
            ))

        source_doc_id: int | None = payload.get("source_doc_id")
        if source_doc_id and not note_ids:
            db.add(Evidence(
                edge_id=edge.id,
                source_type=EvidenceSourceType.SOURCE_DOC,
                source_id=source_doc_id,
                quote=None,
            ))

        # Also record node-level provenance for both endpoints
        _create_node_sources_from_quotes(from_node.id, payload, db)
        _create_node_sources_from_quotes(to_node.id, payload, db)

        result = {
            "edge_id": edge.id,
            "from_node_id": from_node.id,
            "to_node_id": to_node.id,
            "relation": relation,
        }

    elif s.type == SuggestionType.MERGE_NODE:
        payload = s.payload
        into_node_id = payload.get("into_node_id")
        source_name = str(payload.get("source_node_name", "")).strip()

        if not into_node_id:
            raise HTTPException(status_code=422, detail="Merge suggestion is missing into_node_id.")

        into_node = await db.get(KnowledgeNode, into_node_id)
        if not into_node or into_node.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Target node not found.")

        alias_added = False
        if source_name and source_name not in into_node.aliases and source_name != into_node.name:
            # SQLAlchemy ARRAY mutation requires assignment of a new list
            into_node.aliases = list(into_node.aliases) + [source_name]
            alias_added = True

        result = {
            "merged": True,
            "into_node_id": into_node.id,
            "alias_added": alias_added,
        }

    elif s.type == SuggestionType.ENRICH_NODE:
        payload = s.payload
        node_id = payload.get("node_id")
        if not node_id:
            raise HTTPException(status_code=422, detail="enrich_node suggestion is missing node_id.")

        node = await db.get(KnowledgeNode, node_id)
        if not node or node.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Target node not found.")

        # Apply description only if the node has none or the new one is longer/better.
        new_description = str(payload.get("description", "")).strip()
        if new_description and (not node.description or len(new_description) > len(node.description)):
            node.description = new_description

        # Merge in new aliases without duplicating.
        new_aliases = [str(a) for a in payload.get("aliases", []) if isinstance(a, str) and a.strip()]
        existing_aliases_lower = {a.lower() for a in (node.aliases or [])}
        existing_aliases_lower.add(node.name.lower())
        merged = list(node.aliases or [])
        for alias in new_aliases:
            if alias.lower() not in existing_aliases_lower:
                merged.append(alias)
                existing_aliases_lower.add(alias.lower())
        node.aliases = merged

        result = {"node_id": node.id, "name": node.name, "enriched": True}

    else:
        raise HTTPException(
            status_code=422,
            detail=f"Approval not supported for suggestion type: {s.type.value}",
        )

    s.status = SuggestionStatus.APPROVED
    s.reviewed_at = datetime.now(timezone.utc)
    await db.commit()

    return {"approved": True, **result}


@router.post("/suggestions/{suggestion_id}/reject")
async def reject_suggestion(
    suggestion_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = await _get_suggestion_for_user(suggestion_id, current_user.id, db)
    if s.status not in (SuggestionStatus.PENDING, SuggestionStatus.APPROVED):
        raise HTTPException(status_code=409, detail=f"Suggestion is already {s.status.value}.")

    s.status = SuggestionStatus.REJECTED
    s.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"rejected": True, "id": s.id}


@router.post("/suggestions/{suggestion_id}/dismiss")
async def dismiss_suggestion(
    suggestion_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = await _get_suggestion_for_user(suggestion_id, current_user.id, db)
    s.status = SuggestionStatus.DISMISSED
    s.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"dismissed": True, "id": s.id}


# ---------------------------------------------------------------------------
# Node + Edge CRUD (Phase 3)
# ---------------------------------------------------------------------------


class NodeIn(BaseModel):
    type: str
    name: str
    aliases: list[str] = []
    description: str | None = None
    node_metadata: dict = {}


class NodeUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    aliases: list[str] | None = None
    description: str | None = None
    node_metadata: dict | None = None


class EdgeIn(BaseModel):
    to_node_id: int
    relation: str


def _node_out(n: KnowledgeNode) -> dict:
    return {
        "id": n.id,
        "type": n.type.value,
        "name": n.name,
        "aliases": n.aliases,
        "description": n.description,
        "node_metadata": n.node_metadata,
        "created_at": n.created_at.isoformat(),
        "updated_at": n.updated_at.isoformat(),
    }


def _edge_out(e: KnowledgeEdge, evidence: list[dict] | None = None) -> dict:
    d = {
        "id": e.id,
        "from_node_id": e.from_node_id,
        "to_node_id": e.to_node_id,
        "relation": e.relation,
        "created_at": e.created_at.isoformat(),
    }
    if evidence is not None:
        d["evidence"] = evidence
    return d


@router.get("/nodes")
async def list_nodes(
    node_type: str | None = Query(None),
    search: str | None = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(KnowledgeNode).where(KnowledgeNode.user_id == current_user.id)
    if node_type:
        try:
            q = q.where(KnowledgeNode.type == KnowledgeNodeType(node_type))
        except ValueError:
            raise HTTPException(422, detail=f"Invalid node_type: {node_type}")
    if search:
        q = q.where(KnowledgeNode.name.ilike(f"%{search}%"))
    q = q.order_by(KnowledgeNode.name).offset(offset).limit(limit)
    result = await db.execute(q)
    nodes = result.scalars().all()
    return {"nodes": [_node_out(n) for n in nodes], "total": len(nodes)}


@router.post("/nodes", status_code=201)
async def create_node(
    body: NodeIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        node_type = KnowledgeNodeType(body.type)
    except ValueError:
        raise HTTPException(422, detail=f"Invalid node type: {body.type}")
    node = KnowledgeNode(
        user_id=current_user.id,
        type=node_type,
        name=body.name,
        aliases=body.aliases,
        description=body.description,
        node_metadata=body.node_metadata,
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return _node_out(node)


@router.get("/nodes/{node_id}")
async def get_node(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return a node with its edges, edge evidence, and node-level source provenance."""
    result = await db.execute(
        select(KnowledgeNode)
        .where(KnowledgeNode.id == node_id, KnowledgeNode.user_id == current_user.id)
        .options(
            selectinload(KnowledgeNode.outgoing_edges).selectinload(KnowledgeEdge.evidence),
            selectinload(KnowledgeNode.incoming_edges).selectinload(KnowledgeEdge.evidence),
        )
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(404, detail="Node not found.")

    # --- Node-level sources (mentions) ---
    ns_result = await db.execute(
        select(NodeSource)
        .where(NodeSource.node_id == node_id)
        .order_by(NodeSource.created_at.desc())
    )
    node_source_rows = list(ns_result.scalars().all())

    # Collect note ids from both edge evidence and node_sources
    all_edges = list(node.outgoing_edges) + list(node.incoming_edges)
    note_ids_set: set[int] = set()
    for edge in all_edges:
        for ev in edge.evidence:
            if ev.source_type == EvidenceSourceType.NOTE:
                note_ids_set.add(ev.source_id)
    for ns in node_source_rows:
        if ns.source_type == EvidenceSourceType.NOTE.value:
            note_ids_set.add(ns.source_id)

    # Collect source_doc ids for title lookup
    source_doc_ids_set: set[int] = set()
    for ns in node_source_rows:
        if ns.source_type == EvidenceSourceType.SOURCE_DOC.value:
            source_doc_ids_set.add(ns.source_id)

    # Fetch note titles
    note_title_map: dict[int, str | None] = {}
    if note_ids_set:
        note_rows = await db.execute(
            select(Note.id, Note.title).where(Note.id.in_(note_ids_set))
        )
        note_title_map = {row[0]: row[1] for row in note_rows.all()}

    # Fetch source_doc titles
    source_doc_title_map: dict[int, str | None] = {}
    if source_doc_ids_set:
        sd_rows = await db.execute(
            select(SourceDocument.id, SourceDocument.title, SourceDocument.source_type)
            .where(SourceDocument.id.in_(source_doc_ids_set))
        )
        source_doc_title_map = {
            row[0]: {"title": row[1], "source_type": row[2].value}
            for row in sd_rows.all()
        }

    def _evidence_out(ev) -> dict:
        return {
            "id": ev.id,
            "source_type": ev.source_type.value,
            "source_id": ev.source_id,
            "quote": ev.quote,
            "note_title": note_title_map.get(ev.source_id)
            if ev.source_type == EvidenceSourceType.NOTE else None,
        }

    def _node_source_out(ns: NodeSource) -> dict:
        meta: dict = {}
        if ns.source_type == EvidenceSourceType.NOTE.value:
            meta["note_title"] = note_title_map.get(ns.source_id)
        elif ns.source_type == EvidenceSourceType.SOURCE_DOC.value:
            sd = source_doc_title_map.get(ns.source_id, {})
            meta["source_doc_title"] = sd.get("title")
            meta["source_doc_type"] = sd.get("source_type")
        return {
            "id": ns.id,
            "source_type": ns.source_type,
            "source_id": ns.source_id,
            "excerpt": ns.excerpt,
            "created_at": ns.created_at.isoformat(),
            **meta,
        }

    edges_out = []
    for edge in all_edges:
        edges_out.append(
            _edge_out(edge, evidence=[_evidence_out(ev) for ev in edge.evidence])
        )

    return {
        **_node_out(node),
        "edges": edges_out,
        "sources": [_node_source_out(ns) for ns in node_source_rows],
    }


@router.patch("/nodes/{node_id}")
async def update_node(
    node_id: int,
    body: NodeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    node = await db.get(KnowledgeNode, node_id)
    if not node or node.user_id != current_user.id:
        raise HTTPException(404, detail="Node not found.")
    if body.name is not None:
        node.name = body.name
    if body.type is not None:
        try:
            node.type = KnowledgeNodeType(body.type)
        except ValueError:
            raise HTTPException(422, detail=f"Invalid node type: {body.type}")
    if body.aliases is not None:
        node.aliases = body.aliases
    if body.description is not None:
        node.description = body.description
    if body.node_metadata is not None:
        node.node_metadata = body.node_metadata
    await db.commit()
    await db.refresh(node)
    return _node_out(node)


@router.delete("/nodes/{node_id}", status_code=204)
async def delete_node(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    node = await db.get(KnowledgeNode, node_id)
    if not node or node.user_id != current_user.id:
        raise HTTPException(404, detail="Node not found.")
    await db.delete(node)
    await db.commit()


@router.post("/nodes/{node_id}/edges", status_code=201)
async def create_edge(
    node_id: int,
    body: EdgeIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from_node = await db.get(KnowledgeNode, node_id)
    if not from_node or from_node.user_id != current_user.id:
        raise HTTPException(404, detail="Source node not found.")
    to_node = await db.get(KnowledgeNode, body.to_node_id)
    if not to_node or to_node.user_id != current_user.id:
        raise HTTPException(404, detail="Target node not found.")
    edge = KnowledgeEdge(
        user_id=current_user.id,
        from_node_id=node_id,
        to_node_id=body.to_node_id,
        relation=body.relation,
    )
    db.add(edge)
    await db.commit()
    await db.refresh(edge)
    return _edge_out(edge)


@router.delete("/edges/{edge_id}", status_code=204)
async def delete_edge(
    edge_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    edge = await db.get(KnowledgeEdge, edge_id)
    if not edge or edge.user_id != current_user.id:
        raise HTTPException(404, detail="Edge not found.")
    await db.delete(edge)
    await db.commit()


# ---------------------------------------------------------------------------
# Graph data endpoint (Phase 3)
# ---------------------------------------------------------------------------


@router.get("/graph")
async def get_graph(
    node_type: str | None = Query(None),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all nodes + edges for the user in adjacency-list form.

    Edges are only included if BOTH endpoints are in the returned node set
    (relevant when node_type or search filters are active).
    """
    node_q = select(KnowledgeNode).where(KnowledgeNode.user_id == current_user.id)
    if node_type:
        try:
            node_q = node_q.where(KnowledgeNode.type == KnowledgeNodeType(node_type))
        except ValueError:
            raise HTTPException(422, detail=f"Invalid node_type: {node_type}")
    if search:
        node_q = node_q.where(KnowledgeNode.name.ilike(f"%{search}%"))

    nodes_result = await db.execute(node_q.order_by(KnowledgeNode.name))
    nodes = nodes_result.scalars().all()

    node_ids = {n.id for n in nodes}

    if node_ids:
        edges_result = await db.execute(
            select(KnowledgeEdge).where(
                KnowledgeEdge.user_id == current_user.id,
                KnowledgeEdge.from_node_id.in_(node_ids),
                KnowledgeEdge.to_node_id.in_(node_ids),
            )
        )
        edges = edges_result.scalars().all()
    else:
        edges = []

    return {
        "nodes": [_node_out(n) for n in nodes],
        "edges": [_edge_out(e) for e in edges],
    }
