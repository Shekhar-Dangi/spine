"""
Q&A endpoints — selection Q&A and map node Q&A (both SSE).
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import get_db
from db.models import Book, IngestStatus
from services import qa as qa_svc

router = APIRouter(prefix="/api/books", tags=["qa"])


class SelectionQaIn(BaseModel):
    chapter_id: int
    selected_text: str
    question: str


class NodeQaIn(BaseModel):
    chapter_id: int
    node_label: str
    question: str


@router.post("/{book_id}/selection/qa")
async def selection_qa(
    book_id: int,
    body: SelectionQaIn,
    db: AsyncSession = Depends(get_db),
):
    book = await db.get(Book, book_id)
    if not book or book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready.")

    from providers.registry import get_active_provider
    provider = await get_active_provider(db)

    async def event_stream():
        async for delta in qa_svc.stream_selection_qa(
            book_id, body.chapter_id, body.selected_text, body.question, db, provider
        ):
            yield f"data: {delta}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/{book_id}/map/node-qa")
async def node_qa(
    book_id: int,
    body: NodeQaIn,
    db: AsyncSession = Depends(get_db),
):
    book = await db.get(Book, book_id)
    if not book or book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready.")

    from providers.registry import get_active_provider
    provider = await get_active_provider(db)

    async def event_stream():
        async for delta in qa_svc.stream_node_qa(
            book_id, body.chapter_id, body.node_label, body.question, db, provider
        ):
            yield f"data: {delta}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
