"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SearchResult } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<SearchResult["source_type"], string> = {
  book: "Book",
  note: "Note",
  source_doc: "Source",
};

const SOURCE_BADGE: Record<SearchResult["source_type"], string> = {
  book:       "bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400",
  note:       "bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-400",
  source_doc: "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400",
};

function jumpHref(r: SearchResult): string | null {
  if (r.source_type === "note" && r.meta.note_id != null)
    return `/notes/${r.meta.note_id}`;
  // source_doc: navigate to originating note if available
  if (r.source_type === "source_doc") {
    const noteId = r.meta.origin_ref?.note_id;
    if (noteId != null) return `/notes/${noteId}`;
  }
  return null;
}

function resultContext(r: SearchResult): string | null {
  if (r.source_type === "book" && r.chapter_title)
    return `${r.title} · ${r.chapter_title}`;
  if (r.source_type === "book")
    return r.title;
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when overlay opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQuery("");
      setResults([]);
      setActiveIdx(-1);
    }
  }, [open]);

  // Debounced search
  const runSearch = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.search.query(q, 15);
        setResults(data.results);
        setActiveIdx(-1);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 320);
  }, []);

  const handleChange = (v: string) => {
    setQuery(v);
    runSearch(v);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    }
    if (e.key === "Enter" && activeIdx >= 0) {
      navigate(results[activeIdx]);
    }
  };

  const navigate = (r: SearchResult) => {
    const href = jumpHref(r);
    setOpen(false);
    if (href) router.push(href);
    // book and unlinked source_doc: close overlay only (no navigation)
  };

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="p-1.5 rounded-md text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm">
          <div
            ref={overlayRef}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-xl mx-4 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-2xl overflow-hidden"
          >
            {/* Input row */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-200 dark:border-stone-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-stone-400 dark:text-stone-500 shrink-0"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => handleChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search books, notes, and sources…"
                className="flex-1 bg-transparent text-sm text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 outline-none"
              />
              {loading && (
                <svg
                  className="animate-spin shrink-0 text-stone-400 dark:text-stone-500"
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-stone-400 dark:text-stone-600 hover:text-stone-600 dark:hover:text-stone-400 transition-colors"
              >
                Esc
              </button>
            </div>

            {/* Results */}
            {results.length > 0 && (
              <ul className="max-h-96 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800">
                {results.map((r, i) => {
                  const href = jumpHref(r);
                  const isActive = i === activeIdx;
                  return (
                    <li key={i}>
                      <button
                        className={`w-full text-left px-4 py-3 transition-colors ${
                          isActive
                            ? "bg-stone-100 dark:bg-stone-800"
                            : "hover:bg-stone-50 dark:hover:bg-stone-800/60"
                        }`}
                        onClick={() => navigate(r)}
                        onMouseEnter={() => setActiveIdx(i)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${SOURCE_BADGE[r.source_type]}`}
                          >
                            {SOURCE_LABEL[r.source_type]}
                          </span>
                          <span className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate flex-1">
                            {resultContext(r) ?? r.title}
                          </span>
                          {href != null && (
                            <span className="ml-auto text-[10px] text-sky-500 dark:text-sky-400 shrink-0">
                              open →
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 leading-relaxed">
                          {r.excerpt}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Empty state */}
            {!loading && query.trim() && results.length === 0 && (
              <p className="px-4 py-5 text-sm text-stone-400 dark:text-stone-600 text-center">
                No results for &ldquo;{query}&rdquo;
              </p>
            )}

            {/* Idle state */}
            {!query.trim() && (
              <p className="px-4 py-5 text-xs text-stone-400 dark:text-stone-600 text-center">
                Semantic search across books, notes, and sources
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
