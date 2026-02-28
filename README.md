# Spine V1

AI-powered book reader with chapter explanation, Q&A, dossier generation, and concept mapping.

## Requirements

- Python 3.13
- Node.js + [Bun](https://bun.sh)
- OpenAI or OpenRouter API key
- Tavily API key (for web search)

## Quickstart

### 1. Clone and configure

```bash
git clone <repo-url>
cd spine-v1
```

Copy the example env file and fill in your keys:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```
OPENAI_API_KEY=your_key_here
TAVILY_API_KEY=your_key_here
```

### 2. Backend

```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
.venv/bin/python3.13 -m uvicorn main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Usage

1. Upload a PDF or EPUB from the library page
2. Review and confirm the table of contents
3. Open the reader and use the AI panel to explain chapters, ask questions, or generate a concept map
