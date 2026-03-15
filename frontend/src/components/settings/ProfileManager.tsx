"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ModelCapability, ModelProfile, RoutingTask, TaskMapping } from "@/types";
import { TASK_REQUIRED_CAPABILITY } from "@/types";

const DEFAULT_MODEL: Record<"openai" | "openrouter", string> = {
  openai: "gpt-4o",
  openrouter: "qwen/qwen3-235b-a22b",
};

const inputClass =
  "w-full bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 disabled:opacity-50 transition-colors";

// Per-capability test result shape from backend
interface TestResult {
  reachable: boolean;
  capabilities_tested: Record<string, boolean | string>;
}

export default function ProfileManager() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult | "testing" | "error">>({});

  const refresh = async () => {
    try {
      setProfiles(await api.providers.list());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleTest = async (id: number) => {
    setTestResults((prev) => ({ ...prev, [id]: "testing" }));
    try {
      const result = await api.providers.test(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: "error" }));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this profile?")) return;
    try {
      await api.providers.delete(id);
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete.");
    }
  };

  const handleEdit = (p: ModelProfile) => {
    setShowForm(false);
    setEditingProfile(p);
  };

  const handleAddNew = () => {
    setEditingProfile(null);
    setShowForm((v) => !v);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif italic text-lg text-stone-900 dark:text-stone-100">Model Profiles</h2>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
            Configure AI providers. Each profile uses one model. Declare what the model supports.
          </p>
        </div>
        <button
          onClick={handleAddNew}
          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 text-white text-sm font-medium transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Profile"}
        </button>
      </div>

      {showForm && !editingProfile && (
        <ProfileForm onDone={() => { setShowForm(false); refresh(); }} />
      )}

      {loading && <p className="text-sm text-stone-400 dark:text-stone-600">Loading…</p>}

      {!loading && profiles.length === 0 && !showForm && (
        <div className="rounded-xl border border-dashed border-stone-300 dark:border-stone-700 py-12 text-center text-stone-400 dark:text-stone-600 text-sm">
          No model profiles yet. Add one to enable AI features.
        </div>
      )}

      <div className="space-y-3">
        {profiles.map((p) => {
          const tr = testResults[p.id];
          return (
            <div
              key={p.id}
              className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden"
            >
              <div className="px-5 py-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-stone-800 dark:text-stone-200 text-sm">{p.name}</p>
                  <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 font-mono">
                    {p.provider_type === "openrouter" ? "OpenRouter" : "OpenAI"} · {p.model}
                  </p>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {p.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 border border-stone-200 dark:border-stone-700"
                      >
                        {cap}
                        {cap === "embedding" && p.embedding_dim ? ` · ${p.embedding_dim}d` : ""}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 pt-0.5">
                  {p.active && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Active</span>
                  )}
                  <button
                    onClick={() => handleTest(p.id)}
                    className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline transition-colors"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => handleEdit(p)}
                    className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="text-xs text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 underline transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Test results — per capability */}
              {tr && (
                <div className="px-5 pb-3 flex flex-wrap gap-2">
                  {tr === "testing" && (
                    <span className="text-xs text-stone-400 dark:text-stone-600">Testing…</span>
                  )}
                  {tr === "error" && (
                    <span className="text-xs text-red-500 dark:text-red-400">✗ Connection failed</span>
                  )}
                  {typeof tr === "object" && Object.entries(tr.capabilities_tested).map(([cap, result]) => {
                    if (cap === "embedding_error") return null;
                    const ok = result === true;
                    const embeddingErr = cap === "embedding" && !ok
                      ? tr.capabilities_tested["embedding_error"] as string | undefined
                      : undefined;
                    return (
                      <div key={cap} className="flex flex-col gap-0.5">
                        <span className={`text-xs font-medium ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                          {ok ? "✓" : "✗"} {cap}
                        </span>
                        {embeddingErr && (
                          <p className="text-[10px] text-red-400 dark:text-red-500 max-w-xs leading-snug">{embeddingErr}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {editingProfile?.id === p.id && (
                <div className="border-t border-stone-200 dark:border-stone-800">
                  <ProfileForm
                    existing={p}
                    onDone={() => { setEditingProfile(null); refresh(); }}
                    onCancel={() => setEditingProfile(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface FormProps {
  existing?: ModelProfile;
  onDone: () => void;
  onCancel?: () => void;
}

function ProfileForm({ existing, onDone, onCancel }: FormProps) {
  const isEdit = !!existing;
  const [provider, setProvider] = useState<"openai" | "openrouter">(
    (existing?.provider_type as "openai" | "openrouter") ?? "openai",
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(existing?.model ?? DEFAULT_MODEL["openai"]);
  const [capabilities, setCapabilities] = useState<ModelCapability[]>(
    existing?.capabilities ?? ["chat"],
  );
  const [embeddingDim, setEmbeddingDim] = useState<string>(
    existing?.embedding_dim?.toString() ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProviderChange = (v: "openai" | "openrouter") => {
    setProvider(v);
    if (!existing) setModel(DEFAULT_MODEL[v]);
  };

  const toggleCapability = (cap: ModelCapability) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    );
  };

  const needsEmbedDim = capabilities.includes("embedding");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) { setError("Name is required."); return; }
    if (!isEdit && !apiKey.trim()) { setError("API key is required."); return; }
    if (!model.trim()) { setError("Model is required."); return; }
    if (capabilities.length === 0) { setError("Select at least one capability."); return; }
    if (needsEmbedDim && !embeddingDim.trim()) {
      setError("Embedding dimension is required when 'embedding' capability is selected.");
      return;
    }
    const dimNum = needsEmbedDim ? parseInt(embeddingDim, 10) : undefined;
    if (needsEmbedDim && (!dimNum || dimNum <= 0)) {
      setError("Embedding dimension must be a positive integer (e.g. 1024, 1536, 3072).");
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const body: Parameters<typeof api.providers.update>[1] = {
          name: name.trim(),
          model: model.trim(),
          capabilities,
          embedding_dim: dimNum,
        };
        if (apiKey.trim()) body.api_key = apiKey.trim();
        await api.providers.update(existing!.id, body);
      } else {
        await api.providers.create({
          name: name.trim(),
          provider_type: provider,
          api_key: apiKey.trim(),
          model: model.trim(),
          capabilities,
          embedding_dim: dimNum,
        });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-5 space-y-4 bg-stone-50 dark:bg-stone-900/50">
      <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
        {isEdit ? "Edit Profile" : "New Profile"}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">Provider</label>
          <select
            value={provider}
            disabled={isEdit}
            onChange={(e) => handleProviderChange(e.target.value as "openai" | "openrouter")}
            className={inputClass}
          >
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">Profile name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. GTE-Large (embed)"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">
          API Key{isEdit && " (leave blank to keep existing)"}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={isEdit ? "••••••••" : "sk-…"}
          className={`${inputClass} font-mono`}
        />
      </div>

      <div>
        <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">Model</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={
            provider === "openrouter"
              ? "e.g. thenlper/gte-large or qwen/qwen3-235b-a22b"
              : "e.g. text-embedding-3-small or gpt-4o"
          }
          className={`${inputClass} font-mono`}
        />
      </div>

      {/* Capabilities */}
      <div>
        <label className="text-xs text-stone-500 dark:text-stone-400 block mb-2">
          Capabilities — what this model supports
        </label>
        <div className="flex gap-3">
          {(["chat", "embedding"] as ModelCapability[]).map((cap) => (
            <label key={cap} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={capabilities.includes(cap)}
                onChange={() => toggleCapability(cap)}
                className="accent-amber-600 w-3.5 h-3.5"
              />
              <span className="text-sm text-stone-700 dark:text-stone-300 capitalize">{cap}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-stone-400 dark:text-stone-600 mt-1.5">
          Chat models answer questions. Embedding models produce vectors for search.
          Some models support both.
        </p>
      </div>

      {/* Embedding dimension — only shown when embedding is checked */}
      {needsEmbedDim && (
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">
            Embedding dimension
          </label>
          <input
            type="number"
            value={embeddingDim}
            onChange={(e) => setEmbeddingDim(e.target.value)}
            placeholder="e.g. 1024"
            min={1}
            className={`${inputClass} font-mono`}
          />
          <p className="text-xs text-stone-400 dark:text-stone-600 mt-1.5">
            Check the model&apos;s docs for the output dimension.
            Common values: <span className="font-mono">1024</span> (GTE-Large),{" "}
            <span className="font-mono">1536</span> (text-embedding-3-small / ada-002),{" "}
            <span className="font-mono">3072</span> (text-embedding-3-large).
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {submitting ? "Saving…" : "Save Profile"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Task Routing Manager
// ---------------------------------------------------------------------------

const TASK_LABELS: Record<RoutingTask, string> = {
  dossier: "Pre-read Dossier",
  explain: "Chapter Deep Explain",
  qa: "Selection Q&A",
  map_extract: "Chapter Concept Map",
  toc_extract: "TOC Suggestion (LLM)",
  embed: "Embedding (book indexing + search)",
  extract: "Knowledge Extraction",
};

const ROUTING_TASKS: RoutingTask[] = [
  "dossier",
  "explain",
  "qa",
  "map_extract",
  "toc_extract",
  "embed",
  "extract",
];

export function TaskRoutingManager() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [mapping, setMapping] = useState<TaskMapping>({
    dossier: null,
    explain: null,
    qa: null,
    map_extract: null,
    toc_extract: null,
    embed: null,
    extract: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [pList, tMap] = await Promise.all([
          api.providers.list(),
          api.providers.getTaskMapping(),
        ]);
        setProfiles(pList);
        setMapping(tMap);
      } catch {}
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await api.providers.setTaskMapping(mapping);
      setMapping(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save.");
    }
    setSaving(false);
  };

  const embeddingProfiles = profiles.filter((p) => p.capabilities.includes("embedding"));
  const chatProfiles = profiles.filter((p) => p.capabilities.includes("chat"));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif italic text-lg text-stone-900 dark:text-stone-100">Task Routing</h2>
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
          Choose which model profile handles each AI task. Dropdowns only show profiles
          with the required capability.
        </p>
      </div>

      {loading && <p className="text-sm text-stone-400 dark:text-stone-600">Loading…</p>}

      {!loading && profiles.length === 0 && (
        <p className="text-sm text-stone-400 dark:text-stone-600">
          Add a model profile first before configuring task routing.
        </p>
      )}

      {!loading && profiles.length > 0 && (
        <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 divide-y divide-stone-100 dark:divide-stone-800">
          {ROUTING_TASKS.map((task) => {
            const requiredCap = TASK_REQUIRED_CAPABILITY[task];
            const availableProfiles = requiredCap === "embedding" ? embeddingProfiles : chatProfiles;
            const isEmbed = task === "embed";

            return (
              <div
                key={task}
                className={`flex items-center justify-between px-5 py-3 gap-4 ${isEmbed ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}
              >
                <div className="min-w-0">
                  <span className="text-sm text-stone-700 dark:text-stone-300">
                    {TASK_LABELS[task]}
                  </span>
                  {isEmbed && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
                      Required — must assign an embedding-capable profile
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {availableProfiles.length === 0 ? (
                    <span className="text-xs text-red-400 dark:text-red-500 italic">
                      No {requiredCap} profile — add one above
                    </span>
                  ) : (
                    <select
                      value={mapping[task] ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [task]: e.target.value ? Number(e.target.value) : null,
                        }))
                      }
                      className="bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-2 py-1 text-xs text-stone-700 dark:text-stone-300 outline-none max-w-[220px] focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 transition-colors"
                    >
                      <option value="">
                        {isEmbed ? "— select embedding profile —" : "Default (active profile)"}
                      </option>
                      {availableProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {isEmbed && p.embedding_dim ? ` (${p.embedding_dim}d)` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {saveError && <p className="text-xs text-red-500 dark:text-red-400">{saveError}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || loading || profiles.length === 0}
          className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {saving ? "Saving…" : "Save Routing"}
        </button>
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Saved</span>}
      </div>
    </div>
  );
}
