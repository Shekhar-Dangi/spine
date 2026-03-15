"""Add enrich_node to suggestion_type enum

Revision ID: 007
Revises: 006
Create Date: 2026-03-12

enrich_node suggestions are created when extraction finds new information
(description, aliases) about a node that already exists in the graph.
They allow the user to approve enrichments without creating duplicates.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL allows adding values to enums but not removing them.
    # IF NOT EXISTS guards against re-running on a DB that already has it.
    op.execute("ALTER TYPE suggestion_type ADD VALUE IF NOT EXISTS 'enrich_node'")


def downgrade() -> None:
    # Cannot remove enum values in PostgreSQL without recreating the type.
    # Downgrade is a no-op — the value will remain but be unused.
    pass
