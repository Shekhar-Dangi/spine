"""
Dossier endpoints.
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import AsyncSessionLocal, get_db
from db.models import Book, Dossier, DossierSection, IngestStatus
from services import dossier as dossier_svc

router = APIRouter(prefix="/api/books", tags=["dossier"])


class GenerateRequest(BaseModel):
    use_web_search: bool = True


@router.post("/{book_id}/dossier/generate", response_model=dict)
async def generate_dossier(
    book_id: int,
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    book = await db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready yet.")

    from providers.registry import get_active_provider
    provider = await get_active_provider(db)

    # Create (or reset) the Dossier row so GET /dossier returns "generating" state
    result = await db.execute(select(Dossier).where(Dossier.book_id == book_id))
    existing = result.scalar_one_or_none()
    if existing:
        existing.generated_at = None  # signal: regenerating in progress
        await db.commit()
        dossier_id = existing.id
    else:
        new_dossier = Dossier(book_id=book_id, version=0, generated_at=None)
        db.add(new_dossier)
        await db.commit()
        await db.refresh(new_dossier)
        dossier_id = new_dossier.id

    use_web_search = body.use_web_search

    async def _task():
        async with AsyncSessionLocal() as bg_db:
            await dossier_svc.generate_dossier(book_id, bg_db, provider, use_web_search)

    background_tasks.add_task(_task)
    return {"book_id": book_id, "status": "generating"}


@router.get("/{book_id}/dossier", response_model=dict)
async def get_dossier(book_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Dossier).where(Dossier.book_id == book_id))
    dossier = result.scalar_one_or_none()
    if not dossier:
        raise HTTPException(status_code=404, detail="Dossier not generated yet.")

    sections_result = await db.execute(
        select(DossierSection).where(DossierSection.dossier_id == dossier.id)
    )
    sections = sections_result.scalars().all()
    return {
        "id": dossier.id,
        "book_id": book_id,
        "version": dossier.version,
        "generated_at": dossier.generated_at.isoformat() if dossier.generated_at else None,
        "sections": [
            {
                "section_type": s.section_type,
                "content": s.content,
                "citations": s.citations_json,
            }
            for s in sections
        ],
    }
