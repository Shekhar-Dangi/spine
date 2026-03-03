"use client";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

type LineSpacing = "1" | "1.5" | "2" | "2.5";

const SPACING_OPTIONS: { label: string; value: LineSpacing }[] = [
  { label: "1.0×", value: "1" },
  { label: "1.5×", value: "1.5" },
  { label: "2.0×", value: "2" },
  { label: "2.5×", value: "2.5" },
];

interface Props {
  content: string;
  chapterNum: number;
  onClose: () => void;
}

const buildPrintCSS = (lineSpacing: string) => `
@page { size: A4; margin: 2cm; }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: #fff;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 12pt;
  color: #1a1a1a;
  line-height: ${lineSpacing};
}
.content { padding: 0; }
h1 { font-size: 1.6em; font-weight: 700; margin: 1.4em 0 0.5em; }
h2 { font-size: 1.3em; font-weight: 600; margin: 1.1em 0 0.4em; }
h3 { font-size: 1.15em; font-weight: 600; margin: 0.9em 0 0.3em; }
h4,h5,h6 { font-weight: 600; margin: 0.7em 0 0.2em; }
p { margin: 0.55em 0; }
ul, ol { margin: 0.5em 0; padding-left: 1.8em; }
li { margin: 0.2em 0; }
strong, b { font-weight: 700; }
em, i { font-style: italic; }
code {
  background: #f3f4f6; padding: 0.15em 0.4em; border-radius: 3px;
  font-family: "Courier New", Courier, monospace; font-size: 0.88em;
}
pre {
  background: #f3f4f6; padding: 0.8em 1em; border-radius: 4px;
  margin: 0.6em 0; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;
}
pre code { background: none; padding: 0; }
blockquote {
  border-left: 3px solid #d1d5db; padding-left: 1em;
  color: #555; margin: 0.6em 0;
}
hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }
table { border-collapse: collapse; width: 100%; margin: 0.6em 0; }
th, td { border: 1px solid #d1d5db; padding: 0.4em 0.6em; text-align: left; }
th { background: #f9fafb; font-weight: 600; }
a { color: #1a1a1a; text-decoration: underline; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; break-after: avoid; }
  pre, blockquote, table, figure, img { page-break-inside: avoid; break-inside: avoid; }
  p { orphans: 3; widows: 3; }
}
`;

export default function ExportPdfModal({ content, chapterNum, onClose }: Props) {
  const [spacing, setSpacing] = useState<LineSpacing>("1.5");
  const [preparing, setPreparing] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const handleDownload = async () => {
    if (!previewRef.current) return;
    setPreparing(true);

    try {
      const iframe = document.createElement("iframe");
      iframe.style.cssText =
        "position:fixed;left:-9999px;top:0;width:760px;height:1px;border:none;visibility:hidden;";
      document.body.appendChild(iframe);

      const iDoc = iframe.contentDocument!;
      iDoc.open();
      iDoc.write(
        `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Chapter ${chapterNum} – Explanation</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.33/dist/katex.min.css" crossorigin="anonymous">
<style>${buildPrintCSS(spacing)}</style>
</head><body>
<div class="content">${previewRef.current.innerHTML}</div>
</body></html>`,
      );
      iDoc.close();

      await new Promise<void>((resolve) => {
        iframe.onload = () => setTimeout(resolve, 600);
        setTimeout(resolve, 2000);
      });

      iframe.contentWindow!.focus();
      iframe.contentWindow!.print();

      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch { /* already removed */ }
      }, 500);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-2xl w-[720px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-stone-700 shrink-0">
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200">Export as PDF</h2>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        {/* Spacing controls */}
        <div className="flex items-center gap-2.5 px-6 py-3 border-b border-stone-200 dark:border-stone-700 shrink-0">
          <span className="text-xs text-stone-500 dark:text-stone-400">Line spacing:</span>
          {SPACING_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSpacing(opt.value)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                spacing === opt.value
                  ? "bg-amber-600 text-white"
                  : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-y-auto p-4 bg-stone-100 dark:bg-stone-950">
          <div
            ref={previewRef}
            className="bg-white text-stone-900 rounded p-8 max-w-none shadow-sm"
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: "12pt",
              lineHeight: spacing,
              color: "#1a1a1a",
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                h1: (props) => <h1 style={{ fontSize: "1.6em", fontWeight: 700, margin: "1.4em 0 0.5em" }} {...props} />,
                h2: (props) => <h2 style={{ fontSize: "1.3em", fontWeight: 600, margin: "1.1em 0 0.4em" }} {...props} />,
                h3: (props) => <h3 style={{ fontSize: "1.15em", fontWeight: 600, margin: "0.9em 0 0.3em" }} {...props} />,
                p: (props) => <p style={{ margin: "0.55em 0" }} {...props} />,
                ul: (props) => <ul style={{ margin: "0.5em 0", paddingLeft: "1.8em" }} {...props} />,
                ol: (props) => <ol style={{ margin: "0.5em 0", paddingLeft: "1.8em" }} {...props} />,
                li: (props) => <li style={{ margin: "0.2em 0" }} {...props} />,
                blockquote: (props) => <blockquote style={{ borderLeft: "3px solid #d1d5db", paddingLeft: "1em", color: "#555", margin: "0.6em 0" }} {...props} />,
                code: ({ className, children, ...props }) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return (
                      <pre style={{ background: "#f3f4f6", padding: "0.8em 1em", borderRadius: "4px", margin: "0.6em 0", overflowX: "auto", whiteSpace: "pre-wrap", wordWrap: "break-word" }}>
                        <code style={{ fontFamily: '"Courier New", Courier, monospace', fontSize: "0.88em" }} {...props}>{children}</code>
                      </pre>
                    );
                  }
                  return <code style={{ background: "#f3f4f6", padding: "0.15em 0.4em", borderRadius: "3px", fontFamily: '"Courier New", Courier, monospace', fontSize: "0.88em" }} {...props}>{children}</code>;
                },
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-stone-200 dark:border-stone-700 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={preparing}
            className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium transition-colors flex items-center gap-2"
          >
            {preparing && (
              <div className="h-3 w-3 border border-white border-t-transparent rounded-full animate-spin" />
            )}
            {preparing ? "Preparing…" : "Save as PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
