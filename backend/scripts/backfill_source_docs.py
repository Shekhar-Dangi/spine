"""
Phase 4e backfill — migrate ExtractionJobs that used the deprecated
`source_content` column to proper SourceDocument + SourceChunk rows.

Finds all extraction_jobs where source_content IS NOT NULL and
source_doc_id IS NULL, creates a SourceDocument (type=manual_text) per
job, chunks and embeds the content, then sets source_doc_id on the job.

Run once after applying migrations 008+:
  cd backend && .venv/bin/python3.13 scripts/backfill_source_docs.py

The script is idempotent: jobs that already have source_doc_id are skipped.
"""
import asyncio
import logging
import os
import sys

# Allow running from the backend/ directory or from the repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import ExtractionJob, SourceDocType
from services.source_docs import chunk_and_embed, create_source_document

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)


async def run() -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ExtractionJob).where(
                ExtractionJob.source_content.isnot(None),
                ExtractionJob.source_doc_id.is_(None),
            )
        )
        jobs = result.scalars().all()

    if not jobs:
        log.info("Nothing to backfill — no eligible jobs found.")
        return

    log.info("Backfilling %d extraction job(s) …", len(jobs))

    ok = 0
    failed = 0

    for job in jobs:
        async with AsyncSessionLocal() as db:
            # Re-fetch the job inside its own session
            j = await db.get(ExtractionJob, job.id)
            if j is None or j.source_doc_id is not None:
                log.info("  job %d — already processed, skipping", job.id)
                continue

            log.info("  job %d (user %d) — creating source_document …", j.id, j.user_id)
            try:
                from providers.registry import get_embedding_provider_for_user

                embed_provider = await get_embedding_provider_for_user(db, j.user_id)

                doc = await create_source_document(
                    user_id=j.user_id,
                    source_type=SourceDocType.MANUAL_TEXT,
                    content=j.source_content,
                    title=f"Backfilled from extraction job #{j.id}",
                    origin_ref={"extraction_job_id": j.id},
                    db=db,
                )

                await chunk_and_embed(doc, db=db, embed_provider=embed_provider)

                j.source_doc_id = doc.id
                await db.commit()

                log.info(
                    "  job %d → source_doc %d (%d chars)",
                    j.id,
                    doc.id,
                    len(j.source_content or ""),
                )
                ok += 1
            except Exception as exc:
                await db.rollback()
                log.error("  job %d — failed: %s", job.id, exc)
                failed += 1

    log.info("Done. %d migrated, %d failed.", ok, failed)


if __name__ == "__main__":
    asyncio.run(run())
