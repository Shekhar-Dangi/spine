"use client";
/**
 * GeoMapWidget — floating, resizable geographic map panel.
 *
 * - Drag the resize handle (bottom-right corner) to resize.
 * - Click the expand icon to toggle fullscreen.
 * - Clicking a marker opens a detail panel (map stays open).
 * - "Set as context" pins the marker to Q&A / Explain without closing the map.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { useBookReader } from "@/contexts/BookReaderContext";
import type { GeoMap, GeoMarker } from "@/types";

const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-xs text-stone-400 dark:text-stone-600">
      Loading map…
    </div>
  ),
});

const MIN_W = 320;
const MIN_H = 280;
const DEFAULT_W = 480;
const DEFAULT_H = 420;

interface Props {
  bookId: number;
  onClose: () => void;
}

export default function GeoMapWidget({ bookId, onClose }: Props) {
  const { activeChapterId, activeMapMarker, setActiveMapMarker } = useBookReader();
  const [geoMap, setGeoMap] = useState<GeoMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dims, setDims] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const [selectedMarker, setSelectedMarker] = useState<GeoMarker | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [contextJustSet, setContextJustSet] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (!activeChapterId) { setGeoMap(null); setSelectedMarker(null); return; }
    setLoading(true);
    setError(null);
    api.geoMap.get(bookId, activeChapterId)
      .then((m) => {
        setGeoMap(m);
        if (m.status === "generating") startPolling(activeChapterId);
      })
      .catch(() => setGeoMap(null))
      .finally(() => setLoading(false));
  }, [bookId, activeChapterId]);

  // Sync note textarea when selected marker changes
  useEffect(() => {
    setNoteText(selectedMarker?.user_annotation ?? "");
    setContextJustSet(false);
  }, [selectedMarker?.id]);

  function startPolling(chapterId: number) {
    if (pollRef.current) clearInterval(pollRef.current);
    setGenerating(true);
    pollRef.current = setInterval(async () => {
      try {
        const m = await api.geoMap.get(bookId, chapterId);
        setGeoMap(m);
        if (m.status === "ready" || m.status === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setGenerating(false);
        }
      } catch {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setGenerating(false);
      }
    }, 2000);
  }

  async function handleGenerate() {
    if (!activeChapterId || generating) return;
    setError(null);
    setSelectedMarker(null);
    try {
      await api.geoMap.generate(bookId, activeChapterId);
      startPolling(activeChapterId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start generation");
    }
  }

  function handleMarkerClick(marker: GeoMarker) {
    // Don't close the map — open the detail panel instead
    setSelectedMarker(marker);
  }

  async function handleNoteSave() {
    if (!selectedMarker) return;
    setNoteSaving(true);
    try {
      const updated = await api.geoMap.updateMarker(selectedMarker.id, noteText || null);
      if (geoMap) {
        setGeoMap({
          ...geoMap,
          markers: geoMap.markers.map((m) => (m.id === updated.id ? updated : m)),
        });
      }
      setSelectedMarker(updated);
    } catch { /* silent */ } finally {
      setNoteSaving(false);
    }
  }

  function handleAnnotationSave(markerId: number, annotation: string) {
    // Used by MapCanvas (legacy) — kept for compatibility
    api.geoMap.updateMarker(markerId, annotation || null)
      .then((updated) => {
        if (geoMap) {
          setGeoMap({
            ...geoMap,
            markers: geoMap.markers.map((m) => (m.id === updated.id ? updated : m)),
          });
        }
      })
      .catch(() => {});
  }

  function handleSetContext() {
    if (!selectedMarker) return;
    setActiveMapMarker(selectedMarker);
    setContextJustSet(true);
    setTimeout(() => setContextJustSet(false), 2000);
  }

  // ---------------------------------------------------------------------------
  // Resize drag
  // ---------------------------------------------------------------------------
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: dims.w, startH: dims.h };

    function onMouseMove(ev: MouseEvent) {
      if (!resizeRef.current) return;
      const { startX, startY, startW, startH } = resizeRef.current;
      setDims({
        w: Math.max(MIN_W, startW + (ev.clientX - startX)),
        h: Math.max(MIN_H, startH + (ev.clientY - startY)),
      });
    }
    function onMouseUp() {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [dims]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const hasMap = geoMap && geoMap.status === "ready";
  const isContextActive = activeMapMarker?.id === selectedMarker?.id && selectedMarker != null;

  const containerStyle = isFullscreen
    ? { top: "1rem", left: "1rem", right: "1rem", bottom: "1rem" }
    : { bottom: "4rem", right: "1rem", width: dims.w, height: dims.h };

  return (
    <div
      className="fixed z-50 flex flex-col rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-2xl transition-all duration-300 ease-in-out"
      style={containerStyle}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/50 rounded-t-xl select-none">
        <div className="flex items-center gap-2 min-w-0">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M1.5 8h13M8 1.5C6 4 5 6 5 8s1 4 3 6.5M8 1.5C10 4 11 6 11 8s-1 4-3 6.5" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-medium text-stone-700 dark:text-stone-300 shrink-0">Chapter Map</span>
          {geoMap?.period_label && (
            <span className="text-[10px] text-stone-400 dark:text-stone-600 truncate">— {geoMap.period_label}</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasMap && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              title="Regenerate map"
              className="text-[10px] text-stone-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-40"
            >
              Regenerate
            </button>
          )}

          <button
            onClick={() => setIsFullscreen((f) => !f)}
            title={isFullscreen ? "Exit fullscreen" : "Expand map"}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
          >
            {isFullscreen ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
                <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
                <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          <button
            onClick={onClose}
            title="Close map"
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
              <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 relative overflow-hidden rounded-b-xl">
        {!activeChapterId && <EmptyState message="Open a chapter to generate a map." />}
        {activeChapterId && loading && <EmptyState message="Loading…" />}

        {activeChapterId && !loading && !geoMap && !generating && (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-10 h-10 text-stone-300 dark:text-stone-700">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2C9 6 8 9 8 12s1 6 4 10M12 2c3 4 4 7 4 10s-1 6-4 10" strokeLinecap="round" />
            </svg>
            <p className="text-xs text-stone-500 dark:text-stone-500 text-center max-w-[220px]">
              No map generated for this chapter yet. The LLM will extract and locate geographic places mentioned.
            </p>
            <button
              onClick={handleGenerate}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
            >
              Generate Map
            </button>
            {error && <p className="text-[11px] text-red-500 dark:text-red-400 text-center">{error}</p>}
          </div>
        )}

        {(generating || geoMap?.status === "generating") && !hasMap && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-6 h-6 rounded-full border-2 border-amber-600 border-t-transparent animate-spin" />
            <p className="text-xs text-stone-500 dark:text-stone-500">Extracting places from chapter…</p>
          </div>
        )}

        {geoMap?.status === "failed" && !generating && (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
            <p className="text-xs text-red-500 dark:text-red-400 text-center">
              {geoMap.error_message ?? "Generation failed."}
            </p>
            <button
              onClick={handleGenerate}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {hasMap && geoMap.markers.length === 0 && (
          <EmptyState message="No geographic places found in this chapter." />
        )}

        {hasMap && geoMap.markers.length > 0 && (
          <>
            <MapCanvas
              geoMap={geoMap}
              isFullscreen={isFullscreen}
              selectedMarkerId={selectedMarker?.id}
              onMarkerClick={handleMarkerClick}
              onAnnotationSave={handleAnnotationSave}
            />

            {/* Marker detail panel — overlays map on the right */}
            {selectedMarker && (
              <div className="absolute top-0 right-0 bottom-0 w-72 flex flex-col bg-white/92 dark:bg-stone-900/92 backdrop-blur-sm border-l border-stone-200 dark:border-stone-700 shadow-xl overflow-hidden"
                style={{ zIndex: 1000 }}
              >
                {/* Panel header */}
                <div className="shrink-0 flex items-start justify-between px-4 pt-3.5 pb-2.5 border-b border-stone-100 dark:border-stone-800">
                  <div className="min-w-0 flex-1 pr-2">
                    <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 leading-tight">
                      {selectedMarker.place_name}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 capitalize">
                        {selectedMarker.marker_type}
                      </span>
                      <ConfidenceDot confidence={selectedMarker.confidence} />
                      {selectedMarker.period_label && (
                        <span className="text-[10px] text-stone-400 dark:text-stone-500">{selectedMarker.period_label}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedMarker(null)}
                    className="shrink-0 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors mt-0.5"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
                      <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs">

                  {/* LLM annotation */}
                  <div>
                    <p className="text-[10px] font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">
                      About this place
                    </p>
                    <p className="text-stone-700 dark:text-stone-300 leading-relaxed">
                      {selectedMarker.llm_annotation || "No description available."}
                    </p>
                  </div>

                  {/* User note */}
                  <div>
                    <p className="text-[10px] font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wide mb-1.5">
                      My note
                    </p>
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onBlur={handleNoteSave}
                      placeholder="Add your thoughts about this place…"
                      rows={4}
                      className="w-full rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-800 dark:text-stone-200 placeholder-stone-400 dark:placeholder-stone-600 px-2.5 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-amber-500 transition-colors"
                    />
                    {noteSaving && (
                      <p className="text-[10px] text-stone-400 mt-1">Saving…</p>
                    )}
                  </div>
                </div>

                {/* Panel footer — set context button */}
                <div className="shrink-0 px-4 py-3 border-t border-stone-100 dark:border-stone-800">
                  <button
                    onClick={handleSetContext}
                    className={`w-full py-2 rounded-lg text-xs font-medium transition-all ${
                      contextJustSet || isContextActive
                        ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                        : "bg-amber-600 hover:bg-amber-700 text-white"
                    }`}
                  >
                    {contextJustSet
                      ? "✓ Context set — switch to Q&A or Explain"
                      : isContextActive
                        ? "✓ Active in Q&A / Explain"
                        : "Set as reading context"}
                  </button>
                  <p className="text-[10px] text-stone-400 dark:text-stone-600 text-center mt-1.5 leading-tight">
                    This place will be sent automatically to the LLM in Q&A and Explain.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Resize handle — hidden in fullscreen */}
      {!isFullscreen && (
        <div
          onMouseDown={onResizeMouseDown}
          title="Drag to resize"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize rounded-br-xl flex items-end justify-end p-0.5"
          style={{ zIndex: 10 }}
        >
          <svg viewBox="0 0 8 8" className="w-2.5 h-2.5 text-stone-300 dark:text-stone-600">
            <path d="M7 1L1 7M7 4L4 7M7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-stone-400 dark:text-stone-600">{message}</p>
    </div>
  );
}

function ConfidenceDot({ confidence }: { confidence: GeoMarker["confidence"] }) {
  const colors: Record<string, string> = {
    high: "bg-amber-500",
    medium: "bg-stone-400",
    low: "bg-stone-300",
  };
  const labels: Record<string, string> = {
    high: "high confidence",
    medium: "medium confidence",
    low: "low confidence",
  };
  return (
    <span className="flex items-center gap-1 text-[10px] text-stone-400 dark:text-stone-500">
      <span className={`w-1.5 h-1.5 rounded-full ${colors[confidence] ?? colors.medium}`} />
      {labels[confidence] ?? confidence}
    </span>
  );
}
