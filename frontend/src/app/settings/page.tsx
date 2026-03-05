"use client";

import ProfileManager from "@/components/settings/ProfileManager";
import { TaskRoutingManager } from "@/components/settings/ProfileManager";
import ExplainTemplateManager from "@/components/settings/ExplainTemplateManager";
import InviteManager from "@/components/settings/InviteManager";
import Link from "next/link";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      <header className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/90 dark:bg-stone-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              href="/"
              className="shrink-0 text-xs text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
            >
              ← Library
            </Link>
            <span className="text-stone-200 dark:text-stone-800 shrink-0">·</span>
            <span className="font-serif italic text-sm text-stone-700 dark:text-stone-300 truncate">Settings</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-8 py-8 sm:py-10 space-y-10">
        <ProfileManager />
        <hr className="border-stone-200 dark:border-stone-800" />
        <TaskRoutingManager />
        <hr className="border-stone-200 dark:border-stone-800" />
        <ExplainTemplateManager />
        {user?.is_admin && (
          <>
            <hr className="border-stone-200 dark:border-stone-800" />
            <InviteManager />
          </>
        )}
      </main>
    </div>
  );
}
