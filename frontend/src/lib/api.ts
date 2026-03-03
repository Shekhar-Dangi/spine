/**
 * Thin API client wrapping fetch calls to the FastAPI backend.
 * All endpoints mirror the backend API surface from PLAN.md.
 */

const BASE = "http://localhost:8000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
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
  books: {
    upload: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
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
    suggestToc: (bookId: number, toc_pdf_page: number, page_offset: number) =>
      req<{ chapters: import("@/types").SuggestedChapter[] }>(
        `/api/books/${bookId}/toc/suggest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toc_pdf_page, page_offset }),
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
    getCached: (bookId: number, chapterId: number, mode: import("@/types").ExplainMode = "story") =>
      req<{ content: string; generated_at: string; mode: string }>(
        `/api/books/${bookId}/chapters/${chapterId}/explain?mode=${mode}`,
      ),
    getModes: (bookId: number, chapterId: number) =>
      req<{ cached_modes: Record<string, string | null> }>(
        `/api/books/${bookId}/chapters/${chapterId}/explain/modes`,
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

  providers: {
    capabilities: () =>
      req<{ tavily_available: boolean }>("/api/providers/capabilities"),
    list: () =>
      req<import("@/types").ModelProfile[]>("/api/providers/profiles"),
    create: (body: {
      name: string;
      provider_type: "openai" | "openrouter";
      api_key: string;
      base_url?: string;
      model: string;
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
      req<{ profile_id: number; reachable: boolean }>(
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
 */
export async function streamPost(
  path: string,
  body: unknown,
  onDelta: (text: string) => void,
  onDone: () => void,
  onError?: (err: Error) => void,
): Promise<void> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
          const data = line.slice(6);
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
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
