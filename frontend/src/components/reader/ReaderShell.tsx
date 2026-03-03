"use client";
import { useState } from "react";
import { BookReaderProvider } from "@/contexts/BookReaderContext";
import ReaderPanel from "./ReaderPanel";
import AiPanel from "@/components/ai-panel/AiPanel";

interface Props {
  bookId: number;
}

export default function ReaderShell({ bookId }: Props) {
  const [readerCollapsed, setReaderCollapsed] = useState(false);
  const [aiWide, setAiWide] = useState(false);

  const aiWidth = readerCollapsed ? undefined : aiWide ? 640 : 440;

  return (
    <BookReaderProvider>
      <div className="flex h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 overflow-hidden">
        {readerCollapsed ? (
          /* Collapsed strip */
          <div className="w-11 shrink-0 flex flex-col items-center border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/50 py-3">
            <button
              onClick={() => setReaderCollapsed(false)}
              title="Restore reader"
              className="p-1.5 rounded hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        ) : (
          /* Reader panel */
          <div className="flex-1 overflow-hidden border-r border-stone-200 dark:border-stone-800 min-w-0">
            <ReaderPanel bookId={bookId} onCollapse={() => setReaderCollapsed(true)} />
          </div>
        )}

        {/* AI panel */}
        <div
          className="shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
          style={readerCollapsed ? { flex: 1 } : { width: aiWidth }}
        >
          <AiPanel
            bookId={bookId}
            aiWide={aiWide}
            onToggleWide={() => setAiWide((w) => !w)}
            readerCollapsed={readerCollapsed}
          />
        </div>
      </div>
    </BookReaderProvider>
  );
}
