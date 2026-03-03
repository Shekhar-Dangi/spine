"use client";
import { createContext, useContext, useState } from "react";
import type { TocChapter } from "@/types";

interface BookReaderState {
  chapters: TocChapter[];
  setChapters: (chapters: TocChapter[]) => void;
  activeChapterId: number | null;
  setActiveChapterId: (id: number | null) => void;
  selectedText: string;
  setSelectedText: (text: string) => void;
}

const BookReaderContext = createContext<BookReaderState | null>(null);

export function BookReaderProvider({ children }: { children: React.ReactNode }) {
  const [chapters, setChapters] = useState<TocChapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [selectedText, setSelectedText] = useState("");

  return (
    <BookReaderContext.Provider
      value={{ chapters, setChapters, activeChapterId, setActiveChapterId, selectedText, setSelectedText }}
    >
      {children}
    </BookReaderContext.Provider>
  );
}

export function useBookReader() {
  const ctx = useContext(BookReaderContext);
  if (!ctx) throw new Error("useBookReader must be used inside BookReaderProvider");
  return ctx;
}
