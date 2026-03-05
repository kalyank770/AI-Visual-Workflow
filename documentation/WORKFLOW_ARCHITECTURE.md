# AI Visual Workflow - Complete Architecture Guide

## Overview
This document provides a comprehensive overview of the AI Visual Workflow system architecture, component integration, data flow, and deployment guidance for demo presentations.

---

## Table of Contents
1. [System Architecture](#system-architecture)
2. [Component Overview](#component-overview)
3. [Data Flow & Execution](#data-flow--execution)
4. [Technology Stack](#technology-stack)
5. [Key Integrations](#key-integrations)
6. [Demo Preparation Guide](#demo-preparation-guide)
7. [Deployment & Configuration](#deployment--configuration)
8. [Troubleshooting](#troubleshooting)

---

## System Architecture

### High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                    AI VISUAL WORKFLOW SYSTEM                      │
│                  Production Agentic AI Platform                   │
└──────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Prompt   │  │ Flow     │  │ Response │  │ Metadata │       │
│  │ Input    │→ │ Visual-  │→ │ Display  │→ │ Timeline │       │
│  │          │  │ ization  │  │          │  │          │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│       ↓              ↑              ↑              ↑            │
│       └──────────────┴──────────────┴──────────────┘            │
│                     REST API CALLS                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    HTTP (localhost:5001)
                             │
┌────────────────────────────┴────────────────────────────────────┐
│                    BACKEND (FastAPI + Python)                    │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   API LAYER (api.py)                      │  │
│  │  • POST /api/run — Execute workflow                       │  │
│  │  • GET  /api/health — System status                       │  │
│  │  • GET  /api/graph — Topology info                        │  │
│  │  • POST /api/dashboard-logs — Persist logs                │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                            ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │          LANGGRAPH ORCHESTRATOR (orchestrator.py)         │  │
│  │                                                            │  │
│  │  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────┐│  │
│  │  │ Intake   │ → │ Planner  │ → │   RAG    │ → │ Synth- ││  │
│  │  │  Node    │   │  Node    │   │   Node   │   │ esizer ││  │
│  │  └──────────┘   └────┬─────┘   └──────────┘   │  Node  ││  │
│  │                      │              ↑           └────────┘│  │
│  │                      ↓              │                      │  │
│  │                 ┌──────────┐        │                      │  │
│  │                 │  Tools   │────────┘                      │  │
│  │                 │  Node    │                               │  │
│  │                 └──────────┘                               │  │
│  │                                                            │  │
│  │  State Flow: AgentState (TypedDict)                       │  │
│  │  Persistence: Redis (optional) + in-memory checkpointer   │  │
│  └────────────────────────┬─────────────────────────────────┘  │
│                            │                                     │
│         ┌──────────────────┴─────────────────┐                  │
│         ↓                                    ↓                  │
│  ┌──────────────────────┐         ┌──────────────────────┐    │
│  │   RAG ENGINE         │         │   TOOL ENGINE        │    │
│  │  (vector_engine.py)  │         │  (orchestrator.py)   │    │
│  ├──────────────────────┤         ├──────────────────────┤    │
│  │ • Document Loader    │         │ • Stock Price        │    │
│  │ • Sentence Transform │         │ • Stock Analysis     │    │
│  │ • FAISS Index        │         │ • Weather            │    │
│  │ • Chunking           │         │ • Wikipedia          │    │
│  │ • Query Expansion    │         │ • Web Search         │    │
│  │ • Hybrid Search      │         │ • Dictionary         │    │
│  │   (70% vector +      │         │ • Calculator         │    │
│  │    30% keyword)      │         │ • Unit Converter     │    │
│  └──────────────────────┘         │ • World Clock        │    │
│                                    │ • Currency           │    │
│  ┌──────────────────────┐         └──────────────────────┘    │
│  │   LLM ROUTER         │                  ↓                   │
│  │  (orchestrator.py)   │         Pattern Matching             │
│  ├──────────────────────┤         Multi-Entity Support         │
│  │ • Task Classifier    │         Guard Rails                  │
│  │ • Model Registry     │         Result Deduplication         │
│  │ • Model Selector     │                                      │
│  │ • Budget Modes       │                                      │
│  │ • Cascade Fallback   │                                      │
│  │   1. Llama 3.3 70B   │                                      │
│  │   2. Gemini Flash    │                                      │
│  │   3. Template        │                                      │
│  └──────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL SERVICES                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │ Internal LLM   │  │ Gemini API     │  │ Redis (opt.)   │   │
│  │ Llama 3.3 70B  │  │ 2.5 Flash      │  │ State Storage  │   │
│  └────────────────┘  └────────────────┘  └────────────────┘   │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │ Yahoo Finance  │  │ wttr.in        │  │ Wikipedia API  │   │
│  │ Stock Data     │  │ Weather        │  │ Knowledge      │   │
│  └────────────────┘  └────────────────┘  └────────────────┘   │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │ DuckDuckGo     │  │ Dictionary API │  │ Exchange Rate  │   │
│  │ Web Search     │  │ Definitions    │  │ Currency       │   │
│  └────────────────┘  └────────────────┘  └────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Overview

### 1. Frontend (React + TypeScript)
**Location**: Root directory (`App.tsx`, `components/`)

**Purpose**: Interactive visual workflow interface

**Key Features**:
- **Prompt Input**: User query submission
- **Flow Visualization**: Real-time animated graph showing execution path
- **Response Display**: LLM-generated answer with metadata
- **Timeline**: Step-by-step execution log with timing
- **State Management**: React hooks for UI updates

**Technology**:
- React 18
- TypeScript
- Vite (build tool)
- TailwindCSS (styling)

**API Integration**:
```typescript
// POST /api/run
const response = await fetch('http://localhost:5001/api/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: userInput })
});
```

**See**: [App.tsx](App.tsx), [AnimatedFlow.tsx](components/AnimatedFlow.tsx)

---

### 2. Backend API (FastAPI)
**Location**: [backend/api.py](backend/api.py)

**Purpose**: REST API server exposing the workflow

**Endpoints**:

| Method | Endpoint | Description |
|--------|----------|-------------|
| **POST** | `/api/run` | Execute workflow for a prompt |
| **GET** | `/api/health` | System health & capability checks |
| **GET** | `/api/graph` | Graph topology (nodes, edges) |
| **POST** | `/api/dashboard-logs` | Persist execution logs |

**Key Responsibilities**:
- Request validation (Pydantic models)
- Workflow invocation
- CORS handling (for frontend)
- Error handling & HTTP status codes

**Example Health Check Response**:
```json
{
  "status": "healthy",
  "graph_compiled": true,
  "rag_chunks": 127,
  "knowledge_docs": 5,
  "llm_available": {
    "internal_llama": true,
    "gemini": true,
    "template_fallback": true
  },
  "rag_engine_type": "VectorRAGEngine",
  "rag_engine_info": {
    "total_chunks": 127,
    "embedding_model": "all-MiniLM-L6-v2",
    "embedding_dimension": 384
  }
}
```

---

### 3. LangGraph Orchestrator
**Location**: [backend/core/orchestrator.py](backend/core/orchestrator.py)

**Purpose**: Central controller managing the agentic workflow

**Architecture**: Directed graph with 5 nodes:

```
START → Intake → Planner → (RAG / Tools / Direct) → Synthesizer → END
```

**Nodes**:

| Node | Responsibility | Output |
|------|----------------|--------|
| **Intake** | Sanitize prompt | `user_prompt`, log entry |
| **Planner** | Classify intent, select route | `route`, `plan_reasoning`, log |
| **RAG** | Retrieve from knowledge base | `rag_context`, `rag_sources`, log |
| **Tools** | Execute external API calls | `tool_results`, log |
| **Synthesizer** | Combine context & generate response | `final_response`, `active_model`, log |

**State Management**: `AgentState` (TypedDict) flows through all nodes

**Persistence**: Redis snapshots at each node (optional)

**Related Docs**: [LANGGRAPH_CONFIGURATION.md](LANGGRAPH_CONFIGURATION.md)

---

### 4. RAG Engine
**Location**: [backend/rag/vector_engine.py](backend/rag/vector_engine.py), [backend/rag/document_loader.py](backend/rag/document_loader.py)

**Purpose**: Semantic search over internal knowledge base

**Pipeline**:
1. **Document Loading**: Supports .txt, .md, .json, .pdf
2. **Chunking**: Sentence-aware splitting (400 chars, 80 char overlap)
3. **Embedding**: Sentence Transformers (`all-MiniLM-L6-v2`, 384 dimensions)
4. **Indexing**: FAISS `IndexFlatIP` (Inner Product for cosine similarity)
5. **Query Processing**: Query expansion (3 variants)
6. **Hybrid Search**: 70% vector + 30% keyword (TF-IDF)
7. **Retrieval**: Top-5 chunks with deduplication

**Performance**:
- Cold start: ~300ms (includes model loading)
- Warm queries: ~10ms (FAISS search)
- Scales to 1K+ documents without performance degradation

**Related Docs**: [RAG_PIPELINE.md](RAG_PIPELINE.md)

---

### 5. LLM Routing System
**Location**: [backend/core/orchestrator.py](backend/core/orchestrator.py#L1848-L2211)

**Purpose**: Intelligent model selection based on task type and budget

**Model Registry**:
1. **Llama 3.3 70B** (Internal) — Reasoning, Code, Analysis
2. **Gemini 2.5 Flash** — Summarization, Factual Q&A, Chat
3. **Gemini 1.5 Flash** — Fallback

**Task Classification**:
- **CODE**: "Write a Python function"
- **ANALYZE**: "AAPL stock forecast"
- **SUMMARIZE**: "Summarize this document"
- **REASON**: "Why does RAG improve accuracy?"
- **FACTUAL**: "What is OpenText?"
- **CHAT**: "Hello"

**Routing Logic**:
1. Classify task type
2. Filter models by API key availability
3. Score models by task fit, quality, cost, latency
4. Select highest-scoring model
5. Fallback cascade: Llama → Gemini 2.5 → Gemini 1.5 → Template

**Budget Modes**:
- **Economy**: Prioritize cost (Gemini Flash for everything)
- **Balanced**: Mix cost & quality (default)
- **Quality**: Prioritize accuracy (Llama 3.3 for most queries)

**Related Docs**: [LLM_CONFIGURATION.md](LLM_CONFIGURATION.md)

---

### 6. MCP Tools Engine
**Location**: [backend/core/orchestrator.py](backend/core/orchestrator.py#L500-L1840)

**Purpose**: Execute external API calls for real-time data

**Tool Catalog** (10 tools):

| Tool | API | Latency | Use Case |
|------|-----|---------|----------|
| Stock Price | Yahoo Finance | 300ms | "AAPL stock price" |
| Stock Analysis | Yahoo Finance | 400ms | "AAPL forecast" |
| Weather | wttr.in | 250ms | "weather in London" |
| Wikipedia | Wikimedia REST | 200ms | "What is RAG?" |
| Web Search | DuckDuckGo | 500ms | "OpenText CEO" |
| Dictionary | Free Dictionary | 180ms | "define ephemeral" |
| Calculator | Sandboxed eval | 5ms | "45 * 23" |
| Unit Converter | Built-in | 2ms | "100 km to miles" |
| World Clock | Timezone lookup | 1ms | "time in Tokyo" |
| Currency | exchangerate.host | 150ms | "USD to EUR" |

**Key Features**:
- **Zero Configuration**: All APIs are free, no keys required
- **Pattern Matching**: Regex-based entity extraction
- **Multi-Entity**: "AAPL; MSFT; GOOGL" → parallel execution
- **Guard Rails**: Wikipedia blocked for time-sensitive queries
- **Deduplication**: Merges duplicate tool calls

**Related Docs**: [MCP_TOOLS.md](MCP_TOOLS.md)

---

## Data Flow & Execution

### Complete Execution Flow Example

**Query**: "What is OpenText and who is the current CEO?"

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: USER INPUT (Frontend)                               │
├─────────────────────────────────────────────────────────────┤
│ User types: "What is OpenText and who is the current CEO?"  │
│ Frontend → POST /api/run                                    │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: API RECEIVES REQUEST (api.py)                       │
├─────────────────────────────────────────────────────────────┤
│ Validates request schema                                     │
│ Calls: run_workflow("What is OpenText...")                  │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: INTAKE NODE (orchestrator.py)                       │
├─────────────────────────────────────────────────────────────┤
│ Sanitizes prompt → "What is OpenText and who is the current │
│                     CEO?"                                    │
│ Returns: {user_prompt, execution_log}                       │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: PLANNER NODE (intent classification)                │
├─────────────────────────────────────────────────────────────┤
│ Detects:                                                     │
│   • "OpenText" → internal knowledge (RAG)                   │
│   • "current CEO" → real-time data (Tools)                  │
│ Route decision: "hybrid" (RAG + Tools)                      │
│ Reasoning: "Query combines internal knowledge AND real-time │
│             data → RAG + MCP tools"                          │
│ Returns: {route: "hybrid", plan_reasoning, log}             │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 5: CONDITIONAL ROUTING (LangGraph)                     │
├─────────────────────────────────────────────────────────────┤
│ Checks state.route == "hybrid"                              │
│ Decision: Go to RAG Node first                              │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 6: RAG NODE (vector search)                            │
├─────────────────────────────────────────────────────────────┤
│ Query: "What is OpenText and who is the current CEO?"       │
│                                                              │
│ 6a. Query Expansion:                                         │
│     • "What is OpenText and who is the current CEO?"        │
│     • "What is OpenText and who is the current CEO?"        │
│     • "opentext and who is the current ceo"                 │
│                                                              │
│ 6b. Embedding Generation (all-MiniLM-L6-v2):                │
│     → [0.45, -0.23, 0.89, ..., -0.12] (384 dims)            │
│                                                              │
│ 6c. FAISS Search (IndexFlatIP):                             │
│     Top-5 chunks:                                            │
│     1. "OpenText Corporation is a Canadian enterprise..."   │
│        Score: 0.8234 | Source: opentext_products.md         │
│     2. "Core Products: Content Server, Documentum..."       │
│        Score: 0.7891 | Source: opentext_products.md         │
│     3. "OpenText acquired Micro Focus in 2023..."           │
│        Score: 0.7456 | Source: agentic_ai.md                │
│     4. "OpenText Aviator: Next-gen AI platform..."          │
│        Score: 0.7123 | Source: opentext_products.md         │
│     5. "Cloud Editions deliver quarterly releases..."       │
│        Score: 0.6789 | Source: opentext_products.md         │
│                                                              │
│ 6d. Context Assembly:                                        │
│     Combined content from top-5 chunks (1,234 chars)        │
│                                                              │
│ Returns: {rag_context, rag_sources: [5 items], log}         │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 7: CONDITIONAL ROUTING (hybrid → tools)                │
├─────────────────────────────────────────────────────────────┤
│ Checks state.route == "hybrid"                              │
│ Decision: Go to Tools Node                                  │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 8: TOOLS NODE (external APIs)                          │
├─────────────────────────────────────────────────────────────┤
│ run_tools("What is OpenText and who is the current CEO?")   │
│                                                              │
│ 8a. Pattern Matching:                                        │
│     • Stock ticker? No                                       │
│     • Weather? No                                            │
│     • Leadership query? YES                                  │
│       → Pattern: "who\s+is.*ceo"                             │
│       → Entity: "OpenText"                                   │
│                                                              │
│ 8b. Tool Execution:                                          │
│     tool_web_search("Who is OpenText current CEO latest")   │
│     → Normalized query with site hints                      │
│     → DuckDuckGo API call                                    │
│     → Response: "[OpenText] Mark J. Barrenechea serves as   │
│                  Interim Chief Executive Officer..."         │
│                                                              │
│ Returns: {tool_results: [1 item], log}                      │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 9: SYNTHESIZER NODE (LLM generation)                   │
├─────────────────────────────────────────────────────────────┤
│ 9a. Task Classification:                                     │
│     classify_task("What is OpenText...", rag_context, [tool])│
│     → TaskType.FACTUAL                                       │
│                                                              │
│ 9b. Enhanced Prompt Assembly:                                │
│     "What is OpenText and who is the current CEO?           │
│                                                              │
│      [RETRIEVED KNOWLEDGE (RAG)]                            │
│      OpenText Corporation is a Canadian enterprise          │
│      software company... [1,234 chars]                      │
│                                                              │
│      [TOOL RESULTS (MCP)]                                   │
│      Tool [WebSearch]: Mark J. Barrenechea serves as        │
│                        Interim Chief Executive Officer..."   │
│                                                              │
│ 9c. Model Selection:                                         │
│     Task: FACTUAL | Budget: balanced | Latency: <5000ms     │
│     Scores:                                                  │
│       • Llama 3.3 70B: 115.25 (high quality, free)          │
│       • Gemini 2.5 Flash: 87.35 (fast, strong for factual)  │
│     Selected: Llama 3.3 70B                                  │
│                                                              │
│ 9d. LLM Call:                                                │
│     System: "You are an intelligent AI agent. Use provided  │
│              context to answer directly and professionally."│
│     Messages: [{"role": "user", "content": enhanced_prompt}]│
│     → POST to internal Llama endpoint                        │
│     → Response (324 chars):                                  │
│       "OpenText Corporation is a Canadian enterprise         │
│        information management company headquartered in       │
│        Waterloo, Ontario. Founded in 1991, it provides      │
│        solutions including Content Server (ECM), Documentum,│
│        Extended ECM, and Aviator (AI platform). The company │
│        acquired Micro Focus in 2023 for $5.8B. Mark J.      │
│        Barrenechea currently serves as Interim Chief        │
│        Executive Officer."                                   │
│                                                              │
│ Returns: {final_response, active_model: "llama-3.3-70b", log}│
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 10: WORKFLOW COMPLETE                                   │
├─────────────────────────────────────────────────────────────┤
│ Final state returned to API layer                           │
│ Execution time: ~1.2 seconds                                 │
│   • Intake: 2ms                                              │
│   • Planner: 150ms (LLM classification)                      │
│   • RAG: 85ms (FAISS search)                                 │
│   • Tools: 420ms (web search API)                            │
│   • Synthesizer: 543ms (Llama generation)                    │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 11: API RESPONSE (api.py)                              │
├─────────────────────────────────────────────────────────────┤
│ JSON Response:                                               │
│ {                                                            │
│   "run_id": "run_a3f789b21cd4",                             │
│   "route": "hybrid",                                         │
│   "plan_reasoning": "[LLM] Query combines internal          │
│                      knowledge AND real-time data",          │
│   "final_response": "OpenText Corporation is a Canadian...",│
│   "active_model": "llama-3.3-70b",                          │
│   "rag_sources": [5 items with scores],                      │
│   "tool_results": [1 web search result],                     │
│   "execution_log": [5 node entries],                         │
│   "execution_time_s": 1.234,                                 │
│   "error": ""                                                │
│ }                                                            │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 12: FRONTEND DISPLAY                                    │
├─────────────────────────────────────────────────────────────┤
│ • Animated flow shows: Intake → Planner → RAG → Tools →    │
│                        Synthesizer                           │
│ • Response displayed with markdown formatting               │
│ • Timeline shows 5 steps with timing breakdown              │
│ • Sources expandable (5 RAG chunks, 1 tool result)          │
└─────────────────────────────────────────────────────────────┘
```

### Execution Time Breakdown

| Stage | Avg Time | Notes |
|-------|----------|-------|
| **Intake** | 1-5ms | String sanitization only |
| **Planner** | 50-200ms | LLM classification (can be 0ms for regex fallback) |
| **RAG** | 10-100ms | FAISS search (depends on corpus size) |
| **Tools** | 150-500ms | External API latency |
| **Synthesizer** | 300-2000ms | LLM generation (varies by model & length) |
| **Total** | 500ms - 3s | Typical: 1-1.5s for hybrid queries |

---

## Technology Stack

### Backend Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Framework** | FastAPI | 0.104+ | REST API server |
| **Workflow** | LangGraph | 0.0.34+ | State graph orchestration |
| **LLM** | Llama 3.3 70B | 3.3 | Complex reasoning, code generation |
| **LLM** | Gemini 2.5 Flash | 2.5 | Fast factual Q&A, chat |
| **Embeddings** | Sentence Transformers | 2.2+ | Vector generation (all-MiniLM-L6-v2) |
| **Vector DB** | FAISS | 1.7+ | Vector similarity search |
| **HTTP Client** | httpx | 0.24+ | Async external API calls |
| **Persistence** | Redis | 7.0+ | State snapshots (optional) |
| **Server** | Uvicorn | 0.23+ | ASGI server |

### Frontend Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Framework** | React | 18.2+ | UI library |
| **Language** | TypeScript | 5.0+ | Type safety |
| **Build Tool** | Vite | 4.4+ | Fast dev server & bundling |
| **Styling** | TailwindCSS | 3.3+ | Utility-first CSS |
| **Animation** | React Flow | 11.0+ | Graph visualization |

### External APIs (All Free, No Keys)

| Service | API | Rate Limit | Purpose |
|---------|-----|------------|---------|
| **Yahoo Finance** | chart API | ~2000 req/hr | Stock prices & trends |
| **wttr.in** | JSON API | Unlimited | Weather data |
| **Wikipedia** | REST v1 | 5000 req/hr | Article summaries |
| **DuckDuckGo** | Instant Answer | Unlimited | Web search |
| **Free Dictionary** | dictionaryapi.dev | Unlimited | Word definitions |
| **Exchange Rate** | exchangerate.host | 1500 req/month | Currency rates |

---

## Key Integrations

### 1. LangGraph ↔ RAG
**File**: [orchestrator.py#L2859-L2892](backend/core/orchestrator.py#L2859-L2892)

```python
def rag_node(state: AgentState) -> dict:
    query = state["user_prompt"]
    results = _rag_engine.search(query, top_k=5)  # Vector + keyword search
    context = "\n\n".join([f"[Source: {r['chunk']['source']}]\n{r['chunk']['content']}" 
                           for r in results])
    return {"rag_context": context, "rag_sources": [...], "execution_log": [...]}
```

**Data Flow**: User prompt → FAISS search → Top-5 chunks → Context for LLM

---

### 2. LangGraph ↔ MCP Tools
**File**: [orchestrator.py#L2895-L2921](backend/core/orchestrator.py#L2895-L2921)

```python
def tool_node(state: AgentState) -> dict:
    prompt = state["user_prompt"]
    results = run_tools(prompt)  # Pattern matching + API calls
    return {"tool_results": results, "execution_log": [...]}
```

**Data Flow**: User prompt → Pattern extraction → Tool execution → Results for LLM

---

### 3. LangGraph ↔ LLM
**File**: [orchestrator.py#L2924-L3010](backend/core/orchestrator.py#L2924-L3010)

```python
def synthesizer_node(state: AgentState) -> dict:
    task = classify_task(state["user_prompt"], state["rag_context"], state["tool_results"])
    enhanced_prompt = assemble_context(state)  # RAG + Tools + Original prompt
    response, model = call_llm([{"role": "user", "content": enhanced_prompt}], task_type=task)
    return {"final_response": response, "active_model": model, "execution_log": [...]}
```

**Data Flow**: Task classification → Model selection → Context assembly → LLM generation

---

### 4. FastAPI ↔ React
**Files**: [api.py#L226-L272](backend/api.py#L226-L272), [App.tsx](App.tsx)

**Backend** (FastAPI):
```python
@app.post("/api/run", response_model=RunResponse)
async def api_run(request: RunRequest):
    result = run_workflow(request.prompt)
    return RunResponse(**result, execution_time_s=elapsed)
```

**Frontend** (React):
```typescript
const response = await fetch('http://localhost:5001/api/run', {
  method: 'POST',
  body: JSON.stringify({ prompt: userInput }),
  headers: { 'Content-Type': 'application/json' }
});
const data = await response.json();
setWorkflowState(data);
```

---

## Demo Preparation Guide

### Key Demo Scenarios

#### 1. Internal Knowledge Query (RAG Only)
**Query**: "What is OpenText Documentum?"

**Expected Flow**:
```
Intake → Planner (rag_only) → RAG (5 chunks) → Synthesizer → Response
```

**Key Points to Highlight**:
- ✅ RAG retrieves 5 relevant chunks from knowledge base
- ✅ Semantic search (not just keyword matching)
- ✅ Hybrid scoring (70% vector + 30% keyword)
- ✅ Sources displayed with relevance scores

---

#### 2. Real-Time Data Query (MCP Only)
**Query**: "What is the current AAPL stock price?"

**Expected Flow**:
```
Intake → Planner (mcp_only) → Tools (Yahoo Finance) → Synthesizer → Response
```

**Key Points to Highlight**:
- ✅ Pattern matching extracts "AAPL" ticker
- ✅ Live API call to Yahoo Finance
- ✅ No API keys required (free public API)
- ✅ Result: Current price, change, volume

---

#### 3. Hybrid Query (RAG + MCP)
**Query**: "What is OpenText and who is the current CEO?"

**Expected Flow**:
```
Intake → Planner (hybrid) → RAG (company info) → Tools (web search for CEO) → Synthesizer → Response
```

**Key Points to Highlight**:
- ✅ Intelligent routing detects need for both internal & external data
- ✅ RAG provides company background
- ✅ Web search provides current CEO (real-time)
- ✅ LLM synthesizes both sources into coherent answer

---

#### 4. Stock Forecast Query (Analysis Tool)
**Query**: "What is the AAPL stock forecast for the next quarter?"

**Expected Flow**:
```
Intake → Planner (mcp_only) → Tools (stock_analysis with 30-day trend) → Synthesizer → Response
```

**Key Points to Highlight**:
- ✅ Tool provides 30-day trend data (upward/sideways/downward)
- ✅ High/low range, average, 5-day momentum
- ✅ LLM uses data to provide informed analysis (not hallucination)
- ✅ Disclaimer: "This is analysis, not financial advice"

---

#### 5. Multi-Entity Query
**Query**: "Get weather in London, Paris, and Tokyo"

**Expected Flow**:
```
Intake → Planner (mcp_only) → Tools (3 weather API calls) → Synthesizer → Response
```

**Key Points to Highlight**:
- ✅ Single query triggers 3 parallel tool calls
- ✅ Results merged with " | " separator
- ✅ Total time ~250ms (APIs called concurrently)

---

### Demo Talking Points

#### LangGraph Configuration
**Audience Question**: "How did you configure LangGraph?"

**Your Response**:
> "LangGraph is our workflow orchestrator. We define a **state graph** with 5 nodes: Intake, Planner, RAG, Tools, and Synthesizer. The state is a TypedDict (`AgentState`) that flows through each node, accumulating data. Nodes are pure functions that return partial state updates. **Conditional edges** route based on the `route` field (rag_only, mcp_only, hybrid, direct). We use Redis for checkpointing to enable fault tolerance and human-in-the-loop (though currently disabled for autonomous operation)."

**Navigate to**: [orchestrator.py#L3067-L3103](backend/core/orchestrator.py#L3067-L3103) — show `build_graph()` function

---

#### RAG Pipeline
**Audience Question**: "How did you build the RAG pipeline?"

**Your Response**:
> "Our RAG pipeline uses **Sentence Transformers** (all-MiniLM-L6-v2) for embeddings — 384 dimensions, optimized for semantic similarity. Documents are chunked with **sentence-aware splitting** (400 chars, 80 char overlap) to preserve context. We use **FAISS IndexFlatIP** for exact cosine similarity search (normalized vectors → inner product = cosine). The search is **hybrid**: 70% vector similarity + 30% TF-IDF keyword matching. Query expansion generates 3 variants to improve recall. Top-5 chunks are deduplicated and passed to the LLM."

**Navigate to**: [vector_engine.py#L53-L360](backend/rag/vector_engine.py#L53-L360) — show `VectorRAGEngine` class

**Demo**: Show [RAG_PIPELINE.md](RAG_PIPELINE.md) for detailed architecture

---

#### LLM Configuration
**Audience Question**: "How did you configure the LLM?"

**Your Response**:
> "We use **intelligent routing** across multiple LLMs. First, we **classify the task** (code, reasoning, summarization, factual, etc.) using heuristics. Then we **score available models** based on task fit, quality, cost, and latency. Our model registry includes **Llama 3.3 70B** (internal, free, best for reasoning/code) and **Gemini 2.5 Flash** (Google, low-latency, good for simple queries). Budget modes (economy/balanced/quality) adjust the scoring weights. If the selected model fails, we cascade through fallbacks: Llama → Gemini 2.5 → Gemini 1.5 → Template."

**Navigate to**: [orchestrator.py#L1878-L2048](backend/core/orchestrator.py#L1878-L2048) — show `MODEL_REGISTRY` and `select_model()`

**Demo**: Show [LLM_CONFIGURATION.md](LLM_CONFIGURATION.md) for task classification

---

#### MCP Tools
**Audience Question**: "How did you configure MCP and register tools?"

**Your Response**:
> "We implemented **10 MCP tools**: stock price, stock analysis (with trend data for forecasts), weather, Wikipedia, web search, dictionary, calculator, unit converter, world clock, and currency. All use **free public APIs** — no keys required. Tools are invoked via **pattern matching** in `run_tools()`: regex extracts entities (tickers, locations, words), then we execute the corresponding tool function. Guard rails prevent Wikipedia for time-sensitive queries (uses web search instead). Multi-entity queries like 'AAPL; MSFT; GOOGL' are split and executed in parallel, then deduplicated."

**Navigate to**: [orchestrator.py#L500-L1400](backend/core/orchestrator.py#L500-L1400) — show tool implementations

**Demo**: Show [MCP_TOOLS.md](MCP_TOOLS.md) for complete tool catalog

---

### Common Demo Questions & Answers

**Q**: "Why use LangGraph instead of plain Python?"
**A**: "LangGraph provides **state management**, **conditional routing**, and **checkpointing** out-of-the-box. It's designed for agentic workflows where the execution path is dynamic (depends on intent classification). Without it, we'd need to manually handle state, persistence, and error recovery."

**Q**: "What if the LLM is down?"
**A**: "We have a **3-tier fallback**: (1) Internal Llama, (2) Gemini API, (3) Template-based responses. If both LLMs fail, the system still returns a structured answer using tool results and RAG context."

**Q**: "How do you prevent hallucinations?"
**A**: "Three strategies: (1) **RAG grounds responses** in retrieved documents, (2) **Tool results provide real-time data** (not LLM knowledge cutoff), (3) System prompt instructs: 'Do NOT invent numbers or data not in the provided context.'"

**Q**: "Can you add more tools?"
**A**: "Yes! Adding a tool requires: (1) Implement the tool function (API call), (2) Add pattern matching in `run_tools()`, (3) Map tool name in `_execute_tool_call()`. Example: News API, GitHub, Jira."

**Q**: "How do you handle rate limits?"
**A**: "Currently, all APIs are free with generous limits. For production, we'd add: (1) **Caching** (Redis with 5-min TTL), (2) **Exponential backoff** on failures, (3) **API key rotation** for premium APIs."

---

## Deployment & Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# ── LLM Configuration ──────────────────────────────────────
# Internal Llama 3.3 70B
INTERNAL_MODEL_ENDPOINT=https://model-broker.aviator-model.bp.anthos.otxlab.net/v1/chat/completions
INTERNAL_MODEL_NAME=llama-3.3-70b
INTERNAL_API_KEY=your_internal_api_key_here

# Google Gemini (get from https://makersuite.google.com/app/apikey)
GEMINI_API_KEY=your_gemini_api_key_here
# OR (frontend compatibility)
VITE_GEMINI_API_KEY=your_gemini_api_key_here

# LLM Routing
LLM_ROUTING_ENABLED=true             # Enable intelligent routing
LLM_BUDGET_MODE=balanced              # economy | balanced | quality
LLM_MAX_LATENCY_MS=5000               # Max acceptable latency

# Timeouts
LLM_TIMEOUT=8                         # LLM request timeout (seconds)
HTTP_TIMEOUT=10                       # External HTTP timeout (seconds)

# ── Redis Persistence (Optional) ───────────────────────────
REDIS_URL=redis://localhost:6379/0
REDIS_KEY_PREFIX=aiwf:langgraph
REDIS_STATE_TTL_SECONDS=86400         # 24 hours

# ── Debugging ──────────────────────────────────────────────
VERBOSE=true                          # Enable detailed logging
```

### Installation

#### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

pip install -r requirements.txt
```

**Requirements**:
```
fastapi>=0.104.0
uvicorn[standard]>=0.23.0
langgraph>=0.0.34
httpx>=0.24.0
sentence-transformers>=2.2.0
faiss-cpu>=1.7.0
numpy>=1.24.0
redis>=4.5.0  # Optional
python-dotenv>=1.0.0
pydantic>=2.0.0
```

#### Frontend

```bash
npm install
# OR
yarn install
```

### Running the Application

#### 1. Start Backend

```bash
cd backend
python main.py --port 5001
```

Output:
```
============================================================
  AI Visual Workflow — Backend Server
  http://0.0.0.0:5001
  API Docs: http://localhost:5001/docs
============================================================

INFO: Started server process [12345]
INFO: Uvicorn running on http://0.0.0.0:5001
```

#### 2. Start Frontend (separate terminal)

```bash
npm run dev
# OR
yarn dev
```

Output:
```
  VITE v4.4.9  ready in 234 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.100:5173/
```

#### 3. Open Browser

Navigate to: **http://localhost:5173**

---

## Troubleshooting

### Issue: Backend won't start — "Port 5001 already in use"

**Solution 1**: Kill process using the port
```bash
# Windows
netstat -ano | findstr :5001
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:5001 | xargs kill -9
```

**Solution 2**: Use different port
```bash
python main.py --port 8000
```
Update frontend API URL in `App.tsx`: `http://localhost:8000`

---

### Issue: "ModuleNotFoundError: No module named 'langgraph'"

**Solution**: Install dependencies
```bash
pip install -r requirements.txt
```

If using a virtual environment, ensure it's activated:
```bash
source .venv/bin/activate  # Linux/Mac
.venv\Scripts\activate     # Windows
```

---

### Issue: RAG returns no results

**Cause**: No documents loaded or embeddings not generated

**Solution**:
1. Check `backend/data/` directory exists and has files
2. Verify document format (.txt, .md, .json supported)
3. Check logs: `python -c "from backend.rag.document_loader import load_all_documents; print(load_all_documents('backend/data'))"`

---

### Issue: LLM always returns "none" model

**Cause**: No API keys configured

**Solution**:
1. Set environment variables:
   ```bash
   export INTERNAL_API_KEY=your_key_here
   export GEMINI_API_KEY=your_key_here
   ```
2. OR create `.env` file with keys
3. Restart backend server

---

### Issue: Tools not executing

**Cause**: Pattern matching failed or entity extraction incorrect

**Debug**:
```python
from backend.core.orchestrator import run_tools

results = run_tools("AAPL stock price")
print(results)  # Should show: ["Tool [StockPrice]: ..."]
```

If empty, check regex patterns in `run_tools()` function.

---

### Issue: Frontend can't connect to backend

**Symptoms**: "Failed to fetch" error in browser console

**Solution**:
1. Verify backend is running: `curl http://localhost:5001/api/health`
2. Check CORS settings in `api.py` (should allow all origins for dev)
3. Update frontend API URL if using non-default port

---

## Summary

You now have comprehensive documentation covering:

1. ✅ **LangGraph Configuration** — State management, graph construction, conditional routing
2. ✅ **RAG Pipeline** — Vector embeddings, FAISS indexing, hybrid search
3. ✅ **LLM Configuration** — Intelligent routing, multi-provider support, task classification
4. ✅ **MCP Tools** — Tool catalog, pattern matching, API integrations
5. ✅ **Overall Architecture** — Complete system overview, data flow, deployment

**Demo-Ready Features**:
- Navigate to specific code sections with line numbers
- Explain architecture decisions with confidence
- Handle technical questions about each component
- Show execution flow for different query types

**Documentation Files**:
- [LANGGRAPH_CONFIGURATION.md](LANGGRAPH_CONFIGURATION.md) — Graph orchestration
- [RAG_PIPELINE.md](RAG_PIPELINE.md) — Retrieval system
- [LLM_CONFIGURATION.md](LLM_CONFIGURATION.md) — Model routing
- [MCP_TOOLS.md](MCP_TOOLS.md) — External tool execution
- [WORKFLOW_ARCHITECTURE.md](WORKFLOW_ARCHITECTURE.md) — This file (overview)

**Next Steps**:
- Review each component doc before demo
- Practice navigating code with line numbers
- Test demo queries to ensure smooth execution
- Have fallback examples ready for live demo failures

---

**Good luck with your demo! 🚀**
