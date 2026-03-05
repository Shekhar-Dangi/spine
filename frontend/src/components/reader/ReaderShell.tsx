"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { BookReaderProvider } from "@/contexts/BookReaderContext";
import ReaderPanel from "./ReaderPanel";
import AiPanel from "@/components/ai-panel/AiPanel";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { api } from "@/lib/api";

interface Props {
  bookId: number;
}

export default function ReaderShell({ bookId }: Props) {
  const [readerCollapsed, setReaderCollapsed] = useState(false);
  const [aiWide, setAiWide] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"reader" | "ai">("reader");
  const [bookTitle, setBookTitle] = useState<string | null>(null);

  useEffect(() => {
    api.books.get(bookId).then((b) => setBookTitle(b.title)).catch(() => {});
  }, [bookId]);

  const aiWidth = readerCollapsed ? undefined : aiWide ? 640 : 440;

  return (
    <BookReaderProvider>
      <div className="flex flex-col h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 overflow-hidden">

        {/* ── Mobile top bar (hidden on md+) ── */}
        <div className="md:hidden shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
          <Link
            href="/"
            className="shrink-0 flex items-center gap-1 text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors py-1 pr-2"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
              <path d="M10 13H6V9H4l4-4 4 4h-2v4z" strokeLinejoin="round" />
              <path d="M2 7V14h12V7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-xs font-medium">Library</span>
          </Link>
          <div className="h-4 w-px bg-stone-200 dark:bg-stone-700" />
          <p className="flex-1 text-xs font-medium text-stone-600 dark:text-stone-400 truncate">
            {bookTitle ?? "Loading…"}
          </p>
          <ThemeToggle />
        </div>

        {/* ── Mobile panel switcher ── */}
        <div className="md:hidden shrink-0 flex border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
          <button
            onClick={() => setMobilePanel("reader")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
              mobilePanel === "reader"
                ? "text-amber-700 dark:text-amber-400 border-b-2 border-amber-600 dark:border-amber-500"
                : "text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"
            }`}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <rect x="1" y="1" width="12" height="12" rx="1" />
              <path d="M4 4h6M4 7h6M4 10h4" strokeLinecap="round" />
            </svg>
            Read
          </button>
          <button
            onClick={() => setMobilePanel("ai")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
              mobilePanel === "ai"
                ? "text-amber-700 dark:text-amber-400 border-b-2 border-amber-600 dark:border-amber-500"
                : "text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"
            }`}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3">
              <circle cx="7" cy="7" r="6" />
              <path d="M5 5.5C5 4.4 5.9 3.5 7 3.5s2 .9 2 2c0 1.5-2 2-2 3.5" strokeLinecap="round" />
              <circle cx="7" cy="11" r=".5" fill="currentColor" />
            </svg>
            AI
          </button>
        </div>

        {/* ── Mobile content ── */}
        <div className="md:hidden flex-1 overflow-hidden">
          {mobilePanel === "reader" ? (
            <ReaderPanel bookId={bookId} />
          ) : (
            <AiPanel bookId={bookId} />
          )}
        </div>

        {/* ── Desktop layout (hidden on mobile) ── */}
        <div className="hidden md:flex flex-1 overflow-hidden">
          {readerCollapsed ? (
            /* Collapsed strip */
            <div className="w-11 shrink-0 flex flex-col items-center border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/50 py-3 gap-1">
              {/* Home */}
              <Link
                href="/"
                title="Back to Library"
                className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
                  <path d="M1 7L8 1l7 6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 7v7a1 1 0 0 0 1 1h3v-4h4v4h3a1 1 0 0 0 1-1V7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <div className="h-px w-5 bg-stone-200 dark:bg-stone-700 my-0.5" />
              {/* Restore reader */}
              <button
                onClick={() => setReaderCollapsed(false)}
                title="Restore reader"
                className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          ) : (
            /* Reader panel */
            <div className="flex-1 overflow-hidden border-r border-stone-200 dark:border-stone-800 min-w-0">
              <ReaderPanel bookId={bookId} onCollapse={() => setReaderCollapsed(true)} />
            </div>
          )}

          {/* AI panel */}
          <div
            className="shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
            style={readerCollapsed ? { flex: 1 } : { width: aiWidth }}
          >
            <AiPanel
              bookId={bookId}
              aiWide={aiWide}
              onToggleWide={() => setAiWide((w) => !w)}
              readerCollapsed={readerCollapsed}
            />
          </div>
        </div>

      </div>
    </BookReaderProvider>
  );
}
