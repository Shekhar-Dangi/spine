"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useBookReader } from "@/contexts/BookReaderContext";

interface Props {
  bookId: number;
  onCollapse?: () => void;
}

export default function ReaderPanel({ bookId, onCollapse }: Props) {
  const { chapters, setChapters, activeChapterId, setActiveChapterId, setSelectedText } =
    useBookReader();
  const [chapterText, setChapterText] = useState<string>("");
  const [loadingText, setLoadingText] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load chapter list on mount
  useEffect(() => {
    api.books.chapters(bookId).then(setChapters).catch(console.error);
  }, [bookId, setChapters]);

  // Load text when active chapter changes
  useEffect(() => {
    if (activeChapterId === null) return;
    setLoadingText(true);
    setChapterText("");
    setError(null);
    api.books
      .chapterText(bookId, activeChapterId)
      .then(({ text }) => setChapterText(text))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingText(false));
  }, [bookId, activeChapterId]);

  // Capture text selection
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length > 10) setSelectedText(sel);
  }, [setSelectedText]);

  const activeChapter = chapters.find((c) => c.id === activeChapterId);

  return (
    <div className="h-full flex flex-col bg-stone-50 dark:bg-stone-950">
      {/* Chapter selector */}
      <div className="shrink-0 flex items-center border-b border-stone-200 dark:border-stone-800 px-3 sm:px-5 py-3 bg-white dark:bg-stone-900/50 gap-2">
        {/* Home link — desktop only (mobile has top bar) */}
        <Link
          href="/"
          title="Back to Library"
          className="hidden md:flex shrink-0 items-center gap-1 text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300 transition-colors pr-1"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
            <path d="M1 7L8 1l7 6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 7v7a1 1 0 0 0 1 1h3v-4h4v4h3a1 1 0 0 0 1-1V7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        {onCollapse && (
          <div className="hidden md:block h-4 w-px bg-stone-200 dark:bg-stone-700 shrink-0" />
        )}
        <select
          value={activeChapterId ?? ""}
          onChange={(e) => setActiveChapterId(e.target.value ? Number(e.target.value) : null)}
          className="flex-1 bg-transparent text-sm text-stone-700 dark:text-stone-300 outline-none cursor-pointer min-w-0"
        >
          <option value="">— Select a chapter —</option>
          {chapters.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.index + 1}. {ch.title}
            </option>
          ))}
        </select>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse reader"
            className="shrink-0 p-1.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
      </div>

      {/* Chapter text */}
      <div
        className="flex-1 overflow-y-auto px-5 sm:px-10 py-6 sm:py-8 text-[15px] sm:text-[16px] leading-[1.85] text-stone-700 dark:text-stone-300 select-text"
        onMouseUp={handleMouseUp}
      >
        {!activeChapterId && (
          <p className="text-stone-400 dark:text-stone-600 text-sm mt-12 text-center">
            Select a chapter to begin reading.
          </p>
        )}
        {loadingText && (
          <p className="text-stone-400 dark:text-stone-600 text-sm mt-12 text-center">Loading…</p>
        )}
        {error && (
          <p className="text-red-500 dark:text-red-400 text-sm mt-12 text-center">{error}</p>
        )}
        {chapterText && !loadingText && (
          <article className="max-w-[65ch]">
            <h2 className="font-serif text-xl sm:text-2xl text-stone-900 dark:text-stone-100 mb-6 sm:mb-8 leading-tight">
              {activeChapter?.title}
            </h2>
            {chapterText.split("\n\n").map((para, i) => (
              <p key={i} className="mb-5">
                {para}
              </p>
            ))}
          </article>
        )}
      </div>

      {/* Selection hint — hidden on mobile to save space */}
      <div className="hidden sm:block shrink-0 border-t border-stone-200 dark:border-stone-800 px-5 py-2 text-xs text-stone-400 dark:text-stone-600 bg-white dark:bg-stone-900/30">
        Highlight text and switch to Q&amp;A to ask a grounded question.
      </div>
    </div>
  );
}
