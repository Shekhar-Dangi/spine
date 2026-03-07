"""API-based embeddings — drop fastembed, add capabilities + variable-dim vectors

Revision ID: 002
Revises: 001
Create Date: 2026-03-07

Changes:
  - model_profiles: add capabilities_json (TEXT), embedding_dim (INTEGER)
  - books: add embedding_profile_id (FK → model_profiles)
  - chunks.embedding: drop fixed vector(384) column, re-add as variable vector()
  - task_provider_mappings: "embed" is now a valid task_name (no schema change needed,
    the column is TEXT — the app-level ROUTING_TASKS tuple enforces the set)
  - Existing book embeddings (fastembed/bge-small 384-dim) are cleared and books
    that were READY are set to FAILED so users re-embed with an API provider.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. model_profiles — add capabilities_json + embedding_dim
    # ------------------------------------------------------------------
    op.add_column(
        "model_profiles",
        sa.Column("capabilities_json", sa.Text(), nullable=False, server_default='["chat"]'),
    )
    op.add_column(
        "model_profiles",
        sa.Column("embedding_dim", sa.Integer(), nullable=True),
    )

    # ------------------------------------------------------------------
    # 2. books — add embedding_profile_id FK
    # ------------------------------------------------------------------
    op.add_column(
        "books",
        sa.Column("embedding_profile_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_books_embedding_profile_id",
        "books",
        "model_profiles",
        ["embedding_profile_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ------------------------------------------------------------------
    # 3. chunks.embedding — drop fixed-dim column, re-add as variable-dim
    #    All existing fastembed (384-dim) vectors are discarded.
    # ------------------------------------------------------------------
    op.drop_column("chunks", "embedding")
    op.execute("ALTER TABLE chunks ADD COLUMN embedding vector")

    # ------------------------------------------------------------------
    # 4. Invalidate existing embeddings
    #    Books that were READY had fastembed vectors that are now gone.
    #    Mark them FAILED so users know they must re-embed.
    # ------------------------------------------------------------------
    op.execute(
        """
        UPDATE books
        SET ingest_status = 'failed',
            ingest_error  = 'Re-embedding required: local (fastembed) embeddings have been '
                            'removed. Configure an embedding-capable API profile in Settings '
                            'and use Retry Embed.'
        WHERE ingest_status = 'ready'
        """
    )


def downgrade() -> None:
    # Restore fixed 384-dim embedding column (data is lost either way)
    op.drop_column("chunks", "embedding")
    op.execute("ALTER TABLE chunks ADD COLUMN embedding vector(384)")

    op.drop_constraint("fk_books_embedding_profile_id", "books", type_="foreignkey")
    op.drop_column("books", "embedding_profile_id")

    op.drop_column("model_profiles", "embedding_dim")
    op.drop_column("model_profiles", "capabilities_json")
