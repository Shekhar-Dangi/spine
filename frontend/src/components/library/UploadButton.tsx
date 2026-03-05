"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface Props {
  onUploaded?: () => void;
}

export default function UploadButton({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { book_id } = await api.books.upload(file);
      onUploaded?.();
      router.push(`/books/${book_id}/toc-review`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.epub"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-stone-50 dark:text-stone-900 text-xs font-medium hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-50 transition-colors whitespace-nowrap"
      >
        {uploading ? (
          <>
            <span className="w-3 h-3 border border-stone-400 border-t-transparent rounded-full animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="6" y1="1" x2="6" y2="11" />
              <line x1="1" y1="6" x2="11" y2="6" />
            </svg>
            Add book
          </>
        )}
      </button>
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}
