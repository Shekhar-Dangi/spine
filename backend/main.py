"""
Spine — FastAPI application entry point.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, update, or_

from config import settings
from db.database import AsyncSessionLocal
from db.models import Book, IngestStatus
from api import books, dossier, explain, qa, map, providers, auth

log = logging.getLogger(__name__)


async def _sweep_stuck_books() -> None:
    """Reset books stuck in PARSING/INGESTING (from a previous crash) to FAILED."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Book).where(
                or_(
                    Book.ingest_status == IngestStatus.PARSING,
                    Book.ingest_status == IngestStatus.INGESTING,
                )
            )
        )
        stuck = result.scalars().all()
        if stuck:
            ids = [b.id for b in stuck]
            await db.execute(
                update(Book)
                .where(Book.id.in_(ids))
                .values(
                    ingest_status=IngestStatus.FAILED,
                    ingest_error="Server restarted during processing. Please retry.",
                )
            )
            await db.commit()
            log.warning("Reset %d stuck books to FAILED: %s", len(ids), ids)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _sweep_stuck_books()
    yield


app = FastAPI(title="Spine API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(books.router)
app.include_router(dossier.router)
app.include_router(explain.router)
app.include_router(qa.router)
app.include_router(map.router)
app.include_router(providers.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
