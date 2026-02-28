# Multi-Agent Pipeline (Gemini) + React UI

## Prerequisites

- Python 3.10+
- Node 18+

## Environment variables

Create a `.env` file in the project root (it is gitignored).

Minimum required:

- `GEMINI_KEYS_REGULATORY` (comma-separated)
- `GEMINI_KEYS_ARCHITECT` (comma-separated)
- `GEMINI_KEYS_MATLAB` (comma-separated)

Model selection:

- Option A (one list for all agents):
  - `GEMINI_MODELS=models/gemini-2.5-flash,models/gemini-2.5-pro,models/gemini-2.0-flash`
- Option B (per-agent override):
  - `GEMINI_MODEL_REGULATORY=...`
  - `GEMINI_MODEL_ARCHITECT=...`
  - `GEMINI_MODEL_MATLAB=...`

Optional:

- `GEMINI_MIN_SPACING_SECONDS=2`

## Run backend (FastAPI)

Install deps:

```bash
pip install -r requirements.txt
```

Start API server:

```bash
uvicorn api_server:app --reload --port 8000
```

API:

- `POST /api/run` with JSON `{ "user_request": "..." }`

## Run frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Open:

- http://localhost:5173

The Vite dev server proxies `/api/*` to `http://127.0.0.1:8000`.

## Build + serve frontend from backend (optional)

```bash
cd frontend
npm run build
```

Then start the backend; it will serve `frontend/dist` at `/`.
