"""V2 Knowledge Layer — Phase 1: passage anchors, notes, knowledge graph, suggestions

Revision ID: 003
Revises: 002
Create Date: 2026-03-10

New tables:
  - passage_anchors   — stable position references into book chunks
  - notes             — user-authored + promoted knowledge artifacts
  - note_links        — manual backlinks between notes
  - knowledge_nodes   — concept/person/event/place/era graph nodes
  - knowledge_edges   — directed relations between nodes (require evidence)
  - evidence          — polymorphic source references backing each edge
  - extraction_jobs   — per-note async LLM extraction jobs (Phase 2 runner)
  - suggestions       — AI-proposed graph changes pending user review (Phase 2 inbox)

New PostgreSQL enum types:
  note_origin_type, knowledge_node_type, evidence_source_type,
  job_status, suggestion_status, suggestion_type
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. PostgreSQL enum types (must exist before tables reference them)
    # ------------------------------------------------------------------
    op.execute(
        "CREATE TYPE note_origin_type AS ENUM "
        "('standalone', 'passage_anchor', 'explain_turn', 'qa_turn')"
    )
    op.execute(
        "CREATE TYPE knowledge_node_type AS ENUM "
        "('concept', 'person', 'event', 'place', 'era')"
    )
    op.execute(
        "CREATE TYPE evidence_source_type AS ENUM "
        "('chunk', 'passage_anchor', 'note', 'qa_turn', 'explain_turn')"
    )
    op.execute(
        "CREATE TYPE job_status AS ENUM "
        "('pending', 'running', 'completed', 'failed')"
    )
    op.execute(
        "CREATE TYPE suggestion_status AS ENUM "
        "('pending', 'approved', 'rejected', 'dismissed')"
    )
    op.execute(
        "CREATE TYPE suggestion_type AS ENUM "
        "('new_node', 'merge_node', 'alias', 'new_edge', 'historical_tag')"
    )

    # ------------------------------------------------------------------
    # 2. passage_anchors
    #    Stable position into a chunk: chunk_id + char_start + char_end.
    #    text_fingerprint = first 80 + last 80 chars of selected_text.
    # ------------------------------------------------------------------
    op.create_table(
        "passage_anchors",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("chunk_id", sa.Integer(), nullable=False),
        sa.Column("char_start", sa.Integer(), nullable=False),
        sa.Column("char_end", sa.Integer(), nullable=False),
        sa.Column("text_fingerprint", sa.Text(), nullable=False),
        sa.Column("selected_text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chunk_id"], ["chunks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_passage_anchors_user_id", "passage_anchors", ["user_id"])
    op.create_index("ix_passage_anchors_chunk_id", "passage_anchors", ["chunk_id"])

    # ------------------------------------------------------------------
    # 3. notes
    #    origin_type + origin_id together identify the source entity.
    #    origin_id is a polymorphic FK (no DB-level constraint; validated
    #    at application layer based on origin_type).
    #    last_indexed_at tracks when content was last chunked + embedded
    #    for retrieval (Phase 2). NULL = not yet indexed.
    # ------------------------------------------------------------------
    op.create_table(
        "notes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "origin_type",
            postgresql.ENUM(
                "standalone", "passage_anchor", "explain_turn", "qa_turn",
                name="note_origin_type",
                create_type=False,
            ),
            nullable=True,
        ),
        sa.Column("origin_id", sa.Integer(), nullable=True),
        sa.Column("last_indexed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notes_user_id", "notes", ["user_id"])

    # ------------------------------------------------------------------
    # 4. note_links
    #    Manual bidirectional backlinks between notes.
    # ------------------------------------------------------------------
    op.create_table(
        "note_links",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("from_note_id", sa.Integer(), nullable=False),
        sa.Column("to_note_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["from_note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("from_note_id", "to_note_id", name="uq_note_links_pair"),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------
    # 5. knowledge_nodes
    #    metadata JSONB holds optional approximate values:
    #    era ranges, loose geographic regions, etc. Exact dates and
    #    coordinates are NOT required (out of scope for this version).
    # ------------------------------------------------------------------
    op.create_table(
        "knowledge_nodes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "type",
            postgresql.ENUM(
                "concept", "person", "event", "place", "era",
                name="knowledge_node_type",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "aliases",
            postgresql.ARRAY(sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_nodes_user_id", "knowledge_nodes", ["user_id"])

    # ------------------------------------------------------------------
    # 6. knowledge_edges
    #    Every approved edge must have at least one evidence row.
    #    Enforced at application layer.
    # ------------------------------------------------------------------
    op.create_table(
        "knowledge_edges",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("from_node_id", sa.Integer(), nullable=False),
        sa.Column("to_node_id", sa.Integer(), nullable=False),
        sa.Column("relation", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["from_node_id"], ["knowledge_nodes.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["to_node_id"], ["knowledge_nodes.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_edges_user_id", "knowledge_edges", ["user_id"])

    # ------------------------------------------------------------------
    # 7. evidence
    #    Polymorphic source reference backing a knowledge_edge.
    #    source_id has no DB-level FK — validated at application layer
    #    using source_type to determine which table to check.
    # ------------------------------------------------------------------
    op.create_table(
        "evidence",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("edge_id", sa.Integer(), nullable=False),
        sa.Column(
            "source_type",
            postgresql.ENUM(
                "chunk", "passage_anchor", "note", "qa_turn", "explain_turn",
                name="evidence_source_type",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("quote", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["edge_id"], ["knowledge_edges.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------
    # 8. extraction_jobs
    #    note_ids stores the list of notes submitted for extraction.
    #    Phase 2 worker reads this and generates suggestions.
    # ------------------------------------------------------------------
    op.create_table(
        "extraction_jobs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "pending", "running", "completed", "failed",
                name="job_status",
                create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "note_ids",
            postgresql.ARRAY(sa.Integer()),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_extraction_jobs_user_id", "extraction_jobs", ["user_id"])

    # ------------------------------------------------------------------
    # 9. suggestions
    #    payload JSONB shape varies by type:
    #      new_node:       { type, name, aliases, description, metadata }
    #      merge_node:     { into_node_id, source_node_name }
    #      alias:          { node_id, alias }
    #      new_edge:       { from_node_id, to_node_id, relation, evidence_source_ids }
    #      historical_tag: { node_id, tag_type, value }
    # ------------------------------------------------------------------
    op.create_table(
        "suggestions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column(
            "type",
            postgresql.ENUM(
                "new_node", "merge_node", "alias", "new_edge", "historical_tag",
                name="suggestion_type",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(
                "pending", "approved", "rejected", "dismissed",
                name="suggestion_status",
                create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_id"], ["extraction_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_suggestions_user_status", "suggestions", ["user_id", "status"])


def downgrade() -> None:
    op.drop_table("suggestions")
    op.drop_table("extraction_jobs")
    op.drop_table("evidence")
    op.drop_table("knowledge_edges")
    op.drop_table("knowledge_nodes")
    op.drop_table("note_links")
    op.drop_table("notes")
    op.drop_table("passage_anchors")

    op.execute("DROP TYPE suggestion_type")
    op.execute("DROP TYPE suggestion_status")
    op.execute("DROP TYPE job_status")
    op.execute("DROP TYPE evidence_source_type")
    op.execute("DROP TYPE knowledge_node_type")
    op.execute("DROP TYPE note_origin_type")
