"use client";
/**
 * TocEditor — loads extracted chapters, lets the user edit, then confirms.
 * Polls for PENDING_TOC_REVIEW status if book is still parsing.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Book, TocChapter } from "@/types";

interface Props {
  bookId: number;
}

export default function TocEditor({ bookId }: Props) {
  const router = useRouter();
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<TocChapter[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuggest, setShowSuggest] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const b = await api.books.get(bookId);
        setBook(b);
        if (b.ingest_status === "pending_toc_review") {
          if (pollRef.current) clearInterval(pollRef.current);
          const chs = await api.books.chapters(bookId);
          setChapters(chs);
        } else if (b.ingest_status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(`Parsing failed: ${b.ingest_error ?? "unknown error"}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load book.");
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };

    check();
    pollRef.current = setInterval(check, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [bookId]);

  const update = (i: number, patch: Partial<TocChapter>) =>
    setChapters((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const add = () =>
    setChapters((prev) => [
      ...prev,
      {
        index: prev.length,
        title: `Chapter ${prev.length + 1}`,
        start_page: null,
        end_page: null,
        start_anchor: null,
        end_anchor: null,
        confirmed: false,
      },
    ]);

  const remove = (i: number) =>
    setChapters((prev) =>
      prev.filter((_, idx) => idx !== i).map((c, idx) => ({ ...c, index: idx })),
    );

  const handleConfirm = async () => {
    if (chapters.length === 0) {
      setError("Add at least one chapter.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.books.confirmToc(bookId, chapters);
      router.push(`/books/${bookId}/reader`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirmation failed.");
      setSubmitting(false);
    }
  };

  // Still parsing / ingesting
  if (!book || (book.ingest_status !== "pending_toc_review" && book.ingest_status !== "failed")) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-stone-400 dark:text-stone-600">
        <div className="h-6 w-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Parsing book structure…</p>
      </div>
    );
  }

  const warnings: string[] = book.ingest_quality_json
    ? (JSON.parse(book.ingest_quality_json).warnings ?? [])
    : [];

  const isPdf = book.format === "pdf";

  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-4 py-3 text-xs text-amber-700 dark:text-amber-300 space-y-1">
          <p className="font-semibold">Warnings from parser:</p>
          {warnings.map((w, i) => (
            <p key={i}>• {w}</p>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* LLM Suggest Panel — PDF only */}
      {isPdf && (
        <div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowSuggest((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
          >
            <span className="font-medium text-stone-600 dark:text-stone-400">
              ✦ Suggest TOC from PDF page
            </span>
            <span className="text-stone-400 dark:text-stone-600 text-xs">
              {showSuggest ? "▲" : "▼"}
            </span>
          </button>
          {showSuggest && (
            <div className="border-t border-stone-200 dark:border-stone-800">
              <SuggestPanel
                bookId={bookId}
                onSuggested={(suggested) => {
                  setChapters(suggested);
                  setShowSuggest(false);
                }}
              />
            </div>
          )}
        </div>
      )}

      {chapters.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 py-12 text-center text-stone-400 dark:text-stone-600 text-sm">
          No chapters detected — use "Suggest TOC" above or add them manually below.
        </div>
      )}

      {chapters.map((ch, i) => (
        <ChapterRow
          key={i}
          chapter={ch}
          isPdf={isPdf}
          onChange={(patch) => update(i, patch)}
          onRemove={() => remove(i)}
        />
      ))}

      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={add}
          className="text-sm text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline underline-offset-2 transition-colors"
        >
          + Add chapter
        </button>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-stone-400 dark:text-stone-600">
            {chapters.length} chapter{chapters.length !== 1 ? "s" : ""}
          </span>
          <button
            onClick={handleConfirm}
            disabled={submitting || chapters.length === 0}
            className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {submitting ? "Confirming…" : "Confirm & Index"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LLM Suggest Panel
// ---------------------------------------------------------------------------

function SuggestPanel({
  bookId,
  onSuggested,
}: {
  bookId: number;
  onSuggested: (chapters: TocChapter[]) => void;
}) {
  const [tocPageStart, setTocPageStart] = useState("");
  const [tocPageEnd, setTocPageEnd] = useState("");
  const [offset, setOffset] = useState("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSuggest = async () => {
    const startNum = parseInt(tocPageStart, 10);
    const endNum = tocPageEnd ? parseInt(tocPageEnd, 10) : undefined;
    const offsetNum = parseInt(offset, 10) || 0;
    if (!startNum || startNum < 1) {
      setError("Enter a valid start page number.");
      return;
    }
    if (endNum !== undefined && endNum < startNum) {
      setError("End page must be ≥ start page.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { chapters } = await api.books.suggestToc(bookId, startNum, offsetNum, endNum);
      if (chapters.length === 0) {
        setError("LLM found no chapters on those pages. Try different page numbers.");
        setLoading(false);
        return;
      }
      onSuggested(
        chapters.map((ch) => ({
          index: ch.index,
          title: ch.title,
          start_page: ch.start_page,
          end_page: ch.end_page,
          start_anchor: ch.start_anchor,
          end_anchor: ch.end_anchor,
          confirmed: false,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggestion failed.");
      setLoading(false);
    }
  };

  const inputClass =
    "bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-1.5 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 transition-colors";

  return (
    <div className="px-4 py-4 space-y-3">
      <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
        Enter the PDF page range that shows the table of contents. If the TOC fits on one page,
        leave the end page blank. The{" "}
        <strong className="text-stone-600 dark:text-stone-300">page offset</strong> corrects for
        front-matter — e.g. if chapter 1 is labeled "page 1" but is on PDF page 13, set offset to{" "}
        <code className="text-stone-600 dark:text-stone-300">12</code>.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1">
            TOC start page
          </label>
          <input
            type="number"
            min={1}
            value={tocPageStart}
            onChange={(e) => setTocPageStart(e.target.value)}
            placeholder="e.g. 5"
            className={`w-24 ${inputClass}`}
          />
        </div>
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1">
            End page <span className="opacity-50">(optional)</span>
          </label>
          <input
            type="number"
            min={1}
            value={tocPageEnd}
            onChange={(e) => setTocPageEnd(e.target.value)}
            placeholder="e.g. 7"
            className={`w-24 ${inputClass}`}
          />
        </div>
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1">
            Page offset
          </label>
          <input
            type="number"
            min={0}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            placeholder="0"
            className={`w-20 ${inputClass}`}
          />
        </div>
        <button
          onClick={handleSuggest}
          disabled={loading}
          className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
              Asking LLM…
            </span>
          ) : (
            "Suggest"
          )}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chapter Row
// ---------------------------------------------------------------------------

interface RowProps {
  chapter: TocChapter;
  isPdf: boolean;
  onChange: (patch: Partial<TocChapter>) => void;
  onRemove: () => void;
}

function ChapterRow({ chapter, isPdf, onChange, onRemove }: RowProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-4 py-3 transition-colors hover:border-stone-300 dark:hover:border-stone-700">
      <span className="text-xs text-stone-400 dark:text-stone-600 font-mono w-5 text-right shrink-0">
        {chapter.index + 1}
      </span>

      <input
        type="text"
        value={chapter.title}
        onChange={(e) => onChange({ title: e.target.value })}
        className="flex-1 bg-transparent text-sm text-stone-900 dark:text-stone-100 border-b border-transparent focus:border-amber-500 dark:focus:border-amber-400 outline-none py-0.5 min-w-0 placeholder-stone-300 dark:placeholder-stone-600 transition-colors"
        placeholder="Chapter title"
      />

      {isPdf && (
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            value={chapter.start_page ?? ""}
            onChange={(e) => onChange({ start_page: e.target.value ? Number(e.target.value) : null })}
            className="w-14 bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded px-2 py-1 text-xs text-stone-600 dark:text-stone-400 text-center outline-none focus:border-amber-500 transition-colors"
            placeholder="p.start"
          />
          <span className="text-stone-400 dark:text-stone-600 text-xs">–</span>
          <input
            type="number"
            value={chapter.end_page ?? ""}
            onChange={(e) => onChange({ end_page: e.target.value ? Number(e.target.value) : null })}
            className="w-14 bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded px-2 py-1 text-xs text-stone-600 dark:text-stone-400 text-center outline-none focus:border-amber-500 transition-colors"
            placeholder="p.end"
          />
        </div>
      )}

      {!isPdf && chapter.start_anchor && (
        <span className="text-xs text-stone-400 dark:text-stone-600 font-mono truncate max-w-[100px] shrink-0">
          {chapter.start_anchor}
        </span>
      )}

      <button
        onClick={onRemove}
        className="text-stone-300 dark:text-stone-700 hover:text-red-500 dark:hover:text-red-400 transition-colors text-sm shrink-0"
        aria-label="Remove"
      >
        ✕
      </button>
    </div>
  );
}
