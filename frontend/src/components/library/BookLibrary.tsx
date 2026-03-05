"use client";
import { useEffect, useRef, useState } from "react";
import UploadButton from "./UploadButton";
import BookCard from "./BookCard";
import { api } from "@/lib/api";
import type { Book, IngestStatus } from "@/types";

const ACTIVE_STATUSES = new Set<IngestStatus>(["uploaded", "parsing", "ingesting"]);

export default function BookLibrary() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBooks = async () => {
    try {
      const data = await api.books.list();
      setBooks(data);
      setError(null);
      if (!data.some((b) => ACTIVE_STATUSES.has(b.ingest_status))) {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load books.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBooks();
    pollRef.current = setInterval(fetchBooks, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-serif italic text-stone-600 dark:text-stone-400 text-sm tracking-wide">
          Your Library
        </h2>
        <UploadButton onUploaded={fetchBooks} />
      </div>

      {loading && (
        <p className="text-xs text-stone-400 dark:text-stone-600 py-2">Loading…</p>
      )}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 py-2">{error}</p>
      )}

      {!loading && books.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-10 h-10 mb-4 rounded-xl border border-stone-200 dark:border-stone-800 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400 dark:text-stone-600">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <p className="text-sm text-stone-500 dark:text-stone-500 font-medium">No books yet</p>
          <p className="text-xs text-stone-400 dark:text-stone-600 mt-1">
            Upload a PDF or EPUB to get started
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {books.map((book) => (
          <BookCard key={book.id} book={book} onChanged={fetchBooks} />
        ))}
      </div>
    </div>
  );
}
