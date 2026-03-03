"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { api, streamPost } from "@/lib/api";
import { useBookReader } from "@/contexts/BookReaderContext";
import ExportPdfModal from "./ExportPdfModal";
import type { ExplainMode } from "@/types";

/** Convert LLM LaTeX delimiters to remark-math format. */
function normalizeLatex(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math}$`);
}

const MODES: { key: ExplainMode; label: string }[] = [
  { key: "story", label: "Story" },
  { key: "first_principles", label: "First Principles" },
  { key: "systems", label: "Systems" },
  { key: "derivation", label: "Derivation" },
  { key: "synthesis", label: "Synthesis" },
];

const MODE_GUIDE: { label: string; when: string; examples: string }[] = [
  {
    label: "Story",
    when: "You want to understand *why* something exists — the historical chain of problems that forced it into being.",
    examples: "Why did central banking emerge? How did TCP/IP get designed?",
  },
  {
    label: "First Principles",
    when: "You want to derive the idea yourself — from constraints up, not from authority down.",
    examples: "Re-derive how consensus algorithms work. Build up RSA from scratch.",
  },
  {
    label: "Systems",
    when: "You want to see the moving parts — who has what incentive, where information flows, what loops exist.",
    examples: "How does a market clear? What keeps a bureaucracy stable (or unstable)?",
  },
  {
    label: "Derivation",
    when: "The chapter has math, proofs, or formal logic and you want every step shown explicitly.",
    examples: "Walk through a proof. Derive a formula. Trace a theorem step by step.",
  },
  {
    label: "Synthesis",
    when: "You've already read the chapter and want the distilled essence — one idea you can carry and reuse.",
    examples: "What's the one mental model here? What would I tell someone in 2 minutes?",
  },
];

interface ModeState {
  /** null = not yet fetched, "" = fetched but no cache, "..." = has content */
  content: string | null;
  streaming: boolean;
  error: string | null;
}

function emptyModeState(): ModeState {
  return { content: null, streaming: false, error: null };
}

function allModes(): Record<ExplainMode, ModeState> {
  const rec = {} as Record<ExplainMode, ModeState>;
  for (const { key } of MODES) rec[key] = emptyModeState();
  return rec;
}

interface Props { bookId: number }

export default function ExplainView({ bookId }: Props) {
  const { activeChapterId, chapters } = useBookReader();
  const [activeMode, setActiveMode] = useState<ExplainMode>("story");
  const [modeStates, setModeStates] = useState<Record<ExplainMode, ModeState>>(allModes);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [exportingLLM, setExportingLLM] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Track ongoing abort controllers per mode so we can cancel streams
  const abortRefs = useRef<Partial<Record<ExplainMode, AbortController>>>({});

  const activeChapter = chapters.find((c) => c.id === activeChapterId);
  const ms = modeStates[activeMode];

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function patchMode(mode: ExplainMode, patch: Partial<ModeState>) {
    setModeStates((prev) => ({
      ...prev,
      [mode]: { ...prev[mode], ...patch },
    }));
  }

  // -------------------------------------------------------------------------
  // Fetch cached content for a single mode (non-streaming)
  // -------------------------------------------------------------------------
  async function fetchCached(mode: ExplainMode, chId: number) {
    try {
      const data = await api.explain.getCached(bookId, chId, mode);
      patchMode(mode, { content: data.content });
    } catch {
      // 404 → no cache
      patchMode(mode, { content: "" });
    }
  }

  // -------------------------------------------------------------------------
  // Stream a mode
  // -------------------------------------------------------------------------
  function streamMode(mode: ExplainMode, force = false) {
    if (!activeChapterId) return;

    // Cancel any previous stream for this mode
    abortRefs.current[mode]?.abort();
    const ctrl = new AbortController();
    abortRefs.current[mode] = ctrl;

    patchMode(mode, { content: "", streaming: true, error: null });

    const url = `/api/books/${bookId}/chapters/${activeChapterId}/explain?mode=${mode}${force ? "&force=true" : ""}`;

    streamPost(
      url,
      {},
      (delta) => {
        if (ctrl.signal.aborted) return;
        setModeStates((prev) => ({
          ...prev,
          [mode]: {
            ...prev[mode],
            content: (prev[mode].content ?? "") + delta.replace(/\\n/g, "\n"),
          },
        }));
      },
      () => {
        if (!ctrl.signal.aborted) patchMode(mode, { streaming: false });
      },
      (err) => {
        if (!ctrl.signal.aborted) patchMode(mode, { streaming: false, error: err.message });
      },
    );
  }

  // -------------------------------------------------------------------------
  // Chapter changes → reset all states, load modes list, fetch active mode
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Abort all ongoing streams
    for (const ctrl of Object.values(abortRefs.current)) ctrl?.abort();
    abortRefs.current = {};

    setActiveMode("story");
    setModeStates(allModes());

    if (!activeChapterId) return;

    const chId = activeChapterId;

    // Fetch which modes are cached
    api.explain.getModes(bookId, chId).then(({ cached_modes }) => {
      setModeStates((prev) => {
        const next = { ...prev };
        for (const { key } of MODES) {
          if (key in cached_modes) {
            // Mark as cached but don't load content yet (lazy)
            next[key] = { ...next[key], content: null };
          }
        }
        return next;
      });
    }).catch(() => {});

    // Load story mode content immediately
    fetchCached("story", chId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapterId, bookId]);

  // -------------------------------------------------------------------------
  // Tab click → fetch content if not yet loaded
  // -------------------------------------------------------------------------
  function handleTabClick(mode: ExplainMode) {
    setActiveMode(mode);
    if (activeChapterId && modeStates[mode].content === null && !modeStates[mode].streaming) {
      fetchCached(mode, activeChapterId);
    }
  }

  // -------------------------------------------------------------------------
  // Generate All — stream all modes where content is "" or null (not streaming)
  // -------------------------------------------------------------------------
  function handleGenerateAll() {
    for (const { key } of MODES) {
      const s = modeStates[key];
      if (!s.streaming && !s.content) {
        streamMode(key, false);
      }
    }
  }

  // -------------------------------------------------------------------------
  // LLM Context Export
  // -------------------------------------------------------------------------
  const handleExportLLM = async () => {
    if (!activeChapterId || !activeChapter) return;
    setExportingLLM(true);
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
      const activeContent = ms.content;
      if (activeContent) {
        lines.push(SEP, `## DEEP EXPLANATION (${activeMode})`, activeContent, "");
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

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------
  const hasContent = Boolean(ms.content);
  const anyStreaming = MODES.some(({ key }) => modeStates[key].streaming);
  const canExport = hasContent && !ms.streaming;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-5 pt-4 pb-3 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {activeChapter && (
              <p className="text-xs text-stone-400 dark:text-stone-500 truncate max-w-[200px]">
                {activeChapter.index + 1}. {activeChapter.title}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
            {activeChapterId && (
              <button
                onClick={handleGenerateAll}
                disabled={anyStreaming || !activeChapterId}
                className="px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 disabled:opacity-40 text-stone-600 dark:text-stone-400 text-xs font-medium transition-colors whitespace-nowrap"
              >
                Generate All
              </button>
            )}
            {canExport && (
              <button
                onClick={() => streamMode(activeMode, true)}
                className="px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-400 text-xs font-medium transition-colors whitespace-nowrap"
              >
                Re-explain
              </button>
            )}
            {canExport && (
              <button
                onClick={() => setShowPdfModal(true)}
                className="px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-400 text-xs font-medium transition-colors whitespace-nowrap"
              >
                PDF
              </button>
            )}
            {canExport && (
              <button
                onClick={handleExportLLM}
                disabled={exportingLLM}
                className="px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 disabled:opacity-40 text-stone-600 dark:text-stone-400 text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5"
              >
                {exportingLLM && (
                  <div className="h-2.5 w-2.5 border border-stone-400 border-t-transparent rounded-full animate-spin" />
                )}
                {exportingLLM ? "Gathering…" : "Export .txt"}
              </button>
            )}
          </div>
        </div>

        {/* Mode tabs */}
        {activeChapterId && (
          <div className="relative mt-3">
            <div className="flex items-center gap-1 flex-wrap pr-7">
              {MODES.map(({ key, label }) => {
                const s = modeStates[key];
                const isCurrent = key === activeMode;
                const isStreaming = s.streaming;
                const isCached = Boolean(s.content);

                let indicator: React.ReactNode;
                if (isStreaming) {
                  indicator = (
                    <span className="inline-block h-2.5 w-2.5 border border-amber-500 border-t-transparent rounded-full animate-spin" />
                  );
                } else if (isCached) {
                  indicator = <span className="text-emerald-500 leading-none">●</span>;
                } else {
                  indicator = <span className="text-stone-300 dark:text-stone-600 leading-none">○</span>;
                }

                return (
                  <button
                    key={key}
                    onClick={() => handleTabClick(key)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      isCurrent
                        ? "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300"
                        : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                    }`}
                  >
                    {indicator}
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Single info button */}
            <button
              onClick={() => setShowGuide((v) => !v)}
              className={`absolute right-0 top-0 h-6 w-6 flex items-center justify-center rounded-md text-xs transition-colors ${
                showGuide
                  ? "bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-200"
                  : "text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-600 dark:hover:text-stone-300"
              }`}
              title="When to use each mode"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5a.75.75 0 1 1 0 1.5A.75.75 0 0 1 8 5zm-.75 2.75a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0v-3z" />
              </svg>
            </button>

            {/* Guide popover */}
            {showGuide && (
              <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-stone-900 dark:bg-stone-800 border border-stone-700 dark:border-stone-600 rounded-xl shadow-xl p-4 space-y-3.5">
                {MODE_GUIDE.map(({ label, when, examples }) => (
                  <div key={label}>
                    <p className="text-[11px] font-semibold text-amber-400 mb-0.5">{label}</p>
                    <p className="text-[11px] text-stone-300 leading-relaxed">{when}</p>
                    <p className="text-[10px] text-stone-500 mt-0.5 italic">{examples}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Output */}
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
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
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
              No explanation generated yet for this mode.
            </p>
            <button
              onClick={() => streamMode(activeMode)}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 text-white text-xs font-medium transition-colors"
            >
              Generate
            </button>
          </div>
        )}
        {activeChapterId && ms.content === null && !ms.streaming && (
          <div className="flex items-center gap-2 text-stone-400 dark:text-stone-600 text-xs mt-4">
            <div className="h-2.5 w-2.5 border border-stone-300 border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        )}
      </div>

      {/* PDF export modal */}
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
