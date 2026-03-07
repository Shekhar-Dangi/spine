"""Initial schema — PostgreSQL + pgvector

Revision ID: 001
Revises: None
Create Date: 2026-03-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EMBEDDING_DIM = 384


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Users
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("username", sa.String(64), nullable=False, unique=True),
        sa.Column("email", sa.String(256), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(256), nullable=False),
        sa.Column("is_admin", sa.Boolean(), default=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # Invite codes
    op.create_table(
        "invite_codes",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("used_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # Books
    op.create_table(
        "books",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("author", sa.String(256)),
        sa.Column("format", sa.Enum("pdf", "epub", name="bookformat"), nullable=False),
        sa.Column("file_path", sa.String(1024), nullable=False),
        sa.Column("page_count", sa.Integer()),
        sa.Column("ingest_status", sa.Enum(
            "uploaded", "parsing", "pending_toc_review", "ingesting", "ready", "failed",
            name="ingeststatus",
        ), nullable=False, server_default="uploaded"),
        sa.Column("ingest_error", sa.Text()),
        sa.Column("ingest_quality_json", sa.Text()),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_books_user_id", "books", ["user_id"])

    # Chapters
    op.create_table(
        "chapters",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("book_id", sa.Integer(), sa.ForeignKey("books.id"), nullable=False),
        sa.Column("chapter_index", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("start_page", sa.Integer()),
        sa.Column("end_page", sa.Integer()),
        sa.Column("start_anchor", sa.String(256)),
        sa.Column("end_anchor", sa.String(256)),
        sa.Column("token_estimate", sa.Integer()),
        sa.Column("confirmed", sa.Boolean(), default=False),
    )
    op.create_index("ix_chapters_book_id", "chapters", ["book_id"])

    # Chunks (with pgvector embedding)
    op.create_table(
        "chunks",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("book_id", sa.Integer(), sa.ForeignKey("books.id"), nullable=False),
        sa.Column("chapter_id", sa.Integer(), sa.ForeignKey("chapters.id")),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("anchor", sa.String(256)),
        sa.Column("embedding_id", sa.String(128)),
        sa.Column("embedding", Vector(EMBEDDING_DIM)),
    )
    op.create_index("ix_chunks_book_id", "chunks", ["book_id"])
    op.create_index("ix_chunks_chapter_id", "chunks", ["chapter_id"])

    # Chapter explains
    op.create_table(
        "chapter_explains",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("book_id", sa.Integer(), sa.ForeignKey("books.id"), nullable=False),
        sa.Column("chapter_id", sa.Integer(), sa.ForeignKey("chapters.id"), nullable=False),
        sa.Column("mode", sa.String(32), nullable=False, server_default="story"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_complete", sa.Boolean(), server_default="false"),
        sa.Column("generated_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("chapter_id", "mode"),
    )

    # Dossiers
    op.create_table(
        "dossiers",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("book_id", sa.Integer(), sa.ForeignKey("books.id"), nullable=False, unique=True),
        sa.Column("version", sa.Integer(), default=1),
        sa.Column("generated_at", sa.DateTime(timezone=True)),
    )

    # Dossier sections
    op.create_table(
        "dossier_sections",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("dossier_id", sa.Integer(), sa.ForeignKey("dossiers.id"), nullable=False),
        sa.Column("section_type", sa.String(64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations_json", sa.Text()),
    )

    # Citations
    op.create_table(
        "citations",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("source_type", sa.Enum("book", "web", name="sourcetype"), nullable=False),
        sa.Column("source_ref", sa.String(512)),
        sa.Column("anchor_or_url", sa.String(1024)),
        sa.Column("confidence", sa.Float()),
    )

    # Conversations
    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("book_id", sa.Integer(), sa.ForeignKey("books.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # Messages
    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id"), nullable=False),
        sa.Column("chapter_id", sa.Integer(), sa.ForeignKey("chapters.id")),
        sa.Column("role", sa.Enum("user", "assistant", name="messagerole"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])

    # Explain conversations
    op.create_table(
        "explain_conversations",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("book_id", sa.Integer(), sa.ForeignKey("books.id"), nullable=False),
        sa.Column("chapter_id", sa.Integer(), sa.ForeignKey("chapters.id"), nullable=False),
        sa.Column("mode", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("chapter_id", "mode"),
    )

    # Explain messages
    op.create_table(
        "explain_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("explain_conversations.id"), nullable=False),
        sa.Column("role", sa.Enum("user", "assistant", name="messagerole", create_type=False), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # Chapter maps
    op.create_table(
        "chapter_maps",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("book_id", sa.Integer(), sa.ForeignKey("books.id"), nullable=False),
        sa.Column("chapter_id", sa.Integer(), sa.ForeignKey("chapters.id"), nullable=False, unique=True),
        sa.Column("nodes_json", sa.Text(), nullable=False),
        sa.Column("edges_json", sa.Text(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True)),
    )

    # Model profiles (per-user)
    op.create_table(
        "model_profiles",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("provider_type", sa.Enum("openai", "openrouter", name="providertype"), nullable=False),
        sa.Column("key_ref", sa.String(512), nullable=False),
        sa.Column("base_url", sa.String(512)),
        sa.Column("model", sa.String(256), nullable=False),
        sa.Column("active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "name", name="uq_model_profiles_user_name"),
    )
    op.create_index("ix_model_profiles_user_id", "model_profiles", ["user_id"])

    # Task provider mappings (per-user)
    op.create_table(
        "task_provider_mappings",
        sa.Column("id", sa.Integer(), autoincrement=True, primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_name", sa.String(64), nullable=False),
        sa.Column("profile_id", sa.Integer(), sa.ForeignKey("model_profiles.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("user_id", "task_name", name="uq_task_mapping_user_task"),
    )


def downgrade() -> None:
    op.drop_table("task_provider_mappings")
    op.drop_table("model_profiles")
    op.drop_table("chapter_maps")
    op.drop_table("explain_messages")
    op.drop_table("explain_conversations")
    op.drop_table("messages")
    op.drop_table("conversations")
    op.drop_table("citations")
    op.drop_table("dossier_sections")
    op.drop_table("dossiers")
    op.drop_table("chapter_explains")
    op.drop_table("chunks")
    op.drop_table("chapters")
    op.drop_table("books")
    op.drop_table("invite_codes")
    op.drop_table("users")
    op.execute("DROP EXTENSION IF EXISTS vector")
