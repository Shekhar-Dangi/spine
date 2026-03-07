"""
Q&A endpoints — SSE streaming Q&A + conversation history.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.deps import get_current_user
from db.database import get_db
from db.models import Book, Conversation, IngestStatus, Message, User
from services import qa as qa_svc

router = APIRouter(prefix="/api/books", tags=["qa"])


class QaIn(BaseModel):
    chapter_id: int
    selected_text: str = ""
    question: str


@router.post("/{book_id}/qa")
async def ask(
    book_id: int,
    body: QaIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    book = await db.get(Book, book_id)
    if not book or book.ingest_status != IngestStatus.READY:
        raise HTTPException(status_code=409, detail="Book is not ready.")

    if not body.question.strip():
        raise HTTPException(status_code=422, detail="Question cannot be empty.")

    from providers.registry import get_provider_for_task
    provider = await get_provider_for_task("qa", db, current_user.id)

    async def event_stream():
        async for delta in qa_svc.stream_qa(
            book_id,
            body.chapter_id,
            body.selected_text,
            body.question,
            db,
            provider,
        ):
            safe = delta.replace("\n", "\\n")
            yield f"data: {safe}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{book_id}/conversation")
async def get_conversation(
    book_id: int,
    chapter_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Conversation).where(Conversation.book_id == book_id)
    )
    conv = result.scalar_one_or_none()
    if not conv:
        return {"conversation_id": None, "messages": []}

    query = select(Message).where(Message.conversation_id == conv.id)
    if chapter_id is not None:
        query = query.where(Message.chapter_id == chapter_id)
    query = query.order_by(Message.id)

    msg_result = await db.execute(query)
    messages = msg_result.scalars().all()

    return {
        "conversation_id": conv.id,
        "messages": [
            {
                "id": m.id,
                "role": m.role.value,
                "content": m.content,
                "chapter_id": m.chapter_id,
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ],
    }
