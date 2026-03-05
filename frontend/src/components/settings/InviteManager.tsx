"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { InviteOut } from "@/types";

export default function InviteManager() {
  const [invites, setInvites] = useState<InviteOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadInvites() {
    try {
      setInvites(await api.auth.listInvites());
    } catch {
      setError("Failed to load invites.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvites();
  }, []);

  async function createInvite() {
    setCreating(true);
    setError(null);
    setNewInviteUrl(null);
    try {
      const result = await api.auth.createInvite();
      setNewInviteUrl(result.url);
      await loadInvites();
    } catch {
      setError("Failed to create invite.");
    } finally {
      setCreating(false);
    }
  }

  async function copyUrl() {
    if (!newInviteUrl) return;
    await navigator.clipboard.writeText(newInviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 uppercase tracking-wider">
          Team &amp; Invites
        </h2>
        <button
          onClick={createInvite}
          disabled={creating}
          className="text-xs bg-stone-900 dark:bg-stone-100 text-stone-50 dark:text-stone-900 px-3 py-1.5 rounded-lg hover:bg-stone-700 dark:hover:bg-stone-300 transition-colors disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create invite"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
      )}

      {newInviteUrl && (
        <div className="mb-4 bg-stone-100 dark:bg-stone-800 rounded-lg p-3 flex items-center gap-2">
          <code className="text-xs text-stone-700 dark:text-stone-300 flex-1 truncate">
            {newInviteUrl}
          </code>
          <button
            onClick={copyUrl}
            className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 transition-colors whitespace-nowrap"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-stone-400 dark:text-stone-600">Loading…</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-stone-400 dark:text-stone-600">
          No invites yet.
        </p>
      ) : (
        <div className="space-y-2">
          {invites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-stone-700 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <code className="text-xs text-stone-600 dark:text-stone-400 truncate block">
                  {invite.code}
                </code>
                <p className="text-xs text-stone-400 dark:text-stone-600 mt-0.5">
                  Created {new Date(invite.created_at).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ml-3 whitespace-nowrap ${
                  invite.used_by_id
                    ? "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400"
                    : "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                }`}
              >
                {invite.used_by_id
                  ? `Used by ${invite.used_by_username ?? "unknown"}`
                  : "Available"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
