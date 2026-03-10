"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { api } from "@/lib/api";
import ThemeToggle from "@/components/ui/ThemeToggle";
import type { Note } from "@/types";

const ORIGIN_LABELS: Record<string, string> = {
  standalone: "Standalone",
  passage_anchor: "Passage",
  explain_turn: "Explain chat",
  qa_turn: "Q&A chat",
};

export default function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const router = useRouter();
  const id = Number(noteId);

  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Edit state
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [editingContent, setEditingContent] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Links state
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [addingLink, setAddingLink] = useState(false);

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    api.notes
      .get(id)
      .then((data) => {
        setNote(data);
        setTitle(data.title ?? "");
        setContent(data.content);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const saveField = useCallback(
    async (field: "title" | "content", value: string) => {
      if (!note) return;
      setSaving(true);
      setSaveError(null);
      try {
        const updated = await api.notes.update(note.id, { [field]: value });
        setNote(updated);
      } catch {
        setSaveError("Save failed — check your connection.");
      } finally {
        setSaving(false);
      }
    },
    [note],
  );

  // Auto-save content after 800ms idle
  const handleContentChange = (val: string) => {
    setContent(val);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveField("content", val), 800);
  };

  const handleTitleBlur = () => {
    setEditingTitle(false);
    if (title !== (note?.title ?? "")) saveField("title", title);
  };

  const handleAddLink = async () => {
    const targetId = Number(linkInput.trim());
    if (!targetId || isNaN(targetId) || !note) return;
    setAddingLink(true);
    setLinkError(null);
    try {
      await api.notes.addLink(note.id, targetId);
      const updated = await api.notes.get(note.id);
      setNote(updated);
      setLinkInput("");
    } catch {
      setLinkError("Could not add link — check the note ID.");
    } finally {
      setAddingLink(false);
    }
  };

  const handleRemoveLink = async (toId: number) => {
    if (!note) return;
    try {
      await api.notes.removeLink(note.id, toId);
      const updated = await api.notes.get(note.id);
      setNote(updated);
    } catch {
      // silent
    }
  };

  const handleDelete = async () => {
    if (!note) return;
    setDeleting(true);
    try {
      await api.notes.delete(note.id);
      router.push("/notes");
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center">
        <p className="text-stone-400 dark:text-stone-600 text-sm">Loading…</p>
      </div>
    );
  }

  if (notFound || !note) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col items-center justify-center gap-3">
        <p className="text-stone-500 dark:text-stone-400 text-sm">Note not found.</p>
        <Link href="/notes" className="text-sm text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300">
          ← Back to Notes
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      {/* Header */}
      <header className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/90 dark:bg-stone-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/notes"
              className="text-stone-400 dark:text-stone-600 hover:text-stone-700 dark:hover:text-stone-300 transition-colors shrink-0"
              title="Back to Notes"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
                <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <span className="text-xs text-stone-400 dark:text-stone-600 truncate">Notes</span>
          </div>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-[11px] text-stone-400 dark:text-stone-600">Saving…</span>
            )}
            {saveError && (
              <span className="text-[11px] text-red-500">{saveError}</span>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
        {/* Origin badge */}
        {note.origin_type && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-[11px] text-stone-400 dark:text-stone-600">
              Saved from
            </span>
            <span className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
              {ORIGIN_LABELS[note.origin_type] ?? note.origin_type}
            </span>
          </div>
        )}

        {/* Title */}
        <div className="mb-6">
          {editingTitle ? (
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => { if (e.key === "Enter") handleTitleBlur(); if (e.key === "Escape") { setTitle(note.title ?? ""); setEditingTitle(false); }}}
              className="w-full bg-transparent text-2xl sm:text-3xl font-serif text-stone-900 dark:text-stone-100 outline-none border-b border-amber-400 dark:border-amber-600 pb-1"
            />
          ) : (
            <h1
              onClick={() => setEditingTitle(true)}
              className="text-2xl sm:text-3xl font-serif text-stone-900 dark:text-stone-100 cursor-text hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
              title="Click to edit title"
            >
              {note.title || <span className="text-stone-400 dark:text-stone-600 italic">Untitled — click to add title</span>}
            </h1>
          )}
          <p className="text-[11px] text-stone-400 dark:text-stone-600 mt-1.5">
            Updated {formatDate(note.updated_at)}
          </p>
        </div>

        {/* Content */}
        <div className="mb-10">
          {editingContent ? (
            <textarea
              autoFocus
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onBlur={() => setEditingContent(false)}
              rows={Math.max(10, content.split("\n").length + 2)}
              className="w-full bg-transparent text-[15px] leading-[1.85] text-stone-700 dark:text-stone-300 outline-none border border-stone-200 dark:border-stone-800 rounded-lg px-4 py-3 resize-none font-mono focus:border-amber-400 dark:focus:border-amber-600 focus:ring-1 focus:ring-amber-400/30 transition-colors"
            />
          ) : (
            <div
              onClick={() => setEditingContent(true)}
              className="cursor-text prose prose-stone dark:prose-invert max-w-none prose-sm sm:prose-base leading-[1.85] min-h-[120px] rounded-lg px-4 py-3 -mx-4 hover:bg-stone-100/50 dark:hover:bg-stone-900/50 transition-colors"
              title="Click to edit"
            >
              {content ? (
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {content}
                </ReactMarkdown>
              ) : (
                <p className="text-stone-400 dark:text-stone-600 italic text-sm">
                  Click to start writing…
                </p>
              )}
            </div>
          )}
        </div>

        {/* Note links */}
        <section className="border-t border-stone-200 dark:border-stone-800 pt-6 mb-8">
          <h2 className="text-xs font-semibold text-stone-500 dark:text-stone-500 uppercase tracking-wider mb-4">
            Linked Notes
          </h2>

          {/* Links to */}
          {note.links_to && note.links_to.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] text-stone-400 dark:text-stone-600 mb-1.5">Links to</p>
              <div className="flex flex-wrap gap-2">
                {note.links_to.map((toId) => (
                  <div key={toId} className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 rounded-full px-2.5 py-1 text-xs text-stone-600 dark:text-stone-400">
                    <Link href={`/notes/${toId}`} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                      Note #{toId}
                    </Link>
                    <button
                      onClick={() => handleRemoveLink(toId)}
                      className="text-stone-400 hover:text-red-500 dark:hover:text-red-400 transition-colors ml-0.5"
                      title="Remove link"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Linked from */}
          {note.linked_from && note.linked_from.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] text-stone-400 dark:text-stone-600 mb-1.5">Linked from</p>
              <div className="flex flex-wrap gap-2">
                {note.linked_from.map((fromId) => (
                  <Link
                    key={fromId}
                    href={`/notes/${fromId}`}
                    className="bg-stone-100 dark:bg-stone-800 rounded-full px-2.5 py-1 text-xs text-stone-600 dark:text-stone-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                  >
                    Note #{fromId}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Add link */}
          <div className="flex items-center gap-2 mt-3">
            <input
              type="number"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
              placeholder="Link to note ID…"
              className="w-40 bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700 rounded px-2.5 py-1 text-xs text-stone-900 dark:text-stone-100 placeholder-stone-400 outline-none focus:ring-1 focus:ring-amber-500/40 focus:border-amber-500 [appearance:textfield]"
            />
            <button
              onClick={handleAddLink}
              disabled={!linkInput.trim() || addingLink}
              className="px-2.5 py-1 rounded bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 text-xs disabled:opacity-50 transition-colors"
            >
              {addingLink ? "…" : "Link"}
            </button>
            {linkError && (
              <span className="text-xs text-red-500 dark:text-red-400">{linkError}</span>
            )}
          </div>
        </section>

        {/* Danger zone */}
        <section className="border-t border-stone-200 dark:border-stone-800 pt-6">
          {confirmDelete ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-stone-600 dark:text-stone-400">Delete this note?</p>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-stone-400 dark:text-stone-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            >
              Delete note
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
