"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import ThemeToggle from "@/components/ui/ThemeToggle";
import GlobalSearch from "@/components/search/GlobalSearch";
import type {
  EvidenceItem,
  KnowledgeEdge,
  KnowledgeGraphResponse,
  KnowledgeNode,
  KnowledgeNodeType,
  NodeSourceItem,
} from "@/types";

// Load graph canvas without SSR (canvas APIs require browser)
const GraphCanvas = dynamic(() => import("./GraphCanvas"), { ssr: false });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_TYPES: KnowledgeNodeType[] = ["concept", "person", "event", "place", "era"];

const NODE_TYPE_COLOR: Record<string, string> = {
  concept: "text-sky-600 dark:text-sky-400",
  person: "text-violet-600 dark:text-violet-400",
  event: "text-amber-600 dark:text-amber-400",
  place: "text-emerald-600 dark:text-emerald-400",
  era: "text-rose-600 dark:text-rose-400",
};

const NODE_TYPE_BG: Record<string, string> = {
  concept: "bg-sky-100 dark:bg-sky-950/50",
  person: "bg-violet-100 dark:bg-violet-950/50",
  event: "bg-amber-100 dark:bg-amber-950/50",
  place: "bg-emerald-100 dark:bg-emerald-950/50",
  era: "bg-rose-100 dark:bg-rose-950/50",
};

