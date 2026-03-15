"""Add node_sources table for node-level provenance

Revision ID: 009
Revises: 008
Create Date: 2026-03-13

New table:
  node_sources — links a knowledge node to the source texts where it is mentioned.

This completes node-level provenance: previously only edges had Evidence rows.
node_sources allows the node detail view to show "all raw material the user
has studied that mentions this node", grouped by source.

source_type values mirror EvidenceSourceType:
  chunk, passage_anchor, note, qa_turn, explain_turn, source_doc
"""
from typing import Sequence, Union

from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE node_sources (
            id          SERIAL PRIMARY KEY,
            node_id     INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
            source_type TEXT    NOT NULL,
            source_id   INTEGER NOT NULL,
            excerpt     TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX ix_node_sources_node_id ON node_sources(node_id)")
    op.execute(
        "CREATE INDEX ix_node_sources_source ON node_sources(source_type, source_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_node_sources_source")
    op.execute("DROP INDEX IF EXISTS ix_node_sources_node_id")
    op.execute("DROP TABLE node_sources")
