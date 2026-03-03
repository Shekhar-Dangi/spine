"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ModelProfile, RoutingTask, TaskMapping } from "@/types";

const DEFAULT_MODEL: Record<"openai" | "openrouter", string> = {
  openai: "gpt-4o",
  openrouter: "qwen/qwen3-235b-a22b",
};

const inputClass =
  "w-full bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 disabled:opacity-50 transition-colors";

export default function ProfileManager() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ModelProfile | null>(null);
  const [testResults, setTestResults] = useState<Record<number, boolean | null>>({});

  const refresh = async () => {
    try {
      setProfiles(await api.providers.list());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleTest = async (id: number) => {
    setTestResults((prev) => ({ ...prev, [id]: null }));
    try {
      const { reachable } = await api.providers.test(id);
      setTestResults((prev) => ({ ...prev, [id]: reachable }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: false }));
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
            Configure AI providers for Spine&apos;s features.
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
        {profiles.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden"
          >
            <div className="px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-stone-800 dark:text-stone-200 text-sm">{p.name}</p>
                <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                  {p.provider_type === "openrouter" ? "OpenRouter" : "OpenAI"} · {p.model}
                </p>
              </div>
              {p.active && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                  Active
                </span>
              )}
              <button
                onClick={() => handleTest(p.id)}
                className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline shrink-0 transition-colors"
              >
                Test
              </button>
              <button
                onClick={() => handleEdit(p)}
                className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline shrink-0 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(p.id)}
                className="text-xs text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 underline shrink-0 transition-colors"
              >
                Delete
              </button>
              {testResults[p.id] === null && (
                <span className="text-xs text-stone-400 dark:text-stone-600">Testing…</span>
              )}
              {testResults[p.id] === true && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Connected</span>
              )}
              {testResults[p.id] === false && (
                <span className="text-xs text-red-500 dark:text-red-400">✗ Failed</span>
              )}
            </div>

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
        ))}
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProviderChange = (v: "openai" | "openrouter") => {
    setProvider(v);
    if (!existing) setModel(DEFAULT_MODEL[v]);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required."); return; }
    if (!isEdit && !apiKey.trim()) { setError("API key is required."); return; }
    if (!model.trim()) { setError("Model is required."); return; }
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        const body: Parameters<typeof api.providers.update>[1] = {
          name: name.trim(),
          model: model.trim(),
        };
        if (apiKey.trim()) body.api_key = apiKey.trim();
        await api.providers.update(existing!.id, body);
      } else {
        await api.providers.create({
          name: name.trim(),
          provider_type: provider,
          api_key: apiKey.trim(),
          model: model.trim(),
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
            placeholder="e.g. GPT-4o Fast"
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
          placeholder={provider === "openrouter" ? "e.g. qwen/qwen3-235b-a22b" : "e.g. gpt-4o"}
          className={`${inputClass} font-mono`}
        />
        <p className="text-xs text-stone-400 dark:text-stone-600 mt-1.5">
          Each profile uses one model. Use Task Routing below to assign profiles to features.
        </p>
      </div>

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
};

const ROUTING_TASKS: RoutingTask[] = [
  "dossier",
  "explain",
  "qa",
  "map_extract",
  "toc_extract",
];

export function TaskRoutingManager() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [mapping, setMapping] = useState<TaskMapping>({
    dossier: null,
    explain: null,
    qa: null,
    map_extract: null,
    toc_extract: null,
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif italic text-lg text-stone-900 dark:text-stone-100">Task Routing</h2>
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
          Choose which model profile handles each AI task. Leave as "Default" to use the active profile.
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
          {ROUTING_TASKS.map((task) => (
            <div
              key={task}
              className="flex items-center justify-between px-5 py-3 gap-4"
            >
              <span className="text-sm text-stone-700 dark:text-stone-300 min-w-0">
                {TASK_LABELS[task]}
              </span>
              <select
                value={mapping[task] ?? ""}
                onChange={(e) =>
                  setMapping((prev) => ({
                    ...prev,
                    [task]: e.target.value ? Number(e.target.value) : null,
                  }))
                }
                className="bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-2 py-1 text-xs text-stone-700 dark:text-stone-300 outline-none shrink-0 max-w-[200px] focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 transition-colors"
              >
                <option value="">Default (active profile)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.provider_type === "openrouter" ? "OpenRouter" : "OpenAI"})
                  </option>
                ))}
              </select>
            </div>
          ))}
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
