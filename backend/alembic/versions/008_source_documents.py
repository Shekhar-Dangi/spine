"""Add source_documents, source_chunks; add source_doc_id to extraction_jobs

Revision ID: 008
Revises: 007
Create Date: 2026-03-13

New tables:
  source_documents — background source records for non-note extraction inputs
                     (qa_turn, explain_turn, book_passage, manual_text)
  source_chunks    — chunked + embedded slices of source_documents for retrieval

New column:
  extraction_jobs.source_doc_id — FK to source_documents (alternative to note_ids)
"""
from typing import Sequence, Union

from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TYPE source_doc_type AS ENUM (
            'qa_turn', 'explain_turn', 'book_passage', 'manual_text'
        )
    """)

    op.execute("""
        CREATE TABLE source_documents (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source_type source_doc_type NOT NULL,
            title       TEXT,
            content     TEXT NOT NULL,
            origin_ref  JSONB NOT NULL DEFAULT '{}',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX ix_source_documents_user_id ON source_documents(user_id)")

    op.execute("""
        CREATE TABLE source_chunks (
            id            SERIAL PRIMARY KEY,
            source_doc_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
            chunk_index   INTEGER NOT NULL,
            text          TEXT NOT NULL,
            embedding     vector,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute(
        "CREATE INDEX ix_source_chunks_source_doc_id ON source_chunks(source_doc_id)"
    )

    op.execute("""
        ALTER TABLE extraction_jobs
        ADD COLUMN source_doc_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL
    """)

    # Add source_doc to evidence_source_type so edges from source_doc extractions
    # can have proper Evidence rows.
    op.execute(
        "ALTER TYPE evidence_source_type ADD VALUE IF NOT EXISTS 'source_doc'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE extraction_jobs DROP COLUMN source_doc_id")
    op.execute("DROP INDEX IF EXISTS ix_source_chunks_source_doc_id")
    op.execute("DROP TABLE source_chunks")
    op.execute("DROP INDEX IF EXISTS ix_source_documents_user_id")
    op.execute("DROP TABLE source_documents")
    op.execute("DROP TYPE source_doc_type")
