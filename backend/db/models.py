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
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
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
ROUTING_TASKS = ("dossier", "explain", "qa", "map_extract", "toc_extract", "embed", "extract")

# Which capability each task requires
TASK_REQUIRED_CAPABILITY: dict[str, str] = {
    "dossier": "chat",
    "explain": "chat",
    "qa": "chat",
    "map_extract": "chat",
    "toc_extract": "chat",
    "embed": "embedding",
    "extract": "chat",
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


# ---------------------------------------------------------------------------
# V2 Knowledge Layer — Phase 1
# ---------------------------------------------------------------------------


class NoteOriginType(str, enum.Enum):
    STANDALONE = "standalone"
    PASSAGE_ANCHOR = "passage_anchor"
    EXPLAIN_TURN = "explain_turn"
    QA_TURN = "qa_turn"


class KnowledgeNodeType(str, enum.Enum):
    CONCEPT = "concept"
    PERSON = "person"
    EVENT = "event"
    PLACE = "place"
    ERA = "era"


class EvidenceSourceType(str, enum.Enum):
    CHUNK = "chunk"
    PASSAGE_ANCHOR = "passage_anchor"
    NOTE = "note"
    QA_TURN = "qa_turn"
    EXPLAIN_TURN = "explain_turn"
    SOURCE_DOC = "source_doc"


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class SuggestionStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    DISMISSED = "dismissed"


class SuggestionType(str, enum.Enum):
    NEW_NODE = "new_node"
    ENRICH_NODE = "enrich_node"
    MERGE_NODE = "merge_node"
    ALIAS = "alias"
    NEW_EDGE = "new_edge"
    HISTORICAL_TAG = "historical_tag"


class PassageAnchor(Base):
    """Stable reference into a chunk: chunk_id + char offset range.

    text_fingerprint stores first 80 + last 80 chars of the selection for
    validation and future remapping if a book is re-ingested.
    """
    __tablename__ = "passage_anchors"
    __table_args__ = (
        Index("ix_passage_anchors_user_id", "user_id"),
        Index("ix_passage_anchors_chunk_id", "chunk_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    chunk_id: Mapped[int] = mapped_column(
        ForeignKey("chunks.id", ondelete="CASCADE"), nullable=False
    )
    char_start: Mapped[int] = mapped_column(Integer, nullable=False)
    char_end: Mapped[int] = mapped_column(Integer, nullable=False)
    text_fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    selected_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship()
    chunk: Mapped["Chunk"] = relationship()


class Note(Base):
    """User knowledge artifact — standalone or promoted from a source.

    origin_type + origin_id identify the source entity when the note was
    promoted (not standalone). origin_id is a polymorphic FK validated at
    the application layer.

    last_indexed_at tracks lazy embedding for retrieval (Phase 2).
    NULL means the note has not yet been chunked and embedded.
    """
    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    origin_type: Mapped[NoteOriginType | None] = mapped_column(
        Enum(NoteOriginType, name="note_origin_type"), nullable=True
    )
    # Polymorphic FK — points to passage_anchor.id, explain_message.id, or
    # message.id depending on origin_type. No DB-level constraint.
    origin_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_indexed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_extracted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    user: Mapped["User"] = relationship()
    outgoing_links: Mapped[list["NoteLink"]] = relationship(
        foreign_keys="NoteLink.from_note_id",
        back_populates="from_note",
        cascade="all, delete-orphan",
    )
    incoming_links: Mapped[list["NoteLink"]] = relationship(
        foreign_keys="NoteLink.to_note_id",
        back_populates="to_note",
        cascade="all, delete-orphan",
    )


class NoteLink(Base):
    """Manual backlink between two notes."""
    __tablename__ = "note_links"
    __table_args__ = (
        UniqueConstraint("from_note_id", "to_note_id", name="uq_note_links_pair"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_note_id: Mapped[int] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    to_note_id: Mapped[int] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    from_note: Mapped["Note"] = relationship(
        foreign_keys=[from_note_id], back_populates="outgoing_links"
    )
    to_note: Mapped["Note"] = relationship(
        foreign_keys=[to_note_id], back_populates="incoming_links"
    )


class KnowledgeNode(Base):
    """A node in the user's personal knowledge graph.

    metadata JSONB holds optional approximate values such as era ranges or
    loose geographic regions. Exact dates and coordinates are not required.
    """
    __tablename__ = "knowledge_nodes"
    __table_args__ = (
        Index("ix_knowledge_nodes_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[KnowledgeNodeType] = mapped_column(
        Enum(KnowledgeNodeType, name="knowledge_node_type"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    aliases: Mapped[list[str]] = mapped_column(
        ARRAY(Text()), server_default="{}", nullable=False
    )
    description: Mapped[str | None] = mapped_column(Text)
    # 'metadata' is reserved by SQLAlchemy Declarative — use node_metadata as the
    # Python attribute name while keeping the DB column name as 'metadata'.
    node_metadata: Mapped[dict] = mapped_column(
        "metadata", JSONB(), server_default="{}", nullable=False
    )
    # Variable-dim vector — same pattern as Chunk.embedding / NoteChunk.embedding.
    # No ANN index: per-user scan across ~200 nodes is trivial without one.
    embedding = mapped_column(Vector(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    user: Mapped["User"] = relationship()
    outgoing_edges: Mapped[list["KnowledgeEdge"]] = relationship(
        foreign_keys="KnowledgeEdge.from_node_id",
        back_populates="from_node",
        cascade="all, delete-orphan",
    )
    incoming_edges: Mapped[list["KnowledgeEdge"]] = relationship(
        foreign_keys="KnowledgeEdge.to_node_id",
        back_populates="to_node",
        cascade="all, delete-orphan",
    )


class KnowledgeEdge(Base):
    """A directed, evidence-backed relation between two knowledge nodes.

    Every edge must have at least one Evidence row after creation.
    Enforced at the application layer.
    """
    __tablename__ = "knowledge_edges"
    __table_args__ = (
        Index("ix_knowledge_edges_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    from_node_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_nodes.id", ondelete="CASCADE"), nullable=False
    )
    to_node_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_nodes.id", ondelete="CASCADE"), nullable=False
    )
    relation: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship()
    from_node: Mapped["KnowledgeNode"] = relationship(
        foreign_keys=[from_node_id], back_populates="outgoing_edges"
    )
    to_node: Mapped["KnowledgeNode"] = relationship(
        foreign_keys=[to_node_id], back_populates="incoming_edges"
    )
    evidence: Mapped[list["Evidence"]] = relationship(
        back_populates="edge", cascade="all, delete-orphan"
    )


class Evidence(Base):
    """Polymorphic source reference backing a knowledge edge.

    source_type determines which table source_id points to:
      chunk          → chunks.id
      passage_anchor → passage_anchors.id
      note           → notes.id
      qa_turn        → messages.id
      explain_turn   → explain_messages.id
    """
    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    edge_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_edges.id", ondelete="CASCADE"), nullable=False
    )
    source_type: Mapped[EvidenceSourceType] = mapped_column(
        Enum(EvidenceSourceType, name="evidence_source_type"), nullable=False
    )
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    quote: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    edge: Mapped["KnowledgeEdge"] = relationship(back_populates="evidence")


class NodeSource(Base):
    """Links a knowledge node to a source text that mentions it.

    Provides node-level provenance so the node detail view can show all
    raw material the user has studied about this node, grouped by source.

    source_type is a string matching EvidenceSourceType values:
      chunk | passage_anchor | note | qa_turn | explain_turn | source_doc

    source_id is a polymorphic FK validated at the application layer.
    excerpt holds a short raw text passage that mentions the node (optional).
    """
    __tablename__ = "node_sources"
    __table_args__ = (
        Index("ix_node_sources_node_id", "node_id"),
        Index("ix_node_sources_source", "source_type", "source_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    node_id: Mapped[int] = mapped_column(
        ForeignKey("knowledge_nodes.id", ondelete="CASCADE"), nullable=False
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    excerpt: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    node: Mapped["KnowledgeNode"] = relationship()


class ExtractionJob(Base):
    """Async job that runs LLM extraction on a set of notes.

    Created when a user manually triggers knowledge extraction.
    The Phase 2 worker picks up pending jobs, calls the LLM, and
    writes Suggestion rows for the user to review.
    """
    __tablename__ = "extraction_jobs"
    __table_args__ = (
        Index("ix_extraction_jobs_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus, name="job_status"), nullable=False, default=JobStatus.PENDING
    )
    note_ids: Mapped[list[int]] = mapped_column(
        ARRAY(Integer()), nullable=False
    )
    # FK to source_documents — set when extraction runs on a background source
    # record rather than a saved note.
    source_doc_id: Mapped[int | None] = mapped_column(
        ForeignKey("source_documents.id", ondelete="SET NULL"), nullable=True
    )
    # DEPRECATED — kept for backward compat with migration 006 jobs.
    # New jobs must use note_ids or source_doc_id instead.
    source_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped["User"] = relationship()
    suggestions: Mapped[list["Suggestion"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class Suggestion(Base):
    """AI-proposed knowledge graph change pending user review.

    payload JSONB shape by type:
      new_node:       { type, name, aliases, description, metadata }
      merge_node:     { into_node_id, source_node_name }
      alias:          { node_id, alias }
      new_edge:       { from_node_id, to_node_id, relation, evidence_source_ids }
      historical_tag: { node_id, tag_type, value }

    Status lifecycle:
      pending  → approved  (written to knowledge graph)
      pending  → rejected  (soft; can be reconsidered)
      pending  → dismissed (user explicitly discarded; not shown again)
    """
    __tablename__ = "suggestions"
    __table_args__ = (
        Index("ix_suggestions_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    job_id: Mapped[int] = mapped_column(
        ForeignKey("extraction_jobs.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[SuggestionType] = mapped_column(
        Enum(SuggestionType, name="suggestion_type"), nullable=False
    )
    status: Mapped[SuggestionStatus] = mapped_column(
        Enum(SuggestionStatus, name="suggestion_status"), nullable=False, default=SuggestionStatus.PENDING
    )
    payload: Mapped[dict] = mapped_column(JSONB(), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship()
    job: Mapped["ExtractionJob"] = relationship(back_populates="suggestions")


# ---------------------------------------------------------------------------
# V2 Knowledge Layer — Phase 4a: Source Documents
# ---------------------------------------------------------------------------


class SourceDocType(str, enum.Enum):
    QA_TURN = "qa_turn"
    EXPLAIN_TURN = "explain_turn"
    BOOK_PASSAGE = "book_passage"
    MANUAL_TEXT = "manual_text"


class SourceDocument(Base):
    """Background source record for non-note extraction inputs.

    Created when a user triggers extraction directly from Q&A, Explain,
    a book passage, or pasted text — without first saving a note.
    Not visible in the Notes product.
    """
    __tablename__ = "source_documents"
    __table_args__ = (
        Index("ix_source_documents_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    source_type: Mapped[SourceDocType] = mapped_column(
        Enum(SourceDocType, name="source_doc_type"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Soft reference back to the originating entity, e.g.
    # {"book_id": 3, "chapter_id": 7, "message_id": 42}
    origin_ref: Mapped[dict] = mapped_column(
        JSONB(), server_default="{}", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship()
    chunks: Mapped[list["SourceChunk"]] = relationship(
        back_populates="source_doc", cascade="all, delete-orphan"
    )


class SourceChunk(Base):
    """Chunked + embedded slice of a SourceDocument for vector retrieval.

    Created (and re-created) by services/source_docs.py when chunking is
    triggered. Used for unified semantic search (Phase 4d) and as retrieval
    context for future queries.
    """
    __tablename__ = "source_chunks"
    __table_args__ = (
        Index("ix_source_chunks_source_doc_id", "source_doc_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_doc_id: Mapped[int] = mapped_column(
        ForeignKey("source_documents.id", ondelete="CASCADE"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Variable-dimension vector — same pattern as Chunk.embedding / NoteChunk.embedding.
    embedding = mapped_column(Vector(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    source_doc: Mapped["SourceDocument"] = relationship(back_populates="chunks")


# ---------------------------------------------------------------------------
# V2 Knowledge Layer — Phase 2
# ---------------------------------------------------------------------------


class NoteChunk(Base):
    """Chunked + embedded slice of a note for vector retrieval.

    Created lazily before first retrieval. Invalidated when note.updated_at
    advances past note.last_indexed_at. Re-embedding sets last_indexed_at.
    """
    __tablename__ = "note_chunks"
    __table_args__ = (
        Index("ix_note_chunks_note_id", "note_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    note_id: Mapped[int] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Variable-dimension vector — same pattern as Chunk.embedding.
    embedding = mapped_column(Vector(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    note: Mapped["Note"] = relationship()
