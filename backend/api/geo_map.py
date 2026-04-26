"""
Geographic map endpoints.

GET  /api/books/{book_id}/chapters/{chapter_id}/geo-map          → map + markers (or 404/status)
POST /api/books/{book_id}/chapters/{chapter_id}/geo-map/generate → trigger generation
PATCH /api/geo-markers/{marker_id}                               → update user annotation
POST /api/books/{book_id}/chapters/{chapter_id}/geo-map/markers  → add user marker
"""
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.deps import get_current_user
from db.database import get_db, AsyncSessionLocal
from db.models import (
    Book, Chapter, GeoConfidence, GeoMap, GeoMapStatus, GeoMarker, IngestStatus,
    MarkerType, User,
)
from services import geo_map as geo_map_svc

router = APIRouter(tags=["geo_map"])


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------


def _marker_dict(m: GeoMarker) -> dict:
    return {
        "id": m.id,
        "place_name": m.place_name,
        "latitude": m.latitude,
        "longitude": m.longitude,
        "marker_type": m.marker_type.value,
        "period_label": m.period_label,
        "llm_annotation": m.llm_annotation,
        "user_annotation": m.user_annotation,
        "confidence": m.confidence.value,
    }


def _map_dict(geo_map: GeoMap, markers: list[GeoMarker]) -> dict:
    return {
        "id": geo_map.id,
        "chapter_id": geo_map.chapter_id,
        "book_id": geo_map.book_id,
        "status": geo_map.status.value,
        "period_label": geo_map.period_label,
        "period_start_year": geo_map.period_start_year,
        "period_end_year": geo_map.period_end_year,
        "error_message": geo_map.error_message,
        "generated_at": geo_map.generated_at.isoformat() if geo_map.generated_at else None,
        "markers": [_marker_dict(m) for m in markers],
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/api/books/{book_id}/chapters/{chapter_id}/geo-map")
async def get_geo_map(
    book_id: int,
    chapter_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")

    result = await db.execute(
        select(GeoMap).where(
            GeoMap.book_id == book_id,
            GeoMap.chapter_id == chapter_id,
        )
    )
    geo_map = result.scalar_one_or_none()
    if not geo_map:
        raise HTTPException(status_code=404, detail="No geo map for this chapter.")

    marker_result = await db.execute(
        select(GeoMarker).where(GeoMarker.geo_map_id == geo_map.id)
    )
    markers = marker_result.scalars().all()
    return _map_dict(geo_map, markers)


@router.post("/api/books/{book_id}/chapters/{chapter_id}/geo-map/generate")
async def generate_geo_map(
    book_id: int,
    chapter_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")
    if book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready.")

    chapter = await db.get(Chapter, chapter_id)
    if not chapter or chapter.book_id != book_id:
        raise HTTPException(status_code=404, detail="Chapter not found.")

    from providers.registry import get_provider_for_task
    provider = await get_provider_for_task("geo_extract", db, current_user.id)

    # Upsert a GeoMap row with status=generating
    result = await db.execute(
        select(GeoMap).where(GeoMap.chapter_id == chapter_id)
    )
    geo_map = result.scalar_one_or_none()
    if geo_map:
        geo_map.status = GeoMapStatus.GENERATING
        geo_map.error_message = None
        geo_map.generated_at = None
    else:
        geo_map = GeoMap(
            book_id=book_id,
            chapter_id=chapter_id,
            status=GeoMapStatus.GENERATING,
            created_at=datetime.now(timezone.utc),
        )
        db.add(geo_map)
    await db.commit()
    await db.refresh(geo_map)

    async def _task():
        async with AsyncSessionLocal() as bg_db:
            await geo_map_svc.generate_geo_map(book_id, chapter_id, bg_db, provider)

    background_tasks.add_task(_task)
    return {"status": "generating", "chapter_id": chapter_id}


class UpdateMarkerIn(BaseModel):
    user_annotation: str | None = None


@router.patch("/api/geo-markers/{marker_id}")
async def update_marker(
    marker_id: int,
    body: UpdateMarkerIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    marker = await db.get(GeoMarker, marker_id)
    if not marker:
        raise HTTPException(status_code=404, detail="Marker not found.")

    # Verify ownership via the geo_map → book
    result = await db.execute(
        select(GeoMap).where(GeoMap.id == marker.geo_map_id)
    )
    geo_map = result.scalar_one_or_none()
    if not geo_map:
        raise HTTPException(status_code=404, detail="Marker not found.")

    book = await db.get(Book, geo_map.book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden.")

    marker.user_annotation = body.user_annotation
    await db.commit()
    return _marker_dict(marker)


class AddMarkerIn(BaseModel):
    place_name: str
    latitude: float
    longitude: float
    marker_type: str = "other"
    period_label: str | None = None
    user_annotation: str | None = None


@router.post("/api/books/{book_id}/chapters/{chapter_id}/geo-map/markers", status_code=201)
async def add_marker(
    book_id: int,
    chapter_id: int,
    body: AddMarkerIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = await db.get(Book, book_id)
    if not book or book.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Book not found.")

    result = await db.execute(
        select(GeoMap).where(
            GeoMap.book_id == book_id,
            GeoMap.chapter_id == chapter_id,
        )
    )
    geo_map = result.scalar_one_or_none()
    if not geo_map or geo_map.status != GeoMapStatus.READY:
        raise HTTPException(status_code=409, detail="No ready map for this chapter.")

    marker_type = body.marker_type if body.marker_type in {t.value for t in MarkerType} else "other"

    marker = GeoMarker(
        geo_map_id=geo_map.id,
        place_name=body.place_name.strip(),
        latitude=max(-90.0, min(90.0, body.latitude)),
        longitude=max(-180.0, min(180.0, body.longitude)),
        marker_type=MarkerType(marker_type),
        period_label=body.period_label,
        llm_annotation="User-added marker.",
        user_annotation=body.user_annotation,
        confidence=GeoConfidence.HIGH,
        created_at=datetime.now(timezone.utc),
    )
    db.add(marker)
    await db.commit()
    await db.refresh(marker)
    return _marker_dict(marker)
