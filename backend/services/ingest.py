"""
Ingestion service.

parse_book()    → parse PDF/EPUB, extract TOC, create draft chapters
confirm_toc()   → user-confirmed chapters → chunk → embed via API → pgvector → READY
delete_book_artefacts() → hard-delete all data for a book
"""
import asyncio
import json
import re
import shutil
from pathlib import Path

import fitz  # PyMuPDF
from sqlalchemy import delete as sql_delete, select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import Book, BookFormat, Chapter, ChapterExplain, ChapterMap, Chunk, Dossier, IngestStatus


# ---------------------------------------------------------------------------
# PDF helpers
# ---------------------------------------------------------------------------


def _pdf_toc(file_path: str) -> tuple[list[dict], int]:
    """
    Extract TOC from PDF.
    Falls back to heading heuristics if TOC is empty.
    Returns (chapters, page_count).
    """
    doc = fitz.open(file_path)
    page_count = len(doc)
    toc = doc.get_toc()  # [[level, title, page], ...]

    top = [(title.strip(), max(0, page - 1))
           for level, title, page in toc if level == 1 and title.strip()]

    if not top:
        top = _pdf_heading_fallback(doc)

    if not top:
        doc.close()
        return [{"index": 0, "title": "Full Book", "start_page": 0, "end_page": page_count - 1,
                 "start_anchor": None, "end_anchor": None}], page_count

    chapters = []
    for i, (title, start) in enumerate(top):
        end = top[i + 1][1] - 1 if i + 1 < len(top) else page_count - 1
        chapters.append({
            "index": i,
            "title": title,
            "start_page": start,
            "end_page": end,
            "start_anchor": None,
            "end_anchor": None,
        })

    doc.close()
    return chapters, page_count


def _pdf_heading_fallback(doc: fitz.Document) -> list[tuple[str, int]]:
    """Detect chapter headings by font size on first 80 pages."""
    size_counts: dict[float, int] = {}
    for page_num in range(min(80, len(doc))):
        for block in doc[page_num].get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    size_counts[span["size"]] = size_counts.get(span["size"], 0) + 1

    if not size_counts:
        return []

    body_size = sorted(size_counts.keys(), key=lambda s: size_counts[s], reverse=True)[0]
    heading_threshold = body_size * 1.15

    headings: list[tuple[str, int]] = []
    seen: set[str] = set()
    for page_num in range(len(doc)):
        for block in doc[page_num].get_text("dict")["blocks"]:
            text_parts = []
            is_heading = False
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    if span["size"] >= heading_threshold:
                        is_heading = True
                    text_parts.append(span["text"])
            if is_heading:
                title = " ".join(text_parts).strip()
                if title and title not in seen and len(title) < 120:
                    seen.add(title)
                    headings.append((title, page_num))

    return headings[:80]


def _pdf_chapter_text(file_path: str, start_page: int, end_page: int) -> str:
    doc = fitz.open(file_path)
    pages = [doc[p].get_text() for p in range(start_page, min(end_page + 1, len(doc)))]
    doc.close()
    return "\n\n".join(pages)


def _pdf_metadata(file_path: str) -> dict:
    doc = fitz.open(file_path)
    meta = doc.metadata or {}
    doc.close()
    return meta


# ---------------------------------------------------------------------------
# EPUB helpers
# ---------------------------------------------------------------------------


def _epub_toc(file_path: str) -> tuple[list[dict], int]:
    from ebooklib import epub

    ebook = epub.read_epub(file_path, options={"ignore_ncx": True})

    def _flatten(items, depth=0):
        result = []
        for item in items:
            if isinstance(item, tuple):
                section, children = item
                if hasattr(section, "href"):
                    result.append(section)
                result.extend(_flatten(children, depth + 1))
            elif hasattr(item, "href"):
                result.append(item)
        return result

    toc_links = _flatten(ebook.toc)

    if toc_links:
        chapters = [
            {
                "index": i,
                "title": (getattr(link, "title", None) or f"Chapter {i + 1}").strip(),
                "start_page": None,
                "end_page": None,
                "start_anchor": link.href.split("#")[0],
                "end_anchor": None,
            }
            for i, link in enumerate(toc_links)
        ]
    else:
        spine_ids = [sid for sid, _ in ebook.spine]
        chapters = [
            {
                "index": i,
                "title": f"Section {i + 1}",
                "start_page": None,
                "end_page": None,
                "start_anchor": ebook.get_item_with_id(sid).get_name() if ebook.get_item_with_id(sid) else str(i),
                "end_anchor": None,
            }
            for i, sid in enumerate(spine_ids)
            if ebook.get_item_with_id(sid)
        ]

    return chapters, 0


