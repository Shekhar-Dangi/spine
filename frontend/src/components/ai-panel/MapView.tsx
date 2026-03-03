"use client";
/**
 * MapView — renders the interactive chapter concept map via React Flow.
 * Phase 4 implementation target.
 */

interface Props { bookId: number }

export default function MapView({ bookId }: Props) {
  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">Concept Map</h3>
        <button className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors">
          Generate
        </button>
      </div>
      <div className="h-64 rounded-lg border border-dashed border-stone-300 dark:border-stone-700 flex items-center justify-center">
        <p className="text-xs text-stone-400 dark:text-stone-600">No map generated yet.</p>
      </div>
    </div>
  );
}
