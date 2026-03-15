"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import BookLibrary from "@/components/library/BookLibrary";
import ThemeToggle from "@/components/ui/ThemeToggle";
import GlobalSearch from "@/components/search/GlobalSearch";
import { useAuth } from "@/contexts/AuthContext";

export default function HomePage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/90 dark:bg-stone-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 h-12 flex items-center justify-between gap-3">
          {/* Logo */}
          <div className="flex items-baseline gap-2 shrink-0">
            <span className="font-serif italic text-base sm:text-lg text-stone-900 dark:text-stone-100 tracking-tight leading-none">
              Spine
            </span>
            <span className="hidden sm:inline text-[11px] text-stone-400 dark:text-stone-600 tracking-wide">
              reading companion
            </span>
          </div>

          {/* Nav */}
          <nav className="flex items-center gap-0.5">
            <Link
              href="/ask"
              className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Ask
            </Link>
            <Link
              href="/notes"
              className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Notes
            </Link>
            <Link
              href="/review"
              className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Review
            </Link>
            <Link
              href="/explore"
              className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Explore
            </Link>
            <Link
              href="/settings"
              className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              Settings
            </Link>
            {user && (
              <>
                <span className="hidden sm:inline text-xs text-stone-400 dark:text-stone-600 px-1.5">
                  {user.username}
                </span>
                <button
                  onClick={handleLogout}
                  className="text-xs sm:text-sm text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors px-2 py-1.5 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800 whitespace-nowrap"
                >
                  Sign out
                </button>
              </>
            )}
            <GlobalSearch />
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10">
        <BookLibrary />
      </main>
    </div>
  );
}
