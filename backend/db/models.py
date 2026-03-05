"""
SQLAlchemy ORM models for Spine V1.
All tables use integer primary keys + created_at timestamps.
"""
import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class BookFormat(str, enum.Enum):
    PDF = "pdf"
    EPUB = "epub"


class IngestStatus(str, enum.Enum):
    UPLOADED = "uploaded"          # file saved, not yet parsed
    PARSING = "parsing"            # extracting text + TOC
    PENDING_TOC_REVIEW = "pending_toc_review"  # awaiting user confirmation
    INGESTING = "ingesting"        # chunking + embedding in progress
    READY = "ready"                # fully ready for use
    FAILED = "failed"


class ProviderType(str, enum.Enum):
    OPENAI = "openai"
    OPENROUTER = "openrouter"


class SourceType(str, enum.Enum):
    BOOK = "book"
    WEB = "web"


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"


class ExplainMode(str, enum.Enum):
    STORY = "story"
    FIRST_PRINCIPLES = "first_principles"
    SYSTEMS = "systems"
    DERIVATION = "derivation"
    SYNTHESIS = "synthesis"


# ---------------------------------------------------------------------------
# User + InviteCode
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    books: Mapped[list["Book"]] = relationship(back_populates="user")
    invite_codes_created: Mapped[list["InviteCode"]] = relationship(
        foreign_keys="InviteCode.created_by_id", back_populates="created_by"
    )


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    used_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    created_by: Mapped["User"] = relationship(
        foreign_keys=[created_by_id], back_populates="invite_codes_created"
    )
    used_by: Mapped["User | None"] = relationship(foreign_keys=[used_by_id])


# ---------------------------------------------------------------------------
# Book
# ---------------------------------------------------------------------------


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    author: Mapped[str | None] = mapped_column(String(256))
    format: Mapped[BookFormat] = mapped_column(
        Enum(BookFormat), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer)
    ingest_status: Mapped[IngestStatus] = mapped_column(
        Enum(IngestStatus), nullable=False, default=IngestStatus.UPLOADED
    )
    ingest_error: Mapped[str | None] = mapped_column(Text)
    ingest_quality_json: Mapped[str | None] = mapped_column(
        Text)  # JSON warnings
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    user: Mapped["User | None"] = relationship(back_populates="books")
    chapters: Mapped[list["Chapter"]] = relationship(
        back_populates="book", cascade="all, delete-orphan"
    )
    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="book", cascade="all, delete-orphan"
    )
    dossier: Mapped["Dossier | None"] = relationship(
        back_populates="book", cascade="all, delete-orphan", uselist=False
    )
    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="book", cascade="all, delete-orphan"
    )
    chapter_maps: Mapped[list["ChapterMap"]] = relationship(
        back_populates="book", cascade="all, delete-orphan"
    )
    chapter_explains: Mapped[list["ChapterExplain"]] = relationship(
        back_populates="book", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Chapter
# ---------------------------------------------------------------------------


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id"), nullable=False)
    chapter_index: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    start_page: Mapped[int | None] = mapped_column(
        Integer)  # PDF page (0-indexed)
    end_page: Mapped[int | None] = mapped_column(Integer)
    start_anchor: Mapped[str | None] = mapped_column(
        String(256))  # EPUB anchor
    end_anchor: Mapped[str | None] = mapped_column(String(256))
    token_estimate: Mapped[int | None] = mapped_column(Integer)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)

    book: Mapped["Book"] = relationship(back_populates="chapters")
    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="chapter", cascade="all, delete-orphan"
    )
    chapter_map: Mapped["ChapterMap | None"] = relationship(
        back_populates="chapter", cascade="all, delete-orphan", uselist=False
    )
    chapter_explains: Mapped[list["ChapterExplain"]] = relationship(
        back_populates="chapter", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# Chunk
# ---------------------------------------------------------------------------


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id"), nullable=False)
    chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    anchor: Mapped[str | None] = mapped_column(
        String(256))  # page:offset or epub id
    embedding_id: Mapped[str | None] = mapped_column(
        String(128))  # ChromaDB doc id

    book: Mapped["Book"] = relationship(back_populates="chunks")
    chapter: Mapped["Chapter | None"] = relationship(back_populates="chunks")


# ---------------------------------------------------------------------------
# ChapterExplain
# ---------------------------------------------------------------------------


class ChapterExplain(Base):
    __tablename__ = "chapter_explains"
    __table_args__ = (UniqueConstraint("chapter_id", "mode"),)

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id"), nullable=False)
    chapter_id: Mapped[int] = mapped_column(
        ForeignKey("chapters.id"), nullable=False
    )
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="story")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now)

    book: Mapped["Book"] = relationship(back_populates="chapter_explains")
    chapter: Mapped["Chapter"] = relationship(back_populates="chapter_explains")


