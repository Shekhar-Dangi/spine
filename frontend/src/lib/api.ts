/**
 * Thin API client wrapping fetch calls to the FastAPI backend.
 * All endpoints mirror the backend API surface from PLAN.md.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

// When set, file uploads bypass Vercel's 4.5 MB function payload limit by
// POSTing directly to the backend. All other API calls still go through the
// Vercel proxy (so cookies work). Set this to your backend's public URL in
// your Vercel project environment variables, e.g.:
//   NEXT_PUBLIC_UPLOAD_URL=https://spine-api-prod.azurewebsites.net
const UPLOAD_BASE = process.env.NEXT_PUBLIC_UPLOAD_URL ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

export const api = {
  auth: {
    login: (username_or_email: string, password: string) =>
      req<import("@/types").UserOut>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username_or_email, password }),
      }),
    logout: () =>
      req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    me: () => req<import("@/types").UserOut>("/api/auth/me"),
    setupStatus: () =>
      req<{ needs_setup: boolean }>("/api/auth/setup-status"),
    setup: (username: string, email: string, password: string, setup_key: string) =>
      req<import("@/types").UserOut>("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, setup_key }),
      }),
    register: (
      invite_code: string,
      username: string,
      email: string,
      password: string,
    ) =>
      req<import("@/types").UserOut>("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_code, username, email, password }),
      }),
    createInvite: () =>
      req<{ code: string; url: string }>("/api/auth/invites", {
        method: "POST",
      }),
    listInvites: () =>
      req<import("@/types").InviteOut[]>("/api/auth/invites"),
    getUploadToken: () =>
      req<{ token: string }>("/api/auth/upload-token"),
  },

  books: {
    upload: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);

      if (UPLOAD_BASE) {
        // Direct upload — bypasses Vercel's 4.5 MB function payload limit.
        // First get a short-lived Bearer token (tiny proxied request, no size issue).
        const { token } = await req<{ token: string }>("/api/auth/upload-token");
        const res = await fetch(`${UPLOAD_BASE}/api/books/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`API ${res.status}: ${text}`);
        }
        return res.json() as Promise<{ book_id: number; status: string }>;
      }

      return req<{ book_id: number; status: string }>("/api/books/upload", {
        method: "POST",
        body: fd,
      });
    },
    list: () => req<import("@/types").Book[]>("/api/books"),
    get: (bookId: number) =>
      req<import("@/types").Book>(`/api/books/${bookId}`),
    update: (bookId: number, body: { title?: string; author?: string }) =>
      req<import("@/types").Book>(`/api/books/${bookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    delete: (bookId: number) =>
      req<{ deleted: number }>(`/api/books/${bookId}`, { method: "DELETE" }),
    chapters: (bookId: number) =>
      req<import("@/types").TocChapter[]>(`/api/books/${bookId}/chapters`),
    confirmToc: (bookId: number, chapters: import("@/types").TocChapter[]) =>
      req<{ book_id: number; status: string }>(
        `/api/books/${bookId}/toc/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chapters }),
        },
      ),
    suggestToc: (bookId: number, toc_pdf_page: number, page_offset: number, toc_pdf_page_end?: number) =>
      req<{ chapters: import("@/types").SuggestedChapter[] }>(
        `/api/books/${bookId}/toc/suggest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toc_pdf_page, toc_pdf_page_end: toc_pdf_page_end ?? null, page_offset }),
        },
      ),
    resetToc: (bookId: number) =>
      req<{ book_id: number; status: string }>(
        `/api/books/${bookId}/reset-toc`,
        {
          method: "POST",
        },
      ),
    updateChapter: (bookId: number, chapterId: number, title: string) =>
      req<import("@/types").TocChapter>(
        `/api/books/${bookId}/chapters/${chapterId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      ),
    chapterText: (bookId: number, chapterId: number) =>
      req<{ chapter_id: number; text: string }>(
        `/api/books/${bookId}/chapters/${chapterId}/text`,
      ),
    retryEmbed: (bookId: number) =>
      req<{ book_id: number; status: string }>(
        `/api/books/${bookId}/retry-embed`,
        {
          method: "POST",
        },
      ),
  },

  dossier: {
    generate: (bookId: number, useWebSearch: boolean) =>
      req<{ book_id: number; status: string }>(
        `/api/books/${bookId}/dossier/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ use_web_search: useWebSearch }),
        },
      ),
    get: (bookId: number) =>
      req<import("@/types").Dossier>(`/api/books/${bookId}/dossier`),
  },

  explain: {
    getCached: (bookId: number, chapterId: number, mode: string = "story") =>
      req<{ content: string; generated_at: string; mode: string }>(
        `/api/books/${bookId}/chapters/${chapterId}/explain?mode=${mode}`,
      ),
    getModes: (bookId: number, chapterId: number) =>
      req<{ cached_modes: Record<string, string | null> }>(
        `/api/books/${bookId}/chapters/${chapterId}/explain/modes`,
      ),
    getChat: (bookId: number, chapterId: number, mode: string) =>
      req<{ messages: Array<{ id: number; role: "user" | "assistant"; content: string; created_at: string }> }>(
        `/api/books/${bookId}/chapters/${chapterId}/explain/chat?mode=${encodeURIComponent(mode)}`,
      ),
    clearChat: (bookId: number, chapterId: number, mode: string) =>
      req<{ ok: boolean }>(
        `/api/books/${bookId}/chapters/${chapterId}/explain/chat?mode=${encodeURIComponent(mode)}`,
        { method: "DELETE" },
      ),
  },

  map: {
    generate: (bookId: number, chapterId: number) =>
      req<{ status: string }>(
        `/api/books/${bookId}/chapters/${chapterId}/map/generate`,
        {
          method: "POST",
        },
      ),
    get: (bookId: number, chapterId: number) =>
      req<import("@/types").ChapterMap>(
        `/api/books/${bookId}/chapters/${chapterId}/map`,
      ),
  },

  qa: {
    getConversation: (bookId: number, chapterId?: number) => {
      const qs = chapterId != null ? `?chapter_id=${chapterId}` : "";
      return req<import("@/types").ConversationResponse>(
        `/api/books/${bookId}/conversation${qs}`,
      );
    },
  },

  notes: {
    list: (params?: { origin_type?: string; search?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.origin_type) qs.set("origin_type", params.origin_type);
      if (params?.search) qs.set("search", params.search);
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.offset != null) qs.set("offset", String(params.offset));
      const q = qs.toString();
      return req<import("@/types").NotesListResponse>(`/api/notes${q ? `?${q}` : ""}`);
    },
    get: (noteId: number) =>
      req<import("@/types").Note>(`/api/notes/${noteId}`),
    create: (body: { title?: string; content: string }) =>
      req<import("@/types").Note>("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    update: (noteId: number, body: { title?: string; content?: string }) =>
      req<import("@/types").Note>(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    delete: (noteId: number) =>
      req<void>(`/api/notes/${noteId}`, { method: "DELETE" }),
    addLink: (noteId: number, toNoteId: number) =>
      req<{ from_note_id: number; to_note_id: number }>(`/api/notes/${noteId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_note_id: toNoteId }),
      }),
    removeLink: (noteId: number, toNoteId: number) =>
      req<void>(`/api/notes/${noteId}/links/${toNoteId}`, { method: "DELETE" }),
    saveQaTurn: (bookId: number, messageId: number, title?: string) =>
      req<import("@/types").SaveNoteResult>(
        `/api/books/${bookId}/qa/messages/${messageId}/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title ?? null }),
        },
      ),
    saveMultipleQaTurns: (bookId: number, messageIds: number[], title?: string) =>
      req<import("@/types").SaveNoteResult>(
        `/api/books/${bookId}/qa/messages/save-multiple`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_ids: messageIds, title: title ?? null }),
        },
      ),
    saveExplainTurn: (bookId: number, chapterId: number, messageId: number, title?: string) =>
      req<import("@/types").SaveNoteResult>(
        `/api/books/${bookId}/chapters/${chapterId}/explain/messages/${messageId}/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title ?? null }),
        },
      ),
    saveExplainContent: (bookId: number, chapterId: number, mode: string, title?: string) =>
      req<import("@/types").SaveNoteResult>(
        `/api/books/${bookId}/chapters/${chapterId}/explain/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, title: title ?? null }),
        },
      ),
    savePassage: (
      bookId: number,
      chapterId: number,
      body: { selected_text: string; title?: string; extra_content?: string },
    ) =>
      req<import("@/types").Note>(
        `/api/books/${bookId}/chapters/${chapterId}/anchor-note`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    migrateHistory: (bookId: number, include_qa: boolean, include_explain: boolean) =>
      req<{ created: number; skipped: number }>(
        `/api/books/${bookId}/migrate-history`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ include_qa, include_explain }),
        },
      ),
  },

  knowledge: {
    triggerExtraction: (source: { noteId: number } | { content: string }) =>
      req<import("@/types").ExtractionJob>("/api/knowledge/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          "noteId" in source
            ? { note_id: source.noteId }
            : { source_content: source.content },
        ),
      }),
    getJob: (jobId: number) =>
      req<import("@/types").ExtractionJob>(`/api/knowledge/jobs/${jobId}`),
    listSuggestions: (params?: { status?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.offset != null) qs.set("offset", String(params.offset));
      const q = qs.toString();
      return req<import("@/types").SuggestionsListResponse>(
        `/api/knowledge/suggestions${q ? `?${q}` : ""}`
      );
    },
    approveSuggestion: (id: number) =>
      req<{ approved: boolean }>(`/api/knowledge/suggestions/${id}/approve`, {
        method: "POST",
      }),
    rejectSuggestion: (id: number) =>
      req<{ rejected: boolean }>(`/api/knowledge/suggestions/${id}/reject`, {
        method: "POST",
      }),
    dismissSuggestion: (id: number) =>
      req<{ dismissed: boolean }>(`/api/knowledge/suggestions/${id}/dismiss`, {
        method: "POST",
      }),

    // Phase 3 — nodes + graph
    listNodes: (params?: { node_type?: string; search?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.node_type) qs.set("node_type", params.node_type);
      if (params?.search) qs.set("search", params.search);
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.offset != null) qs.set("offset", String(params.offset));
      const q = qs.toString();
      return req<import("@/types").KnowledgeNodesResponse>(`/api/knowledge/nodes${q ? `?${q}` : ""}`);
    },
    getNode: (nodeId: number) =>
      req<import("@/types").KnowledgeNode & { edges: import("@/types").KnowledgeEdge[] }>(
        `/api/knowledge/nodes/${nodeId}`
      ),
    createNode: (body: {
      type: string;
      name: string;
      aliases?: string[];
      description?: string | null;
      node_metadata?: Record<string, unknown>;
    }) =>
      req<import("@/types").KnowledgeNode>("/api/knowledge/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    updateNode: (
      nodeId: number,
      body: {
        name?: string;
        type?: string;
        aliases?: string[];
        description?: string | null;
        node_metadata?: Record<string, unknown>;
      },
    ) =>
      req<import("@/types").KnowledgeNode>(`/api/knowledge/nodes/${nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    deleteNode: (nodeId: number) =>
      req<void>(`/api/knowledge/nodes/${nodeId}`, { method: "DELETE" }),
    createEdge: (nodeId: number, body: { to_node_id: number; relation: string }) =>
      req<import("@/types").KnowledgeEdge>(`/api/knowledge/nodes/${nodeId}/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    deleteEdge: (edgeId: number) =>
      req<void>(`/api/knowledge/edges/${edgeId}`, { method: "DELETE" }),
    getGraph: (params?: { node_type?: string; search?: string }) => {
      const qs = new URLSearchParams();
      if (params?.node_type) qs.set("node_type", params.node_type);
      if (params?.search) qs.set("search", params.search);
      const q = qs.toString();
      return req<import("@/types").KnowledgeGraphResponse>(`/api/knowledge/graph${q ? `?${q}` : ""}`);
    },
  },

  search: {
    query: (q: string, limit = 20) => {
      const qs = new URLSearchParams({ q, limit: String(limit) });
      return req<import("@/types").SearchResponse>(`/api/search?${qs}`);
    },
  },

  providers: {
    capabilities: () =>
      req<{ tavily_available: boolean; valid_capabilities: string[] }>("/api/providers/capabilities"),
    list: () =>
      req<import("@/types").ModelProfile[]>("/api/providers/profiles"),
    create: (body: {
      name: string;
      provider_type: "openai" | "openrouter";
      api_key: string;
      base_url?: string;
      model: string;
      capabilities: import("@/types").ModelCapability[];
      embedding_dim?: number;
    }) =>
      req<import("@/types").ModelProfile>("/api/providers/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    update: (
      profileId: number,
      body: {
        name?: string;
        api_key?: string;
        base_url?: string;
        model?: string;
        active?: boolean;
        capabilities?: import("@/types").ModelCapability[];
        embedding_dim?: number;
      },
    ) =>
      req<import("@/types").ModelProfile>(
        `/api/providers/profiles/${profileId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    delete: (profileId: number) =>
      req<{ deleted: number }>(`/api/providers/profiles/${profileId}`, {
        method: "DELETE",
      }),
    test: (profileId: number) =>
      req<{
        profile_id: number;
        reachable: boolean;
        capabilities_tested: Record<string, boolean | string>;
      }>(
        `/api/providers/profiles/${profileId}/test`,
        { method: "POST" },
      ),
    getTaskMapping: () =>
      req<import("@/types").TaskMapping>("/api/providers/task-mapping"),
    setTaskMapping: (mapping: Partial<import("@/types").TaskMapping>) =>
      req<import("@/types").TaskMapping>("/api/providers/task-mapping", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mapping),
      }),
  },
};

/**
 * POST a request and consume the SSE stream.
 * Calls onDelta for each text chunk; calls onDone when stream ends.
 * Pass an AbortSignal to cancel the stream.
 */
export async function streamPost(
  path: string,
  body: unknown,
  onDelta: (text: string) => void,
  onDone: () => void,
  onError?: (err: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`Stream error ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).replace(/\\n/g, "\n");
          if (data === "[DONE]") {
            onDone();
            return;
          }
          if (data.startsWith("[ERROR]")) {
            onError?.(new Error(data.slice(7).trim()));
            return;
          }
          onDelta(data);
        }
      }
    }
    onDone();
  } catch (err) {
    // Ignore abort errors — caller intentionally cancelled the stream
    if (err instanceof Error && err.name === "AbortError") return;
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
