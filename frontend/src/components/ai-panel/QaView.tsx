"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ExtractionJob } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { api, streamPost } from "@/lib/api";
import { useBookReader } from "@/contexts/BookReaderContext";
import type { ConversationMessage } from "@/types";

interface Props { bookId: number }

export default function QaView({ bookId }: Props) {
  const { activeChapterId, selectedText, setSelectedText } = useBookReader();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load persisted messages when chapter changes
  useEffect(() => {
    if (!activeChapterId) { setMessages([]); return; }
    api.qa.getConversation(bookId, activeChapterId)
      .then((data) => setMessages(data.messages))
      .catch(() => setMessages([]));
  }, [bookId, activeChapterId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingQuestion, streamingContent]);

  // Reset select mode when chapter changes
  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [activeChapterId]);

  const handleAsk = () => {
    if (!question.trim() || !activeChapterId || loading) return;

    const q = question.trim();
    setQuestion("");
    setError(null);
    setStreamingContent("");
    setPendingQuestion(q);
    setLoading(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    streamPost(
      `/api/books/${bookId}/qa`,
      { chapter_id: activeChapterId, selected_text: selectedText, question: q },
      (delta) => {
        if (ctrl.signal.aborted) return;
        setStreamingContent((prev) => (prev ?? "") + delta.replace(/\\n/g, "\n"));
      },
      () => {
        if (ctrl.signal.aborted) return;
        setStreamingContent(null);
        setLoading(false);
        setSelectedText("");
        setPendingQuestion(null);
        api.qa.getConversation(bookId, activeChapterId)
          .then((data) => setMessages(data.messages))
          .catch(() => {});
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setError(err.message);
        setStreamingContent(null);
        setPendingQuestion(null);
        setLoading(false);
      },
      ctrl.signal,
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreamingContent(null);
    setPendingQuestion(null);
    setLoading(false);
  };

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  };

  const toggleSelectId = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header toolbar — only when messages exist */}
      {messages.length > 0 && (
        <div className="shrink-0 flex items-center justify-end px-5 pt-3 pb-1 gap-2">
          <button
            onClick={toggleSelectMode}
            className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors ${
              selectMode
                ? "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400"
                : "text-stone-400 dark:text-stone-600 hover:text-stone-700 dark:hover:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
            }`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        </div>
      )}

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && !streamingContent && (
          <p className="text-xs text-stone-400 dark:text-stone-600 mt-2 leading-relaxed">
            {activeChapterId
              ? "No questions yet for this chapter. Ask anything below."
              : "Open a chapter to start asking questions."}
          </p>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            bookId={bookId}
            selectMode={selectMode}
            selected={selectedIds.has(msg.id)}
            onToggleSelect={() => toggleSelectId(msg.id)}
          />
        ))}

        {pendingQuestion !== null && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-amber-600 dark:bg-amber-700 px-4 py-2.5 text-sm text-white leading-6">
              {pendingQuestion}
            </div>
          </div>
        )}

        {streamingContent !== null && (
          <div className="flex gap-2.5">
            <div className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-[8px] text-stone-500 dark:text-stone-400 font-bold tracking-wide">
              AI
            </div>
            <div className="flex-1 text-sm text-stone-700 dark:text-stone-300 leading-7 prose prose-sm prose-stone dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {streamingContent}
              </ReactMarkdown>
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-amber-500 animate-pulse rounded-sm align-middle" />
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-500 dark:text-red-400 text-xs">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Multi-select save bar */}
      {selectMode && selectedIds.size > 0 && (
        <MultiSaveBar
          bookId={bookId}
          selectedIds={selectedIds}
          onDone={() => { setSelectMode(false); setSelectedIds(new Set()); }}
        />
      )}

      {/* Input area */}
      {!selectMode && (
        <div className="shrink-0 border-t border-stone-200 dark:border-stone-800 px-5 py-3 space-y-2 bg-stone-50 dark:bg-stone-900/50">
          {selectedText && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 text-xs text-stone-600 dark:text-stone-400 leading-5 relative">
              <p className="line-clamp-2 italic pr-5">"{selectedText}"</p>
              <button
                onClick={() => setSelectedText("")}
                className="absolute top-1.5 right-2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                aria-label="Clear selection"
              >
                ✕
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleAsk()}
              placeholder={selectedText ? "Ask about the selection…" : "Ask about this chapter…"}
              disabled={!activeChapterId || loading}
              className="flex-1 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 disabled:opacity-50 transition-colors"
            />
            {loading ? (
              <button
                onClick={handleStop}
                className="px-4 py-2 rounded-lg bg-red-100 hover:bg-red-200 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-medium transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleAsk}
                disabled={!question.trim() || !activeChapterId}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
              >
                Ask
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MessageBubble — renders one message with optional save action
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  bookId,
  selectMode,
  selected,
  onToggleSelect,
}: {
  msg: ConversationMessage;
  bookId: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [extractionJob, setExtractionJob] = useState<ExtractionJob | null>(null);
  const extractPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (extractPollRef.current) clearInterval(extractPollRef.current); };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.notes.saveQaTurn(bookId, msg.id, titleInput.trim() || undefined);
      setSaved(true);
      setShowForm(false);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // silent — keep form open
    } finally {
      setSaving(false);
    }
  };

  // Extract is independent — uses message content directly, no note required
  const handleExtract = async () => {
    if (!msg.content || extractionJob) return;
    try {
      const job = await api.knowledge.triggerExtraction({ content: msg.content });
      setExtractionJob(job);
      const poll = setInterval(async () => {
        try {
          const updated = await api.knowledge.getJob(job.id);
          setExtractionJob(updated);
          if (updated.status === "completed" || updated.status === "failed") {
            clearInterval(poll);
          }
        } catch {
          clearInterval(poll);
        }
      }, 2000);
      extractPollRef.current = poll;
    } catch {
      // silent
    }
  };

  if (msg.role === "user") {
    return (
      <div className="flex justify-end items-start gap-2">
        {selectMode && (
          <button
            onClick={onToggleSelect}
            className={`mt-1 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
              selected
                ? "bg-amber-600 border-amber-600"
                : "border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800"
            }`}
          >
            {selected && (
              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
                <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-amber-600 dark:bg-amber-700 px-4 py-2.5 text-sm text-white leading-6">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-2.5">
      {selectMode && (
        <button
          onClick={onToggleSelect}
          className={`mt-1 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
            selected
              ? "bg-amber-600 border-amber-600"
              : "border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-800"
          }`}
        >
          {selected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
              <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      )}
      <div className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-[8px] text-stone-500 dark:text-stone-400 font-bold tracking-wide">
        AI
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-stone-700 dark:text-stone-300 leading-7 prose prose-sm prose-stone dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {msg.content}
          </ReactMarkdown>
        </div>

        {/* Save + Extract — independent actions */}
        {!selectMode && (
          <div className="mt-1">
            {showForm ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowForm(false); }}
                  placeholder="Title (optional)"
                  className="flex-1 min-w-0 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded px-2 py-1 text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500"
                />
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-medium disabled:opacity-50 transition-colors"
                >
                  {saving ? "…" : "Save"}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-2 py-1 text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {/* Save to note */}
                {saved ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Saved ✓</span>
                ) : (
                  <button
                    onClick={() => setShowForm(true)}
                    className="opacity-0 group-hover:opacity-100 text-[11px] text-stone-400 dark:text-stone-600 hover:text-amber-600 dark:hover:text-amber-400 transition-all flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.8">
                      <path d="M3 2h10a1 1 0 0 1 1 1v10.5l-5-2.5-5 2.5V3a1 1 0 0 1 1-1z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Save to notes
                  </button>
                )}
                {/* Extract — independent, uses content directly */}
                {extractionJob ? (
                  <span className={`text-[11px] ${
                    extractionJob.status === "completed" ? "text-emerald-600 dark:text-emerald-400" :
                    extractionJob.status === "failed" ? "text-red-500 dark:text-red-400" :
                    "text-sky-600 dark:text-sky-400"
                  }`}>
                    {extractionJob.status === "pending" && "Pending…"}
                    {extractionJob.status === "running" && "Extracting…"}
                    {extractionJob.status === "completed" && (
                      extractionJob.suggestion_count === 0
                        ? "Nothing found"
                        : <Link href="/review" className="underline hover:text-emerald-700 dark:hover:text-emerald-300">
                            {extractionJob.suggestion_count ?? "…"} suggestion{extractionJob.suggestion_count !== 1 ? "s" : ""} →
                          </Link>
                    )}
                    {extractionJob.status === "failed" && "Failed"}
                  </span>
                ) : (
                  <button
                    onClick={handleExtract}
                    className="opacity-0 group-hover:opacity-100 text-[11px] text-stone-400 dark:text-stone-600 hover:text-sky-600 dark:hover:text-sky-400 transition-all flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="5" cy="5" r="2.5"/><circle cx="11" cy="5" r="2.5"/><circle cx="8" cy="12" r="2.5"/>
                      <path d="M5 7.5v1.5l3 1.5M11 7.5v1.5l-3 1.5" strokeLinecap="round"/>
                    </svg>
                    Extract
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MultiSaveBar — shown when messages are selected in select mode
// ---------------------------------------------------------------------------

function MultiSaveBar({
  bookId,
  selectedIds,
  onDone,
}: {
  bookId: number;
  selectedIds: Set<number>;
  onDone: () => void;
}) {
  const [titleInput, setTitleInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.notes.saveMultipleQaTurns(bookId, Array.from(selectedIds), titleInput.trim() || undefined);
      setSaved(true);
      setTimeout(onDone, 1500);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 px-5 py-3 space-y-2">
      {saved ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 text-center">Saved {selectedIds.size} messages as note ✓</p>
      ) : (
        <>
          <p className="text-xs text-stone-600 dark:text-stone-400">
            {selectedIds.size} message{selectedIds.size !== 1 ? "s" : ""} selected
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="Note title (optional)"
              className="flex-1 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-1.5 text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save to Notes"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
