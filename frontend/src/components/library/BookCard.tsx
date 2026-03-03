"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Book } from "@/types";

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  uploaded:           { label: "Uploaded",   dot: "bg-stone-400",   text: "text-stone-500 dark:text-stone-400" },
  parsing:            { label: "Parsing…",   dot: "bg-amber-500 animate-pulse", text: "text-amber-600 dark:text-amber-400" },
  pending_toc_review: { label: "Review TOC", dot: "bg-sky-500",     text: "text-sky-600 dark:text-sky-400" },
  ingesting:          { label: "Indexing…",  dot: "bg-amber-500 animate-pulse", text: "text-amber-600 dark:text-amber-400" },
  ready:              { label: "Ready",       dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  failed:             { label: "Failed",      dot: "bg-red-500",     text: "text-red-500 dark:text-red-400" },
};

interface Props {
  book: Book;
  onChanged: () => void;
}

export default function BookCard({ book, onChanged }: Props) {
  const status = STATUS_CONFIG[book.ingest_status] ?? {
    label: book.ingest_status,
    dot: "bg-stone-400",
    text: "text-stone-500",
  };
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [resettingToc, setResettingToc] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingMeta, setEditingMeta] = useState(false);

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
      className={`group relative rounded-xl border bg-white dark:bg-stone-900 p-5 h-full transition-colors
        ${cardHref
          ? "border-stone-200 dark:border-stone-800 hover:border-amber-400 dark:hover:border-amber-600 cursor-pointer shadow-sm hover:shadow-md"
          : "border-stone-200 dark:border-stone-800 cursor-default shadow-sm"
        }`}
    >
      {/* Action buttons — top-right, revealed on hover */}
      <div className="absolute top-3 right-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleEditClick}
          title="Edit metadata"
          className="w-7 h-7 flex items-center justify-center text-stone-400 hover:text-amber-600 dark:hover:text-amber-400 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors text-sm"
          aria-label="Edit book metadata"
        >
          ✎
        </button>
        {(book.ingest_status === "ready" || book.ingest_status === "failed") && (
          <button
            onClick={handleResetToc}
            disabled={resettingToc}
            title="Reset TOC & re-parse"
            className="w-7 h-7 flex items-center justify-center text-stone-400 hover:text-amber-600 dark:hover:text-amber-400 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors text-sm disabled:opacity-50"
            aria-label="Reset TOC"
          >
            {resettingToc ? "…" : "↺"}
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deleting}
          title="Delete book"
          className="w-7 h-7 flex items-center justify-center text-stone-400 hover:text-red-500 dark:hover:text-red-400 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors text-xs disabled:opacity-50"
          aria-label="Delete book"
        >
          {deleting ? "…" : "✕"}
        </button>
      </div>

      <p className="font-medium text-stone-900 dark:text-stone-100 truncate pr-14 leading-snug">
        {book.title}
      </p>
      {book.author && (
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 truncate">
          {book.author}
        </p>
      )}

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-stone-100 dark:border-stone-800">
        <span className="text-[10px] uppercase tracking-widest text-stone-400 dark:text-stone-600 font-mono">
          {book.format}
        </span>
        {book.page_count != null && (
          <span className="text-[10px] text-stone-400 dark:text-stone-600">
            {book.page_count}p
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} />
          <span className={`text-xs font-medium ${status.text}`}>
            {status.label}
          </span>
        </div>
      </div>

      {book.ingest_status === "failed" && (
        <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800 flex items-start justify-between gap-2">
          <p className="text-xs text-red-500 dark:text-red-400 leading-4 flex-1">
            {book.ingest_error ?? "Unknown error"}
          </p>
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="shrink-0 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline disabled:opacity-50 transition-colors"
          >
            {retrying ? "Retrying…" : "Retry embed"}
          </button>
        </div>
      )}

      {actionError && (
        <p className="text-xs text-red-500 dark:text-red-400 mt-2">{actionError}</p>
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline metadata edit modal
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
    if (!title.trim()) {
      setError("Title cannot be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.books.update(book.id, {
        title: title.trim(),
        author: author.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl p-6 w-full max-w-sm space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
      >
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
          Edit Book Metadata
        </h3>

        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 transition-colors"
            autoFocus
          />
        </div>

        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">Author</label>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Optional"
            className="w-full bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 transition-colors"
          />
        </div>

        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
