import Link from "next/link";
import BookLibrary from "@/components/library/BookLibrary";
import ThemeToggle from "@/components/ui/ThemeToggle";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-baseline gap-2.5">
            <span className="font-serif italic text-xl text-stone-900 dark:text-stone-100 tracking-tight">
              Spine
            </span>
            <span className="text-xs text-stone-400 dark:text-stone-600 tracking-wide">
              reading companion
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors px-2 py-1"
            >
              Settings
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-10">
        <BookLibrary />
      </main>
    </div>
  );
}
