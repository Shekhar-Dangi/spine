"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Book } from "@/types";

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string; border: string }> = {
  uploaded:           { label: "Uploaded",    dot: "bg-stone-400",               text: "text-stone-500 dark:text-stone-400",     border: "border-l-stone-300 dark:border-l-stone-700" },
  parsing:            { label: "Parsing…",    dot: "bg-amber-400 animate-pulse", text: "text-amber-600 dark:text-amber-400",     border: "border-l-amber-400 dark:border-l-amber-600" },
  pending_toc_review: { label: "Review TOC",  dot: "bg-sky-500",                 text: "text-sky-600 dark:text-sky-400",          border: "border-l-sky-400 dark:border-l-sky-500" },
  ingesting:          { label: "Indexing…",   dot: "bg-amber-400 animate-pulse", text: "text-amber-600 dark:text-amber-400",     border: "border-l-amber-400 dark:border-l-amber-600" },
  ready:              { label: "Ready",        dot: "bg-emerald-500",             text: "text-emerald-600 dark:text-emerald-400", border: "border-l-emerald-500 dark:border-l-emerald-600" },
  failed:             { label: "Failed",       dot: "bg-red-500",                 text: "text-red-500 dark:text-red-400",          border: "border-l-red-400 dark:border-l-red-600" },
};

interface Props {
  book: Book;
  onChanged: () => void;
}

// ---------------------------------------------------------------------------
// History migration modal
// ---------------------------------------------------------------------------

