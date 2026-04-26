"""012_geo_maps

Revision ID: 012
Revises: 011
Create Date: 2026-04-26

Adds geo_maps and geo_markers tables for the geographic map feature.
"""
from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "geo_maps",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("book_id", sa.Integer(), nullable=False),
        sa.Column("chapter_id", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("generating", "ready", "failed", name="geomapstatus"),
            nullable=False,
        ),
        sa.Column("period_label", sa.Text(), nullable=True),
        sa.Column("period_start_year", sa.Integer(), nullable=True),
        sa.Column("period_end_year", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chapter_id"], ["chapters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chapter_id", name="uq_geo_maps_chapter_id"),
    )
    op.create_index("ix_geo_maps_chapter_id", "geo_maps", ["chapter_id"])
    op.create_index("ix_geo_maps_book_id", "geo_maps", ["book_id"])

    op.create_table(
        "geo_markers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("geo_map_id", sa.Integer(), nullable=False),
        sa.Column("place_name", sa.Text(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column(
            "marker_type",
            sa.Enum("city", "region", "battle", "route", "other", name="markertype"),
            nullable=False,
        ),
        sa.Column("period_label", sa.Text(), nullable=True),
        sa.Column("llm_annotation", sa.Text(), nullable=False),
        sa.Column("user_annotation", sa.Text(), nullable=True),
        sa.Column(
            "confidence",
            sa.Enum("high", "medium", "low", name="geoconfidence"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["geo_map_id"], ["geo_maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_geo_markers_geo_map_id", "geo_markers", ["geo_map_id"])


def downgrade() -> None:
    op.drop_index("ix_geo_markers_geo_map_id", table_name="geo_markers")
    op.drop_table("geo_markers")
    op.drop_index("ix_geo_maps_book_id", table_name="geo_maps")
    op.drop_index("ix_geo_maps_chapter_id", table_name="geo_maps")
    op.drop_table("geo_maps")
    op.execute("DROP TYPE IF EXISTS geoconfidence")
    op.execute("DROP TYPE IF EXISTS markertype")
    op.execute("DROP TYPE IF EXISTS geomapstatus")
