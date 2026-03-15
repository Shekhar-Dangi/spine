# Spine

Most books don't deserve your full attention. Spine helps you figure out which ones do, and build lasting knowledge from the ones that do.

## What it is

Spine is a reading companion and personal knowledge workspace, available as a hosted web app or self-deployable. You upload books (PDF, EPUB), ask questions, get chapter-level explanations, and gradually build a knowledge graph from what you actually read.

The core idea: instead of reading every book cover to cover, you can use Spine to navigate a book's structure, understand what it's actually arguing, and decide whether it's worth your time before you commit to it.

## Why it exists

There are too many books and too little time. Most reading tools assume you've already decided to read something — they help you highlight, annotate, and recall. Spine starts one step earlier: helping you decide _what_ deserves deep reading in the first place.

But it doesn't stop there. Once you engage with material across multiple books, concepts start connecting. If you're studying finance and then pick up a book on history or technology, the same events and forces keep showing up from different angles. Spine lets you capture that — not just within a single book, but across everything you're reading. A financial concept that shaped a historical event that later drove a technology shift. Everything connected, in one place, in your own words.

## What it does

**Book navigation**

- Upload and parse books; browse by chapter
- Ask questions grounded in the actual text
- Get deep chapter explanations with citations
- Chat with the material without losing context

**Notes**

- Save anything worth keeping — a passage, an AI explanation, your own thinking — as a durable Markdown note
- Notes are searchable, linkable to source passages, and become part of your retrieval context when you ask questions later

**Knowledge graph**

- Extract structured knowledge (concepts, people, events, places) from your notes and reading
- Connect ideas across books and domains
- AI-proposed connections go to a review inbox first — nothing is added to your graph silently
- Browse connections visually in the Explorer

**Global ask**

- Ask questions across your whole library, specific books, or just your notes
- Retrieval pulls from book text, approved knowledge, and your own notes together

## What it is not

Spine is not a replacement for reading. It won't read books for you. The goal is to help you read more deliberately — spend time on what matters, skip what doesn't, and hold onto what you learn.

## Stack

- **Backend**: Python / FastAPI / PostgreSQL + pgvector
- **Frontend**: Next.js / React / TypeScript / Tailwind
- **LLM & Embeddings**: OpenAI or OpenRouter (bring your own key; more providers coming)

## Self-hosting

**Prerequisites**: Docker, Python 3.13, Bun

```bash
# 1. Clone and configure
git clone <repo-url>
cd spine-v1
cp backend/.env.example backend/.env
# Fill in your keys in backend/.env

# 2. Start the database
docker compose up -d

# 3. Run migrations
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
.venv/bin/python3.13 -m alembic upgrade head

# 4. Start the backend
.venv/bin/python3.13 -m uvicorn main:app --reload --port 8000

# 5. Start the frontend (separate terminal)
cd frontend
bun install
bun dev
```

Open `http://localhost:3000`. On first visit you'll be prompted to create an admin account — you'll need `SPINE_SETUP_KEY` set in `backend/.env`.

See `backend/.env.example` for all required environment variables.
