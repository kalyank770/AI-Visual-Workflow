# AI Visual Workflow

A production-ready visualizer and backend for an agentic workflow. The UI shows the flow between UI, LangGraph (LG), LLM, RAG, Vector DB (VDB), MCP tools, and Output. The backend executes the real workflow with **real vector-based RAG retrieval**, tool execution, and LLM synthesis. The system is fully autonomous (no human approval gates).

## What This Project Does
- Visualizes an agentic workflow in a live, animated UI.
- Runs a real LangGraph workflow with routing: RAG-only, MCP-only, Hybrid, or Direct.
- **Real RAG with vector embeddings** using Sentence Transformers + FAISS for semantic search
- Executes real tools for stocks, weather, currency, time, dictionary, web search, and more.
- Uses intelligent LLM routing to choose the best model by task type, budget, and latency.
- Supports optional Redis persistence for workflow checkpoints.

## Architecture Overview
Frontend (React + Vite):
- App.tsx renders the workflow diagram and telemetry logs.
- User input is sent to the backend API.

Backend (Python + FastAPI + LangGraph):
- Intake -> Planner -> (RAG and/or Tools) -> Synthesizer -> Output
- Planner selects route: rag_only, mcp_only, hybrid, direct
- **RAG: Vector embeddings with FAISS for semantic search**
  - Sentence Transformers (all-MiniLM-L6-v2) for embeddings
  - FAISS for fast similarity search (~15ms)
  - Hybrid search: 70% vector + 30% keyword matching
  - Query expansion for better recall
  - Falls back to TF-IDF if dependencies unavailable
- Tools: real API calls (Yahoo Finance, Open-Meteo, Wikipedia, etc.)
- LLM: internal Llama 3.3 70B primary, Gemini fallback

## Run Locally

### 1) Frontend
```bash
npm install
npm run dev
```

### 2) Backend API
```bash
cd backend
pip install -r requirements.txt
python main.py
```

**First run**: Downloads the embedding model (~90MB) and indexes documents (~4s)  
**Subsequent runs**: Instant startup (model is cached)

Default API URL: http://localhost:5001

### Combined (Frontend + Backend)
```bash
npm run start
```

## API Endpoints
Backend API (FastAPI):
- POST /api/run
  - Body: {"prompt": "...", "run_id": null, "verbose": false, "enable_interrupts": false}
  - Response: final_response, route, active_model, tool_results, rag_sources
- GET /api/health
- GET /api/graph

Note: Human approval endpoints exist in code but the UI flow is fully autonomous.

## LLM Routing
The workflow uses task-based routing:
- Task types: summarize, reason, code, creative, factual, chat, analyze
- Budget modes: economy, balanced, quality
- Env vars:
  - LLM_ROUTING_ENABLED=true|false
  - LLM_BUDGET_MODE=economy|balanced|quality
  - LLM_MAX_LATENCY_MS=5000

## Environment Variables
Backend (.env or system):
- INTERNAL_API_KEY (internal model)
- GEMINI_API_KEY (fallback)
- INTERNAL_MODEL_ENDPOINT (optional override)
- INTERNAL_MODEL_NAME (default: llama-3.3-70b)
- LLM_TIMEOUT (seconds)
- HTTP_TIMEOUT (seconds)
- REDIS_URL (optional)
- REDIS_KEY_PREFIX (optional)
- REDIS_STATE_TTL_SECONDS (optional)

Frontend:
- No required env vars for production UI.

## Project Structure
```
AI-Visual-Workflow/
├── App.tsx
├── components/
│   ├── AnimatedFlow.tsx
│   └── Diagram.tsx
├── backend/
│   ├── main.py                # Entry point
│   ├── api.py                 # FastAPI REST API
│   ├── core/
│   │   └── orchestrator.py    # LangGraph orchestration
│   ├── rag/
│   │   ├── document_loader.py # Document ingestion
│   │   └── vector_engine.py   # Vector search & embeddings
│   ├── tools/                 # Tool integrations
│   ├── data/                  # Knowledge base
│   └── requirements.txt
├── images/
│   └── architecture-diagram.png
├── index.html
├── index.tsx
├── constants.tsx
├── types.ts
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Notes
- The system is fully autonomous. No human approval gates are used.
- Frontend communicates with the backend API for all workflow execution.

## Build
```bash
npm run build
```

## Troubleshooting
- If backend is down: UI will show an error. Ensure backend is running at http://localhost:5001
- If Redis is not available: workflow falls back to in-memory persistence.
- If LLM keys are missing: tools and RAG still run; LLM response uses template fallback.
