"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import ThemeToggle from "@/components/ui/ThemeToggle";
import type { Note, NoteOriginType } from "@/types";

const ORIGIN_LABELS: Record<NoteOriginType, string> = {
  standalone: "Standalone",
  passage_anchor: "Passage",
  explain_turn: "Explain",
  qa_turn: "Q&A",
};

const ORIGIN_COLORS: Record<NoteOriginType, string> = {
  standalone: "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400",
  passage_anchor: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400",
  explain_turn: "bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-400",
  qa_turn: "bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400",
};

export default function NotesPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const loadNotes = (s = search, f = filterType) => {
    setLoading(true);
    api.notes
      .list({ search: s || undefined, origin_type: f || undefined, limit: 100 })
      .then((data) => setNotes(data.notes))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (v: string) => {
    setSearch(v);
    loadNotes(v, filterType);
  };

  const handleFilter = (v: string) => {
    setFilterType(v);
    loadNotes(search, v);
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const note = await api.notes.create({ content: "Start writing…" });
      router.push(`/notes/${note.id}`);
    } catch {
      setCreating(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/90 dark:bg-stone-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-8 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-serif italic text-base text-stone-900 dark:text-stone-100 tracking-tight">
              Spine
            </Link>
            <span className="text-stone-300 dark:text-stone-700 text-sm">·</span>
            <span className="text-sm text-stone-600 dark:text-stone-400">Notes</span>
          </div>
          <nav className="flex items-center gap-0.5">
            <Link
              href="/"
              className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Library
            </Link>
            <Link
              href="/settings"
              className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Settings
            </Link>
            {user && (
              <button
                onClick={handleLogout}
                className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                Sign out
              </button>
            )}
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search notes…"
            className="flex-1 bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 transition-colors"
          />
          <select
            value={filterType}
            onChange={(e) => handleFilter(e.target.value)}
            className="bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-700 dark:text-stone-300 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 cursor-pointer"
          >
            <option value="">All types</option>
            <option value="standalone">Standalone</option>
            <option value="passage_anchor">Passage</option>
            <option value="explain_turn">Explain</option>
            <option value="qa_turn">Q&A</option>
          </select>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap"
          >
            {creating ? "Creating…" : "New Note"}
          </button>
        </div>

        {/* Notes grid */}
        {loading ? (
          <div className="text-sm text-stone-400 dark:text-stone-600 text-center py-16">
            Loading…
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-stone-400 dark:text-stone-600 text-sm mb-4">
              {search || filterType ? "No notes match your search." : "No notes yet."}
            </p>
            {!search && !filterType && (
              <p className="text-stone-400 dark:text-stone-600 text-xs leading-relaxed max-w-sm mx-auto">
                Save insights from Q&amp;A and Explain chats, or highlight passages while reading. They all appear here.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {notes.map((note) => (
              <NoteCard key={note.id} note={note} formatDate={formatDate} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function NoteCard({ note, formatDate }: { note: Note; formatDate: (s: string) => string }) {
  const preview = note.content.replace(/^#+\s*/gm, "").replace(/\*\*/g, "").trim();
  const lines = preview.split("\n").filter(Boolean);
  const snippet = lines.slice(0, 3).join(" ").slice(0, 160);

  return (
    <Link
      href={`/notes/${note.id}`}
      className="block bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-stone-900 dark:text-stone-100 line-clamp-1 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors">
          {note.title || "Untitled"}
        </h3>
        {note.origin_type && (
          <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ORIGIN_COLORS[note.origin_type]}`}>
            {ORIGIN_LABELS[note.origin_type]}
          </span>
        )}
      </div>
      <p className="text-xs text-stone-500 dark:text-stone-500 leading-relaxed line-clamp-3">
        {snippet || "—"}
      </p>
      <p className="text-[11px] text-stone-400 dark:text-stone-600 mt-3">
        {formatDate(note.updated_at)}
      </p>
    </Link>
  );
}