def _epub_chapter_text(file_path: str, start_anchor: str) -> str:
    from ebooklib import epub

    ebook = epub.read_epub(file_path, options={"ignore_ncx": True})
    item = ebook.get_item_with_href(start_anchor)
    if item is None:
        return ""

    raw = item.get_content().decode("utf-8", errors="ignore")
    text = re.sub(r"<style[^>]*>.*?</style>", " ", raw, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&lt;", "<", text)
    text = re.sub(r"&gt;", ">", text)
    text = re.sub(r"&[a-zA-Z]+;", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------


def _chunk_text(text: str, max_words: int = 700, overlap_words: int = 80) -> list[str]:
    """Split text into chunks with overlap."""
    paras = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    if not paras:
        return [text.strip()] if text.strip() else []

    chunks: list[str] = []
    current: list[str] = []
    current_words = 0

    for para in paras:
        para_word_count = len(para.split())
        if current_words + para_word_count > max_words and current:
            chunk = " ".join(current)
            if chunk.strip():
                chunks.append(chunk)
            overlap_text = " ".join(" ".join(current).split()[-overlap_words:])
            current = [overlap_text, para] if overlap_text else [para]
            current_words = len(" ".join(current).split())
        else:
            current.append(para)
            current_words += para_word_count

    if current:
        chunk = " ".join(current)
        if chunk.strip():
            chunks.append(chunk)

    return chunks


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def parse_book(book_id: int, db: AsyncSession) -> None:
    """
    Parse the uploaded file, extract TOC, create draft Chapter rows.
    Sets status: PARSING → PENDING_TOC_REVIEW (or FAILED).
    """
    book = await db.get(Book, book_id)
    if book is None:
        return

    book.ingest_status = IngestStatus.PARSING
    await db.commit()

    try:
        if book.format == BookFormat.PDF:
            chapters, page_count = await asyncio.to_thread(_pdf_toc, book.file_path)
            meta = await asyncio.to_thread(_pdf_metadata, book.file_path)
            book.page_count = page_count
            if meta.get("author"):
                book.author = meta["author"][:256]
            if meta.get("title", "").strip():
                book.title = meta["title"].strip()[:512]
        else:
            chapters, _ = await asyncio.to_thread(_epub_toc, book.file_path)

        for ch in chapters:
            db.add(Chapter(
                book_id=book_id,
                chapter_index=ch["index"],
                title=ch["title"],
                start_page=ch.get("start_page"),
                end_page=ch.get("end_page"),
                start_anchor=ch.get("start_anchor"),
                end_anchor=ch.get("end_anchor"),
                confirmed=False,
            ))

        book.ingest_status = IngestStatus.PENDING_TOC_REVIEW
        await db.commit()

    except Exception as exc:
        book.ingest_status = IngestStatus.FAILED
        book.ingest_error = str(exc)[:1000]
        await db.commit()
        raise


async def confirm_toc(
    book_id: int,
    chapters: list[dict],
    db: AsyncSession,
    user_id: int,
) -> None:
    """
    Accept user-confirmed chapters → chunk → embed via API → pgvector → READY.
    Requires the user to have an embedding-capable profile configured.
    """
    from providers.registry import get_embedding_provider_for_user

    book = await db.get(Book, book_id)
    if book is None:
        return

    book.ingest_status = IngestStatus.INGESTING
    await db.commit()

    try:
        # Resolve embedding provider before doing expensive work
        embed_provider = await get_embedding_provider_for_user(db, user_id)

        # Remove all draft chapters for this book
        existing = (await db.execute(select(Chapter).where(Chapter.book_id == book_id))).scalars().all()
        for ch in existing:
            await db.delete(ch)
        await db.flush()

        parsed_dir = Path(settings.parsed_path) / str(book_id)
        parsed_dir.mkdir(parents=True, exist_ok=True)

        all_chunk_rows: list[Chunk] = []
        all_texts: list[str] = []
        quality_warnings: list[str] = []

        for ch_data in chapters:
            chapter = Chapter(
                book_id=book_id,
                chapter_index=ch_data["index"],
                title=ch_data["title"],
                start_page=ch_data.get("start_page"),
                end_page=ch_data.get("end_page"),
                start_anchor=ch_data.get("start_anchor"),
                end_anchor=ch_data.get("end_anchor"),
                confirmed=True,
            )
            db.add(chapter)
            await db.flush()

            if book.format == BookFormat.PDF:
                text = await asyncio.to_thread(
                    _pdf_chapter_text,
                    book.file_path,
                    ch_data.get("start_page") or 0,
                    ch_data.get("end_page") or 0,
                )
            else:
                text = await asyncio.to_thread(
                    _epub_chapter_text,
                    book.file_path,
                    ch_data.get("start_anchor") or "",
                )

            word_count = len(text.split())
            if word_count < 50:
                quality_warnings.append(
                    f"Chapter '{ch_data['title']}' has very low text ({word_count} words) "
                    "— may be image-based or a cover page."
                )

            (parsed_dir / f"chapter_{ch_data['index']}.txt").write_text(text, encoding="utf-8")
            chapter.token_estimate = word_count * 4 // 3

            raw_chunks = _chunk_text(text)
            if not raw_chunks:
                raw_chunks = [text[:3000]] if text.strip() else []

            for c_idx, chunk_text in enumerate(raw_chunks):
                anchor = (
                    f"p{ch_data.get('start_page', 0)}:{c_idx}"
                    if book.format == BookFormat.PDF
                    else f"{ch_data.get('start_anchor', '')}:{c_idx}"
                )
                chunk_id = f"b{book_id}_ch{chapter.id}_c{c_idx}"
                chunk_row = Chunk(
                    book_id=book_id,
                    chapter_id=chapter.id,
                    text=chunk_text,
                    anchor=anchor,
                    embedding_id=chunk_id,
                )
                db.add(chunk_row)
                all_chunk_rows.append(chunk_row)
                all_texts.append(chunk_text)

        await db.commit()

        # Embed via API and store vectors in pgvector in batches
        if all_texts:
            batch = 100
            for i in range(0, len(all_texts), batch):
                batch_texts = all_texts[i: i + batch]
                embeddings = await embed_provider.embed_texts(batch_texts)
                batch_rows = all_chunk_rows[i: i + batch]
                for row, vec in zip(batch_rows, embeddings):
                    await db.execute(
                        sql_update(Chunk)
                        .where(Chunk.id == row.id)
                        .values(embedding=vec)
                    )
            await db.commit()

        # Record which profile was used so retrieval uses the same model
        from sqlalchemy import select as sa_select
        from db.models import TaskProviderMapping, ModelProfile
        mapping_result = await db.execute(
            sa_select(TaskProviderMapping).where(
                TaskProviderMapping.user_id == user_id,
                TaskProviderMapping.task_name == "embed",
            )
        )
        mapping = mapping_result.scalar_one_or_none()
        if mapping and mapping.profile_id:
            book.embedding_profile_id = mapping.profile_id
        else:
            # Find the first active embedding-capable profile that was used
            profile_result = await db.execute(
                sa_select(ModelProfile).where(
                    ModelProfile.user_id == user_id,
                    ModelProfile.active == True,
                ).order_by(ModelProfile.created_at)
            )
            for profile in profile_result.scalars().all():
                if profile.has_capability("embedding"):
                    book.embedding_profile_id = profile.id
                    break

        book.ingest_quality_json = json.dumps({"warnings": quality_warnings})
        book.ingest_status = IngestStatus.READY
        await db.commit()

    except Exception as exc:
        book.ingest_status = IngestStatus.FAILED
        book.ingest_error = str(exc)[:1000]
        await db.commit()
        raise


async def retry_embed(book_id: int, db: AsyncSession, user_id: int) -> None:
    """
    Re-run only the embedding step for a FAILED book.
    Chunks are already in the DB — this just re-embeds and stores vectors.
    """
    from providers.registry import get_embedding_provider_for_user

    book = await db.get(Book, book_id)
    if book is None:
        return

    book.ingest_status = IngestStatus.INGESTING
    book.ingest_error = None
    await db.commit()

    try:
        embed_provider = await get_embedding_provider_for_user(db, user_id)

        result = await db.execute(select(Chunk).where(Chunk.book_id == book_id).order_by(Chunk.id))
        chunks = result.scalars().all()

        if not chunks:
            raise ValueError(
                "No chunks found — the book may need to be re-uploaded and re-confirmed."
            )

        all_texts = [c.text for c in chunks]
        all_ids = [c.id for c in chunks]

        batch = 100
        for i in range(0, len(all_texts), batch):
            batch_texts = all_texts[i: i + batch]
            embeddings = await embed_provider.embed_texts(batch_texts)
            batch_ids = all_ids[i: i + batch]
            for chunk_id, vec in zip(batch_ids, embeddings):
                await db.execute(
                    sql_update(Chunk)
                    .where(Chunk.id == chunk_id)
                    .values(embedding=vec)
                )
        await db.commit()

        # Update embedding_profile_id to whichever profile was used
        from sqlalchemy import select as sa_select
        from db.models import TaskProviderMapping, ModelProfile
        mapping_result = await db.execute(
            sa_select(TaskProviderMapping).where(
                TaskProviderMapping.user_id == user_id,
                TaskProviderMapping.task_name == "embed",
            )
        )
        mapping = mapping_result.scalar_one_or_none()
        if mapping and mapping.profile_id:
            book.embedding_profile_id = mapping.profile_id
        else:
            profile_result = await db.execute(
                sa_select(ModelProfile).where(
                    ModelProfile.user_id == user_id,
                    ModelProfile.active == True,
                ).order_by(ModelProfile.created_at)
            )
            for profile in profile_result.scalars().all():
                if profile.has_capability("embedding"):
                    book.embedding_profile_id = profile.id
                    break

        book.ingest_status = IngestStatus.READY
        book.ingest_error = None
        await db.commit()

    except Exception as exc:
        book.ingest_status = IngestStatus.FAILED
        book.ingest_error = str(exc)[:1000]
        await db.commit()
        raise


async def reset_and_reparse(book_id: int, db: AsyncSession) -> None:
    """
    Wipe all derived data for a book and re-run parse_book() so the user
    can review and confirm the TOC again.
    """
    parsed_dir = Path(settings.parsed_path) / str(book_id)
    if parsed_dir.exists():
        shutil.rmtree(parsed_dir)

    await db.execute(sql_delete(ChapterMap).where(ChapterMap.book_id == book_id))
    await db.execute(sql_delete(ChapterExplain).where(ChapterExplain.book_id == book_id))
    await db.execute(sql_delete(Chunk).where(Chunk.book_id == book_id))
    await db.execute(sql_delete(Chapter).where(Chapter.book_id == book_id))
    await db.execute(sql_delete(Dossier).where(Dossier.book_id == book_id))
    await db.commit()

    await parse_book(book_id, db)


async def delete_book_artefacts(book_id: int, file_path: str, db: AsyncSession) -> None:
    """Hard-delete: file, parsed artefacts, all DB rows."""
    upload = Path(file_path)
    if upload.exists():
        upload.unlink()

    parsed_dir = Path(settings.parsed_path) / str(book_id)
    if parsed_dir.exists():
        shutil.rmtree(parsed_dir)

    book = await db.get(Book, book_id)
    if book:
        await db.delete(book)
        await db.commit()
