"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.auth.setupStatus().then(({ needs_setup }) => {
      if (!needs_setup) router.replace("/login");
      else setChecking(false);
    }).catch(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.setup(username, email, password, setupKey);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <div className="text-center mb-8">
          <span className="font-serif italic text-xl text-stone-900 dark:text-stone-100 tracking-tight">
            Spine
          </span>
          <p className="text-xs text-stone-400 dark:text-stone-600 mt-1">Initial setup</p>
        </div>

        <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 overflow-hidden">
          <div className="px-6 pt-5 pb-1">
            <h1 className="text-sm font-medium text-stone-800 dark:text-stone-200">Create admin account</h1>
          </div>

          <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-3">
            {error && (
              <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">Setup key</label>
              <input
                type="password"
                value={setupKey}
                onChange={(e) => setSetupKey(e.target.value)}
                required
                autoComplete="off"
                className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-stone-300 dark:focus:ring-stone-600 transition-colors"
              />
              <p className="text-[10px] text-stone-400 dark:text-stone-600 mt-1">
                Set via SPINE_SETUP_KEY environment variable on the server
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-stone-900 dark:bg-stone-100 text-stone-50 dark:text-stone-900 py-2 text-sm font-medium hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-50 transition-colors mt-1"
            >
              {loading ? "Creating..." : "Create admin account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
