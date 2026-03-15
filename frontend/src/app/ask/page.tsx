"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { api, streamPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import ThemeToggle from "@/components/ui/ThemeToggle";
import GlobalSearch from "@/components/search/GlobalSearch";
import type { AskScope, Book } from "@/types";

const SCOPE_CONFIG: Record<AskScope, { label: string; description: string }> = {
  whole_library: {
    label: "Whole library",
    description: "Search across all your books",
  },
  current_book: {
    label: "One book",
    description: "Search within a specific book",
  },
  notes: {
    label: "Notes",
    description: "Search across your saved notes",
  },
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AskPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [scope, setScope] = useState<AskScope>("whole_library");
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api.books.list()
      .then((data) => {
        const ready = data.filter((b) => b.ingest_status === "ready");
        setBooks(ready);
        if (ready.length > 0) setSelectedBookId(ready[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingQuestion, streamingContent]);

  const handleAsk = () => {
    if (!question.trim() || loading) return;
    if (scope === "current_book" && !selectedBookId) return;

    const q = question.trim();
    setQuestion("");
    setError(null);
    setStreamingContent("");
    setPendingQuestion(q);
    setLoading(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let accumulated = "";

    streamPost(
      "/api/ask",
      {
        question: q,
        scope,
        book_id: scope === "current_book" ? selectedBookId : null,
      },
      (delta) => {
        if (ctrl.signal.aborted) return;
        accumulated += delta.replace(/\\n/g, "\n");
        setStreamingContent(accumulated);
      },
      () => {
        if (ctrl.signal.aborted) return;
        setMessages((prev) => [
          ...prev,
          { role: "user", content: q },
          { role: "assistant", content: accumulated },
        ]);
        setStreamingContent(null);
        setPendingQuestion(null);
        setLoading(false);
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

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/90 dark:bg-stone-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-serif italic text-base text-stone-900 dark:text-stone-100 tracking-tight">
              Spine
            </Link>
            <span className="text-stone-300 dark:text-stone-700 text-sm">·</span>
            <span className="text-sm text-stone-600 dark:text-stone-400">Ask</span>
          </div>
          <nav className="flex items-center gap-0.5">
            <Link href="/" className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800">
              Library
            </Link>
            <Link href="/notes" className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800">
              Notes
            </Link>
            <Link href="/review" className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800">
              Review
            </Link>
            <Link href="/explore" className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800">
              Explore
            </Link>
            {user && (
              <button
                onClick={handleLogout}
                className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                Sign out
              </button>
            )}
            <GlobalSearch />
            <ThemeToggle />
          </nav>
        </div>
      </header>

      {/* Scope selector */}
      <div className="border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-stone-500 dark:text-stone-400 font-medium">Search in:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(Object.keys(SCOPE_CONFIG) as AskScope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  scope === s
                    ? "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-700"
                    : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-300"
                }`}
              >
                {SCOPE_CONFIG[s].label}
              </button>
            ))}
          </div>

          {/* Book selector — shown when scope = current_book */}
          {scope === "current_book" && (
            <select
              value={selectedBookId ?? ""}
              onChange={(e) => setSelectedBookId(e.target.value ? Number(e.target.value) : null)}
              className="ml-1 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-2.5 py-1 text-xs text-stone-700 dark:text-stone-300 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
            >
              <option value="">Select a book…</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Chat thread */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 space-y-6">
          {messages.length === 0 && !streamingContent && (
            <div className="text-center py-16">
              <p className="text-stone-400 dark:text-stone-600 text-sm mb-2">
                Ask anything across your {SCOPE_CONFIG[scope].label.toLowerCase()}.
              </p>
              <p className="text-stone-300 dark:text-stone-700 text-xs">
                {SCOPE_CONFIG[scope].description}
              </p>
            </div>
          )}

          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-amber-600 dark:bg-amber-700 px-4 py-2.5 text-sm text-white leading-6">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-[8px] text-stone-500 dark:text-stone-400 font-bold">
                  AI
                </div>
                <div className="flex-1 prose prose-sm prose-stone dark:prose-invert max-w-none leading-7 text-stone-700 dark:text-stone-300">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            )
          )}

          {pendingQuestion !== null && (
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-amber-600 dark:bg-amber-700 px-4 py-2.5 text-sm text-white leading-6">
                {pendingQuestion}
              </div>
            </div>
          )}

          {streamingContent !== null && (
            <div className="flex gap-3">
              <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-[8px] text-stone-500 dark:text-stone-400 font-bold">
                AI
              </div>
              <div className="flex-1 prose prose-sm prose-stone dark:prose-invert max-w-none leading-7 text-stone-700 dark:text-stone-300">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {streamingContent}
                </ReactMarkdown>
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-amber-500 animate-pulse rounded-sm align-middle" />
              </div>
            </div>
          )}

          {error && (
            <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/30 px-4 sm:px-8 py-4">
        <div className="max-w-3xl mx-auto flex gap-3">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleAsk()}
            placeholder={`Ask across your ${SCOPE_CONFIG[scope].label.toLowerCase()}…`}
            disabled={loading || (scope === "current_book" && !selectedBookId)}
            className="flex-1 bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-xl px-4 py-2.5 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 disabled:opacity-50 transition-colors"
          />
          {loading ? (
            <button
              onClick={handleStop}
              className="px-4 py-2.5 rounded-xl bg-red-100 hover:bg-red-200 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-sm font-medium transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleAsk}
              disabled={!question.trim() || (scope === "current_book" && !selectedBookId)}
              className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
            >
              Ask
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
