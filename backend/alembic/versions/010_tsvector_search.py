"""Add generated tsvector columns and GIN indexes for hybrid full-text search

Revision ID: 010
Revises: 009
Create Date: 2026-03-15

Adds a STORED generated tsvector column to chunks, note_chunks, and source_chunks.
PostgreSQL computes and maintains the value automatically on insert/update.
GIN indexes make full-text queries O(log n) as the tables grow.

This enables hybrid search: semantic (vector) + keyword (tsvector) with score fusion.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # chunks
    op.execute("""
        ALTER TABLE chunks
        ADD COLUMN text_search tsvector
            GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
    """)
    op.execute("CREATE INDEX ix_chunks_text_search ON chunks USING GIN (text_search)")

    # note_chunks
    op.execute("""
        ALTER TABLE note_chunks
        ADD COLUMN text_search tsvector
            GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
    """)
    op.execute("CREATE INDEX ix_note_chunks_text_search ON note_chunks USING GIN (text_search)")

    # source_chunks
    op.execute("""
        ALTER TABLE source_chunks
        ADD COLUMN text_search tsvector
            GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
    """)
    op.execute(
        "CREATE INDEX ix_source_chunks_text_search ON source_chunks USING GIN (text_search)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_source_chunks_text_search")
    op.execute("ALTER TABLE source_chunks DROP COLUMN IF EXISTS text_search")

    op.execute("DROP INDEX IF EXISTS ix_note_chunks_text_search")
    op.execute("ALTER TABLE note_chunks DROP COLUMN IF EXISTS text_search")

    op.execute("DROP INDEX IF EXISTS ix_chunks_text_search")
    op.execute("ALTER TABLE chunks DROP COLUMN IF EXISTS text_search")
