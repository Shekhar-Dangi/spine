"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { api, streamPost } from "@/lib/api";
import { useBookReader } from "@/contexts/BookReaderContext";
import type { ConversationMessage } from "@/types";

interface Props { bookId: number }

export default function QaView({ bookId }: Props) {
  const { activeChapterId, selectedText, setSelectedText } = useBookReader();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load persisted messages when chapter changes
  useEffect(() => {
    if (!activeChapterId) { setMessages([]); return; }
    api.qa.getConversation(bookId, activeChapterId)
      .then((data) => setMessages(data.messages))
      .catch(() => setMessages([]));
  }, [bookId, activeChapterId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingQuestion, streamingContent]);

  const handleAsk = () => {
    if (!question.trim() || !activeChapterId || loading) return;

    const q = question.trim();
    setQuestion("");
    setError(null);
    setStreamingContent("");
    setPendingQuestion(q);
    setLoading(true);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    streamPost(
      `/api/books/${bookId}/qa`,
      { chapter_id: activeChapterId, selected_text: selectedText, question: q },
      (delta) => {
        if (ctrl.signal.aborted) return;
        setStreamingContent((prev) => (prev ?? "") + delta.replace(/\\n/g, "\n"));
      },
      () => {
        if (ctrl.signal.aborted) return;
        setStreamingContent(null);
        setLoading(false);
        setSelectedText("");
        setPendingQuestion(null);
        api.qa.getConversation(bookId, activeChapterId)
          .then((data) => setMessages(data.messages))
          .catch(() => {});
      },
      (err) => {
        if (ctrl.signal.aborted) return;
        setError(err.message);
        setStreamingContent(null);
        setPendingQuestion(null);
        setLoading(false);
      },
      ctrl.signal,
    );
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreamingContent(null);
    setPendingQuestion(null);
    setLoading(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && !streamingContent && (
          <p className="text-xs text-stone-400 dark:text-stone-600 mt-2 leading-relaxed">
            {activeChapterId
              ? "No questions yet for this chapter. Ask anything below."
              : "Open a chapter to start asking questions."}
          </p>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {pendingQuestion !== null && (
          <MessageBubble role="user" content={pendingQuestion} />
        )}

        {streamingContent !== null && (
          <MessageBubble role="assistant" content={streamingContent} streaming />
        )}

        {error && (
          <p className="text-red-500 dark:text-red-400 text-xs">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-stone-200 dark:border-stone-800 px-5 py-3 space-y-2 bg-stone-50 dark:bg-stone-900/50">
        {selectedText && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 text-xs text-stone-600 dark:text-stone-400 leading-5 relative">
            <p className="line-clamp-2 italic pr-5">"{selectedText}"</p>
            <button
              onClick={() => setSelectedText("")}
              className="absolute top-1.5 right-2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
              aria-label="Clear selection"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleAsk()}
            placeholder={selectedText ? "Ask about the selection…" : "Ask about this chapter…"}
            disabled={!activeChapterId || loading}
            className="flex-1 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 dark:focus:border-amber-500 disabled:opacity-50 transition-colors"
          />
          {loading ? (
            <button
              onClick={handleStop}
              className="px-4 py-2 rounded-lg bg-red-100 hover:bg-red-200 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-medium transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleAsk}
              disabled={!question.trim() || !activeChapterId}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 dark:hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-medium transition-colors"
            >
              Ask
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-amber-600 dark:bg-amber-700 px-4 py-2.5 text-sm text-white leading-6">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-[8px] text-stone-500 dark:text-stone-400 font-bold tracking-wide">
        AI
      </div>
      <div className="flex-1 text-sm text-stone-700 dark:text-stone-300 leading-7 prose prose-sm prose-stone dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {content}
        </ReactMarkdown>
        {streaming && (
          <span className="inline-block w-1.5 h-4 ml-0.5 bg-amber-500 animate-pulse rounded-sm align-middle" />
        )}
      </div>
    </div>
  );
}