function MigrateHistoryModal({
  book,
  onClose,
}: {
  book: Book;
  onClose: () => void;
}) {
  const [includeQa, setIncludeQa] = useState(true);
  const [includeExplain, setIncludeExplain] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!includeQa && !includeExplain) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.notes.migrateHistory(book.id, includeQa, includeExplain);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl p-5 w-full max-w-sm space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">Import reading history</h3>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 leading-relaxed">
            Save past conversations from <span className="font-medium text-stone-700 dark:text-stone-300">{book.title}</span> as notes. Already-saved turns are skipped.
          </p>
        </div>

        {result ? (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400 space-y-0.5">
            <p>{result.created} note{result.created !== 1 ? "s" : ""} created</p>
            {result.skipped > 0 && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-500">{result.skipped} already saved — skipped</p>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={includeQa}
                  onChange={(e) => setIncludeQa(e.target.checked)}
                  className="w-3.5 h-3.5 accent-amber-600 cursor-pointer"
                />
                <span className="text-sm text-stone-700 dark:text-stone-300">Q&amp;A conversations</span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={includeExplain}
                  onChange={(e) => setIncludeExplain(e.target.checked)}
                  className="w-3.5 h-3.5 accent-amber-600 cursor-pointer"
                />
                <span className="text-sm text-stone-700 dark:text-stone-300">Deep Explain chats</span>
              </label>
            </div>

            {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleRun}
                disabled={running || (!includeQa && !includeExplain)}
                className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {running ? "Importing…" : "Import"}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 text-sm hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {result && (
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 text-sm hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

export default function BookCard({ book, onChanged }: Props) {
  const status = STATUS_CONFIG[book.ingest_status] ?? {
    label: book.ingest_status,
    dot: "bg-stone-400",
    text: "text-stone-500",
    border: "border-l-stone-300 dark:border-l-stone-700",
  };

  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [resettingToc, setResettingToc] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);
  const [migratingHistory, setMigratingHistory] = useState(false);

  const cardHref =
    book.ingest_status === "pending_toc_review"
      ? `/books/${book.id}/toc-review`
      : book.ingest_status === "ready"
        ? `/books/${book.id}/reader`
        : null;

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${book.title}"? This removes all chapters, chats, and indexed data permanently.`)) return;
    setDeleting(true);
    setActionError(null);
    try {
      await api.books.delete(book.id);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed.");
      setDeleting(false);
    }
  };

  const handleRetry = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRetrying(true);
    setActionError(null);
    try {
      await api.books.retryEmbed(book.id);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Retry failed.");
      setRetrying(false);
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingMeta(true);
  };

  const handleResetToc = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Reset TOC for "${book.title}"? This will wipe all chapters, embeddings, and cached explanations and re-parse the file.`)) return;
    setResettingToc(true);
    setActionError(null);
    try {
      await api.books.resetToc(book.id);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Reset failed.");
      setResettingToc(false);
    }
  };

  const inner = (
    <div
      className={`group relative flex flex-col rounded-lg border-l-2 border border-stone-100 dark:border-stone-800/60 bg-white dark:bg-stone-900 px-4 py-3.5 h-full transition-all
        ${status.border}
        ${cardHref
          ? "hover:border-stone-200 dark:hover:border-stone-700 hover:shadow-sm"
          : ""
        }`}
    >
      {/* Action buttons — top-right, revealed on hover */}
      <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {book.ingest_status === "ready" && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMigratingHistory(true); }}
            title="Import reading history as notes"
            className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-amber-600 dark:hover:text-amber-400 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
            aria-label="Import reading history as notes"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 2h10a1 1 0 0 1 1 1v10.5l-5-2.5-5 2.5V3a1 1 0 0 1 1-1z"/>
            </svg>
          </button>
        )}
        <button
          onClick={handleEditClick}
          title="Edit metadata"
          className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          aria-label="Edit book metadata"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.5 2.5a1.5 1.5 0 0 1 2.1 2.1L5 13.2l-3 .8.8-3 8.7-8.5z"/>
          </svg>
        </button>
        {(book.ingest_status === "ready" || book.ingest_status === "failed") && (
          <button
            onClick={handleResetToc}
            disabled={resettingToc}
            title="Reset TOC & re-parse"
            className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-40"
            aria-label="Reset TOC"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8a6 6 0 1 1 1.5 4"/><path d="M2 12V8h4"/>
            </svg>
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deleting}
          title="Delete book"
          className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-40"
          aria-label="Delete book"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/>
          </svg>
        </button>
      </div>

      {/* Title + author */}
      <div className="flex-1 min-w-0 pr-16">
        <p className="text-sm font-medium text-stone-900 dark:text-stone-100 leading-snug line-clamp-2">
          {book.title}
        </p>
        {book.author && (
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 truncate">
            {book.author}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800">
        <span className="text-[10px] uppercase tracking-widest text-stone-300 dark:text-stone-700 font-mono">
          {book.format}
        </span>
        {book.page_count != null && (
          <span className="text-[10px] text-stone-300 dark:text-stone-700">
            {book.page_count}p
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} />
          <span className={`text-xs font-medium ${status.text}`}>
            {status.label}
          </span>
        </div>
      </div>

      {book.ingest_status === "failed" && (
        <div className="mt-2.5 pt-2.5 border-t border-stone-100 dark:border-stone-800 flex items-start justify-between gap-2">
          <p className="text-xs text-red-500 dark:text-red-400 leading-4 flex-1 line-clamp-2">
            {book.ingest_error ?? "Unknown error"}
          </p>
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="shrink-0 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 underline disabled:opacity-50 transition-colors"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {actionError && (
        <p className="text-xs text-red-500 dark:text-red-400 mt-2 line-clamp-2">{actionError}</p>
      )}
    </div>
  );

  return (
    <>
      {cardHref ? (
        <Link href={cardHref} className="block h-full">
          {inner}
        </Link>
      ) : (
        <div className="h-full">{inner}</div>
      )}

      {editingMeta && (
        <EditMetaModal
          book={book}
          onClose={() => setEditingMeta(false)}
          onSaved={() => {
            setEditingMeta(false);
            onChanged();
          }}
        />
      )}
      {migratingHistory && (
        <MigrateHistoryModal
          book={book}
          onClose={() => setMigratingHistory(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

function EditMetaModal({
  book,
  onClose,
  onSaved,
}: {
  book: Book;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError("Title cannot be empty."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.books.update(book.id, { title: title.trim(), author: author.trim() || undefined });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl p-5 w-full max-w-sm space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
      >
        <h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">Edit book</h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600 transition-colors"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1">Author</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Optional"
              className="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600 transition-colors"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-stone-50 dark:text-stone-900 text-sm font-medium hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 text-sm hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