# ---------------------------------------------------------------------------
# Dossier
# ---------------------------------------------------------------------------


class Dossier(Base):
    __tablename__ = "dossiers"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id"), nullable=False, unique=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True))

    book: Mapped["Book"] = relationship(back_populates="dossier")
    sections: Mapped[list["DossierSection"]] = relationship(
        back_populates="dossier", cascade="all, delete-orphan"
    )


class DossierSection(Base):
    __tablename__ = "dossier_sections"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    dossier_id: Mapped[int] = mapped_column(
        ForeignKey("dossiers.id"), nullable=False)
    section_type: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    citations_json: Mapped[str | None] = mapped_column(
        Text)  # JSON list of Citation

    dossier: Mapped["Dossier"] = relationship(back_populates="sections")


# ---------------------------------------------------------------------------
# Citation (inline, stored as JSON in parent rows — but also standalone table
# for query/audit purposes)
# ---------------------------------------------------------------------------


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    source_type: Mapped[SourceType] = mapped_column(
        Enum(SourceType), nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String(512))
    anchor_or_url: Mapped[str | None] = mapped_column(String(1024))
    confidence: Mapped[float | None] = mapped_column(Float)


# ---------------------------------------------------------------------------
# Conversation + Message
# ---------------------------------------------------------------------------


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now)

    book: Mapped["Book"] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id"), nullable=False
    )
    chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))
    role: Mapped[MessageRole] = mapped_column(
        Enum(MessageRole), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now)

    conversation: Mapped["Conversation"] = relationship(
        back_populates="messages")


# ---------------------------------------------------------------------------
# ChapterMap
# ---------------------------------------------------------------------------


class ChapterMap(Base):
    __tablename__ = "chapter_maps"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id"), nullable=False)
    chapter_id: Mapped[int] = mapped_column(
        ForeignKey("chapters.id"), nullable=False, unique=True
    )
    nodes_json: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array
    edges_json: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array
    generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True))

    book: Mapped["Book"] = relationship(back_populates="chapter_maps")
    chapter: Mapped["Chapter"] = relationship(back_populates="chapter_map")


# ---------------------------------------------------------------------------
# ModelProfile
# ---------------------------------------------------------------------------


class ModelProfile(Base):
    __tablename__ = "model_profiles"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    provider_type: Mapped[ProviderType] = mapped_column(
        Enum(ProviderType), nullable=False
    )
    key_ref: Mapped[str] = mapped_column(
        String(512), nullable=False)  # encrypted blob
    base_url: Mapped[str | None] = mapped_column(
        String(512))  # OpenRouter only
    model: Mapped[str] = mapped_column(String(256), nullable=False)  # single model string
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now)


# ---------------------------------------------------------------------------
# TaskProviderMapping — maps a routing task to a specific ModelProfile.
# If profile_id is NULL the system falls back to the active profile.
# ---------------------------------------------------------------------------

# Canonical routing task names (also used as valid values for task_name PK)
ROUTING_TASKS = ("dossier", "explain", "qa", "map_extract", "toc_extract")


class TaskProviderMapping(Base):
    __tablename__ = "task_provider_mappings"

    task_name: Mapped[str] = mapped_column(String(64), primary_key=True)
    profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_profiles.id", ondelete="SET NULL"), nullable=True
    )

    profile: Mapped["ModelProfile | None"] = relationship()
