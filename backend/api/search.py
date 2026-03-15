"""
Unified semantic search endpoint.

GET /api/search?q=<query>&limit=<int>

Returns ranked results from book chunks, note_chunks, and source_chunks.
Each result includes source_type, title, excerpt, similarity score, and
typed ID metadata for frontend navigation.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from auth.deps import get_current_user
from db.database import get_db
from db.models import User
from services import search as search_svc

router = APIRouter(tags=["search"])


@router.get("/api/search")
async def unified_search(
    q: str = Query(..., min_length=1, description="Semantic search query"),
    limit: int = Query(default=20, ge=1, le=50, description="Max results to return"),
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not q.strip():
        raise HTTPException(status_code=422, detail="Query cannot be empty.")

    from providers.registry import get_embedding_provider_for_user

    embed_provider = await get_embedding_provider_for_user(db, current_user.id)

    results = await search_svc.search(
        query=q,
        user_id=current_user.id,
        limit=limit,
        db=db,
        embed_provider=embed_provider,
    )

    return {"results": results}
