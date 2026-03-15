"""extraction_jobs: add source_content for direct content extraction

Revision ID: 006
Revises: 005
Create Date: 2026-03-12

Allows ExtractionJob to store raw content directly so extraction can run
without the user first saving a note. note_ids stays nullable-list; when
source_content is set and note_ids is empty, the extraction service uses
the content directly.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE extraction_jobs ADD COLUMN source_content TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE extraction_jobs DROP COLUMN source_content")
