"""
SQLAlchemy ORM models for Spine V1.
All tables use integer primary keys + created_at timestamps.
"""
import enum
import json
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as _SaEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


def Enum(enum_cls, **kw):
    """Wrapper that ensures PostgreSQL native enums use .value (lowercase) not .name (uppercase)."""
    return _SaEnum(enum_cls, values_callable=lambda e: [m.value for m in e], **kw)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class BookFormat(str, enum.Enum):
    PDF = "pdf"
    EPUB = "epub"


class IngestStatus(str, enum.Enum):
    UPLOADED = "uploaded"
    PARSING = "parsing"
    PENDING_TOC_REVIEW = "pending_toc_review"
    INGESTING = "ingesting"
    READY = "ready"
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
    model_profiles: Mapped[list["ModelProfile"]] = relationship(back_populates="user")


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
    __table_args__ = (
        Index("ix_books_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    author: Mapped[str | None] = mapped_column(String(256))
    format: Mapped[BookFormat] = mapped_column(Enum(BookFormat), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    page_count: Mapped[int | None] = mapped_column(Integer)
    ingest_status: Mapped[IngestStatus] = mapped_column(
        Enum(IngestStatus), nullable=False, default=IngestStatus.UPLOADED
    )
    ingest_error: Mapped[str | None] = mapped_column(Text)
    ingest_quality_json: Mapped[str | None] = mapped_column(Text)
    # Which ModelProfile was used to embed this book's chunks.
    # Must use the same model/dim for query embedding during retrieval.
    embedding_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_profiles.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    user: Mapped["User | None"] = relationship(back_populates="books")
    embedding_profile: Mapped["ModelProfile | None"] = relationship(
        foreign_keys=[embedding_profile_id]
    )
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
    __table_args__ = (
        Index("ix_chapters_book_id", "book_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), nullable=False)
    chapter_index: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    start_page: Mapped[int | None] = mapped_column(Integer)
    end_page: Mapped[int | None] = mapped_column(Integer)
    start_anchor: Mapped[str | None] = mapped_column(String(256))
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
    __table_args__ = (
        Index("ix_chunks_book_id", "book_id"),
        Index("ix_chunks_chapter_id", "chapter_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), nullable=False)
    chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    anchor: Mapped[str | None] = mapped_column(String(256))
    embedding_id: Mapped[str | None] = mapped_column(String(128))
    # Variable-dimension vector — dimension depends on user's chosen embedding model.
    # No fixed dim allows any provider model (1024d, 1536d, 3072d, etc.)
    # Full-scan cosine similarity is fine for book-sized chunk sets.
    embedding = mapped_column(Vector(), nullable=True)

    book: Mapped["Book"] = relationship(back_populates="chunks")
    chapter: Mapped["Chapter | None"] = relationship(back_populates="chunks")


# ---------------------------------------------------------------------------
# ChapterExplain
# ---------------------------------------------------------------------------


class ChapterExplain(Base):
    __tablename__ = "chapter_explains"
    __table_args__ = (UniqueConstraint("chapter_id", "mode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), nullable=False)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), nullable=False)
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="story")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    book: Mapped["Book"] = relationship(back_populates="chapter_explains")
    chapter: Mapped["Chapter"] = relationship(back_populates="chapter_explains")


# ---------------------------------------------------------------------------
# Dossier
# ---------------------------------------------------------------------------


class Dossier(Base):
    __tablename__ = "dossiers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), nullable=False, unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    book: Mapped["Book"] = relationship(back_populates="dossier")
    sections: Mapped[list["DossierSection"]] = relationship(
        back_populates="dossier", cascade="all, delete-orphan"
    )


class DossierSection(Base):
    __tablename__ = "dossier_sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dossier_id: Mapped[int] = mapped_column(ForeignKey("dossiers.id"), nullable=False)
    section_type: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    citations_json: Mapped[str | None] = mapped_column(Text)

    dossier: Mapped["Dossier"] = relationship(back_populates="sections")


# ---------------------------------------------------------------------------
# Citation
# ---------------------------------------------------------------------------


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_type: Mapped[SourceType] = mapped_column(Enum(SourceType), nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String(512))
    anchor_or_url: Mapped[str | None] = mapped_column(String(1024))
    confidence: Mapped[float | None] = mapped_column(Float)


# ---------------------------------------------------------------------------
# Conversation + Message
# ---------------------------------------------------------------------------


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    book: Mapped["Book"] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation_id", "conversation_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id"), nullable=False
    )
    chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id"))
    role: Mapped[MessageRole] = mapped_column(Enum(MessageRole), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


# ---------------------------------------------------------------------------
# ExplainConversation + ExplainMessage
# ---------------------------------------------------------------------------


class ExplainConversation(Base):
    __tablename__ = "explain_conversations"
    __table_args__ = (UniqueConstraint("chapter_id", "mode"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), nullable=False)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), nullable=False)
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    messages: Mapped[list["ExplainMessage"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class ExplainMessage(Base):
    __tablename__ = "explain_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("explain_conversations.id"), nullable=False
    )
    role: Mapped[MessageRole] = mapped_column(Enum(MessageRole), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    conversation: Mapped["ExplainConversation"] = relationship(back_populates="messages")


# ---------------------------------------------------------------------------
# ChapterMap
# ---------------------------------------------------------------------------


class ChapterMap(Base):
    __tablename__ = "chapter_maps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"), nullable=False)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id"), nullable=False, unique=True)
    nodes_json: Mapped[str] = mapped_column(Text, nullable=False)
    edges_json: Mapped[str] = mapped_column(Text, nullable=False)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    book: Mapped["Book"] = relationship(back_populates="chapter_maps")
    chapter: Mapped["Chapter"] = relationship(back_populates="chapter_map")


# ---------------------------------------------------------------------------
# ModelProfile — per-user API key profiles
# ---------------------------------------------------------------------------

# Valid capability strings. Extensible — add more as features are built.
VALID_CAPABILITIES = frozenset({"chat", "embedding"})


class ModelProfile(Base):
    __tablename__ = "model_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_model_profiles_user_name"),
        Index("ix_model_profiles_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    provider_type: Mapped[ProviderType] = mapped_column(Enum(ProviderType), nullable=False)
    key_ref: Mapped[str] = mapped_column(String(512), nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(512))
    model: Mapped[str] = mapped_column(String(256), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # JSON array of capability strings, e.g. '["chat"]' or '["chat","embedding"]'
    capabilities_json: Mapped[str] = mapped_column(Text, nullable=False, default='["chat"]')
    # Dimension of vectors this model produces. Required when "embedding" in capabilities.
    embedding_dim: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship(back_populates="model_profiles")

    @property
    def capabilities(self) -> list[str]:
        return json.loads(self.capabilities_json)

    @capabilities.setter
    def capabilities(self, value: list[str]) -> None:
        self.capabilities_json = json.dumps(value)

    def has_capability(self, cap: str) -> bool:
        return cap in self.capabilities


# ---------------------------------------------------------------------------
# TaskProviderMapping — per-user, maps a routing task to a specific ModelProfile.
# If profile_id is NULL the system falls back to the active profile.
# ---------------------------------------------------------------------------

# Canonical routing task names.
# "embed" requires an embedding-capable profile; all others require chat-capable.
ROUTING_TASKS = ("dossier", "explain", "qa", "map_extract", "toc_extract", "embed")

# Which capability each task requires
TASK_REQUIRED_CAPABILITY: dict[str, str] = {
    "dossier": "chat",
    "explain": "chat",
    "qa": "chat",
    "map_extract": "chat",
    "toc_extract": "chat",
    "embed": "embedding",
}


class TaskProviderMapping(Base):
    __tablename__ = "task_provider_mappings"
    __table_args__ = (
        UniqueConstraint("user_id", "task_name", name="uq_task_mapping_user_task"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    task_name: Mapped[str] = mapped_column(String(64), nullable=False)
    profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_profiles.id", ondelete="SET NULL"), nullable=True
    )

    profile: Mapped["ModelProfile | None"] = relationship()
