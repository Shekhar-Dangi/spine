"use client";
import { useState } from "react";
import {
  getExplainTemplates,
  saveExplainTemplates,
  resetExplainTemplatesToDefaults,
  slugifyKey,
  DEFAULT_TEMPLATE_TEXTS,
} from "@/lib/explainTemplates";
import type { ExplainTemplate } from "@/types";

const inputClass =
  "w-full bg-stone-50 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 disabled:opacity-50 transition-colors";

const PLACEHOLDERS = ["{book_title}", "{author}", "{chapter_num}", "{chapter_title}", "{chapter_text}"];

export default function ExplainTemplateManager() {
  const [templates, setTemplates] = useState<ExplainTemplate[]>(() => getExplainTemplates());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  function persist(next: ExplainTemplate[]) {
    setTemplates(next);
    saveExplainTemplates(next);
  }

  function handleResetAll() {
    if (!confirm("Reset all templates to defaults? Custom templates will be lost.")) return;
    persist(resetExplainTemplatesToDefaults());
    setEditingId(null);
    setShowAddForm(false);
  }

  function handleRestoreBuiltin(id: string) {
    const key = id; // built-in id === key
    const defaultText = DEFAULT_TEMPLATE_TEXTS[key];
    if (!defaultText) return;
    persist(
      templates.map((t) =>
        t.id === id ? { ...t, template: defaultText, isModified: false } : t,
      ),
    );
    setEditingId(null);
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this template?")) return;
    persist(templates.filter((t) => t.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const next = [...templates];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    persist(next);
  }

  function handleMoveDown(index: number) {
    if (index === templates.length - 1) return;
    const next = [...templates];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    persist(next);
  }

  function handleSaveEdit(updated: ExplainTemplate) {
    persist(templates.map((t) => (t.id === updated.id ? updated : t)));
    setEditingId(null);
  }

  function handleAddTemplate(tmpl: ExplainTemplate) {
    persist([...templates, tmpl]);
    setShowAddForm(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif italic text-lg text-stone-900 dark:text-stone-100">Explain Modes</h2>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 max-w-md">
            Customize how Spine explains chapters. Edit built-in templates or add your own.
            Available placeholders:{" "}
            {PLACEHOLDERS.map((p) => (
              <code key={p} className="text-amber-600 dark:text-amber-400 text-[11px]">{p}</code>
            )).reduce<React.ReactNode[]>((acc, el, i) => [...acc, i > 0 ? ", " : "", el], [])}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleResetAll}
            className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400 text-xs font-medium transition-colors"
          >
            Reset all
          </button>
          <button
            onClick={() => { setShowAddForm((v) => !v); setEditingId(null); }}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 text-white text-sm font-medium transition-colors"
          >
            {showAddForm ? "Cancel" : "+ Add Mode"}
          </button>
        </div>
      </div>

      {showAddForm && (
        <AddTemplateForm
          existingKeys={templates.map((t) => t.key)}
          onAdd={handleAddTemplate}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <div className="space-y-2">
        {templates.map((tmpl, index) => (
          <div
            key={tmpl.id}
            className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden"
          >
            {/* Row */}
            <div className="px-5 py-3.5 flex items-center gap-3">
              {/* Reorder */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  className="text-stone-300 dark:text-stone-700 hover:text-stone-500 dark:hover:text-stone-400 disabled:opacity-20 transition-colors leading-none"
                  title="Move up"
                >
                  ▴
                </button>
                <button
                  onClick={() => handleMoveDown(index)}
                  disabled={index === templates.length - 1}
                  className="text-stone-300 dark:text-stone-700 hover:text-stone-500 dark:hover:text-stone-400 disabled:opacity-20 transition-colors leading-none"
                  title="Move down"
                >
                  ▾
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-stone-800 dark:text-stone-200 text-sm">
                  {tmpl.name}
                  {tmpl.isModified && (
                    <span className="ml-1.5 text-[10px] text-amber-500 dark:text-amber-400 font-normal">
                      (modified)
                    </span>
                  )}
                  {!tmpl.isBuiltin && (
                    <span className="ml-1.5 text-[10px] text-stone-400 dark:text-stone-500 font-normal">
                      (custom)
                    </span>
                  )}
                </p>
                <p className="text-xs text-stone-400 dark:text-stone-500 font-mono mt-0.5">
                  key: {tmpl.key}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setEditingId(editingId === tmpl.id ? null : tmpl.id)}
                  className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline transition-colors"
                >
                  {editingId === tmpl.id ? "Cancel" : "Edit"}
                </button>
                {tmpl.isBuiltin && tmpl.isModified && (
                  <button
                    onClick={() => handleRestoreBuiltin(tmpl.id)}
                    className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline transition-colors"
                  >
                    Restore
                  </button>
                )}
                {!tmpl.isBuiltin && (
                  <button
                    onClick={() => handleDelete(tmpl.id)}
                    className="text-xs text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 underline transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {/* Inline editor */}
            {editingId === tmpl.id && (
              <div className="border-t border-stone-200 dark:border-stone-800">
                <TemplateEditor
                  template={tmpl}
                  existingKeys={templates.filter((t) => t.id !== tmpl.id).map((t) => t.key)}
                  onSave={handleSaveEdit}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="rounded-xl border border-dashed border-stone-300 dark:border-stone-700 py-10 text-center text-stone-400 dark:text-stone-600 text-sm">
          No templates. Add one above or reset to defaults.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template editor (used for both edit and create)
// ---------------------------------------------------------------------------

interface EditorProps {
  template: ExplainTemplate;
  existingKeys: string[];
  onSave: (t: ExplainTemplate) => void;
  onCancel: () => void;
}

function TemplateEditor({ template, existingKeys, onSave, onCancel }: EditorProps) {
  const [name, setName] = useState(template.name);
  const [key, setKey] = useState(template.key);
  const [text, setText] = useState(template.template);
  const [error, setError] = useState<string | null>(null);

  const isBuiltin = template.isBuiltin;

  function handleNameChange(v: string) {
    setName(v);
    // Auto-update key for non-builtin templates
    if (!isBuiltin) setKey(slugifyKey(v));
  }

  function validate() {
    if (!name.trim()) return "Name is required.";
    if (!key.trim()) return "Key is required.";
    if (key.length > 32) return "Key must be 32 characters or fewer.";
    if (!/^[a-z0-9_]+$/.test(key)) return "Key must only contain lowercase letters, numbers, and underscores.";
    if (existingKeys.includes(key)) return `Key "${key}" is already in use.`;
    if (!text.trim()) return "Template text is required.";
    return null;
  }

  function handleSave() {
    const err = validate();
    if (err) { setError(err); return; }
    const isModified = isBuiltin
      ? text.trim() !== (DEFAULT_TEMPLATE_TEXTS[template.key] ?? "").trim()
      : false;
    onSave({ ...template, name: name.trim(), key, template: text, isModified });
  }

  return (
    <div className="p-5 space-y-4 bg-stone-50 dark:bg-stone-900/50">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">Display name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className={inputClass}
            placeholder="e.g. Socratic"
          />
        </div>
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">
            Mode key{isBuiltin && " (fixed)"}
          </label>
          <input
            type="text"
            value={key}
            onChange={(e) => !isBuiltin && setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32))}
            disabled={isBuiltin}
            className={`${inputClass} font-mono`}
            placeholder="e.g. socratic"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">
          Template
          <span className="ml-2 text-stone-400 dark:text-stone-600">
            — placeholders: {PLACEHOLDERS.join(", ")}
          </span>
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          className={`${inputClass} font-mono text-xs leading-relaxed resize-y`}
          placeholder="Write your prompt template here…"
        />
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 text-white text-sm font-medium transition-colors"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add new template form
// ---------------------------------------------------------------------------

interface AddProps {
  existingKeys: string[];
  onAdd: (t: ExplainTemplate) => void;
  onCancel: () => void;
}

function AddTemplateForm({ existingKeys, onAdd, onCancel }: AddProps) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [text, setText] = useState(
    `Book: "{book_title}" by {author}\nChapter {chapter_num}: "{chapter_title}"\n\nChapter text:\n---\n{chapter_text}\n---\n\n`,
  );
  const [error, setError] = useState<string | null>(null);

  function handleNameChange(v: string) {
    setName(v);
    setKey(slugifyKey(v));
  }

  function validate() {
    if (!name.trim()) return "Name is required.";
    if (!key.trim()) return "Key is required.";
    if (key.length > 32) return "Key must be 32 characters or fewer.";
    if (!/^[a-z0-9_]+$/.test(key)) return "Key must only contain lowercase letters, numbers, and underscores.";
    if (existingKeys.includes(key)) return `Key "${key}" is already in use by another template.`;
    if (!text.trim()) return "Template text is required.";
    return null;
  }

  function handleAdd() {
    const err = validate();
    if (err) { setError(err); return; }
    onAdd({
      id: `custom_${Date.now()}`,
      name: name.trim(),
      key,
      template: text,
      isBuiltin: false,
      isModified: false,
    });
  }

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/10 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">New Explain Mode</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">Display name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className={inputClass}
            placeholder="e.g. Socratic"
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">Mode key</label>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32))}
            className={`${inputClass} font-mono`}
            placeholder="auto-generated"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-stone-500 dark:text-stone-400 block mb-1.5">
          Template
          <span className="ml-2 text-stone-400 dark:text-stone-600">
            — available: {PLACEHOLDERS.join(", ")}
          </span>
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          className={`${inputClass} font-mono text-xs leading-relaxed resize-y`}
          placeholder="Write your prompt template here…"
        />
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleAdd}
          className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 text-white text-sm font-medium transition-colors"
        >
          Add Mode
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 text-sm font-medium transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
