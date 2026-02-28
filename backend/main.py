"""
Spine — FastAPI application entry point.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.database import init_db
from api import books, dossier, explain, qa, map, providers


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Spine API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(books.router)
app.include_router(dossier.router)
app.include_router(explain.router)
app.include_router(qa.router)
app.include_router(map.router)
app.include_router(providers.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
