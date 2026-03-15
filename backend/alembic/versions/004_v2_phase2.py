"""V2 Knowledge Layer — Phase 2: note_chunks table for lazy note embedding

Revision ID: 004
Revises: 003
Create Date: 2026-03-10

New table:
  - note_chunks  — split + embedded chunks for note retrieval
                   indexed lazily: when note.last_indexed_at IS NULL or stale
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL so we don't need to import pgvector in the migration.
    # 'vector' with no dimension = variable-dim, same pattern as chunks.embedding.
    op.execute("""
        CREATE TABLE note_chunks (
            id          SERIAL PRIMARY KEY,
            note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            text        TEXT    NOT NULL,
            embedding   vector,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.create_index("ix_note_chunks_note_id", "note_chunks", ["note_id"])


def downgrade() -> None:
    op.drop_index("ix_note_chunks_note_id", table_name="note_chunks")
    op.drop_table("note_chunks")
