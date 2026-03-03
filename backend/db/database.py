from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings


engine = create_async_engine(settings.db_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    from db import models  # noqa: F401 — register all models
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate(conn)


async def _migrate(conn) -> None:
    """
    One-time migration: ModelProfile model_map_json (old) → model (new).
    Each step is idempotent — safe to run on every startup.
    """
    # 1. Add the new column if it doesn't exist yet (no-op on fresh DBs).
    try:
        await conn.execute(text(
            "ALTER TABLE model_profiles ADD COLUMN model VARCHAR(256)"
        ))
    except Exception:
        pass  # column already exists

    # 2. Back-fill from the old JSON for any rows where model is still NULL.
    #    Skipped silently if model_map_json column no longer exists.
    try:
        await conn.execute(text("""
            UPDATE model_profiles
            SET model = COALESCE(
                json_extract(model_map_json, '$.deep_explain'),
                json_extract(model_map_json, '$.qa'),
                json_extract(model_map_json, '$.extract'),
                'gpt-4o'
            )
            WHERE (model IS NULL OR model = '') AND model_map_json IS NOT NULL
        """))
    except Exception:
        pass  # model_map_json already gone (fresh DB or migration already ran)

    # 3. Drop the old column so its NOT NULL constraint no longer blocks INSERTs.
    #    SQLite 3.35+ supports DROP COLUMN. Fails silently on fresh DBs where
    #    the column was never created.
    try:
        await conn.execute(text(
            "ALTER TABLE model_profiles DROP COLUMN model_map_json"
        ))
    except Exception:
        pass  # column already dropped, or fresh DB that never had it

    # 4. Add chapter_id to messages (Q&A per-chapter tagging).
    try:
        await conn.execute(text(
            "ALTER TABLE messages ADD COLUMN chapter_id INTEGER REFERENCES chapters(id)"
        ))
    except Exception:
        pass  # column already exists

    # 5. Add mode column to chapter_explains (multi-explain mode support).
    #    If missing, rebuild the table: rename old → _old, create new with mode,
    #    copy rows with mode='story', drop the backup.
    result = await conn.execute(text("PRAGMA table_info(chapter_explains)"))
    columns = {row[1] for row in result.fetchall()}
    if "mode" not in columns:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS chapter_explains_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id INTEGER NOT NULL REFERENCES books(id),
                chapter_id INTEGER NOT NULL REFERENCES chapters(id),
                mode VARCHAR(32) NOT NULL DEFAULT 'story',
                content TEXT NOT NULL,
                generated_at DATETIME
            )
        """))
        await conn.execute(text("""
            INSERT INTO chapter_explains_v2 (id, book_id, chapter_id, mode, content, generated_at)
            SELECT id, book_id, chapter_id, 'story', content, generated_at
            FROM chapter_explains
        """))
        await conn.execute(text("DROP TABLE chapter_explains"))
        await conn.execute(text("ALTER TABLE chapter_explains_v2 RENAME TO chapter_explains"))

    # 6. Ensure the unique index exists (idempotent).
    try:
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uix_chapter_explains_chapter_mode
            ON chapter_explains(chapter_id, mode)
        """))
    except Exception:
        pass
