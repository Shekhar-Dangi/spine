/**
 * TOC Review page.
 * Shown after upload + parse completes (status = pending_toc_review).
 * User can rename chapters, reorder, add or remove entries, then confirm.
 */
import TocEditor from "@/components/toc/TocEditor";
import Link from "next/link";
import ThemeToggle from "@/components/ui/ThemeToggle";

interface Props {
  params: Promise<{ bookId: string }>;
}

export default async function TocReviewPage({ params }: Props) {
  const { bookId } = await params;
  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      <header className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              href="/"
              className="shrink-0 text-xs text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
            >
              ← Library
            </Link>
            <span className="text-stone-200 dark:text-stone-800 shrink-0">·</span>
            <span className="font-serif italic text-sm text-stone-700 dark:text-stone-300 truncate">
              Review Table of Contents
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
        <div className="mb-8">
          <p className="text-sm text-stone-500 dark:text-stone-400 leading-relaxed">
            We detected the following chapters. Edit titles or page boundaries if needed,
            then confirm to start indexing.
          </p>
        </div>
        <TocEditor bookId={Number(bookId)} />
      </main>
    </div>
  );
}
