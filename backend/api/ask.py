"""
Global Ask endpoint — scoped retrieval + SSE streaming.

POST /api/ask
  body: { question, scope, book_id? }
  scope values: "whole_library" | "current_book" | "notes"
  book_id: required when scope = "current_book"
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth.deps import get_current_user
from db.database import get_db
from db.models import Book, User
from services import ask as ask_svc

router = APIRouter(tags=["ask"])

_VALID_SCOPES = {"whole_library", "current_book", "notes"}


class AskIn(BaseModel):
    question: str
    scope: str = "whole_library"
    book_id: int | None = None


@router.post("/api/ask")
async def global_ask(
    body: AskIn,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.question.strip():
        raise HTTPException(status_code=422, detail="Question cannot be empty.")

    if body.scope not in _VALID_SCOPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid scope. Must be one of: {', '.join(sorted(_VALID_SCOPES))}",
        )

    if body.scope == "current_book":
        if not body.book_id:
            raise HTTPException(
                status_code=422, detail="book_id is required when scope is 'current_book'."
            )
        book = await db.get(Book, body.book_id)
        if not book or book.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Book not found.")

    from providers.registry import get_provider_for_task, get_embedding_provider_for_user
    chat_provider = await get_provider_for_task("qa", db, current_user.id)
    embed_provider = await get_embedding_provider_for_user(db, current_user.id)

    async def event_stream():
        async for delta in ask_svc.stream_ask(
            question=body.question,
            scope=body.scope,
            book_id=body.book_id,
            user_id=current_user.id,
            db=db,
            chat_provider=chat_provider,
            embed_provider=embed_provider,
        ):
            safe = delta.replace("\n", "\\n")
            yield f"data: {safe}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
