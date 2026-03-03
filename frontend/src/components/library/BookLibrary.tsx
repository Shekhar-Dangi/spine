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
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-serif italic text-lg text-stone-800 dark:text-stone-200">
          Your Library
        </h2>
        <UploadButton onUploaded={fetchBooks} />
      </div>

      {loading && (
        <p className="text-sm text-stone-400 dark:text-stone-600">Loading…</p>
      )}
      {error && (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      )}

      {!loading && books.length === 0 && (
        <div className="text-center py-24 border border-dashed border-stone-300 dark:border-stone-700 rounded-2xl">
          <p className="text-sm text-stone-400 dark:text-stone-600">
            No books yet.{" "}
            <span className="text-stone-500 dark:text-stone-500">
              Upload a PDF or EPUB to get started.
            </span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {books.map((book) => (
          <BookCard key={book.id} book={book} onChanged={fetchBooks} />
        ))}
      </div>
    </div>
  );
}
