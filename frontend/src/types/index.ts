// ---------------------------------------------------------------------------
// Shared types mirroring backend data models
// ---------------------------------------------------------------------------

export type BookFormat = "pdf" | "epub";

/** Mode key — built-in or user-defined (any string ≤ 32 chars). */
export type ExplainMode = string;

export const BUILTIN_MODE_KEYS = [
  "story",
  "first_principles",
  "systems",
  "derivation",
  "synthesis",
] as const;

export interface ExplainTemplate {
  id: string;
  name: string;
  /** Mode key sent to backend — max 32 chars, no spaces. */
  key: string;
  /** Full prompt template; uses {book_title}, {author}, {chapter_num}, {chapter_title}, {chapter_text}. */
  template: string;
  /** True if this is one of the 5 original built-in modes. */
  isBuiltin: boolean;
  /** True if the user has edited the template text of a built-in mode. */
  isModified: boolean;
}

export type IngestStatus =
  | "uploaded"
  | "parsing"
  | "pending_toc_review"
  | "ingesting"
  | "ready"
  | "failed";

export interface Book {
  id: number;
  title: string;
  author: string | null;
  format: BookFormat;
  page_count: number | null;
  ingest_status: IngestStatus;
  ingest_error: string | null;
  ingest_quality_json: string | null;
}

export interface TocChapter {
  id?: number;
  index: number;
  title: string;
  start_page: number | null;
  end_page: number | null;
  start_anchor: string | null;
  end_anchor: string | null;
  confirmed: boolean;
}

export interface DossierSection {
  section_type: string;
  content: string;
  citations: string | null;
}

export interface Dossier {
  id: number;
  book_id: number;
  version: number;
  generated_at: string | null;
  sections: DossierSection[];
}

export interface MapNode {
  id: string;
  label: string;
  explanation: string;
  anchors: string[];
}

export interface MapEdge {
  source: string;
  target: string;
  relation: string;
}

export interface ChapterMap {
  id: number;
  book_id: number;
  chapter_id: number;
  nodes: MapNode[];
  edges: MapEdge[];
  generated_at: string | null;
}

export type ModelCapability = "chat" | "embedding";

export interface ModelProfile {
  id: number;
  name: string;
  provider_type: "openai" | "openrouter";
  base_url: string | null;
  model: string;
  active: boolean;
  capabilities: ModelCapability[];
  embedding_dim: number | null;
}

/** Routing task names matching backend ROUTING_TASKS tuple. */
export type RoutingTask =
  | "dossier"
  | "explain"
  | "qa"
  | "map_extract"
  | "toc_extract"
  | "embed"
  | "extract";

/** Which capability each task requires. */
export const TASK_REQUIRED_CAPABILITY: Record<RoutingTask, ModelCapability> = {
  dossier: "chat",
  explain: "chat",
  qa: "chat",
  map_extract: "chat",
  toc_extract: "chat",
  embed: "embedding",
  extract: "chat",
};

/** task_name → profile_id (null = use active/fallback profile). */
export type TaskMapping = Record<RoutingTask, number | null>;

export interface ConversationMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  chapter_id: number | null;
  created_at: string;
}

export interface ConversationResponse {
  conversation_id: number | null;
  messages: ConversationMessage[];
}

export interface UserOut {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  created_at: string;
}

export interface InviteOut {
  id: number;
  code: string;
  created_at: string;
  expires_at: string | null;
  used_by_id: number | null;
  used_by_username: string | null;
}

// ---------------------------------------------------------------------------
// V2 Knowledge Layer
// ---------------------------------------------------------------------------

export type NoteOriginType = "standalone" | "passage_anchor" | "explain_turn" | "qa_turn";

export interface Note {
  id: number;
  title: string | null;
  content: string;
  origin_type: NoteOriginType | null;
  origin_id: number | null;
  last_indexed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Only present on GET /api/notes/{id} */
  links_to?: number[];
  linked_from?: number[];
}

export interface SaveNoteResult {
  id: number;
  title: string | null;
  origin_type: string;
  origin_id: number;
  created_at: string;
}

export interface NotesListResponse {
  notes: Note[];
  total: number;
}

// ---------------------------------------------------------------------------
// V2 Knowledge Layer — Phase 2
// ---------------------------------------------------------------------------

export type AskScope = "whole_library" | "current_book" | "notes";

export type SuggestionType = "new_node" | "merge_node" | "alias" | "new_edge" | "historical_tag" | "enrich_node";
export type SuggestionStatus = "pending" | "approved" | "rejected" | "dismissed";

export interface Suggestion {
  id: number;
  type: SuggestionType;
  status: SuggestionStatus;
  payload: Record<string, unknown>;
  job_id: number;
  reviewed_at: string | null;
  created_at: string;
}

export interface SuggestionsListResponse {
  suggestions: Suggestion[];
  total: number;
}

export interface ExtractionJob {
  id: number;
  status: "pending" | "running" | "completed" | "failed";
  suggestion_count: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// V2 Knowledge Layer — Phase 3 (Explorer)
// ---------------------------------------------------------------------------

export type KnowledgeNodeType = "concept" | "person" | "event" | "place" | "era";

export interface KnowledgeNode {
  id: number;
  type: KnowledgeNodeType;
  name: string;
  aliases: string[];
  description: string | null;
  node_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /** Only present on GET /api/knowledge/nodes/{id} */
  edges?: KnowledgeEdge[];
  /** Only present on GET /api/knowledge/nodes/{id} */
  sources?: NodeSourceItem[];
}

export interface EvidenceItem {
  id: number;
  source_type: string;
  source_id: number;
  quote: string | null;
  note_title: string | null;
}

export interface KnowledgeEdge {
  id: number;
  from_node_id: number;
  to_node_id: number;
  relation: string;
  created_at: string;
  /** Only present on GET /api/knowledge/nodes/{id} */
  evidence?: EvidenceItem[];
}

export interface KnowledgeGraphResponse {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface KnowledgeNodesResponse {
  nodes: KnowledgeNode[];
  total: number;
}

// ---------------------------------------------------------------------------
// V2 Knowledge Layer — Phase 4d (Unified Search)
// ---------------------------------------------------------------------------

export interface SearchResult {
  source_type: "book" | "note" | "source_doc";
  title: string;
  chapter_title: string | null;
  excerpt: string;
  score: number;
  meta: {
    book_id?: number;
    chapter_id?: number;
    note_id?: number;
    source_doc_id?: number;
    origin_ref?: Record<string, unknown>;
  };
}

// Node-level provenance — returned by GET /api/knowledge/nodes/{id}
export interface NodeSourceItem {
  id: number;
  source_type: string;   // "note" | "source_doc" | "chunk" etc.
  source_id: number;
  excerpt: string | null;
  note_title?: string | null;
  source_doc_title?: string | null;
  source_doc_type?: string | null;
  created_at: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

/** A suggested chapter entry returned by POST /toc/suggest. */
export interface SuggestedChapter {
  index: number;
  title: string;
  book_page: number;
  pdf_page: number;
  start_page: number;
  end_page: number | null;
  start_anchor: string | null;
  end_anchor: string | null;
  confirmed: boolean;
}
