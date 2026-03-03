"use client";
import { useState } from "react";
import DossierView from "./DossierView";
import ExplainView from "./ExplainView";
import QaView from "./QaView";
import MapView from "./MapView";

type Tab = "dossier" | "explain" | "qa" | "map";

const TABS: { id: Tab; label: string }[] = [
  { id: "dossier", label: "Pre-Read" },
  { id: "explain", label: "Explain" },
  { id: "qa", label: "Q&A" },
  { id: "map", label: "Map" },
];

interface Props {
  bookId: number;
  aiWide?: boolean;
  onToggleWide?: () => void;
  readerCollapsed?: boolean;
}

export default function AiPanel({ bookId, aiWide, onToggleWide, readerCollapsed }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("explain");

  return (
    <div className="h-full flex flex-col bg-white dark:bg-stone-900">
      {/* Tab bar */}
      <div className="shrink-0 flex items-stretch border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/50">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "text-amber-700 dark:text-amber-400 border-b-2 border-amber-600 dark:border-amber-500 bg-white dark:bg-stone-900"
                : "text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
        {/* Expand/contract toggle — hidden when reader is already collapsed */}
        {!readerCollapsed && onToggleWide && (
          <button
            onClick={onToggleWide}
            title={aiWide ? "Contract AI panel" : "Expand AI panel"}
            className="px-3 text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300 transition-colors"
          >
            {aiWide ? (
              /* inward arrows */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="10" y1="14" x2="3" y2="21" />
                <line x1="21" y1="3" x2="14" y2="10" />
              </svg>
            ) : (
              /* outward arrows */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "dossier" && <DossierView bookId={bookId} />}
        {activeTab === "explain" && <ExplainView bookId={bookId} />}
        {activeTab === "qa" && <QaView bookId={bookId} />}
        {activeTab === "map" && <MapView bookId={bookId} />}
      </div>
    </div>
  );
}
