"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import ThemeToggle from "@/components/ui/ThemeToggle";
import GlobalSearch from "@/components/search/GlobalSearch";
import type { Suggestion } from "@/types";

const TYPE_LABELS: Record<string, string> = {
  new_node: "New concept",
  enrich_node: "Enrich existing",
  new_edge: "New relationship",
  merge_node: "Merge",
  alias: "Alias",
  historical_tag: "Historical tag",
};

const TYPE_COLORS: Record<string, string> = {
  new_node: "bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-400",
  enrich_node: "bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400",
  new_edge: "bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400",
  merge_node: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400",
  alias: "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400",
  historical_tag: "bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400",
};

const NODE_TYPE_COLORS: Record<string, string> = {
  concept: "text-sky-600 dark:text-sky-400",
  person: "text-violet-600 dark:text-violet-400",
  event: "text-amber-600 dark:text-amber-400",
  place: "text-emerald-600 dark:text-emerald-400",
  era: "text-rose-600 dark:text-rose-400",
};

export default function ReviewPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"pending" | "rejected">("pending");
  const [acting, setActing] = useState<Record<number, string>>({});

  const loadSuggestions = (s = statusFilter) => {
    setLoading(true);
    api.knowledge
      .listSuggestions({ status: s, limit: 100 })
      .then((data) => setSuggestions(data.suggestions))
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const act = async (id: number, action: "approve" | "reject" | "dismiss") => {
    setActing((prev) => ({ ...prev, [id]: action }));
    try {
      if (action === "approve") await api.knowledge.approveSuggestion(id);
      else if (action === "reject") await api.knowledge.rejectSuggestion(id);
      else await api.knowledge.dismissSuggestion(id);
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // silent — leave card in place
    } finally {
      setActing((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const pendingCount = suggestions.length;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      {/* Header */}
      <header className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/90 dark:bg-stone-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-serif italic text-base text-stone-900 dark:text-stone-100 tracking-tight">
              Spine
            </Link>
            <span className="text-stone-300 dark:text-stone-700 text-sm">·</span>
            <span className="text-sm text-stone-600 dark:text-stone-400">Review</span>
            {statusFilter === "pending" && pendingCount > 0 && (
              <span className="text-xs bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                {pendingCount}
              </span>
            )}
          </div>
          <nav className="flex items-center gap-0.5">
            <Link href="/" className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800">
              Library
            </Link>
            <Link href="/notes" className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800">
              Notes
            </Link>
            <Link href="/ask" className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800">
              Ask
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

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 mb-6">
          {(["pending", "rejected"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                statusFilter === s
                  ? "bg-stone-200 dark:bg-stone-700 text-stone-800 dark:text-stone-200"
                  : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-sm text-stone-400 dark:text-stone-600 text-center py-16">Loading…</div>
        ) : suggestions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-stone-400 dark:text-stone-600 text-sm mb-2">
              {statusFilter === "pending" ? "No pending suggestions." : "No rejected suggestions."}
            </p>
            {statusFilter === "pending" && (
              <p className="text-stone-400 dark:text-stone-600 text-xs leading-relaxed max-w-sm mx-auto">
                Open a note and click "Extract knowledge" to generate suggestions from your notes.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                acting={acting[s.id]}
                showApprove={statusFilter === "pending"}
                showReject={statusFilter === "pending"}
                showDismiss
                onApprove={() => act(s.id, "approve")}
                onReject={() => act(s.id, "reject")}
                onDismiss={() => act(s.id, "dismiss")}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuggestionCard
// ---------------------------------------------------------------------------

function SuggestionCard({
  suggestion,
  acting,
  showApprove,
  showReject,
  showDismiss,
  onApprove,
  onReject,
  onDismiss,
}: {
  suggestion: Suggestion;
  acting?: string;
  showApprove: boolean;
  showReject: boolean;
  showDismiss: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDismiss: () => void;
}) {
  const p = suggestion.payload;
  const isNode = suggestion.type === "new_node";
  const isEdge = suggestion.type === "new_edge";

  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4">
      {/* Type badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TYPE_COLORS[suggestion.type] ?? ""}`}>
          {TYPE_LABELS[suggestion.type] ?? suggestion.type}
        </span>
        <span className="text-[10px] text-stone-400 dark:text-stone-600">
          {new Date(suggestion.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>

      {/* Payload summary */}
      {isNode && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${NODE_TYPE_COLORS[String(p.type)] ?? "text-stone-500"}`}>
              {String(p.type)}
            </span>
            <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
              {String(p.name)}
            </span>
          </div>
          {Boolean(p.description) && (
            <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
              {String(p.description)}
            </p>
          )}
          {Array.isArray(p.aliases) && p.aliases.length > 0 && (
            <p className="text-[11px] text-stone-400 dark:text-stone-600 mt-1">
              Also known as: {(p.aliases as string[]).join(", ")}
            </p>
          )}
        </div>
      )}

      {suggestion.type === "enrich_node" && (
        <div className="mb-3">
          <p className="text-sm font-medium text-stone-800 dark:text-stone-200 mb-1">
            {String(p.name)}
          </p>
          {Boolean(p.description) && (
            <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed mb-1">
              <span className="text-stone-400 dark:text-stone-600 text-[10px] uppercase tracking-wide mr-1">Description</span>
              {String(p.description)}
            </p>
          )}
          {Array.isArray(p.aliases) && p.aliases.length > 0 && (
            <p className="text-[11px] text-stone-400 dark:text-stone-600">
              <span className="text-[10px] uppercase tracking-wide mr-1">New aliases</span>
              {(p.aliases as string[]).join(", ")}
            </p>
          )}
        </div>
      )}

      {isEdge && (
        <div className="mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
              {String(p.from_name)}
            </span>
            <span className="text-xs text-stone-400 dark:text-stone-500 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full">
              {String(p.relation)}
            </span>
            <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
              {String(p.to_name)}
            </span>
          </div>
        </div>
      )}

      {suggestion.type === "merge_node" && (
        <div className="mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
              {String(p.source_node_name)}
            </span>
            <span className="text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full">
              merge into
            </span>
            <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
              {String(p.into_node_name)}
            </span>
          </div>
          {p.similarity != null && (
            <p className="text-[11px] text-stone-400 mt-1">
              Similarity: {(Number(p.similarity as number) * 100).toFixed(0)}%
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {showApprove && (
          <button
            onClick={onApprove}
            disabled={!!acting}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            {acting === "approve" ? "…" : "Approve"}
          </button>
        )}
        {showReject && (
          <button
            onClick={onReject}
            disabled={!!acting}
            className="px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-400 text-xs font-medium disabled:opacity-50 transition-colors"
          >
            {acting === "reject" ? "…" : "Reject"}
          </button>
        )}
        {showDismiss && (
          <button
            onClick={onDismiss}
            disabled={!!acting}
            className="ml-auto px-2.5 py-1.5 rounded-lg text-stone-400 dark:text-stone-600 hover:text-stone-600 dark:hover:text-stone-400 text-xs transition-colors"
          >
            {acting === "dismiss" ? "…" : "Dismiss"}
          </button>
        )}
      </div>
    </div>
  );
}
