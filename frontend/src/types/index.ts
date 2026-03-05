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

export interface ModelProfile {
  id: number;
  name: string;
  provider_type: "openai" | "openrouter";
  base_url: string | null;
  model: string;
  active: boolean;
}

/** Routing task names matching backend ROUTING_TASKS tuple. */
export type RoutingTask =
  | "dossier"
  | "explain"
  | "qa"
  | "map_extract"
  | "toc_extract";

/** task_name → profile_id (null = use active profile fallback). */
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
