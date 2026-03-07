"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { api, streamPost } from "@/lib/api";
import { useBookReader } from "@/contexts/BookReaderContext";
import ExportPdfModal from "./ExportPdfModal";
import { getExplainTemplates } from "@/lib/explainTemplates";
import type { ExplainTemplate } from "@/types";

/** Convert LLM LaTeX delimiters to remark-math format. */
function normalizeLatex(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math}$`);
}

const MODE_GUIDE: Record<string, { when: string; examples: string }> = {
  Story: {
    when: "You want to understand *why* something exists — the historical chain of problems that forced it into being.",
    examples: "Why did central banking emerge? How did TCP/IP get designed?",
  },
  "First Principles": {
    when: "You want to derive the idea yourself — from constraints up, not from authority down.",
    examples: "Re-derive how consensus algorithms work. Build up RSA from scratch.",
  },
  Systems: {
    when: "You want to see the moving parts — who has what incentive, where information flows, what loops exist.",
    examples: "How does a market clear? What keeps a bureaucracy stable (or unstable)?",
  },
  Derivation: {
    when: "The chapter has math, proofs, or formal logic and you want every step shown explicitly.",
    examples: "Walk through a proof. Derive a formula. Trace a theorem step by step.",
  },
  Synthesis: {
    when: "You've already read the chapter and want the distilled essence — one idea you can carry and reuse.",
    examples: "What's the one mental model here? What would I tell someone in 2 minutes?",
  },
};

interface ModeState {
  /** null = not yet fetched, "" = fetched but no cache, "..." = has content */
  content: string | null;
  streaming: boolean;
  error: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function emptyModeState(): ModeState {
  return { content: null, streaming: false, error: null };
}

function allModesFor(templates: ExplainTemplate[]): Record<string, ModeState> {
  const rec: Record<string, ModeState> = {};
  for (const t of templates) rec[t.key] = emptyModeState();
  return rec;
}

interface Props { bookId: number }

export default function ExplainView({ bookId }: Props) {
  const { activeChapterId, chapters } = useBookReader();

  const [templates] = useState<ExplainTemplate[]>(() => getExplainTemplates());

  const [activeMode, setActiveMode] = useState<string>(templates[0]?.key ?? "story");
  const [modeStates, setModeStates] = useState<Record<string, ModeState>>(() => allModesFor(templates));
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [exportingLLM, setExportingLLM] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Chat state
  const [activeView, setActiveView] = useState<"explain" | "chat">("explain");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatPending, setChatPending] = useState<string | null>(null);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatStreamContent, setChatStreamContent] = useState<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const abortRefs = useRef<Partial<Record<string, AbortController>>>({});
  const explainCache = useRef<Map<string, string>>(new Map());
  const streamAccumRef = useRef<Partial<Record<string, string>>>({});

  const activeChapter = chapters.find((c) => c.id === activeChapterId);
  const ms = modeStates[activeMode] ?? emptyModeState();

  function cacheKey(chId: number, modeKey: string) {
    return `${chId}:${modeKey}`;
  }

  function patchMode(modeKey: string, patch: Partial<ModeState>) {
    setModeStates((prev) => ({
      ...prev,
      [modeKey]: { ...(prev[modeKey] ?? emptyModeState()), ...patch },
    }));
  }

  async function fetchCached(modeKey: string, chId: number) {
    const ck = cacheKey(chId, modeKey);
    if (explainCache.current.has(ck)) {
      patchMode(modeKey, { content: explainCache.current.get(ck)! });
      return;
    }
    try {
      const data = await api.explain.getCached(bookId, chId, modeKey);
      explainCache.current.set(ck, data.content);
      patchMode(modeKey, { content: data.content });
    } catch {
      patchMode(modeKey, { content: "" });
    }
  }

  function streamMode(modeKey: string, force = false) {
    if (!activeChapterId) return;

    abortRefs.current[modeKey]?.abort();
    const ctrl = new AbortController();
    abortRefs.current[modeKey] = ctrl;

    streamAccumRef.current[modeKey] = "";
    patchMode(modeKey, { content: "", streaming: true, error: null });

    const tmpl = templates.find((t) => t.key === modeKey);
    const body =
      tmpl && (!tmpl.isBuiltin || tmpl.isModified)
        ? { custom_template: tmpl.template }
        : {};

    const url = `/api/books/${bookId}/chapters/${activeChapterId}/explain?mode=${modeKey}${force ? "&force=true" : ""}`;

    streamPost(
      url,
      body,
      (delta) => {
        if (ctrl.signal.aborted) return;
        const decoded = delta.replace(/\\n/g, "\n");
        streamAccumRef.current[modeKey] = (streamAccumRef.current[modeKey] ?? "") + decoded;
        setModeStates((prev) => ({
          ...prev,
          [modeKey]: {
            ...(prev[modeKey] ?? emptyModeState()),
            content: ((prev[modeKey]?.content ?? "") + decoded),
          },
        }));
      },
      () => {
        if (!ctrl.signal.aborted) {
          patchMode(modeKey, { streaming: false });
          if (activeChapterId && streamAccumRef.current[modeKey]) {
            explainCache.current.set(cacheKey(activeChapterId, modeKey), streamAccumRef.current[modeKey]!);
          }
        }
        delete streamAccumRef.current[modeKey];
      },
      (err) => {
        if (!ctrl.signal.aborted) patchMode(modeKey, { streaming: false, error: err.message });
        delete streamAccumRef.current[modeKey];
      },
      ctrl.signal,
    );
  }

  useEffect(() => {
    for (const ctrl of Object.values(abortRefs.current)) ctrl?.abort();
    abortRefs.current = {};
    streamAccumRef.current = {};

    const firstKey = templates[0]?.key ?? "story";
    setActiveMode(firstKey);
    setModeStates(allModesFor(templates));
    setChatMessages([]);
    setActiveView("explain");

    if (!activeChapterId) return;

    const chId = activeChapterId;

    api.explain.getModes(bookId, chId).catch(() => {});

    const ck = cacheKey(chId, firstKey);
    if (explainCache.current.has(ck)) {
      patchMode(firstKey, { content: explainCache.current.get(ck)! });
    } else {
      fetchCached(firstKey, chId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapterId, bookId]);

  function handleTabClick(modeKey: string) {
    setActiveMode(modeKey);
    setActiveView("explain");
    setChatMessages([]);
    if (!activeChapterId) return;

    const ck = cacheKey(activeChapterId, modeKey);
    if (explainCache.current.has(ck)) {
      patchMode(modeKey, { content: explainCache.current.get(ck)! });
    } else if ((modeStates[modeKey]?.content ?? null) === null && !modeStates[modeKey]?.streaming) {
      fetchCached(modeKey, activeChapterId);
    }
  }

  function handleGenerateAll() {
    for (const t of templates) {
      const s = modeStates[t.key];
      if (!s?.streaming && !s?.content) {
        streamMode(t.key, false);
      }
    }
  }

  function loadChatFromDb(chId: number, mode: string) {
    api.explain.getChat(bookId, chId, mode)
      .then((data) => setChatMessages(data.messages as ChatMessage[]))
      .catch(() => {});
  }

  function sendChatMessage() {
    if (!chatQuestion.trim() || !activeChapterId || chatStreaming) return;

    const q = chatQuestion.trim();
    setChatQuestion("");
    setChatPending(q);

    chatAbortRef.current?.abort();
    const ctrl = new AbortController();
    chatAbortRef.current = ctrl;

    setChatStreaming(true);
    setChatStreamContent("");

    streamPost(
      `/api/books/${bookId}/chapters/${activeChapterId}/explain/chat?mode=${encodeURIComponent(activeMode)}`,
      { question: q, explain_content: ms.content ?? "" },
      (delta) => {
        if (ctrl.signal.aborted) return;
        setChatStreamContent((prev) => (prev ?? "") + delta.replace(/\\n/g, "\n"));
      },
      () => {
        if (ctrl.signal.aborted) return;
        setChatStreaming(false);
        setChatStreamContent(null);
        setChatPending(null);
        loadChatFromDb(activeChapterId!, activeMode);
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setChatStreaming(false);
        setChatStreamContent(null);
        setChatPending(null);
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${err.message}` },
        ]);
      },
      ctrl.signal,
    );
  }

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatPending, chatStreamContent]);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    function handleClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showExportMenu]);

  const handleExportLLM = async () => {
    if (!activeChapterId || !activeChapter) return;
    setExportingLLM(true);
    setShowExportMenu(false);
    try {
      const [bookResult, chapterTextResult, qaResult, dossierResult] = await Promise.allSettled([
        api.books.get(bookId),
        api.books.chapterText(bookId, activeChapterId),
        api.qa.getConversation(bookId, activeChapterId),
        api.dossier.get(bookId),
      ]);

      const SEP = "================================================================";
      const lines: string[] = [];

      const bookTitle = bookResult.status === "fulfilled" ? bookResult.value.title : `Book ${bookId}`;
      const bookAuthor =
        bookResult.status === "fulfilled" && bookResult.value.author
          ? ` by ${bookResult.value.author}`
          : "";
      lines.push(SEP, "SPINE CONTEXT EXPORT", `Book: ${bookTitle}${bookAuthor}`,
        `Chapter ${activeChapter.index + 1}: ${activeChapter.title}`,
        `Exported: ${new Date().toISOString()}`, SEP);

      if (chapterTextResult.status === "fulfilled") {
        lines.push("", "## CHAPTER TEXT", chapterTextResult.value.text, "");
      }
      if (ms.content) {
        lines.push(SEP, `## DEEP EXPLANATION (${activeMode})`, ms.content, "");
      }
      if (dossierResult.status === "fulfilled" && dossierResult.value.sections.length > 0) {
        lines.push(SEP, "## BOOK CONTEXT (Pre-read Dossier)");
        for (const s of dossierResult.value.sections) {
          lines.push(`### ${s.section_type}`, s.content);
          if (s.citations) lines.push(`Citations: ${s.citations}`);
          lines.push("");
        }
      }
      if (qaResult.status === "fulfilled" && qaResult.value.messages.length > 0) {
        lines.push(SEP, "## Q&A CONVERSATION (This Chapter)");
        for (const msg of qaResult.value.messages) {
          lines.push(`[${msg.role === "user" ? "User" : "Assistant"}] ${msg.content}`);
        }
        lines.push("");
      }

      const text = lines.join("\n");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chapter-${activeChapter.index + 1}-context.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("LLM export failed:", err);
    } finally {
      setExportingLLM(false);
    }
  };

  const hasContent = Boolean(ms.content);
  const anyStreaming = templates.some(({ key }) => modeStates[key]?.streaming);
  const canExport = hasContent && !ms.streaming;
  const cachedCount = templates.filter(({ key }) => Boolean(modeStates[key]?.content)).length;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-stone-200 dark:border-stone-800">

        {/* Row 1: chapter breadcrumb + action toolbar */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2.5">
          {/* Chapter label */}
          <div className="flex-1 min-w-0">
            {activeChapter ? (
              <p className="text-[11px] font-medium text-stone-400 dark:text-stone-500 truncate leading-none">
                Ch {activeChapter.index + 1} · {activeChapter.title}
              </p>
            ) : (
              <span className="text-[11px] text-stone-300 dark:text-stone-700">No chapter selected</span>
            )}
          </div>

          {/* Action toolbar */}
          {activeChapterId && (
            <div className="flex items-center gap-1 shrink-0">

              {/* Generate All (icon-only, only when nothing streaming) */}
              {!anyStreaming && !hasContent && (
                <button
                  onClick={handleGenerateAll}
                  title="Generate all modes"
                  className="h-7 px-2 flex items-center gap-1.5 rounded-md bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400 text-[11px] font-medium transition-colors"
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                    <path d="M2 4h10M2 7h10M2 10h6" strokeLinecap="round"/>
                  </svg>
                  All
                </button>
              )}

              {/* Primary: Stop (streaming) or Re-explain (has content) */}
              {ms.streaming ? (
                <button
                  onClick={() => abortRefs.current[activeMode]?.abort()}
                  className="h-7 px-2.5 flex items-center gap-1.5 rounded-md bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-[11px] font-medium transition-colors"
                >
                  <span className="inline-block h-2 w-2 rounded-sm bg-red-500" />
                  Stop
                </button>
              ) : canExport && activeView === "explain" ? (
                <button
                  onClick={() => streamMode(activeMode, true)}
                  title="Re-explain this mode"
                  className="h-7 w-7 flex items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5">
                    <path d="M12 7A5 5 0 1 1 9.5 2.8" strokeLinecap="round"/>
                    <path d="M12 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ) : null}

              {/* Divider */}
              {hasContent && activeChapterId && (
                <div className="h-4 w-px bg-stone-200 dark:bg-stone-700 mx-0.5" />
              )}

              {/* Chat toggle */}
              {hasContent && activeChapterId && (
                <button
                  onClick={() => {
                    setActiveView((v) => {
                      const next = v === "chat" ? "explain" : "chat";
                      if (next === "chat" && activeChapterId) loadChatFromDb(activeChapterId, activeMode);
                      return next;
                    });
                  }}
                  className={`h-7 px-2.5 flex items-center gap-1.5 rounded-md text-[11px] font-medium transition-colors ${
                    activeView === "chat"
                      ? "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
                      : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-300"
                  }`}
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                    <path d="M2 2h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5l-3 2V3a1 1 0 0 1 1-1z" strokeLinejoin="round"/>
                  </svg>
                  Chat
                </button>
              )}

              {/* Export dropdown */}
              {canExport && activeView === "explain" && (
                <div className="relative" ref={exportMenuRef}>
                  <button
                    onClick={() => setShowExportMenu((v) => !v)}
                    className={`h-7 px-2 flex items-center gap-1 rounded-md text-[11px] font-medium transition-colors ${
                      showExportMenu
                        ? "bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-200"
                        : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-300"
                    }`}
                    title="Export options"
                  >
                    {exportingLLM ? (
                      <div className="h-3 w-3 border border-stone-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
                        <path d="M7 2v8M4 7l3 3 3-3M2 11h10" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    <svg viewBox="0 0 8 8" fill="currentColor" className="w-2 h-2 opacity-60">
                      <path d="M4 5.5L1 2h6L4 5.5z"/>
                    </svg>
                  </button>

                  {showExportMenu && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg overflow-hidden">
                      <button
                        onClick={() => { setShowPdfModal(true); setShowExportMenu(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors text-left"
                      >
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="w-3 h-3 shrink-0">
                          <rect x="2" y="1" width="10" height="12" rx="1"/>
                          <path d="M4 5h6M4 7.5h6M4 10h4" strokeLinecap="round"/>
                        </svg>
                        Export PDF
                      </button>
                      <div className="h-px bg-stone-100 dark:bg-stone-800" />
                      <button
                        onClick={handleExportLLM}
                        disabled={exportingLLM}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-40 transition-colors text-left"
                      >
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="w-3 h-3 shrink-0">
                          <path d="M2 2h10a1 1 0 0 1 1 1v2H1V3a1 1 0 0 1 1-1zM1 5h12v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5z"/>
                          <path d="M5 9h4" strokeLinecap="round"/>
                        </svg>
                        Export .txt
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 2: mode pills strip */}
        {activeChapterId && activeView === "explain" && (
          <div className="relative px-4 pb-2.5">
            <div className="flex items-center gap-1">
              {/* Scrollable pills */}
              <div className="flex-1 flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                {templates.map((tmpl) => {
                  const s = modeStates[tmpl.key] ?? emptyModeState();
                  const isCurrent = tmpl.key === activeMode;
                  const isStreaming = s.streaming;
                  const isCached = Boolean(s.content);

                  return (
                    <button
                      key={tmpl.key}
                      onClick={() => handleTabClick(tmpl.key)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all ${
                        isCurrent
                          ? "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-800/60"
                          : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-300"
                      }`}
                    >
                      {isStreaming ? (
                        <span className="inline-block h-1.5 w-1.5 border border-amber-500 border-t-transparent rounded-full animate-spin" />
                      ) : isCached ? (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      ) : (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-stone-300 dark:bg-stone-600" />
                      )}
                      {tmpl.name}
                      {tmpl.isModified && (
                        <span className="text-amber-400 dark:text-amber-500 text-[9px] leading-none" title="Custom template">✎</span>
                      )}
                    </button>
                  );
                })}

                {/* Generate All — visible when some modes are empty and nothing is streaming */}
                {!anyStreaming && cachedCount < templates.length && hasContent && (
                  <button
                    onClick={handleGenerateAll}
                    title="Generate remaining modes"
                    className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 whitespace-nowrap transition-colors"
                  >
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-2.5 h-2.5">
                      <path d="M6 1v10M1 6h10" strokeLinecap="round"/>
                    </svg>
                    All
                  </button>
                )}
              </div>

              {/* Info button — inline, never overlaps pills */}
              <button
                onClick={() => setShowGuide((v) => !v)}
                className={`shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-xs transition-colors ${
                  showGuide
                    ? "bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-200"
                    : "text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                }`}
                title="When to use each mode"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 5zm-.75 2.75a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0v-3z" />
                </svg>
              </button>
            </div>

            {/* Guide popover */}
            {showGuide && (
              <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-stone-900 dark:bg-stone-800 border border-stone-700 dark:border-stone-600 rounded-xl shadow-xl p-4 space-y-3.5">
                {templates.map((tmpl) => {
                  const guide = MODE_GUIDE[tmpl.name];
                  if (!guide) return null;
                  return (
                    <div key={tmpl.key}>
                      <p className="text-[11px] font-semibold text-amber-400 mb-0.5">{tmpl.name}</p>
                      <p className="text-[11px] text-stone-300 leading-relaxed">{guide.when}</p>
                      <p className="text-[10px] text-stone-500 mt-0.5 italic">{guide.examples}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Chat header */}
        {activeView === "chat" && activeChapterId && (
          <div className="px-4 pb-2.5 flex items-center gap-2">
            <span className="text-[11px] text-stone-400 dark:text-stone-500">
              On: <span className="text-stone-600 dark:text-stone-400 font-medium">{templates.find(t => t.key === activeMode)?.name ?? activeMode}</span>
            </span>
            {chatMessages.length > 0 && (
              <>
                <span className="text-stone-300 dark:text-stone-700">·</span>
                <button
                  onClick={() => {
                    if (!activeChapterId) return;
                    api.explain.clearChat(bookId, activeChapterId, activeMode)
                      .then(() => setChatMessages([]))
                      .catch(() => {});
                  }}
                  className="text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                >
                  Clear history
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── EXPLAIN VIEW ── */}
      {activeView === "explain" && (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!activeChapterId && (
            <p className="text-stone-400 dark:text-stone-600 text-xs mt-4 text-center">
              Select a chapter in the reader first.
            </p>
          )}
          {ms.error && (
            <p className="text-red-500 dark:text-red-400 text-xs mb-3">{ms.error}</p>
          )}
          {ms.content && (
            <div className="prose prose-sm max-w-none dark:prose-invert
              prose-headings:font-serif
              prose-h1:text-base prose-h1:font-semibold prose-h1:mt-6 prose-h1:mb-2 prose-h1:text-stone-900 dark:prose-h1:text-stone-100
              prose-h2:text-sm prose-h2:font-semibold prose-h2:text-amber-700 dark:prose-h2:text-amber-400 prose-h2:mt-4 prose-h2:mb-1 prose-h2:uppercase prose-h2:tracking-wide
              prose-p:text-stone-600 dark:prose-p:text-stone-400 prose-p:leading-7 prose-p:my-1
              prose-li:text-stone-600 dark:prose-li:text-stone-400 prose-li:leading-7
              prose-strong:text-stone-800 dark:prose-strong:text-stone-200
              prose-em:text-stone-600 dark:prose-em:text-stone-400
              prose-code:text-amber-700 dark:prose-code:text-amber-400 prose-code:bg-amber-50 dark:prose-code:bg-amber-950/30 prose-code:px-1 prose-code:rounded
              prose-pre:bg-stone-100 dark:prose-pre:bg-stone-800 prose-pre:text-stone-700 dark:prose-pre:text-stone-300
            ">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {normalizeLatex(ms.content)}
              </ReactMarkdown>
            </div>
          )}
          {ms.streaming && !ms.content && (
            <div className="flex items-center gap-2.5 text-stone-400 dark:text-stone-600 text-xs mt-4">
              <div className="h-3 w-3 border border-amber-500 border-t-transparent rounded-full animate-spin" />
              Generating explanation…
            </div>
          )}
          {activeChapterId && !ms.streaming && ms.content === "" && (
            <div className="flex flex-col items-center gap-3 mt-8">
              <p className="text-stone-400 dark:text-stone-500 text-xs text-center">
                No explanation yet for this mode.
              </p>
              <button
                onClick={() => streamMode(activeMode)}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 text-white text-xs font-medium transition-colors"
              >
                Generate
              </button>
            </div>
          )}
          {activeChapterId && (modeStates[activeMode]?.content ?? null) === null && !ms.streaming && (
            <div className="flex items-center gap-2 text-stone-400 dark:text-stone-600 text-xs mt-4">
              <div className="h-2.5 w-2.5 border border-stone-300 border-t-transparent rounded-full animate-spin" />
              Loading…
            </div>
          )}
        </div>
      )}

      {/* ── CHAT VIEW ── */}
      {activeView === "chat" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {chatMessages.length === 0 && !chatPending && !chatStreamContent && (
              <p className="text-xs text-stone-400 dark:text-stone-600 mt-2 leading-relaxed">
                Ask anything about the <span className="font-medium">{templates.find(t => t.key === activeMode)?.name ?? activeMode}</span> explanation above.
              </p>
            )}
            {chatMessages.map((msg, i) => (
              <ChatBubble key={i} role={msg.role} content={msg.content} />
            ))}
            {chatPending !== null && (
              <ChatBubble role="user" content={chatPending} />
            )}
            {chatStreamContent !== null && (
              <ChatBubble role="assistant" content={chatStreamContent} streaming />
            )}
            <div ref={chatBottomRef} />
          </div>

          <div className="shrink-0 border-t border-stone-200 dark:border-stone-800 px-5 py-3 bg-stone-50 dark:bg-stone-900/50">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatQuestion}
                onChange={(e) => setChatQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
                placeholder="Ask about this explanation…"
                disabled={chatStreaming}
                className="flex-1 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 disabled:opacity-50 transition-colors"
              />
              {chatStreaming ? (
                <button
                  onClick={() => chatAbortRef.current?.abort()}
                  className="px-4 py-2 rounded-lg bg-red-100 hover:bg-red-200 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-medium transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={sendChatMessage}
                  disabled={!chatQuestion.trim() || !ms.content}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                >
                  Ask
                </button>
              )}
            </div>
            {!ms.content && (
              <p className="text-xs text-stone-400 dark:text-stone-600 mt-1.5">
                Generate an explanation first to enable chat.
              </p>
            )}
          </div>
        </div>
      )}

      {showPdfModal && activeChapter && ms.content && (
        <ExportPdfModal
          content={normalizeLatex(ms.content)}
          chapterNum={activeChapter.index + 1}
          onClose={() => setShowPdfModal(false)}
        />
      )}
    </div>
  );
}

function ChatBubble({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-amber-600 dark:bg-amber-700 px-4 py-2.5 text-sm text-white leading-6">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <div className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-[8px] text-stone-500 dark:text-stone-400 font-bold tracking-wide">
        AI
      </div>
      <div className="flex-1 text-sm text-stone-700 dark:text-stone-300 leading-7 prose prose-sm prose-stone dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {content}
        </ReactMarkdown>
        {streaming && (
          <span className="inline-block w-1.5 h-4 ml-0.5 bg-amber-500 animate-pulse rounded-sm align-middle" />
        )}
      </div>
    </div>
  );
}
