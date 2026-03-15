"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type LinkObject, type NodeObject } from "react-force-graph-2d";
import type { KnowledgeEdge, KnowledgeNode } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GNode = NodeObject & { name: string; nodeType: string };
type GLink = LinkObject & { relation: string };

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const TYPE_COLOR: Record<string, string> = {
  concept: "#38bdf8",
  person:  "#a78bfa",
  event:   "#fbbf24",
  place:   "#34d399",
  era:     "#fb7185",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  selectedNodeId: number | null;
  onNodeClick: (id: number) => void;
}

// ---------------------------------------------------------------------------
// GraphCanvas
// ---------------------------------------------------------------------------

export default function GraphCanvas({ nodes, edges, selectedNodeId, onNodeClick }: Props) {
  const [hoveredId, setHoveredId] = useState<string | number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Build graph data — re-computed only when node/edge sets change
  const graphData = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ id: n.id, name: n.name, nodeType: n.type })),
      links: edges.map((e) => ({
        source: e.from_node_id,
        target: e.to_node_id,
        relation: e.relation,
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes.map((n) => n.id).join(","), edges.map((e) => e.id).join(",")],
  );

  // ---------------------------------------------------------------------------
  // Canvas draw: nodes
  // ---------------------------------------------------------------------------

  const nodeCanvasObject = useCallback(
    (rawNode: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = rawNode as GNode & { x: number; y: number };
      const { x, y, id, name, nodeType } = node;
      const color = TYPE_COLOR[nodeType] ?? "#78716c";
      const isSelected = id === selectedNodeId;
      const isHovered = id === hoveredId;
      const r = isSelected ? 6 : isHovered ? 5 : 4;

      // Dot
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = isSelected || isHovered ? color : `${color}bb`;
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = `${color}44`;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // Label
      const fontSize = Math.max(10 / globalScale, 2);
      ctx.font = `${isSelected || isHovered ? "500" : "400"} ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isSelected ? "#f5f5f4" : isHovered ? "#e7e5e4" : "#78716c";
      ctx.fillText(name, x, y + r + 2 / globalScale);
    },
    [selectedNodeId, hoveredId],
  );

  // ---------------------------------------------------------------------------
  // Canvas draw: links (with visible relation label)
  // ---------------------------------------------------------------------------

  const linkCanvasObject = useCallback(
    (rawLink: LinkObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const link = rawLink as GLink;
      const src = link.source as GNode & { x: number; y: number };
      const tgt = link.target as GNode & { x: number; y: number };
      if (src.x == null || tgt.x == null) return;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // Stop line just before the target node's edge
      const nodeR = 5;
      const ex = tgt.x - (nodeR / dist) * dx;
      const ey = tgt.y - (nodeR / dist) * dy;

      // Line
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = "#44403c";
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(dy, dx);
      const arrowLen = 6 / globalScale;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - arrowLen * Math.cos(angle - 0.4), ey - arrowLen * Math.sin(angle - 0.4));
      ctx.lineTo(ex - arrowLen * Math.cos(angle + 0.4), ey - arrowLen * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = "#57534e";
      ctx.fill();

      // Relation label at midpoint
      if (!link.relation) return;
      const mx = (src.x + tgt.x) / 2;
      const my = (src.y + tgt.y) / 2;
      const fontSize = Math.max(8 / globalScale, 1.5);
      ctx.font = `500 ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(link.relation).width;
      const pad = 3 / globalScale;
      // Background rect
      ctx.fillStyle = "rgba(28,25,23,0.88)";
      ctx.fillRect(mx - tw / 2 - pad, my - fontSize / 2 - pad, tw + pad * 2, fontSize + pad * 2);
      // Label text
      ctx.fillStyle = "#a8a29e";
      ctx.fillText(link.relation, mx, my);
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const handleNodeClick = useCallback(
    (node: NodeObject) => { onNodeClick(node.id as number); },
    [onNodeClick],
  );

  const handleNodeHover = useCallback(
    (node: NodeObject | null) => { setHoveredId(node ? (node.id as string | number) : null); },
    [],
  );

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  if (nodes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-stone-500 dark:text-stone-600">
        No nodes yet. Approve suggestions in Review to build your graph.
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <ForceGraph2D
        graphData={graphData}
        width={size.width}
        height={size.height}
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => "replace"}
        linkCanvasObject={linkCanvasObject}
        linkCanvasObjectMode={() => "replace"}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        backgroundColor="transparent"
        nodeLabel=""
        linkDirectionalArrowLength={0}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        cooldownTicks={150}
      />
    </div>
  );
}