type Tab = "graph" | "timeline" | "places";

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ExplorePage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("graph");
  const [graph, setGraph] = useState<KnowledgeGraphResponse>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<KnowledgeNodeType | null>(null);
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  // Enriched node detail fetched from GET /nodes/{id} (includes evidence + quotes)
  const [nodeDetail, setNodeDetail] = useState<(KnowledgeNode & { edges: KnowledgeEdge[] }) | null>(null);

  // Node creation modal state
  const [showCreate, setShowCreate] = useState(false);

  // Edit state (inline in detail panel)
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    type: string;
    description: string;
    aliases: string;
  }>({ name: "", type: "concept", description: "", aliases: "" });

  // Add edge state
  const [showAddEdge, setShowAddEdge] = useState(false);
  const [edgeForm, setEdgeForm] = useState({ to_node_id: "", relation: "" });
  const [edgeError, setEdgeError] = useState("");

  const loadGraph = useCallback(() => {
    setLoading(true);
    api.knowledge
      .getGraph()
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], edges: [] }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Fetch enriched node detail (with evidence + quotes) whenever selection changes
  useEffect(() => {
    if (!selectedNodeId) {
      setNodeDetail(null);
      return;
    }
    api.knowledge.getNode(selectedNodeId).then(setNodeDetail).catch(() => {});
  }, [selectedNodeId]);

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  // ---------------------------------------------------------------------------
  // Filtered views
  // ---------------------------------------------------------------------------

  const filteredNodes = graph.nodes.filter((n) => {
    if (typeFilter && n.type !== typeFilter) return false;
    if (search && !n.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));

  const filteredEdges = graph.edges.filter(
    (e) => filteredNodeIds.has(e.from_node_id) && filteredNodeIds.has(e.to_node_id),
  );

  const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const selectedNodeEdges = selectedNode
    ? graph.edges.filter(
        (e) => e.from_node_id === selectedNode.id || e.to_node_id === selectedNode.id,
      )
    : [];

  // ---------------------------------------------------------------------------
  // Node detail helpers
  // ---------------------------------------------------------------------------

  const openEdit = (node: KnowledgeNode) => {
    setEditForm({
      name: node.name,
      type: node.type,
      description: node.description ?? "",
      aliases: node.aliases.join(", "),
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selectedNode) return;
    try {
      await api.knowledge.updateNode(selectedNode.id, {
        name: editForm.name.trim() || undefined,
        type: editForm.type,
        description: editForm.description.trim() || null,
        aliases: editForm.aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      });
      setEditing(false);
      loadGraph();
    } catch {
      // silent
    }
  };

  const deleteNode = async (nodeId: number) => {
    if (!confirm("Delete this node and all its edges?")) return;
    try {
      await api.knowledge.deleteNode(nodeId);
      setSelectedNodeId(null);
      loadGraph();
    } catch {
      // silent
    }
  };

  const deleteEdge = async (edgeId: number) => {
    if (!confirm("Remove this relationship?")) return;
    try {
      await api.knowledge.deleteEdge(edgeId);
      loadGraph();
    } catch {
      // silent
    }
  };

  const submitAddEdge = async () => {
    if (!selectedNode) return;
    const toId = parseInt(edgeForm.to_node_id);
    if (isNaN(toId)) {
      setEdgeError("Enter a valid node ID.");
      return;
    }
    const relation = edgeForm.relation.trim();
    if (!relation) {
      setEdgeError("Enter a relation label.");
      return;
    }
    try {
      await api.knowledge.createEdge(selectedNode.id, { to_node_id: toId, relation });
      setShowAddEdge(false);
      setEdgeForm({ to_node_id: "", relation: "" });
      setEdgeError("");
      loadGraph();
    } catch (e) {
      setEdgeError(e instanceof Error ? e.message : "Failed to create edge.");
    }
  };

  // ---------------------------------------------------------------------------
  // Timeline helpers
  // ---------------------------------------------------------------------------

  const eraNodes = graph.nodes.filter((n) => n.type === "era");
  const eventNodes = graph.nodes.filter((n) => n.type === "event");
  const placeNodes = graph.nodes.filter((n) => n.type === "place");

  const nodeById = (id: number) => graph.nodes.find((n) => n.id === id);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      {/* Header */}
      <header className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/90 dark:bg-stone-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="font-serif italic text-base text-stone-900 dark:text-stone-100 tracking-tight"
            >
              Spine
            </Link>
            <span className="text-stone-300 dark:text-stone-700 text-sm">·</span>
            <span className="text-sm text-stone-600 dark:text-stone-400">Explore</span>
          </div>
          <nav className="flex items-center gap-0.5">
            {(
              [
                ["/", "Library"],
                ["/notes", "Notes"],
                ["/ask", "Ask"],
                ["/review", "Review"],
              ] as const
            ).map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                {label}
              </Link>
            ))}
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

      {/* Toolbar */}
      <div className="border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-10 flex items-center justify-between gap-4">
          {/* Tabs */}
          <div className="flex items-center gap-0.5">
            {(["graph", "timeline", "places"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                  tab === t
                    ? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
                    : "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800/50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {/* Stats + create */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-400 dark:text-stone-600 hidden sm:block">
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </span>
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs px-2.5 py-1 rounded-md bg-stone-900 dark:bg-stone-100 text-stone-50 dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-300 transition-colors font-medium"
            >
              + Node
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex gap-4" style={{ minHeight: "calc(100vh - 88px)" }}>
        {tab === "graph" && (
          <>
            {/* Left sidebar */}
            <aside className="w-56 shrink-0 flex flex-col gap-3 hidden sm:flex">
              {/* Search */}
              <input
                type="search"
                placeholder="Search nodes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400 dark:focus:ring-stone-600"
              />
              {/* Type filters */}
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => setTypeFilter(null)}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    typeFilter === null
                      ? "bg-stone-200 dark:bg-stone-700 text-stone-800 dark:text-stone-200 font-medium"
                      : "text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                  }`}
                >
                  <span>All types</span>
                  <span className="text-[10px] text-stone-400 dark:text-stone-600">
                    {graph.nodes.length}
                  </span>
                </button>
                {NODE_TYPES.map((t) => {
                  const count = graph.nodes.filter((n) => n.type === t).length;
                  return (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs capitalize transition-colors ${
                        typeFilter === t
                          ? "bg-stone-200 dark:bg-stone-700 font-medium"
                          : "hover:bg-stone-100 dark:hover:bg-stone-800"
                      }`}
                    >
                      <span className={NODE_TYPE_COLOR[t]}>{t}</span>
                      <span className="text-[10px] text-stone-400 dark:text-stone-600">{count}</span>
                    </button>
                  );
                })}
              </div>
              {/* Node list */}
              <div className="flex-1 overflow-y-auto">
                <div className="space-y-0.5">
                  {filteredNodes.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setSelectedNodeId(n.id);
                        setEditing(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                        selectedNodeId === n.id
                          ? "bg-stone-200 dark:bg-stone-700"
                          : "hover:bg-stone-100 dark:hover:bg-stone-800"
                      }`}
                    >
                      <span className={`font-medium text-[10px] uppercase tracking-wide mr-1.5 ${NODE_TYPE_COLOR[n.type]}`}>
                        {n.type[0]}
                      </span>
                      <span className="text-stone-700 dark:text-stone-300">{n.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            {/* Graph canvas */}
            <div className="flex-1 rounded-xl border border-stone-200 dark:border-stone-800 overflow-hidden bg-white dark:bg-stone-900 relative" style={{ height: "calc(100vh - 120px)" }}>
              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-stone-400 dark:text-stone-600">
                  Loading…
                </div>
              ) : (
                <GraphCanvas
                  nodes={filteredNodes}
                  edges={filteredEdges}
                  selectedNodeId={selectedNodeId}
                  onNodeClick={(id) => {
                    setSelectedNodeId(id === selectedNodeId ? null : id);
                    setEditing(false);
                    setShowAddEdge(false);
                  }}
                />
              )}
            </div>

            {/* Node detail panel */}
            {selectedNode && (
              <aside className="w-64 shrink-0 flex flex-col gap-3">
                {editing ? (
                  <EditNodeForm
                    form={editForm}
                    onChange={setEditForm}
                    onSave={saveEdit}
                    onCancel={() => setEditing(false)}
                  />
                ) : (
                  <NodeDetail
                    node={selectedNode}
                    edges={nodeDetail?.edges ?? selectedNodeEdges}
                    sources={nodeDetail?.sources ?? []}
                    nodeById={nodeById}
                    onEdit={() => openEdit(selectedNode)}
                    onDelete={() => deleteNode(selectedNode.id)}
                    onDeleteEdge={deleteEdge}
                    onSelectNode={(id) => {
                      setSelectedNodeId(id);
                      setEditing(false);
                      setShowAddEdge(false);
                    }}
                    showAddEdge={showAddEdge}
                    edgeForm={edgeForm}
                    edgeError={edgeError}
                    onToggleAddEdge={() => {
                      setShowAddEdge(!showAddEdge);
                      setEdgeError("");
                    }}
                    onEdgeFormChange={setEdgeForm}
                    onSubmitAddEdge={submitAddEdge}
                    allNodes={graph.nodes}
                  />
                )}
              </aside>
            )}
          </>
        )}

        {tab === "timeline" && (
          <TimelineView
            eraNodes={eraNodes}
            eventNodes={eventNodes}
            edges={graph.edges}
            nodeById={nodeById}
            onSelect={(id) => {
              setSelectedNodeId(id);
              setTab("graph");
            }}
          />
        )}

        {tab === "places" && (
          <PlacesView
            placeNodes={placeNodes}
            edges={graph.edges}
            nodeById={nodeById}
            onSelect={(id) => {
              setSelectedNodeId(id);
              setTab("graph");
            }}
          />
        )}
      </div>

      {/* Create node modal */}
      {showCreate && (
        <CreateNodeModal
          allNodes={graph.nodes}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadGraph();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeDetail
// ---------------------------------------------------------------------------

function NodeDetail({
  node,
  edges,
  sources,
  nodeById,
  onEdit,
  onDelete,
  onDeleteEdge,
  onSelectNode,
  showAddEdge,
  edgeForm,
  edgeError,
  onToggleAddEdge,
  onEdgeFormChange,
  onSubmitAddEdge,
  allNodes,
}: {
  node: KnowledgeNode;
  edges: KnowledgeEdge[];
  sources: NodeSourceItem[];
  nodeById: (id: number) => KnowledgeNode | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteEdge: (id: number) => void;
  onSelectNode: (id: number) => void;
  showAddEdge: boolean;
  edgeForm: { to_node_id: string; relation: string };
  edgeError: string;
  onToggleAddEdge: () => void;
  onEdgeFormChange: (v: { to_node_id: string; relation: string }) => void;
  onSubmitAddEdge: () => void;
  allNodes: KnowledgeNode[];
}) {
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 120px)" }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${NODE_TYPE_COLOR[node.type]}`}>
            {node.type}
          </span>
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 leading-snug mt-0.5">
            {node.name}
          </h2>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="text-[10px] px-2 py-1 rounded-md bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-[10px] px-2 py-1 rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
          >
            Del
          </button>
        </div>
      </div>

      {/* Aliases */}
      {node.aliases.length > 0 && (
        <p className="text-[11px] text-stone-400 dark:text-stone-600">
          Also: {node.aliases.join(", ")}
        </p>
      )}

      {/* Description */}
      {node.description && (
        <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
          {node.description}
        </p>
      )}

      {/* Metadata */}
      {node.node_metadata && Object.keys(node.node_metadata).length > 0 && (
        <div className="text-[11px] text-stone-400 dark:text-stone-600 space-y-0.5">
          {Object.entries(node.node_metadata).map(([k, v]) => (
            <div key={k}>
              <span className="font-medium">{k}:</span> {String(v)}
            </div>
          ))}
        </div>
      )}

      {/* Edges */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-600">
            Relationships ({edges.length})
          </span>
          <button
            onClick={onToggleAddEdge}
            className="text-[10px] text-stone-400 dark:text-stone-600 hover:text-stone-600 dark:hover:text-stone-400 transition-colors"
          >
            {showAddEdge ? "Cancel" : "+ Add"}
          </button>
        </div>

        {showAddEdge && (
          <div className="mb-2 space-y-1.5">
            <select
              value={edgeForm.to_node_id}
              onChange={(e) => onEdgeFormChange({ ...edgeForm, to_node_id: e.target.value })}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-stone-400"
            >
              <option value="">— select target node —</option>
              {allNodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={String(n.id)}>
                    {n.name} ({n.type})
                  </option>
                ))}
            </select>
            <input
              placeholder="Relation label (e.g. 'influenced')"
              value={edgeForm.relation}
              onChange={(e) => onEdgeFormChange({ ...edgeForm, relation: e.target.value })}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400"
            />
            {edgeError && <p className="text-[10px] text-rose-500">{edgeError}</p>}
            <button
              onClick={onSubmitAddEdge}
              className="w-full py-1.5 rounded-md bg-stone-900 dark:bg-stone-100 text-stone-50 dark:text-stone-900 text-xs font-medium hover:bg-stone-700 dark:hover:bg-stone-300 transition-colors"
            >
              Add relationship
            </button>
          </div>
        )}

        {edges.length === 0 ? (
          <p className="text-[11px] text-stone-400 dark:text-stone-600">No relationships yet.</p>
        ) : (
          <div className="space-y-2">
            {edges.map((e) => {
              const isOut = e.from_node_id === node.id;
              const other = nodeById(isOut ? e.to_node_id : e.from_node_id);
              const quotes = (e.evidence ?? []).filter((ev: EvidenceItem) => ev.quote);
              return (
                <div key={e.id}>
                  <div className="flex items-center gap-1.5 group">
                    <span className="text-[10px] text-stone-400 dark:text-stone-600 w-3 shrink-0">
                      {isOut ? "→" : "←"}
                    </span>
                    <span className="text-[10px] text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded-full">
                      {e.relation}
                    </span>
                    {other ? (
                      <button
                        onClick={() => onSelectNode(other.id)}
                        className="text-[11px] text-stone-700 dark:text-stone-300 hover:text-sky-600 dark:hover:text-sky-400 hover:underline truncate flex-1 text-left"
                      >
                        {other.name}
                      </button>
                    ) : (
                      <span className="text-[11px] text-stone-400 dark:text-stone-600 truncate flex-1">
                        #{isOut ? e.to_node_id : e.from_node_id}
                      </span>
                    )}
                    <button
                      onClick={() => onDeleteEdge(e.id)}
                      className="text-[10px] text-stone-300 dark:text-stone-700 hover:text-rose-400 dark:hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    >
                      ×
                    </button>
                  </div>
                  {quotes.map((ev: EvidenceItem) => (
                    <blockquote
                      key={ev.id}
                      className="text-[10px] italic border-l-2 border-stone-200 dark:border-stone-700 pl-2 text-stone-500 dark:text-stone-400 mt-1"
                    >
                      &ldquo;{ev.quote}&rdquo;
                      {ev.note_title && (
                        <cite className="not-italic block text-[9px] text-stone-400 mt-0.5">
                          — {ev.note_title}
                        </cite>
                      )}
                    </blockquote>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sources */}
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-600">
          Sources ({sources.length})
        </span>
        {sources.length === 0 ? (
          <p className="text-[11px] text-stone-400 dark:text-stone-600 mt-1.5">
            No source material yet. Sources appear when suggestions with quotes are approved.
          </p>
        ) : (
          <div className="mt-1.5 space-y-2">
            {sources.map((s) => (
              <NodeSourceCard key={s.id} source={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeSourceCard
// ---------------------------------------------------------------------------

function NodeSourceCard({ source }: { source: NodeSourceItem }) {
  const isNote = source.source_type === "note";
  const label = isNote ? "Note" : source.source_doc_type ?? "Source";
  const title = isNote
    ? (source.note_title ?? "Untitled note")
    : (source.source_doc_title ?? label);

  return (
    <div className="rounded-lg border border-stone-100 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 p-2.5 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
            isNote
              ? "bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400"
              : "bg-stone-200 dark:bg-stone-800 text-stone-500 dark:text-stone-400"
          }`}>
            {label}
          </span>
          <span className="text-[11px] font-medium text-stone-700 dark:text-stone-300 truncate">
            {title}
          </span>
        </div>
        {isNote && (
          <a
            href={`/notes/${source.source_id}`}
            className="text-[10px] text-sky-600 dark:text-sky-400 hover:underline shrink-0"
          >
            open →
          </a>
        )}
      </div>
      {source.excerpt && (
        <p className="text-[10px] text-stone-500 dark:text-stone-400 leading-relaxed line-clamp-3 italic border-l-2 border-stone-200 dark:border-stone-700 pl-2">
          {source.excerpt}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditNodeForm
// ---------------------------------------------------------------------------

function EditNodeForm({
  form,
  onChange,
  onSave,
  onCancel,
}: {
  form: { name: string; type: string; description: string; aliases: string };
  onChange: (v: typeof form) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl p-4 flex flex-col gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-600">
        Edit node
      </span>
      <input
        value={form.name}
        onChange={(e) => onChange({ ...form, name: e.target.value })}
        placeholder="Name"
        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
      />
      <select
        value={form.type}
        onChange={(e) => onChange({ ...form, type: e.target.value })}
        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-stone-400"
      >
        {(["concept", "person", "event", "place", "era"] as const).map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <textarea
        value={form.description}
        onChange={(e) => onChange({ ...form, description: e.target.value })}
        placeholder="Description (optional)"
        rows={3}
        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400 resize-none"
      />
      <input
        value={form.aliases}
        onChange={(e) => onChange({ ...form, aliases: e.target.value })}
        placeholder="Aliases (comma-separated)"
        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
      />
      <div className="flex gap-2">
        <button
          onClick={onSave}
          className="flex-1 py-1.5 rounded-md bg-stone-900 dark:bg-stone-100 text-stone-50 dark:text-stone-900 text-xs font-medium hover:bg-stone-700 dark:hover:bg-stone-300 transition-colors"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="flex-1 py-1.5 rounded-md bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 text-xs font-medium hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateNodeModal
// ---------------------------------------------------------------------------

function CreateNodeModal({
  allNodes,
  onClose,
  onCreated,
}: {
  allNodes: KnowledgeNode[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    type: "concept",
    description: "",
    aliases: "",
  });
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    try {
      await api.knowledge.createNode({
        name: form.name.trim(),
        type: form.type,
        description: form.description.trim() || null,
        aliases: form.aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create node.");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Create node</h2>
        <div className="flex flex-col gap-2.5">
          <input
            ref={inputRef}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Name *"
            className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-stone-400"
          >
            {(["concept", "person", "event", "place", "era"] as const).map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description (optional)"
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400 resize-none"
          />
          <input
            value={form.aliases}
            onChange={(e) => setForm({ ...form, aliases: e.target.value })}
            placeholder="Aliases (comma-separated)"
            className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={submit}
            className="flex-1 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-stone-50 dark:text-stone-900 text-sm font-medium hover:bg-stone-700 dark:hover:bg-stone-300 transition-colors"
          >
            Create
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 text-sm font-medium hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimelineView
// ---------------------------------------------------------------------------

function TimelineView({
  eraNodes,
  eventNodes,
  edges,
  nodeById,
  onSelect,
}: {
  eraNodes: KnowledgeNode[];
  eventNodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  nodeById: (id: number) => KnowledgeNode | undefined;
  onSelect: (id: number) => void;
}) {
  // Build era→events mapping via edges (event -[part_of/during/in_era]→ era)
  const eraToEvents: Record<number, KnowledgeNode[]> = {};
  const attachedEventIds = new Set<number>();

  for (const edge of edges) {
    const from = nodeById(edge.from_node_id);
    const to = nodeById(edge.to_node_id);
    if (from?.type === "event" && to?.type === "era") {
      if (!eraToEvents[to.id]) eraToEvents[to.id] = [];
      eraToEvents[to.id].push(from);
      attachedEventIds.add(from.id);
    }
  }

  const unattachedEvents = eventNodes.filter((e) => !attachedEventIds.has(e.id));

  if (eraNodes.length === 0 && eventNodes.length === 0) {
    return (
      <EmptyState
        title="No eras or events yet."
        hint="Approve suggestions of type 'era' or 'event' to populate the timeline."
      />
    );
  }

  return (
    <div className="flex-1 max-w-2xl">
      <div className="space-y-6">
        {eraNodes.map((era) => (
          <div key={era.id}>
            <div className="flex items-center gap-3 mb-2">
              <button
                onClick={() => onSelect(era.id)}
                className="text-sm font-semibold text-rose-600 dark:text-rose-400 hover:underline"
              >
                {era.name}
              </button>
              {Boolean(era.node_metadata?.period) && (
                <span className="text-xs text-stone-400 dark:text-stone-600">
                  {String(era.node_metadata.period)}
                </span>
              )}
            </div>
            {era.description && (
              <p className="text-xs text-stone-500 dark:text-stone-400 mb-2 leading-relaxed">
                {era.description}
              </p>
            )}
            {(eraToEvents[era.id] ?? []).length > 0 ? (
              <div className="ml-4 border-l-2 border-rose-200 dark:border-rose-900 pl-4 space-y-2">
                {(eraToEvents[era.id] ?? []).map((ev) => (
                  <EventCard key={ev.id} node={ev} onSelect={onSelect} />
                ))}
              </div>
            ) : (
              <p className="ml-4 text-[11px] text-stone-400 dark:text-stone-600 italic">
                No events linked to this era yet.
              </p>
            )}
          </div>
        ))}

        {unattachedEvents.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-600 mb-2">
              Events without era
            </p>
            <div className="space-y-2">
              {unattachedEvents.map((ev) => (
                <EventCard key={ev.id} node={ev} onSelect={onSelect} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EventCard({ node, onSelect }: { node: KnowledgeNode; onSelect: (id: number) => void }) {
  return (
    <button
      onClick={() => onSelect(node.id)}
      className="w-full text-left bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg px-3 py-2 hover:border-amber-300 dark:hover:border-amber-700 transition-colors"
    >
      <p className="text-xs font-medium text-stone-800 dark:text-stone-200">{node.name}</p>
      {node.description && (
        <p className="text-[11px] text-stone-400 dark:text-stone-600 mt-0.5 line-clamp-2">
          {node.description}
        </p>
      )}
      {Boolean(node.node_metadata?.date) && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
          {String(node.node_metadata.date)}
        </p>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PlacesView
// ---------------------------------------------------------------------------

function PlacesView({
  placeNodes,
  edges,
  nodeById,
  onSelect,
}: {
  placeNodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  nodeById: (id: number) => KnowledgeNode | undefined;
  onSelect: (id: number) => void;
}) {
  if (placeNodes.length === 0) {
    return (
      <EmptyState
        title="No places yet."
        hint="Approve suggestions of type 'place' to populate this view."
      />
    );
  }

  // Group by region metadata if available
  const grouped: Record<string, KnowledgeNode[]> = {};
  for (const p of placeNodes) {
    const region = (p.node_metadata?.region as string) ?? "Other";
    (grouped[region] ??= []).push(p);
  }

  return (
    <div className="flex-1">
      <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
        {Object.entries(grouped).map(([region, places]) => (
          <div key={region} className="break-inside-avoid">
            {region !== "Other" && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-600 mb-2">
                {region}
              </p>
            )}
            <div className="space-y-2">
              {places.map((place) => {
                // Collect related nodes (nodes connected to this place)
                const relatedEdges = edges.filter(
                  (e) => e.from_node_id === place.id || e.to_node_id === place.id,
                );
                const relatedNodes = relatedEdges
                  .map((e) =>
                    nodeById(e.from_node_id === place.id ? e.to_node_id : e.from_node_id),
                  )
                  .filter(Boolean) as KnowledgeNode[];

                return (
                  <button
                    key={place.id}
                    onClick={() => onSelect(place.id)}
                    className="w-full text-left bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-xl px-3 py-3 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
                  >
                    <p className="text-xs font-semibold text-stone-800 dark:text-stone-200 mb-0.5">
                      {place.name}
                    </p>
                    {place.description && (
                      <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-relaxed line-clamp-3">
                        {place.description}
                      </p>
                    )}
                    {Boolean(place.node_metadata?.coordinates) && (
                      <p className="text-[10px] text-stone-400 dark:text-stone-600 mt-1">
                        {String(place.node_metadata.coordinates)}
                      </p>
                    )}
                    {relatedNodes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {relatedNodes.slice(0, 5).map((n) => (
                          <span
                            key={n.id}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full ${NODE_TYPE_BG[n.type]} ${NODE_TYPE_COLOR[n.type]}`}
                          >
                            {n.name}
                          </span>
                        ))}
                        {relatedNodes.length > 5 && (
                          <span className="text-[10px] text-stone-400 dark:text-stone-600">
                            +{relatedNodes.length - 5} more
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-24 text-center">
      <p className="text-sm text-stone-400 dark:text-stone-600 mb-1">{title}</p>
      <p className="text-xs text-stone-400 dark:text-stone-600 max-w-xs leading-relaxed">{hint}</p>
    </div>
  );
}
