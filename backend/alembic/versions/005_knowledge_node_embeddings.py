"""V2 Knowledge — Phase 2b: knowledge_node embeddings + note extraction tracking

Revision ID: 005
Revises: 004
Create Date: 2026-03-12

New columns:
  - knowledge_nodes.embedding  — variable-dim vector for dedup cosine search
  - notes.last_extracted_at    — tracks when note was last processed by extraction job

No index on knowledge_nodes.embedding: per-user cosine scan across ~200 nodes
is trivial without an ANN index. Add one if corpus grows significantly.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL — no need to import pgvector types in migration.
    op.execute("ALTER TABLE knowledge_nodes ADD COLUMN embedding vector")
    op.execute("ALTER TABLE notes ADD COLUMN last_extracted_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE knowledge_nodes DROP COLUMN embedding")
    op.execute("ALTER TABLE notes DROP COLUMN last_extracted_at")
