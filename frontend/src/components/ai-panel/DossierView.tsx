"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Dossier, DossierSection } from "@/types";

interface Props { bookId: number }

type Status = "idle" | "generating" | "ready";

const SECTION_LABELS: Record<string, string> = {
  author_background: "Author Background",
  historical_context: "Historical & Intellectual Context",
  topic_significance: "Why This Matters",
  critiques: "Critiques & Limitations",
};

const SECTION_ORDER = [
  "author_background",
  "historical_context",
  "topic_significance",
  "critiques",
];

export default function DossierView({ bookId }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [tavilyAvailable, setTavilyAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const checkDossier = useCallback(async () => {
    try {
      const data = await api.dossier.get(bookId);
      setDossier(data);
      if (data.generated_at) {
        setStatus("ready");
        stopPolling();
      } else {
        setStatus("generating");
      }
    } catch {
      setStatus("idle");
      setDossier(null);
      stopPolling();
    }
  }, [bookId]);

  useEffect(() => {
    api.providers.capabilities().then((caps) => {
      setTavilyAvailable(caps.tavily_available);
      setUseWebSearch(caps.tavily_available);
    });
    checkDossier();
    return stopPolling;
  }, [bookId, checkDossier]);

  useEffect(() => {
    if (status === "generating" && !pollRef.current) {
      pollRef.current = setInterval(checkDossier, 3000);
    }
    if (status !== "generating") {
      stopPolling();
    }
  }, [status, checkDossier]);

  const handleGenerate = async () => {
    setError(null);
    setStatus("generating");
    setDossier(null);
    try {
      await api.dossier.generate(bookId, useWebSearch);
      pollRef.current = setInterval(checkDossier, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start generation.");
      setStatus("idle");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-stone-200 dark:border-stone-800 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-stone-800 dark:text-stone-200">Pre-Reading Context</p>
          <button
            onClick={handleGenerate}
            disabled={status === "generating"}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap"
          >
            {status === "generating" ? "Generating…" : status === "ready" ? "Regenerate" : "Generate"}
          </button>
        </div>

        {/* Web search toggle */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <div
            onClick={() => setUseWebSearch((v) => !v)}
            className={`relative w-8 h-4 rounded-full transition-colors ${
              useWebSearch ? "bg-amber-500" : "bg-stone-300 dark:bg-stone-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                useWebSearch ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </div>
          <span className="text-xs text-stone-500 dark:text-stone-400">
            Web search
            {!tavilyAvailable && (
              <span className="ml-1 text-stone-400 dark:text-stone-600">(no Tavily key)</span>
            )}
          </span>
        </label>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {error && <p className="text-red-500 dark:text-red-400 text-xs">{error}</p>}

        {status === "idle" && !error && (
          <p className="text-xs text-stone-400 dark:text-stone-600 mt-4 text-center leading-relaxed">
            Generate a pre-reading context pack for this book.
          </p>
        )}

        {status === "generating" && (
          <div className="flex items-center gap-2.5 text-stone-400 dark:text-stone-600 text-xs mt-4">
            <div className="h-3 w-3 border border-amber-500 border-t-transparent rounded-full animate-spin" />
            Generating pre-reading context… this may take a minute.
          </div>
        )}

        {status === "ready" && dossier && (
          <DossierSections sections={dossier.sections} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DossierSections({ sections }: { sections: DossierSection[] }) {
  const ordered = SECTION_ORDER
    .map((type) => sections.find((s) => s.section_type === type))
    .filter(Boolean) as DossierSection[];

  return (
    <div className="space-y-4">
      {ordered.map((section) => (
        <SectionBlock key={section.section_type} section={section} />
      ))}
    </div>
  );
}

function SectionBlock({ section }: { section: DossierSection }) {
  const [expanded, setExpanded] = useState(true);
  const label = SECTION_LABELS[section.section_type] ?? section.section_type;

  let citations: Array<{ title: string; url: string; snippet: string }> = [];
  try {
    if (section.citations) citations = JSON.parse(section.citations);
  } catch {
    // malformed JSON
  }

  return (
    <div className="border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left bg-stone-50 dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800/50 transition-colors"
      >
        <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-500 uppercase tracking-widest">
          {label}
        </span>
        <span className="text-stone-400 dark:text-stone-600 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-stone-900">
          <SectionText content={section.content} />
          {citations.length > 0 && (
            <div className="pt-2 border-t border-stone-100 dark:border-stone-800">
              <p className="text-[10px] text-stone-400 dark:text-stone-600 mb-1.5 uppercase tracking-wide">Sources</p>
              <ul className="space-y-1">
                {citations.map((c, i) => (
                  <li key={i}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline underline-offset-2 line-clamp-1"
                    >
                      {c.title || c.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionText({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    if (line.trim() === "") {
      elements.push(<div key={key++} className="h-1.5" />);
    } else if (line.startsWith("- ") || line.startsWith("• ")) {
      elements.push(
        <p key={key++} className="text-stone-600 dark:text-stone-400 text-xs leading-6 pl-3 before:content-['·'] before:mr-2 before:text-stone-400 dark:before:text-stone-600">
          {line.replace(/^[-•]\s/, "")}
        </p>
      );
    } else {
      elements.push(
        <p key={key++} className="text-stone-600 dark:text-stone-400 text-xs leading-6">
          {line}
        </p>
      );
    }
  }

  return <div>{elements}</div>;
}
