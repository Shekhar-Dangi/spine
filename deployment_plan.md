# Spine V1 — Deployment Plan

## Target Architecture

```
Vercel (Next.js frontend)
        │ HTTPS
        ▼
Azure Container Apps (FastAPI backend)
        │
        ├── Azure Files mount  → /app/storage/spine.db (SQLite)
        │                      → /app/storage/chroma/  (ChromaDB embeddings)
        └── Azure Blob Storage → uploads/ + parsed/    (book files + chapter text)
```

Secrets (Fernet key, JWT secret) live in **Azure Key Vault** — never on disk or in the image.

---

## Security: Per-User API Keys

Each user stores their own OpenAI/OpenRouter API key. Keys are encrypted with **Fernet
symmetric encryption** before being written to SQLite (`providers/key_store.py`).

**Current state (local):**
- Fernet key: `backend/storage/.spine.key` (file on disk)
- JWT secret: `backend/storage/.jwt_secret` (file on disk)
- Risk: if an attacker gets the DB file + `.spine.key`, all users' API keys are exposed

**Required before public deployment:**
- Move Fernet key to `SPINE_FERNET_KEY` environment variable (Azure Key Vault secret)
- Move JWT secret to `SPINE_JWT_SECRET` environment variable (Azure Key Vault secret)
- App reads from env first, falls back to file for local dev
- This way the key is never on the same disk as the database

**Why this matters with per-user keys:**
- Previously: one admin key at risk
- Now: every user's API key at risk from a single leaked Fernet key
- Azure Key Vault access is audited, rotatable, separate from the storage layer

---

## Code Changes Needed (in order)

### 1. Configurable API URL in frontend (`frontend/src/lib/api.ts`)
```ts
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
```
Set `NEXT_PUBLIC_API_URL=https://<your-app>.azurecontainerapps.io` in Vercel env vars.

### 2. Secrets from environment variables (`backend/config.py` + `backend/providers/key_store.py`)
- `SPINE_FERNET_KEY` env var → used instead of `.spine.key` file
- `SPINE_JWT_SECRET` env var → used instead of `.jwt_secret` file
- Local dev: falls back to file-based approach (no change for local)
- `config.py` already loads `jwt_secret` from settings; same pattern for Fernet key

### 3. Dockerfile (`backend/Dockerfile`)
```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PYTHONPATH=/app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 4. SQLite WAL mode (`backend/db/database.py`)
Add to `init_db()` before migrations:
```python
await conn.execute(text("PRAGMA journal_mode=WAL"))
await conn.execute(text("PRAGMA synchronous=NORMAL"))
```
Improves concurrent read performance when multiple users are active.

### 5. Replace hand-written `_migrate()` with Alembic
Alembic is already in `requirements.txt`. Current `_migrate()` in `database.py` works
but becomes fragile. Switch to:
```
backend/alembic/
  env.py
  versions/
    001_initial.py
    002_add_user_id_to_books.py
    ...
```
Run `alembic revision --autogenerate -m "description"` after each model change.
This makes future schema changes safe, version-controlled, and rollback-able.

### 6. Azure Blob for file storage (phase 2, not blocking launch)
Currently: book files in `backend/storage/uploads/`, chapter text in `backend/storage/parsed/`
Future: Azure Blob Storage adapter so files don't live on the container's Azure Files mount
Blocked by: need an abstraction layer in `services/ingest.py` for file read/write

---

## Azure Resources

| Resource | Purpose | SKU |
|----------|---------|-----|
| Container Apps Environment | Host FastAPI | Consumption (free tier) |
| Container Registry | Store Docker image | Basic |
| Azure Files share | Persistent SQLite + ChromaDB | Standard LRS |
| Blob Storage account | Book file uploads + parsed text | Standard LRS, Hot tier |
| Key Vault | Fernet key + JWT secret | Standard |

---

## Deployment Steps

### Backend (Azure Container Apps)

1. Build and push Docker image:
   ```bash
   docker build -t spine-backend ./backend
   az acr push <registry>/spine-backend:latest
   ```

2. Create Azure Files share, mount at `/app/storage` in Container Apps

3. Create Key Vault secrets:
   - `SPINE-FERNET-KEY` — copy value from current `.spine.key` file
   - `SPINE-JWT-SECRET` — copy value from current `.jwt_secret` file

4. Set Container Apps environment variables:
   ```
   SPINE_FERNET_KEY     = @Microsoft.KeyVault(...)
   SPINE_JWT_SECRET     = @Microsoft.KeyVault(...)
   COOKIE_SECURE        = true
   CORS_ORIGINS         = https://<your-app>.vercel.app
   ```

5. Deploy Container App on port 8000

### Frontend (Vercel)

1. Connect GitHub repo to Vercel
2. Set environment variables:
   ```
   NEXT_PUBLIC_API_URL = https://<your-app>.azurecontainerapps.io
   ```
3. Deploy — `bun run build` works as-is

---

## Data Migration Strategy

### Current approach
Hand-written idempotent SQL steps in `db/database.py → _migrate()`.
Works but doesn't scale. Each new schema change appends another step.

### Target approach (Alembic)
- `alembic upgrade head` runs on container startup
- `alembic revision --autogenerate` detects model changes
- Rollback: `alembic downgrade -1`
- Works with SQLite today; switch to PostgreSQL later with zero app code changes

### SQLite → PostgreSQL migration path (if ever needed)
- SQLAlchemy already abstracts the DB layer
- Change `db_url` from `sqlite+aiosqlite://` to `postgresql+asyncpg://`
- Run `alembic upgrade head` against new PostgreSQL instance
- Migrate data with `pg_dump` or a one-time script
- ChromaDB remains separate (not in SQLite)

---

## Environment Variables Reference

| Variable | Local default | Production |
|----------|--------------|------------|
| `SPINE_FERNET_KEY` | (read from `.spine.key` file) | Azure Key Vault |
| `SPINE_JWT_SECRET` | (read from `.jwt_secret` file) | Azure Key Vault |
| `JWT_EXPIRE_MINUTES` | 43200 (30 days) | same |
| `COOKIE_SECURE` | false | true |
| `CORS_ORIGINS` | http://localhost:3000 | https://yourapp.vercel.app |
| `TAVILY_API_KEY` | (empty) | Azure Key Vault or App Setting |
| `NEXT_PUBLIC_API_URL` | http://localhost:8000 | https://yourapp.azurecontainerapps.io |

---

## Pre-Launch Checklist

- [ ] `NEXT_PUBLIC_API_URL` configurable (not hardcoded `localhost`)
- [ ] Fernet key read from env var (not file) in production
- [ ] JWT secret read from env var (not file) in production
- [ ] `COOKIE_SECURE=true` in production
- [ ] `CORS_ORIGINS` set to Vercel domain
- [ ] Dockerfile builds and runs cleanly
- [ ] Azure Files mount persists SQLite + ChromaDB across restarts
- [ ] Key Vault secrets wired up
- [ ] SQLite WAL mode enabled
- [ ] Alembic set up (replaces hand-written `_migrate()`)
