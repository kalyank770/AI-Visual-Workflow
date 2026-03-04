#!/usr/bin/env python3
"""
============================================================
 AI Visual Workflow — Real LangGraph Orchestrator
============================================================

A production-grade LangGraph workflow implementing the agentic
architecture visualized by the frontend:

  Prompt → Intent Classification → Conditional Routing:
    ├─ RAG Path:    TF-IDF Retrieval → Re-rank → Context
    ├─ MCP Path:    Tool Selection → Real API Calls
    ├─ Hybrid Path: RAG + MCP combined
    └─ Direct Path: LLM-only (or template) response

All tool calls use FREE public APIs — no API keys required.
Optional LLM integration (set INTERNAL_API_KEY or GEMINI_API_KEY).

Usage:
  python langgraph_workflow.py "What is the weather in London?"
  python langgraph_workflow.py "AAPL stock price"
  python langgraph_workflow.py "What is RAG in AI?"

Requirements:
  pip install -r requirements.txt
============================================================
"""
from __future__ import annotations

import os
import re
import sys
import json
import math
import time
import uuid
import operator
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import TypedDict, Annotated, Any, Optional

# ── Optional .env loading ───────────────────────────────────
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    _loaded = False
    for _enc in ("utf-8-sig", "utf-8", "utf-16"):
        try:
            load_dotenv(encoding=_enc)
            load_dotenv(_env_path, encoding=_enc)
            _loaded = True
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    if not _loaded:
        try:
            load_dotenv()
            load_dotenv(_env_path)
        except Exception:
            pass
except ImportError:
    pass  # dotenv is optional; continue without it

# ── Required dependencies ───────────────────────────────────
try:
    import httpx
except ImportError:
    sys.exit("Error: httpx required. Run: pip install httpx")

try:
    import redis as redis_lib  # type: ignore
except ImportError:
    redis_lib = None

try:
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.checkpoint.base import BaseCheckpointSaver
except ImportError:
    MemorySaver = None
    BaseCheckpointSaver = None

try:
    from langgraph.graph import StateGraph, START, END
except ImportError:
    try:
        from langgraph.graph import StateGraph, END
        START = "__start__"
    except ImportError:
        sys.exit("Error: langgraph required. Run: pip install langgraph")

# ── Document Loader ────────────────────────────────────
try:
    from backend.rag.document_loader import load_all_documents, add_document
    has_doc_loader = True
except ImportError:
    has_doc_loader = False
    load_all_documents = None
    add_document = None


# ═══════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════

INTERNAL_MODEL_ENDPOINT = os.environ.get(
    "INTERNAL_MODEL_ENDPOINT",
    "https://model-broker.aviator-model.bp.anthos.otxlab.net/v1/chat/completions",
)
INTERNAL_MODEL_NAME = os.environ.get("INTERNAL_MODEL_NAME", "llama-3.3-70b")
LLM_TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "8"))
HTTP_TIMEOUT = int(os.environ.get("HTTP_TIMEOUT", "10"))
REDIS_URL = os.environ.get("REDIS_URL", "").strip()
REDIS_KEY_PREFIX = os.environ.get("REDIS_KEY_PREFIX", "aiwf:langgraph")
REDIS_STATE_TTL_SECONDS = max(60, int(os.environ.get("REDIS_STATE_TTL_SECONDS", "86400")))

# LLM Routing Configuration
LLM_ROUTING_ENABLED = os.environ.get("LLM_ROUTING_ENABLED", "true").lower() == "true"
LLM_BUDGET_MODE = os.environ.get("LLM_BUDGET_MODE", "balanced")  # "economy", "balanced", "quality"
LLM_MAX_LATENCY_MS = int(os.environ.get("LLM_MAX_LATENCY_MS", "5000"))  # Max acceptable latency


def _log(msg: str):
    """Print debug message when VERBOSE is enabled."""
    if os.environ.get("VERBOSE", "").lower() == "true":
        # Replace Unicode arrows with ASCII equivalents for Windows console compatibility
        msg = msg.replace("→", "->").replace("←", "<-").replace("↔", "<->")
        print(f"  [WORKFLOW] {msg}")


def _merge_state(target: dict, delta: dict) -> dict:
    """Merge node output into current state, preserving aggregated execution logs."""
    for key, value in delta.items():
        if key == "execution_log" and isinstance(value, list):
            existing = target.get("execution_log", [])
            if not isinstance(existing, list):
                existing = []
            target["execution_log"] = existing + value
        else:
            target[key] = value
    return target


class RedisStatePersistence:
    """Persist graph state snapshots in Redis for each workflow run."""

    def __init__(self):
        self.enabled = False
        self.reason = ""
        self.client = None
        self.url = REDIS_URL
        self.key_prefix = REDIS_KEY_PREFIX
        self.ttl_seconds = REDIS_STATE_TTL_SECONDS
        self._connect()

    def _connect(self):
        if not self.url:
            self.reason = "REDIS_URL not set"
            return
        if redis_lib is None:
            self.reason = "redis package not installed"
            return
        try:
            self.client = redis_lib.Redis.from_url(self.url, decode_responses=True)
            self.client.ping()
            self.enabled = True
            self.reason = "connected"
        except Exception as e:
            self.enabled = False
            self.reason = f"connection failed: {e}"
            self.client = None

    def _states_key(self, run_id: str) -> str:
        return f"{self.key_prefix}:run:{run_id}:states"

    def _latest_key(self, run_id: str) -> str:
        return f"{self.key_prefix}:run:{run_id}:latest"

    def save_snapshot(self, run_id: str, stage: str, state: dict):
        if not self.enabled or self.client is None:
            return
        payload = {
            "run_id": run_id,
            "stage": stage,
            "timestamp": time.time(),
            "state": state,
        }
        try:
            encoded = json.dumps(payload, default=str)
            pipe = self.client.pipeline()
            pipe.rpush(self._states_key(run_id), encoded)
            pipe.expire(self._states_key(run_id), self.ttl_seconds)
            pipe.set(self._latest_key(run_id), encoded, ex=self.ttl_seconds)
            pipe.execute()
        except Exception as e:
            _log(f"REDIS persistence write failed: {e}")

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "reason": self.reason,
            "url_configured": bool(self.url),
            "ttl_seconds": self.ttl_seconds,
            "key_prefix": self.key_prefix,
        }


_state_store = RedisStatePersistence()


def get_persistence_status() -> dict:
    """Return Redis persistence status for health/introspection endpoints."""
    return _state_store.status()


# ═══════════════════════════════════════════════════════════
#  BUILT-IN KNOWLEDGE BASE (for RAG)
# ═══════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════
#  KNOWLEDGE BASE — Dynamic Loading from Files
# ═══════════════════════════════════════════════════════════

def _get_default_knowledge_base() -> list[dict]:
    """Fallback knowledge base when document loader is not available."""
    return [
    {
        "title": "Agentic AI Architecture Guide",
        "content": (
            "An agentic AI system is an autonomous software agent that perceives its "
            "environment, makes decisions, and takes actions to achieve goals without "
            "continuous human guidance. Core components include: (1) Orchestrator "
            "(LangGraph/LangChain) — the central controller managing state, routing "
            "requests, and coordinating between the LLM, tools, and memory. It implements "
            "a directed graph where nodes represent processing steps and edges represent "
            "transitions. State is persisted to Redis or PostgreSQL for fault tolerance. "
            "(2) Large Language Model — the reasoning engine that generates plans, evaluates "
            "tool outputs, and synthesizes final responses. Models like Llama 3.3 70B or "
            "GPT-4 with function calling capabilities are used. (3) RAG — Retrieval-Augmented "
            "Generation augments LLM responses with relevant documents from a vector database. "
            "The pipeline includes query expansion, embedding generation, similarity search, "
            "and re-ranking. (4) Vector Database — stores document embeddings as high-dimensional "
            "vectors supporting nearest-neighbor search using HNSW algorithms. Options include "
            "Pinecone, ChromaDB, Weaviate, and pgvector. (5) Tool Integration (MCP) — Model "
            "Context Protocol provides a standardized interface for agents to interact with "
            "external services, APIs, databases, and enterprise applications. The agent follows "
            "a Plan-Execute-Evaluate cycle with bounded iteration to prevent infinite loops."
        ),
    },
    {
        "title": "RAG Pipeline Best Practices",
        "content": (
            "Retrieval-Augmented Generation (RAG) grounds LLM responses in enterprise "
            "knowledge. Document ingestion involves format parsing, cleaning, chunking into "
            "200-500 token overlapping segments, and metadata extraction. Chunking strategies "
            "include fixed-size, semantic (sentence boundaries), recursive, and document-aware "
            "approaches. Embeddings are generated using models like text-embedding-004 (768 "
            "dimensions) or text-embedding-3-large (3072 dimensions). Hybrid search combines "
            "vector similarity with keyword search (BM25) via Reciprocal Rank Fusion (RRF). "
            "Re-ranking uses cross-encoder models like ms-marco-MiniLM to sort results by "
            "true relevance. Query expansion generates multiple reformulations for better "
            "recall: synonym expansion, HyDE (Hypothetical Document Embedding), and multi-query "
            "generation. Evaluation metrics include Precision@K, Recall@K, MRR (Mean Reciprocal "
            "Rank), NDCG (Normalized Discounted Cumulative Gain), and Faithfulness which "
            "measures whether the LLM stays grounded in retrieved context."
        ),
    },
    {
        "title": "LangGraph Orchestration Patterns",
        "content": (
            "LangGraph builds stateful multi-step agent workflows as directed graphs. Graph "
            "state is a TypedDict flowing through every node, containing messages, plan, "
            "tool_results, and context. Conditional edges determine the next node at runtime "
            "based on current state — routing to RAG, tools, or synthesis nodes depending on "
            "the classified intent. Checkpointing saves state after each node for fault "
            "tolerance, human-in-the-loop validation, and time-travel debugging. Subgraph "
            "composition decomposes complex workflows: research subgraph (query expansion → "
            "vector search → re-ranking), tool execution subgraph (selection → validation → "
            "API call → parsing), synthesis subgraph (context assembly → generation → citation "
            "linking). Error handling includes retry with backoff, fallback nodes, graceful "
            "degradation, and human escalation. Loop detection prevents infinite recursion via "
            "max iteration limits, cycle detection, and timeout-based circuit breakers. "
            "Streaming supports token-level LLM output and node-level completion events."
        ),
    },
    {
        "title": "MCP Protocol Specification",
        "content": (
            "The Model Context Protocol (MCP) is an open standard by Anthropic for connecting "
            "AI agents to external tools and data sources. It uses JSON-RPC 2.0 over stdio or "
            "HTTP/SSE transport. The protocol supports tool discovery (listing available tools "
            "with schemas), tool execution (calling tools with validated parameters), resource "
            "access (files, databases, APIs), and prompt templates. Each tool is registered "
            "with a name, description, input_schema (JSON Schema), and output format. "
            "Authentication supports API keys, OAuth 2.0, mTLS, and custom adapters. Security "
            "features include sandbox execution in isolated containers, input validation "
            "against schemas, output sanitization, rate limiting, and audit logging. Enterprise "
            "integration enables CRM queries, ERP operations, ITSM ticket management, knowledge "
            "base searches, and communication tools like email, Slack, and Teams notifications."
        ),
    },
    {
        "title": "OpenText Corporate & Product Overview",
        "content": (
            "OpenText Corporation is a Canadian enterprise information management company "
            "founded in 1991, headquartered in Waterloo, Ontario. It trades on NASDAQ and TSX "
            "as OTEX. OpenText acquired Micro Focus in 2023 for approximately $5.8 billion, "
            "expanding into DevOps, IT operations, and application modernization. Key products: "
            "Content Server (enterprise content management), Documentum (content services "
            "platform), Extended ECM (content in business process context), Trading Grid (B2B "
            "integration network), TeamSite (web CMS), Exstream (customer communications), "
            "Fortify (application security testing), ArcSight (SIEM threat detection), NetIQ "
            "(identity and access management), Voltage (data-centric encryption), EnCase "
            "(digital forensics), LoadRunner (performance testing), SMAX (IT service management "
            "with ML), Magellan (AI and analytics platform), and Aviator (next-generation AI "
            "platform leveraging LLMs for intelligent search, content summarization, and "
            "conversational AI assistants). Cloud Editions (CE) deliver quarterly releases on "
            "AWS, Azure, and Google Cloud."
        ),
    },
    ]


# Try to load documents from /data folder; fallback to inline docs if empty
if has_doc_loader and load_all_documents:
    try:
        # Go up from backend/core/ to backend/data/
        data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
        KNOWLEDGE_BASE = load_all_documents(data_dir)
        _log(f"Loaded {len(KNOWLEDGE_BASE)} documents from {data_dir}")
    except Exception as e:
        _log(f"Failed to load documents: {e}")
        KNOWLEDGE_BASE = _get_default_knowledge_base()
else:
    KNOWLEDGE_BASE = _get_default_knowledge_base()


# ═══════════════════════════════════════════════════════════
#  RAG ENGINE — Real vector embeddings with ChromaDB
# ═══════════════════════════════════════════════════════════

# Import the new vector RAG engine
try:
    from backend.rag.vector_engine import create_rag_engine, VectorRAGEngine, TFIDFRAGEngine
    _log("Vector RAG engine module loaded successfully")
except ImportError as e:
    _log(f"Failed to import vector_rag_engine: {e}")
    # Fallback to inline TF-IDF implementation
    class RAGEngine:
        """Lightweight retrieval engine using TF-IDF vectorization and cosine similarity."""

        def __init__(self, documents: list[dict], chunk_size: int = 300, chunk_overlap: int = 60):
            self.chunks: list[dict] = []
            self.idf: dict[str, float] = {}
            self.chunk_vectors: list[dict[str, float]] = []
            self._chunk_documents(documents, chunk_size, chunk_overlap)
            self._build_index()
            _log(f"RAG Engine: {len(documents)} docs → {len(self.chunks)} chunks indexed")

        @staticmethod
        def _tokenize(text: str) -> list[str]:
            """Split text into lowercase alphanumeric tokens."""
            return re.findall(r"[a-z0-9]+", text.lower())

        def _chunk_documents(self, docs: list[dict], size: int, overlap: int):
            """Split documents into overlapping chunks, breaking at sentence boundaries."""
            for doc in docs:
                text = doc["content"]
                title = doc["title"]
                pos, idx = 0, 0
                while pos < len(text):
                    end = min(pos + size, len(text))
                    # Try to break at a sentence boundary
                    if end < len(text):
                        last_period = text.rfind(". ", pos, end)
                        if last_period > pos + size // 2:
                            end = last_period + 2
                    self.chunks.append(
                        {
                            "content": text[pos:end].strip(),
                            "source": title,
                            "chunk_index": idx,
                            "char_start": pos,
                            "char_end": end,
                        }
                    )
                    pos = max(pos + 1, end - overlap)
                    idx += 1

        def _build_index(self):
            """Compute IDF across the corpus and TF-IDF vectors per chunk."""
            N = len(self.chunks)
            if N == 0:
                return
            all_tokens = [self._tokenize(c["content"]) for c in self.chunks]
            # Inverse Document Frequency
            doc_freq: dict[str, int] = {}
            for tokens in all_tokens:
                for t in set(tokens):
                    doc_freq[t] = doc_freq.get(t, 0) + 1
            self.idf = {t: math.log((N + 1) / (1 + df)) for t, df in doc_freq.items()}
            # TF-IDF vectors
            for tokens in all_tokens:
                tf = Counter(tokens)
                total = len(tokens) or 1
                vec = {t: (c / total) * self.idf.get(t, 0) for t, c in tf.items()}
                self.chunk_vectors.append(vec)

        @staticmethod
        def _cosine_sim(v1: dict[str, float], v2: dict[str, float]) -> float:
            """Compute cosine similarity between two sparse TF-IDF vectors."""
            shared = set(v1) & set(v2)
            if not shared:
                return 0.0
            dot = sum(v1[k] * v2[k] for k in shared)
            n1 = math.sqrt(sum(x * x for x in v1.values()))
            n2 = math.sqrt(sum(x * x for x in v2.values()))
            return dot / (n1 * n2) if n1 and n2 else 0.0

        def search(self, query: str, top_k: int = 5) -> list[dict]:
            """Search the index for chunks most relevant to the query."""
            tokens = self._tokenize(query)
            if not tokens:
                return []
            tf = Counter(tokens)
            total = len(tokens)
            q_vec = {t: (c / total) * self.idf.get(t, 0) for t, c in tf.items()}
            scored = []
            for i, c_vec in enumerate(self.chunk_vectors):
                score = self._cosine_sim(q_vec, c_vec)
                if score > 0.01:
                    scored.append((score, i))
            scored.sort(key=lambda x: -x[0])
            return [
                {"chunk": self.chunks[i], "score": round(s, 4), "method": "tfidf"}
                for s, i in scored[:top_k]
            ]
        
        def get_stats(self) -> dict:
            """Get statistics about the indexed data."""
            return {
                "total_documents": len(self.chunks),
                "total_chunks": len(self.chunks),
                "method": "TF-IDF (fallback)",
            }
    
    create_rag_engine = lambda docs, **kwargs: RAGEngine(docs, **kwargs)


# Singleton RAG engine — initialized once at import time
# Uses VectorRAGEngine if available, falls back to TF-IDF
try:
    _rag_engine = create_rag_engine(KNOWLEDGE_BASE)
    _rag_type = type(_rag_engine).__name__
    _log(f"Initialized {_rag_type} successfully")
except Exception as e:
    _log(f"Failed to initialize RAG engine: {e}")
    # Final fallback to basic TF-IDF
    _rag_engine = RAGEngine(KNOWLEDGE_BASE) if 'RAGEngine' in locals() else None
    _log("Using fallback TF-IDF RAG engine")


# ═══════════════════════════════════════════════════════════
#  TOOL IMPLEMENTATIONS — Real APIs, no keys needed
# ═══════════════════════════════════════════════════════════


def _http_get(url: str, headers: dict | None = None) -> Any | None:
    """Safe HTTP GET returning parsed JSON or None on failure."""
    try:
        h = {"User-Agent": "AIVisualWorkflow/2.0 (educational project; contact@example.com)"}
        if headers:
            h.update(headers)
        resp = httpx.get(url, headers=h, timeout=HTTP_TIMEOUT, follow_redirects=True)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        _log(f"HTTP GET failed ({url[:80]}): {e}")
    return None


# Well-known company → ticker map (instant, no network needed)
_COMMON_TICKERS: dict[str, str] = {
    "apple": "AAPL", "microsoft": "MSFT", "google": "GOOGL", "alphabet": "GOOGL",
    "amazon": "AMZN", "meta": "META", "facebook": "META", "tesla": "TSLA",
    "nvidia": "NVDA", "amd": "AMD", "advanced micro devices": "AMD",
    "intel": "INTC", "netflix": "NFLX", "disney": "DIS", "walmart": "WMT",
    "coca cola": "KO", "coca-cola": "KO", "pepsi": "PEP", "pepsico": "PEP",
    "boeing": "BA", "ibm": "IBM", "oracle": "ORCL", "salesforce": "CRM",
    "adobe": "ADBE", "paypal": "PYPL", "uber": "UBER", "spotify": "SPOT",
    "snap": "SNAP", "pinterest": "PINS", "zoom": "ZM",
    "opentext": "OTEX", "open text": "OTEX", "otex": "OTEX",
    "berkshire hathaway": "BRK-B", "jpmorgan": "JPM", "jp morgan": "JPM",
    "goldman sachs": "GS", "bank of america": "BAC", "wells fargo": "WFC",
    "citigroup": "C", "visa": "V", "mastercard": "MA",
    "american express": "AXP", "nike": "NKE", "starbucks": "SBUX",
    "costco": "COST", "target": "TGT", "home depot": "HD",
    "exxon": "XOM", "exxonmobil": "XOM", "chevron": "CVX",
    "pfizer": "PFE", "moderna": "MRNA", "airbnb": "ABNB",
    "palantir": "PLTR", "snowflake": "SNOW", "crowdstrike": "CRWD",
    "shopify": "SHOP", "ford": "F", "general motors": "GM",
    "general electric": "GE", "3m": "MMM", "caterpillar": "CAT",
    "mcdonald's": "MCD", "mcdonalds": "MCD", "cisco": "CSCO",
    "qualcomm": "QCOM", "broadcom": "AVGO", "micron": "MU",
    "dell": "DELL", "hp": "HPQ", "sony": "SONY", "samsung": "SSNLF",
    "databricks": "DBX", "dropbox": "DBX", "twilio": "TWLO",
    "roku": "ROKU", "roblox": "RBLX", "coinbase": "COIN",
    "robinhood": "HOOD", "lucid": "LCID", "rivian": "RIVN",
    "nio": "NIO", "li auto": "LI", "xpeng": "XPEV",
}


def _resolve_ticker(query: str) -> str | None:
    """Resolve a company name or ticker to a Yahoo Finance ticker symbol.

    Priority chain:
      1. Common tickers map (instant, no network)
      2. Yahoo Finance search API (handles everything else)
      3. Fallback: trust short uppercase input as raw ticker
    """
    stripped = query.strip()
    key = stripped.lower()

    # 1. Instant lookup from common map
    if key in _COMMON_TICKERS:
        _log(f"Resolved '{query}' → {_COMMON_TICKERS[key]} (common map)")
        return _COMMON_TICKERS[key]

    # 2. Yahoo Finance search (always try, even for uppercase input like "APPLE")
    search_terms = [stripped]
    if not re.match(r"^[A-Z]{1,5}$", stripped):
        search_terms.extend([f"{stripped} corporation", f"{stripped} company", f"{stripped} inc"])
    for term in search_terms:
        data = _http_get(
            f"https://query2.finance.yahoo.com/v1/finance/search"
            f"?q={term}&quotesCount=5&newsCount=0&listsCount=0"
        )
        if not data:
            continue
        quotes = [
            q for q in data.get("quotes", [])
            if q.get("quoteType") in ("EQUITY", "ETF")
        ]
        if quotes:
            _log(f"Resolved '{query}' → {quotes[0]['symbol']} (via '{term}')")
            return quotes[0]["symbol"]

    # 3. Last resort: if input was short uppercase, trust it as a raw ticker
    if re.match(r"^[A-Z]{1,4}$", stripped):
        _log(f"Resolved '{query}' → {stripped} (assumed ticker, Yahoo search failed)")
        return stripped

    return None


def tool_stock_price(query: str) -> str | None:
    """Fetch real stock price from Yahoo Finance (free, no key)."""
    ticker = _resolve_ticker(query)
    if not ticker:
        _log(f"stock_price: no ticker found for '{query}'")
        return None
    # Get price data
    data = _http_get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
    )
    if not data:
        return None
    result = (data.get("chart") or {}).get("result", [None])[0]
    if not result:
        _log(f"stock_price: chart data empty for ticker '{ticker}'")
        return None
    meta = result["meta"]
    price = meta["regularMarketPrice"]
    prev = meta.get("chartPreviousClose", meta.get("previousClose", price))
    change = price - prev
    pct = (change / prev * 100) if prev else 0
    cur = meta.get("currency", "USD")
    name = meta.get("shortName", ticker)
    exchange = meta.get("exchangeName", "N/A")
    return (
        f"{name} ({ticker}) on {exchange}: {cur} {price:.2f} | "
        f"Change: {'+'if change>=0 else ''}{change:.2f} ({pct:+.2f}%) | "
        f"Prev Close: {cur} {prev:.2f}"
    )


def tool_weather(city: str) -> str | None:
    """Fetch real weather from Open-Meteo (free, no key)."""
    geo = _http_get(
        f"https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=en"
    )
    if not geo or not geo.get("results"):
        return None
    loc = geo["results"][0]
    lat, lon = loc["latitude"], loc["longitude"]
    name = loc.get("name", city)
    country = loc.get("country", "")
    weather = _http_get(
        f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
        f"&current=temperature_2m,relative_humidity_2m,apparent_temperature,"
        f"weather_code,wind_speed_10m"
        f"&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3"
    )
    if not weather or "current" not in weather:
        return None
    cur = weather["current"]
    codes = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Foggy", 48: "Rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
        55: "Dense drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
        71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
        80: "Showers", 81: "Moderate showers", 82: "Heavy showers",
        95: "Thunderstorm", 96: "Thunderstorm with hail",
    }
    condition = codes.get(cur.get("weather_code", -1), f"Code {cur.get('weather_code')}")
    temp_f = cur["temperature_2m"] * 9 / 5 + 32
    feels_f = cur["apparent_temperature"] * 9 / 5 + 32
    # 3-day forecast
    daily = weather.get("daily", {})
    forecast = ""
    if daily.get("time"):
        days = []
        for i, date_str in enumerate(daily["time"][:3]):
            d = datetime.strptime(date_str, "%Y-%m-%d").strftime("%a %b %d")
            lo = daily["temperature_2m_min"][i]
            hi = daily["temperature_2m_max"][i]
            days.append(f"{d}: {lo}°C–{hi}°C")
        forecast = " | Forecast: " + "; ".join(days)
    return (
        f"Weather in {name}, {country}: {condition} | "
        f"{cur['temperature_2m']}°C ({temp_f:.0f}°F) | "
        f"Feels like {cur['apparent_temperature']}°C ({feels_f:.0f}°F) | "
        f"Humidity {cur['relative_humidity_2m']}% | "
        f"Wind {cur['wind_speed_10m']} km/h{forecast}"
    )


def tool_wikipedia(topic: str) -> str | None:
    """Fetch Wikipedia summary with infobox data for leadership info (free, no key)."""
    data = _http_get(
        f"https://en.wikipedia.org/api/rest_v1/page/summary/{topic.replace(' ', '_')}",
        headers={"Accept": "application/json"},
    )
    if not data or data.get("type") == "not_found":
        # Fallback: search for the topic
        search = _http_get(
            f"https://en.wikipedia.org/w/api.php"
            f"?action=opensearch&search={topic}&limit=1&format=json"
        )
        if search and isinstance(search, list) and len(search) > 1 and search[1]:
            title = search[1][0]
            data = _http_get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/"
                f"{title.replace(' ', '_')}",
                headers={"Accept": "application/json"},
            )
    if not data or "extract" not in data:
        return None
    
    title = data.get("title", topic)
    extract = data["extract"]
    if len(extract) > 800:
        extract = extract[:800].rsplit(". ", 1)[0] + "."
    
    # Try to fetch infobox data for leadership information
    page_title = data.get("title", topic)
    infobox_data = _http_get(
        f"https://en.wikipedia.org/w/api.php"
        f"?action=query&prop=revisions&rvprop=content&rvslots=main&titles={page_title.replace(' ', '_')}"
        f"&format=json&formatversion=2"
    )
    
    # Extract CEO/leadership info from infobox if available
    leadership_info = ""
    if infobox_data and "query" in infobox_data and "pages" in infobox_data["query"]:
        pages = infobox_data["query"]["pages"]
        if pages and len(pages) > 0:
            content = pages[0].get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")
            # Look for common infobox fields for leadership
            ceo_match = re.search(r'\|\s*(?:key_people|ceo|CEO|leader_name)\s*=\s*([^\n|]+)', content, re.IGNORECASE)
            if ceo_match:
                ceo_text = ceo_match.group(1).strip()
                # Clean up wiki markup
                ceo_text = re.sub(r'\[\[(?:[^\]]+\|)?([^\]]+)\]\]', r'\1', ceo_text)
                ceo_text = re.sub(r'{{[^}]+}}', '', ceo_text)
                ceo_text = re.sub(r'<[^>]+>', '', ceo_text)
                ceo_text = ceo_text.strip()
                if ceo_text and len(ceo_text) < 200:
                    leadership_info = f" | Leadership: {ceo_text}"
    
    return f"Wikipedia — {title}: {extract}{leadership_info}"


def tool_dictionary(word: str) -> str | None:
    """Fetch word definition from Free Dictionary API (free, no key)."""
    data = _http_get(f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}")
    if not data or not isinstance(data, list):
        return None
    entry = data[0]
    phonetic = entry.get("phonetic", "")
    meanings = []
    for m in entry.get("meanings", [])[:3]:
        pos = m.get("partOfSpeech", "")
        defs = [d["definition"] for d in m.get("definitions", [])[:2]]
        if defs:
            meanings.append(f"{pos}: {'; '.join(defs)}")
    return f"{word} {phonetic}: " + " | ".join(meanings) if meanings else None


def tool_calculator(expr: str) -> str | None:
    """Safely evaluate a math expression (no code injection)."""
    cleaned = re.sub(r"[^0-9+\-*/().%^ ]", "", expr)
    cleaned = cleaned.replace("^", "**")
    if not cleaned.strip():
        return None
    try:
        # Restrict to safe builtins only
        result = eval(
            cleaned,
            {"__builtins__": {}},
            {"abs": abs, "round": round, "min": min, "max": max},
        )
        return f"{expr} = {result}"
    except Exception:
        return None


def tool_web_search(query: str) -> str | None:
    """Search using DuckDuckGo Instant Answer API (free, no key)."""
    data = _http_get(
        f"https://api.duckduckgo.com/"
        f"?q={query.replace(' ', '+')}&format=json&no_html=1&skip_disambig=1"
    )
    if not data:
        return None
    # Try direct Answer field
    answer = data.get("Answer", "")
    if answer:
        return f"[DuckDuckGo] {answer}"
    # Try abstract answer
    abstract = data.get("AbstractText", "")
    source = data.get("AbstractSource", "")
    if abstract:
        if len(abstract) > 600:
            abstract = abstract[:600].rsplit(". ", 1)[0] + "."
        return f"[{source}] {abstract}"
    # Try related topics
    topics = data.get("RelatedTopics", [])
    if topics:
        summaries = []
        for t in topics[:3]:
            text = t.get("Text", "")
            if text:
                summaries.append(text[:200])
        if summaries:
            return "Related: " + " | ".join(summaries)
    # Try Infobox
    infobox = data.get("Infobox", {})
    if infobox and infobox.get("content"):
        facts = []
        for item in infobox["content"][:5]:
            label = item.get("label", "")
            value = item.get("value", "")
            if label and value:
                facts.append(f"{label}: {value}")
        if facts:
            return "[DuckDuckGo] " + " | ".join(facts)
    
    # Fallback: Return acknowledgment that search was attempted
    # This ensures the tool is "called" even when DuckDuckGo has no instant answers
    return f"Web search query received: '{query}'. For real-time results, please use a full-featured search engine."


def tool_stock_analysis(query: str) -> str | None:
    """Fetch stock trend data from Yahoo Finance for prediction/forecast context."""
    ticker = _resolve_ticker(query)
    if not ticker:
        return None
    # Get 1-month chart data for trend analysis
    data = _http_get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?interval=1d&range=1mo"
    )
    if not data:
        return None
    result = (data.get("chart") or {}).get("result", [None])[0]
    if not result:
        return None
    meta = result["meta"]
    price = meta["regularMarketPrice"]
    prev = meta.get("chartPreviousClose", meta.get("previousClose", price))
    cur = meta.get("currency", "USD")
    name = meta.get("shortName", ticker)
    exchange = meta.get("exchangeName", "N/A")
    # Extract closing prices for trend
    indicators = result.get("indicators", {}).get("quote", [{}])[0]
    closes = [c for c in (indicators.get("close") or []) if c is not None]
    timestamps = result.get("timestamp", [])
    trend_info = ""
    if len(closes) >= 5:
        recent_5 = closes[-5:]
        month_start = closes[0]
        month_end = closes[-1]
        month_change = month_end - month_start
        month_pct = (month_change / month_start * 100) if month_start else 0
        high_30d = max(closes)
        low_30d = min(closes)
        avg_30d = sum(closes) / len(closes)
        # 5-day trend
        five_day_change = recent_5[-1] - recent_5[0]
        five_day_pct = (five_day_change / recent_5[0] * 100) if recent_5[0] else 0
        trend_dir = "upward" if month_pct > 1 else "downward" if month_pct < -1 else "sideways"
        trend_info = (
            f" | 30-Day Trend: {trend_dir} ({month_pct:+.2f}%) | "
            f"30-Day Range: {cur} {low_30d:.2f} - {cur} {high_30d:.2f} | "
            f"30-Day Avg: {cur} {avg_30d:.2f} | "
            f"5-Day Change: {five_day_pct:+.2f}%"
        )
    daily_change = price - prev
    daily_pct = (daily_change / prev * 100) if prev else 0
    return (
        f"{name} ({ticker}) on {exchange}: Current {cur} {price:.2f} | "
        f"Daily: {'+'if daily_change>=0 else ''}{daily_change:.2f} ({daily_pct:+.2f}%)"
        f"{trend_info}"
    )


def tool_world_clock(location: str) -> str:
    """Get current time for a timezone or city."""
    offset_map = {
        "new york": -5, "nyc": -5, "est": -5, "eastern": -5,
        "chicago": -6, "cst": -6, "central": -6,
        "denver": -7, "mst": -7, "mountain": -7,
        "los angeles": -8, "la": -8, "pst": -8, "pacific": -8, "san francisco": -8,
        "london": 0, "gmt": 0, "utc": 0,
        "paris": 1, "berlin": 1, "cet": 1, "rome": 1, "madrid": 1,
        "cairo": 2, "johannesburg": 2, "istanbul": 3, "moscow": 3, "msk": 3,
        "dubai": 4, "abu dhabi": 4, "india": 5.5, "mumbai": 5.5, "delhi": 5.5,
        "ist": 5.5, "kolkata": 5.5, "bangalore": 5.5, "hyderabad": 5.5, "chennai": 5.5,
        "bangkok": 7, "jakarta": 7, "singapore": 8, "hong kong": 8,
        "beijing": 8, "shanghai": 8, "perth": 8,
        "tokyo": 9, "jst": 9, "seoul": 9, "kst": 9,
        "sydney": 11, "aest": 11, "melbourne": 11, "auckland": 13, "nzst": 13,
        "honolulu": -10, "hst": -10, "anchorage": -9, "akst": -9,
        "sao paulo": -3, "buenos aires": -3, "mexico city": -6,
        "waterloo": -5, "toronto": -5, "vancouver": -8, "ottawa": -5,
    }
    loc_lower = location.lower().strip()
    offset = offset_map.get(loc_lower)
    if offset is None:
        for name, off in offset_map.items():
            if name in loc_lower or loc_lower in name:
                offset = off
                break
    if offset is None:
        offset = 0
        location = f"{location} (defaulting to UTC)"
    now = datetime.now(timezone.utc) + timedelta(hours=offset)
    sign = "+" if offset >= 0 else ""
    return f"Time in {location}: {now.strftime('%Y-%m-%d %H:%M:%S')} (UTC{sign}{offset})"


# Currency code mappings for flexible input
_CURRENCY_CODES: dict[str, str] = {
    # Fiat currencies
    "usd": "USD", "dollar": "USD", "dollars": "USD", "us dollar": "USD",
    "eur": "EUR", "euro": "EUR", "euros": "EUR",
    "gbp": "GBP", "pound": "GBP", "pounds": "GBP", "sterling": "GBP",
    "inr": "INR", "rupee": "INR", "rupees": "INR", "indian rupee": "INR",
    "jpy": "JPY", "yen": "JPY",
    "cad": "CAD", "canadian dollar": "CAD",
    "aud": "AUD", "australian dollar": "AUD",
    "cny": "CNY", "yuan": "CNY", "chinese yuan": "CNY",
    "chf": "CHF", "franc": "CHF", "swiss franc": "CHF",
    "krw": "KRW", "won": "KRW", "korean won": "KRW",
    "brl": "BRL", "real": "BRL", "brazilian real": "BRL",
    "mxn": "MXN", "mexican peso": "MXN", "peso": "MXN",
    "sgd": "SGD", "singapore dollar": "SGD",
    "hkd": "HKD", "hong kong dollar": "HKD",
    "nzd": "NZD", "new zealand dollar": "NZD",
    "sek": "SEK", "swedish krona": "SEK",
    "nok": "NOK", "norwegian krone": "NOK",
    "dkk": "DKK", "danish krone": "DKK",
    "zar": "ZAR", "south african rand": "ZAR", "rand": "ZAR",
    "thb": "THB", "baht": "THB", "thai baht": "THB",
    "myr": "MYR", "ringgit": "MYR", "malaysian ringgit": "MYR",
    "php": "PHP", "peso": "PHP", "philippine peso": "PHP",
    "idr": "IDR", "rupiah": "IDR", "indonesian rupiah": "IDR",
    "try": "TRY", "lira": "TRY", "turkish lira": "TRY",
    "pln": "PLN", "zloty": "PLN", "polish zloty": "PLN",
    "czk": "CZK", "czech koruna": "CZK", "koruna": "CZK",
    "huf": "HUF", "hungarian forint": "HUF", "forint": "HUF",
    "ron": "RON", "romanian leu": "RON", "leu": "RON",
    "bgn": "BGN", "bulgarian lev": "BGN", "lev": "BGN",
    "hrk": "HRK", "croatian kuna": "HRK", "kuna": "HRK",
    "isk": "ISK", "icelandic krona": "ISK",
}


def tool_currency(from_currency: str, to_currency: str, amount: float = 1.0) -> str | None:
    """Convert currency using Exchange Rate API (free tier available).
    
    Args:
        from_currency: Source currency (e.g., "USD", "EUR", "INR", "dollar", "euro")
        to_currency: Target currency  
        amount: Amount to convert (default 1.0)
    
    Returns:
        Formatted conversion result or None if failed
    """
    # Normalize currency codes
    from_code = _CURRENCY_CODES.get(from_currency.lower(), from_currency.upper())
    to_code = _CURRENCY_CODES.get(to_currency.lower(), to_currency.upper())
    
    # Validate codes (basic check: 3 uppercase letters)
    if not (len(from_code) == 3 and from_code.isupper() and len(to_code) == 3 and to_code.isupper()):
        _log(f"currency: invalid codes '{from_code}' → '{to_code}'")
        return None
    
    # Try multiple free APIs in order of reliability
    apis = [
        # API 1: exchangerate-api.com (most reliable, free tier: 1500/month)
        f"https://api.exchangerate-api.com/v4/latest/{from_code}",
        # API 2: open-exchange-rates (free tier available)
        f"https://openexchangerates.org/api/latest.json?base={from_code}&app_id=dummy",
        # API 3: fixer.io (free tier: 100/month)
        f"https://api.fixer.io/latest?base={from_code}&symbols={to_code}",
    ]
    
    for api_url in apis:
        try:
            data = _http_get(api_url)
            if not data:
                continue
            
            # Parse API response (different formats)
            rate = None
            
            # exchangerate-api.com format
            if "rates" in data and isinstance(data["rates"], dict):
                rate = data["rates"].get(to_code)
            
            # open-exchange-rates format
            elif "rates" in data and isinstance(data["rates"], dict):
                rate = data["rates"].get(to_code)
            
            # fixer.io format
            elif "rates" in data and to_code in data["rates"]:
                rate = data["rates"][to_code]
            
            if rate and isinstance(rate, (int, float)):
                converted = amount * rate
                return (
                    f"{amount} {from_code} = {converted:.2f} {to_code} "
                    f"(rate: 1 {from_code} = {rate:.4f} {to_code})"
                )
        except Exception as e:
            _log(f"currency API {api_url[:40]}: {e}")
            continue
    
    # Fallback: try a simple calculation-based approach (offline)
    # This is a last resort with hardcoded rates (obviously not live)
    _OFFLINE_RATES = {
        ("USD", "EUR"): 0.92,
        ("EUR", "USD"): 1.09,
        ("USD", "INR"): 83.2,
        ("INR", "USD"): 0.012,
        ("EUR", "INR"): 90.5,
        ("INR", "EUR"): 0.011,
        ("EUR", "GBP"): 0.86,
        ("GBP", "EUR"): 1.16,
    }
    
    rate = _OFFLINE_RATES.get((from_code, to_code))
    if rate:
        converted = amount * rate
        _log(f"currency: using offline fallback rate for {from_code}→{to_code}")
        return (
            f"{amount} {from_code} = {converted:.2f} {to_code} "
            f"(rate: 1 {from_code} = {rate:.4f} {to_code}) [offline rate - may be outdated]"
        )
    
    _log(f"currency: no rate found for {from_code}→{to_code}")
    return None


# ═══════════════════════════════════════════════════════════
#  TOOL DISPATCHER — detects intent and calls the right tools
# ═══════════════════════════════════════════════════════════


def _llm_keys_available() -> bool:
    """Return True when at least one LLM API key is configured."""
    return bool(
        os.environ.get("INTERNAL_API_KEY")
        or os.environ.get("VITE_INTERNAL_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
    )


def run_tools(prompt: str) -> list[str]:
    """
    Intelligently route query to tools using LLM-based selection (primary) 
    with regex fallback for safety.
    
    RULE: If LLM successfully parses and selects tools, USE THEM (even if execution returns no data).
    Only fall back to regex if LLM fails completely (timeout, parse error, etc).
    """
    
    _log(f"\n{'='*80}")
    _log(f"RUN_TOOLS CALLED: prompt='{prompt}'")
    _log(f"{'='*80}\n")
    
    # ════════════════════════════════════════════════════════════════
    #  PHASE 1: LLM-BASED TOOL SELECTION (PRIMARY METHOD)
    # ════════════════════════════════════════════════════════════════
    llm_tools = _llm_select_tools(prompt)
    
    if llm_tools:
        _log(f"\n✓ LLM tool selection SUCCEEDED")
        _log(f"  Tools selected: {[t['tool'] for t in llm_tools]}")
        _log(f"  Full tools: {llm_tools}\n")
        
        results: list[str] = []
        for tool_call in llm_tools:
            tool_name = tool_call["tool"]
            entity = tool_call["entity"]
            _log(f"  → Executing: {tool_name} with entity: '{entity}'")
            
            result = _execute_tool_call(tool_name, entity, original_prompt=prompt)
            if result:
                results.append(result)
                _log(f"    ✓ {tool_name} returned: {result[:100]}...")
            else:
                _log(f"    ✗ {tool_name} returned None")
        
        # CRITICAL: If LLM selected tools, ALWAYS return (don't fall back to regex)
        # Even if some/all tools returned no data, that's the correct routing
        if results:
            _log(f"\n✓ FINAL: {len(results)} tool(s) executed successfully")
            return results
        else:
            _log(f"\n⚠ FINAL: All tools returned no data, but trusting LLM routing")
            return [f"Tool [LLM-routing-success]: Query routed to {[t['tool'] for t in llm_tools]} but no data available"]
    
    # ════════════════════════════════════════════════════════════════
    #  PHASE 2: FALLBACK STRATEGY
    # ════════════════════════════════════════════════════════════════
    # If LLM routing is enabled and keys are configured, avoid regex
    # and use a general web search fallback instead.
    if LLM_ROUTING_ENABLED and _llm_keys_available():
        _log("\n✗ LLM tool selection FAILED → using web search fallback")
        result = tool_web_search(prompt)
        if result:
            return [f"Tool [WebSearch]: {result}"]
        return ["Tool [WebSearch]: Web search attempted but no results returned."]

    # Otherwise, fall back to deterministic regex routing (no LLM available)
    _log(f"\n✗ LLM tool selection FAILED → falling back to regex")
    return _regex_run_tools(prompt)



def _regex_run_tools(prompt: str) -> list[str]:
    """Regex-based fallback for tool detection and execution."""
    results: list[str] = []
    lower = prompt.lower()

    # ── Prediction/Forecast Detection (must come before stock detection) ──
    # Note: 'forecast' alone is weather; only counts as prediction if stock-related
    is_prediction_query = bool(
        re.search(
            r"\b(predict(?:ion)?|forecast|outlook|future|tomorrow|"
            r"next\s+(?:\d+\s*)?(?:days?|weeks?|months?|years?|quarters?)|"
            r"\d+\s*(?:months?|years?|weeks?|days?|quarters?)|"
            r"will\s+(?:go|be|rise|fall|drop|increase|crash)|trend|estimate|projection)\b",
            lower,
        )
    ) or (
        "forecast" in lower and any(w in lower for w in ("stock", "share", "market", "price", "ticker"))
    )

    # ── Stock Prediction → ALWAYS fetch BOTH stock_analysis AND wikipedia ──
    if is_prediction_query and any(w in lower for w in ("stock", "share", "ticker", "market", "price")):
        # Try multiple extraction strategies
        entity = None
        
        # Strategy 1: Look for ticker symbols first (most reliable)
        ticker_match = re.search(r"\b([A-Z]{2,5})\b", prompt)
        if ticker_match:
            entity = ticker_match.group(1)
            _log(f"REGEX: extracted ticker '{entity}'")
        
        # Strategy 2: Use regex patterns to extract company names
        if not entity:
            entity = _extract_entity(
                prompt,
                [
                    # "nvidia stock prediction..." → nvidia
                    r"(.+?)\s+stock\s+(?:predict(?:ion)?|forecast|outlook|future|analysis|trend)",
                    # "stock prediction for nvidia" → nvidia
                    r"(?:stock|share)\s+(?:predict(?:ion)?|forecast|outlook|trend)\s+(?:for|of|on)\s+(.+?)(?:\?|$)",
                    # "predict ... for nvidia" → nvidia
                    r"(?:predict(?:ion)?|forecast|outlook|future|analysis)\s+(?:for|of|on)\s+(.+?)(?:\?|$)",
                    # "tesla forecast next month" → tesla
                    r"^([a-zA-Z][a-zA-Z\s]{1,20}?)\s+(?:stock|share|forecast|predict|outlook)",
                ],
            )
            if entity:
                # Clean time-frame phrases from extracted entity
                entity = re.sub(
                    r"\b(?:next|for|in|the|coming|upcoming)\s+\d*\s*(?:days?|weeks?|months?|years?|quarters?)\b",
                    "", entity, flags=re.IGNORECASE
                ).strip(" ,?.!")
                _log(f"REGEX: extracted entity '{entity}' from patterns")
        
        # Strategy 3: Check common tickers map
        if not entity or len(entity) < 2:
            for ticker_name in _COMMON_TICKERS.keys():
                if ticker_name in lower:
                    entity = ticker_name
                    _log(f"REGEX: matched '{entity}' from common tickers")
                    break
        
        if entity and len(entity) >= 2:
            _log(f"REGEX: Final entity for prediction query: '{entity}'")
            
            # ALWAYS call stock_analysis for trend data (labeled correctly)
            analysis = tool_stock_analysis(entity)
            if analysis:
                results.append(f"Tool [StockAnalysis]: {analysis}")
            else:
                _log(f"REGEX: stock_analysis returned None for '{entity}'")
            
            # For Wikipedia, convert ticker to full company name if possible
            wiki_entity = entity
            lower_entity = entity.lower().strip()
            if lower_entity in _COMMON_TICKERS:
                ticker = _COMMON_TICKERS[lower_entity]
                _TICKER_TO_COMPANY = {
                    "AAPL": "Apple Inc", "MSFT": "Microsoft", "GOOGL": "Alphabet Inc",
                    "AMZN": "Amazon", "META": "Meta Platforms", "TSLA": "Tesla",
                    "NVDA": "Nvidia", "NFLX": "Netflix", "DIS": "Disney",
                    "OTEX": "OpenText", "INTC": "Intel", "AMD": "AMD",
                    "BA": "Boeing", "IBM": "IBM", "F": "Ford Motor Company",
                    "GM": "General Motors", "GE": "General Electric",
                }
                wiki_entity = _TICKER_TO_COMPANY.get(ticker, entity)
                _log(f"REGEX: converted '{entity}' → '{wiki_entity}' for Wikipedia")
            elif re.match(r"^[A-Z]{2,5}$", entity):
                _TICKER_TO_COMPANY = {
                    "AAPL": "Apple Inc", "MSFT": "Microsoft", "GOOGL": "Alphabet Inc",
                    "AMZN": "Amazon", "META": "Meta Platforms", "TSLA": "Tesla",
                    "NVDA": "Nvidia", "NFLX": "Netflix", "DIS": "Disney",
                    "OTEX": "OpenText", "INTC": "Intel", "AMD": "AMD",
                    "BA": "Boeing", "IBM": "IBM", "F": "Ford Motor Company",
                    "GM": "General Motors", "GE": "General Electric",
                }
                wiki_entity = _TICKER_TO_COMPANY.get(entity, entity)
                _log(f"REGEX: converted ticker '{entity}' → '{wiki_entity}' for Wikipedia")
            
            # ─── Check for time-sensitive keywords (block Wikipedia) ───
            has_time_sensitive = bool(
                re.search(
                    r"\b(current|latest|recent|new|live|today|now|recently|this\s+(?:week|month|year)|upcoming|\d{4})\b",
                    lower,
                )
            )
            
            # ALWAYS call wikipedia for company background EXCEPT for time-sensitive queries
            if not has_time_sensitive:
                wiki_result = _execute_tool_call("wikipedia", wiki_entity, original_prompt=prompt)
                if wiki_result:
                    results.append(wiki_result)
                else:
                    _log(f"REGEX: wikipedia returned None for '{wiki_entity}'")
            else:
                _log(f"REGEX: Skipping Wikipedia for time-sensitive prediction query: '{prompt}'")
        else:
            _log(f"REGEX: Could not extract entity from prediction query: '{prompt}'")

    # ── Stock Detection (skip if prediction — handled above) ──
    elif not is_prediction_query and any(w in lower for w in ("stock", "share price", "ticker", "market price", "price of")):
        query = _extract_entity(
            prompt,
            [
                r"(?:price|worth)\s+(?:of|for)\s+(.+?)\s+stock",
                r"(?:stock\s+(?:price\s+)?(?:of|for)\s+)(.+?)(?:\s+stock|\?|$)",
                r"(.+?)\s+stock\s*(?:price)?",
                r"(.+?)\s+share\s*price",
            ],
        )
        if not query:
            m = re.search(r"\b([A-Z]{2,5})\b", prompt)
            if m:
                query = m.group(1)
        if query:
            result = tool_stock_price(query)
            if result:
                results.append(f"Tool [StockPrice]: {result}")

    # ── Price without "stock" keyword (skip if prediction) ──
    if not is_prediction_query and not results and ("price" in lower or "worth" in lower):
        m = re.search(r"\b([A-Z]{2,5})\b", prompt)
        if m:
            result = tool_stock_price(m.group(1))
            if result:
                results.append(f"Tool [StockPrice]: {result}")

    # ── Weather Detection ──
    if any(w in lower for w in ("weather", "temperature", "forecast", "raining", "rain", "snowing", "cloudy")):
        city = _extract_entity(
            prompt,
            [
                # Handle "weather [today/tomorrow/now] in X"
                r"weather\s+(?:today|tomorrow|now|currently|right now)?\s+(?:in|at|for)\s+(.+?)(?:\?|$)",
                # Handle "weather in X [today/tomorrow]"
                r"weather\s+(?:in|at|for)\s+(.+?)(?:\s+(?:today|tomorrow|now))?(?:\?|$)",
                r"(?:temperature|forecast)\s+(?:in|at|for)\s+(.+?)(?:\?|$)",
                r"(?:how|what).*(?:weather|temperature)\s+(?:in|at)\s+(.+?)(?:\?|$)",
                r"(?:is\s+it|it|is\s+the)\s+(?:rain|snow|cloud).*(?:in|at)\s+(.+?)(?:\?|$)",
                r"(?:rain|snow|cloud).*(?:in|at)\s+(.+?)(?:\?|$)",
            ],
        )
        if city:
            result = tool_weather(city)
            if result:
                results.append(f"Tool [Weather]: {result}")

    # ── Dictionary Detection ──
    if any(w in lower for w in ("define", "meaning of", "definition", "dictionary", "what does", "mean")):
        m = re.search(
            r"(?:define|meaning of|definition of|dictionary)\s+(\w+)", prompt, re.IGNORECASE
        )
        if not m:
            m = re.search(r"what\s+(?:does|is)\s+(\w+)\s+mean", prompt, re.IGNORECASE)
        if m:
            result = tool_dictionary(m.group(1))
            if result:
                results.append(f"Tool [Dictionary]: {result}")

    # ── Wikipedia / Factual Detection ──
    wiki_triggers = ("who is", "who was", "what is", "what are", "tell me about", "wikipedia", "biography", "company")
    leadership = re.search(
        r"\b(ceo|president|founder|chairman|cto|cfo|headquarters|revenue|employees|founded)\b",
        lower,
    )
    # Check for time-sensitive keywords (highest priority — prefer web search)
    has_time_sensitive = bool(
        re.search(
            r"\b(current|latest|recent|new|live|today|now|recently|this\s+(?:week|month|year)|upcoming|\d{4})\b",
            lower,
        )
    )

    if has_time_sensitive:
        return "mcp_only", "[regex] Time-sensitive query → external tools."
    
    # Skip Wikipedia for time-sensitive queries; use web search instead
    if (any(w in lower for w in wiki_triggers) or leadership) and not has_time_sensitive:
        if leadership or not results:  # Always run for leadership queries (unless time-sensitive)
            topic = _extract_entity(
                prompt,
                [
                    r"(?:who is|who was|what is|what are|tell me about)\s+(.+?)(?:\?|$)",
                    r"wikipedia\s+(.+?)(?:\?|$)",
                    r"(.+?)\s+biography",
                    r"(.+?)\s+company",
                ],
            )
            if topic:
                wiki_result = _execute_tool_call("wikipedia", topic, original_prompt=prompt)
                if wiki_result:
                    results.append(wiki_result)
    
    # If leadership query is time-sensitive, use web search instead
    if leadership and has_time_sensitive and not results:
        # Extract entity and call web search
        topic = _extract_entity(
            prompt,
            [
                r"(?:who is|who was)\s+(.+?)(?:\?|$)",
                r"(.+?)\s+(?:ceo|president|founder|chairman|cto|cfo)",
            ],
        )
        if topic:
            # Actually call the web search tool
            result = tool_web_search(f"{topic} current CEO latest news")
            if result:
                results.append(f"Tool [WebSearch]: {result}")
                _log(f"REGEX: time-sensitive leadership query → web search for '{topic}'")
            
            # If web search returned nothing useful (generic fallback message), try Wikipedia
            # Wikipedia often has current CEO information in company articles
            if not result or "For real-time results" in result:
                _log(f"REGEX: web search insufficient, falling back to Wikipedia for '{topic}'")
                wiki_result = _execute_tool_call("wikipedia", topic, original_prompt=prompt)
                if wiki_result:
                    results.append(wiki_result)
                    _log(f"REGEX: Wikipedia fallback provided company info for '{topic}'")

    # ── Time / Timezone Detection ──
    is_time_query = any(w in lower for w in ("time in", "time at", "what time", "timezone", "clock")) or bool(re.search(r"\d+\s*(?:am|pm)\s+\w+\s+to\s+\w+", lower))
    if is_time_query and not leadership:
        m = re.search(r"(?:time|clock)\s+(?:in|at|for)\s+(.+?)(?:\?|$)", prompt, re.IGNORECASE)
        if not m:
            # Handle time conversion patterns like "5pm utc to ist"
            m = re.search(r"\d+\s*(?:am|pm)?\s+(\w+)\s+to\s+(\w+)", prompt, re.IGNORECASE)
            if m:
                location = m.group(2)  # Get the target timezone
        location = m.group(1).strip(" ?.,") if m else "UTC"
        results.append(f"Tool [WorldClock]: {tool_world_clock(location)}")

    # ── Currency Conversion Detection ──
    # Simple and reliable: detect any pattern with currency-like words + "to/in/into"
    is_currency_query = bool(
        re.search(
            r"\b(currency|exchange\s*rate|forex|fx|convert)\b", lower
        )
    ) or bool(
        # Match patterns like: "euro to rupee", "100 usd to inr", "pound to yen", "euro to indian rupee", etc
        re.search(
            r"\b(usd|eur|gbp|inr|jpy|cad|aud|cny|chf|krw|brl|mxn|sgd|hkd|nzd|sek|nok|dkk|zar|thb|myr|php|idr|try|pln|czk|huf|ron|bgn|hrk|isk|"
            r"dollar|euro|pound|rupee|yen|yuan|franc|won|peso|baht|ringgit|lira|rand|sterling)\s+(?:to|in|into|vs?)\s+"
            r"(?:indian\s+)?(?:usd|eur|gbp|inr|jpy|cad|aud|cny|chf|krw|brl|mxn|sgd|hkd|nzd|sek|nok|dkk|zar|thb|myr|php|idr|try|pln|czk|huf|ron|bgn|hrk|isk|"
            r"dollar|euro|pound|rupee|yen|yuan|franc|won|peso|baht|ringgit|lira|rand|sterling)",
            lower,
        )
    )
    
    if is_currency_query:
        # Extract currencies and optional amount using regex patterns
        amount = 1.0
        from_cur = None
        to_cur = None
        
        # Try to extract amount (e.g., "100 usd to inr" → amount=100)
        amount_match = re.search(r"(\d+(?:\.\d+)?)\s+(?:usd|eur|gbp|inr|jpy|cad|aud|cny|chf|krw|brl|mxn|sgd|hkd|nzd|sek|nok|dkk|zar|thb|myr|php|idr|try|pln|czk|huf|ron|bgn|hrk|isk|dollar|euro|pound|rupee|yen|yuan|franc|won|peso|baht|ringgit|lira|rand|sterling)", lower)
        if amount_match:
            amount = float(amount_match.group(1))
        
        # Extract currency pair: look for currency keywords followed by "to" and another currency
        # Support multi-word currencies like "indian rupee"
        pair_match = re.search(
            r"(usd|eur|gbp|inr|jpy|cad|aud|cny|chf|krw|brl|mxn|sgd|hkd|nzd|sek|nok|dkk|zar|thb|myr|php|idr|try|pln|czk|huf|ron|bgn|hrk|isk|dollar|dollars|euro|euros|pound|pounds|rupee|rupees|yen|yuan|franc|francs|won|pesos|peso|baht|ringgit|lira|rands|rand|sterling)\s+(?:to|in|into|vs?)\s+"
            r"(?:indian\s+)?(usd|eur|gbp|inr|jpy|cad|aud|cny|chf|krw|brl|mxn|sgd|hkd|nzd|sek|nok|dkk|zar|thb|myr|php|idr|try|pln|czk|huf|ron|bgn|hrk|isk|dollar|dollars|euro|euros|pound|pounds|rupee|rupees|yen|yuan|franc|francs|won|pesos|peso|baht|ringgit|lira|rands|rand|sterling)",
            lower,
        )
        
        if pair_match:
            from_cur = pair_match.group(1).strip()
            to_cur = pair_match.group(2).strip()
            
            # Clean trailing 's' from plural forms
            if from_cur.endswith('s'):
                from_cur_clean = from_cur[:-1] if from_cur not in ('dollars', 'euros') else from_cur[:-1]
            else:
                from_cur_clean = from_cur
            if to_cur.endswith('s'):
                to_cur_clean = to_cur[:-1] if to_cur not in ('dollars', 'euros') else to_cur[:-1]
            else:
                to_cur_clean = to_cur
            
            result = tool_currency(from_cur_clean, to_cur_clean, amount)
            if result:
                results.append(f"Tool [Currency]: {result}")
                _log(f"REGEX: currency conversion {amount} {from_cur_clean} → {to_cur_clean}")
            else:
                _log(f"REGEX: currency tool failed for {from_cur_clean}→{to_cur_clean}")
        else:
            _log(f"REGEX: could not extract currency pair from '{prompt}'")

    # ── Math / Calculator Detection ──
    has_math = re.search(r"\d+\s*[+\-*/^]\s*\d+", prompt) or any(w in lower for w in ("calculate", "compute", "solve"))
    has_math_func = bool(re.search(r"\b(sqrt|sin|cos|tan|log|exp|abs|pow)\s*\(", lower))
    
    if has_math or has_math_func:
        if has_math_func:
            # Extract the entire function call
            expr_match = re.search(r"(sqrt|sin|cos|tan|log|exp|abs|pow)\s*\([^)]+\)", prompt, re.IGNORECASE)
        else:
            expr_match = re.search(r"[\d+\-*/^().\s]+", prompt)
        
        if expr_match:
            result = tool_calculator(expr_match.group().strip())
            if result:
                results.append(f"Tool [Calculator]: {result}")

    # ── Web Search Fallback ──
    # This should trigger for any query that didn't match a specific tool
    if not results:
        _log(f"REGEX: No specific tool matched, using web search for '{prompt}'")
        result = tool_web_search(prompt)
        if result:
            results.append(f"Tool [WebSearch]: {result}")
        else:
            # ── Wikipedia Final Fallback (when web search also returned nothing) ──
            # BUT: Skip Wikipedia for time-sensitive queries even as fallback
            has_time_sensitive = bool(
                re.search(
                    r"\b(current|latest|recent|new|live|today|now|recently|this\s+(?:week|month|year)|upcoming|\d{4})\b",
                    prompt.lower(),
                )
            )
            
            if not has_time_sensitive:
                topic = _extract_entity(
                    prompt,
                    [
                        r"(?:tell\s+(?:me\s+)?about|who\s+is|who\s+was|what\s+is|what\s+are|explain|describe)\s+(.+?)(?:\?|$)",
                        r"(?:how\s+does|how\s+do|how\s+is)\s+(.+?)\s+(?:work|function|operate)(?:\?|$)",
                        r"^(.{3,60})(?:\?|$)",
                    ],
                )
                if topic:
                    wiki_result = _execute_tool_call("wikipedia", topic, original_prompt=prompt)
                    if wiki_result:
                        results.append(wiki_result)
            else:
                _log(f"REGEX: Blocked Wikipedia fallback for time-sensitive query: '{prompt}'")

    return results


def _extract_entity(prompt: str, patterns: list[str]) -> str | None:
    """Try multiple regex patterns to extract an entity from the prompt."""
    for pat in patterns:
        m = re.search(pat, prompt, re.IGNORECASE)
        if m:
            entity = m.group(1).strip(" ?,.")
            if entity and 1 < len(entity) < 80:
                # Clean common filler words (loop to strip multiple leading words)
                cleaned = entity
                for _ in range(5):  # max 5 passes to strip chained filler words
                    prev = cleaned
                    cleaned = re.sub(
                        r"^(what|whats|what's|get|show|find|tell|me|the|about|is|are|will|does|do|can|be|for|of|a|an|this|that|these|those)\s+",
                        "",
                        cleaned,
                        flags=re.IGNORECASE,
                    )
                    if cleaned == prev:
                        break
                # Remove trailing filler words
                cleaned = re.sub(
                    r"\s+(today|now|currently|right now|please|stock|price|prices|company|corporation|inc)$",
                    "",
                    cleaned,
                    flags=re.IGNORECASE,
                )
                if cleaned:
                    return cleaned.strip()
    return None


# ═══════════════════════════════════════════════════════════
#  LLM ROUTING SYSTEM — Task-Based Model Selection
# ═══════════════════════════════════════════════════════════

from enum import Enum


class TaskType(str, Enum):
    """Task classification for intelligent model routing."""
    SUMMARIZE = "summarize"  # Condensing long text, bullet points
    REASON = "reason"  # Complex reasoning, multi-step logic
    CODE = "code"  # Programming, technical queries
    CREATIVE = "creative"  # Stories, poems, marketing copy
    FACTUAL = "factual"  # Q&A, information retrieval
    CHAT = "chat"  # Casual conversation, greetings
    ANALYZE = "analyze"  # Data analysis, comparisons


class ModelProfile:
    """Model configuration with capabilities, costs, and performance metrics."""
    
    def __init__(
        self,
        name: str,
        api_type: str,  # "internal", "gemini"
        model_id: str,
        strengths: list[TaskType],
        cost_per_1k_tokens: float,
        avg_latency_ms: int,
        max_tokens: int = 8192,
        quality_score: float = 1.0,
    ):
        self.name = name
        self.api_type = api_type
        self.model_id = model_id
        self.strengths = strengths
        self.cost_per_1k_tokens = cost_per_1k_tokens
        self.avg_latency_ms = avg_latency_ms
        self.max_tokens = max_tokens
        self.quality_score = quality_score  # 0.0 - 1.0 (relative quality)


# Model Registry: Available models with their profiles
MODEL_REGISTRY = [
    # Internal Llama 3.3 70B: Excellent reasoning, good for complex tasks
    ModelProfile(
        name="Llama 3.3 70B (Internal)",
        api_type="internal",
        model_id=INTERNAL_MODEL_NAME,
        strengths=[TaskType.REASON, TaskType.CODE, TaskType.ANALYZE],
        cost_per_1k_tokens=0.0,  # Free (internal deployment)
        avg_latency_ms=2500,
        max_tokens=8192,
        quality_score=0.95,
    ),
    
    # Gemini 2.5 Flash: Fast, cheap, good for simple tasks
    ModelProfile(
        name="Gemini 2.5 Flash",
        api_type="gemini",
        model_id="gemini-2.5-flash",
        strengths=[TaskType.SUMMARIZE, TaskType.FACTUAL, TaskType.CHAT],
        cost_per_1k_tokens=0.00005,  # Very cheap
        avg_latency_ms=800,
        max_tokens=8192,
        quality_score=0.75,
    ),
    
    # Gemini 1.5 Flash: Fallback, similar to 2.5 but older
    ModelProfile(
        name="Gemini 1.5 Flash",
        api_type="gemini",
        model_id="gemini-1.5-flash",
        strengths=[TaskType.SUMMARIZE, TaskType.FACTUAL, TaskType.CHAT],
        cost_per_1k_tokens=0.00005,
        avg_latency_ms=900,
        max_tokens=8192,
        quality_score=0.70,
    ),
]


def classify_task(prompt: str, rag_context: str = "", tool_results: list = None) -> TaskType:
    """
    Classify the task type based on prompt content and context.
    
    Uses heuristics to determine the most appropriate task category.
    In production, this could be enhanced with an LLM classifier.
    """
    prompt_lower = prompt.lower()
    tool_results = tool_results or []
    
    # Code/Technical queries
    if any(kw in prompt_lower for kw in ("code", "function", "program", "script", "api", "syntax", "debug", "error", "exception", "implement", "algorithm")):
        return TaskType.CODE
    
    # Reasoning/Analysis with tools
    if tool_results and any(kw in prompt_lower for kw in ("predict", "forecast", "analyze", "compare", "evaluate", "should", "will", "trend", "outlook")):
        return TaskType.ANALYZE
    
    # Summarization
    if any(kw in prompt_lower for kw in ("summar", "brief", "tldr", "tl;dr", "bullet", "key points", "overview", "condense", "shorten")):
        return TaskType.SUMMARIZE
    
    # Creative writing
    if any(kw in prompt_lower for kw in ("write a story", "poem", "creative", "imagine", "generate blog", "marketing copy", "tagline", "slogan")):
        return TaskType.CREATIVE
    
    # Complex reasoning (multi-step, logic)
    if any(kw in prompt_lower for kw in ("why", "how would", "explain", "reasoning", "logic", "because", "therefore", "consequence", "implication")) and len(prompt.split()) > 15:
        return TaskType.REASON
    
    # Simple chat/greetings
    if any(kw in prompt_lower for kw in ("hello", "hi", "hey", "thanks", "thank you", "bye", "goodbye")) and len(prompt.split()) < 10:
        return TaskType.CHAT
    
    # Default: Factual Q&A
    return TaskType.FACTUAL


def estimate_tokens(text: str) -> int:
    """Rough token estimation: ~1 token per 4 characters."""
    return max(1, len(text) // 4)


def select_model(
    task: TaskType,
    prompt_length: int,
    budget_mode: str = "balanced",
    max_latency_ms: int = 5000,
) -> ModelProfile | None:
    """
    Select the best model based on task type, budget, and latency constraints.
    
    Args:
        task: Classified task type
        prompt_length: Estimated token count of the full prompt
        budget_mode: "economy" (cheapest), "balanced" (cost vs quality), "quality" (best model)
        max_latency_ms: Maximum acceptable latency in milliseconds
    
    Returns:
        Selected ModelProfile or None if no suitable model found
    """
    # Filter models by API key availability
    available_models = []
    
    # Check internal model availability
    internal_key = os.environ.get("INTERNAL_API_KEY") or os.environ.get("VITE_INTERNAL_API_KEY", "")
    if internal_key:
        available_models.extend([m for m in MODEL_REGISTRY if m.api_type == "internal"])
    
    # Check Gemini API availability
    gemini_key = (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("VITE_GEMINI_API_KEY")
        or os.environ.get("VITE_API_KEY")
        or os.environ.get("VITE_GEMINI_API_PRIMARY_KEY", "")
    )
    if gemini_key:
        available_models.extend([m for m in MODEL_REGISTRY if m.api_type == "gemini"])
    
    if not available_models:
        _log("MODEL SELECTION: No API keys configured")
        return None
    
    # Filter by latency constraint
    available_models = [m for m in available_models if m.avg_latency_ms <= max_latency_ms]
    
    if not available_models:
        _log(f"MODEL SELECTION: No models meet latency constraint {max_latency_ms}ms")
        return None
    
    # Filter by token capacity
    available_models = [m for m in available_models if m.max_tokens >= prompt_length]
    
    if not available_models:
        _log(f"MODEL SELECTION: No models can handle {prompt_length} tokens")
        return None
    
    # Score models based on budget mode and task fit
    def score_model(model: ModelProfile) -> float:
        score = 0.0
        
        # Task strength bonus (max +50 points)
        if task in model.strengths:
            score += 50.0
        
        # Quality factor (max +30 points)
        score += model.quality_score * 30.0
        
        # Budget mode scoring
        if budget_mode == "economy":
            # Prioritize cost (max +50 points, inverted)
            # Lower cost = higher score
            max_cost = max(m.cost_per_1k_tokens for m in available_models)
            if max_cost > 0:
                score += (1.0 - (model.cost_per_1k_tokens / max_cost)) * 50.0
            else:
                score += 50.0  # Free models get full points
        
        elif budget_mode == "quality":
            # Prioritize quality and task fit
            score += model.quality_score * 50.0
        
        else:  # balanced
            # Mix of cost and quality
            max_cost = max(m.cost_per_1k_tokens for m in available_models) or 1.0
            cost_score = (1.0 - (model.cost_per_1k_tokens / max_cost)) * 25.0
            quality_bonus = model.quality_score * 25.0
            score += cost_score + quality_bonus
        
        # Latency penalty (faster is better)
        max_latency = max(m.avg_latency_ms for m in available_models)
        if max_latency > 0:
            latency_factor = 1.0 - (model.avg_latency_ms / max_latency)
            score += latency_factor * 20.0
        
        return score
    
    # Rank models
    ranked = sorted(available_models, key=score_model, reverse=True)
    
    selected = ranked[0]
    _log(
        f"MODEL SELECTION: {selected.name} | Task: {task.value} | "
        f"Budget: {budget_mode} | Score: {score_model(selected):.1f}"
    )
    
    return selected


# ═══════════════════════════════════════════════════════════
#  LLM CALLER — Internal Llama → Gemini → Template fallback
# ═══════════════════════════════════════════════════════════


def call_llm(
    messages: list[dict[str, str]],
    system_prompt: str | None = None,
    task_type: TaskType = TaskType.FACTUAL,
) -> tuple[str, str]:
    """
    Call an LLM with intelligent model routing based on task type.
    
    If LLM_ROUTING_ENABLED=true, selects the optimal model based on:
    - Task type (summarize, reason, code, etc.)
    - Budget mode (economy, balanced, quality)
    - Latency constraints
    - Available API keys
    
    Falls back to simple cascade if routing disabled or no suitable model found.
    
    Returns (response_text, model_name). Returns ("", "none") if no LLM is available.
    """
    # Estimate prompt tokens for model selection
    full_prompt = system_prompt or ""
    for msg in messages:
        full_prompt += msg.get("content", "")
    prompt_tokens = estimate_tokens(full_prompt)
    
    # ═══ INTELLIGENT ROUTING (if enabled) ═══════════════════
    if LLM_ROUTING_ENABLED:
        selected_model = select_model(
            task=task_type,
            prompt_length=prompt_tokens,
            budget_mode=LLM_BUDGET_MODE,
            max_latency_ms=LLM_MAX_LATENCY_MS,
        )
        
        if selected_model:
            # Try the selected model
            if selected_model.api_type == "internal":
                result = _call_internal_llm(messages, system_prompt)
                if result:
                    return result
            
            elif selected_model.api_type == "gemini":
                result = _call_gemini_llm(messages, system_prompt, selected_model.model_id)
                if result:
                    return result
            
            _log(f"MODEL ROUTING: Selected model {selected_model.name} failed, falling back to cascade")
    
    # ═══ FALLBACK CASCADE (legacy behavior) ═════════════════
    # 1. Try internal Llama endpoint
    result = _call_internal_llm(messages, system_prompt)
    if result:
        return result
    
    # 2. Try Gemini models in order
    for model_id in ("gemini-2.5-flash", "gemini-1.5-flash"):
        result = _call_gemini_llm(messages, system_prompt, model_id)
        if result:
            return result
    
    # 3. No LLM available
    return "", "none"


def _call_internal_llm(
    messages: list[dict[str, str]],
    system_prompt: str | None = None,
) -> tuple[str, str] | None:
    """Call internal Llama endpoint. Returns (text, model_name) or None on failure."""
    internal_key = os.environ.get("INTERNAL_API_KEY") or os.environ.get(
        "VITE_INTERNAL_API_KEY", ""
    )
    if not internal_key:
        return None
    
    try:
        payload = []
        if system_prompt:
            payload.append({"role": "system", "content": system_prompt})
        payload.extend(messages)
        resp = httpx.post(
            INTERNAL_MODEL_ENDPOINT,
            json={"model": INTERNAL_MODEL_NAME, "messages": payload},
            headers={
                "Authorization": f"Bearer {internal_key}",
                "Content-Type": "application/json",
            },
            timeout=LLM_TIMEOUT,
        )
        if resp.status_code == 200:
            text = (
                resp.json()
                .get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            if text:
                _log(f"LLM response via {INTERNAL_MODEL_NAME}")
                return text, INTERNAL_MODEL_NAME
    except Exception as e:
        _log(f"Internal LLM failed: {e}")
    
    return None


def _call_gemini_llm(
    messages: list[dict[str, str]],
    system_prompt: str | None = None,
    model_id: str = "gemini-2.5-flash",
) -> tuple[str, str] | None:
    """Call Gemini API. Returns (text, model_name) or None on failure."""
    gemini_key = (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("VITE_GEMINI_API_KEY")
        or os.environ.get("VITE_API_KEY")
        or os.environ.get("VITE_GEMINI_API_PRIMARY_KEY", "")
    )
    if not gemini_key:
        return None
    
    try:
        contents = [
            {
                "role": "model" if m["role"] == "assistant" else "user",
                "parts": [{"text": m["content"]}],
            }
            for m in messages
        ]
        body: dict[str, Any] = {"contents": contents}
        if system_prompt:
            body["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        resp = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_id}:generateContent?key={gemini_key}",
            json=body,
            timeout=LLM_TIMEOUT,
        )
        if resp.status_code == 200:
            text = (
                resp.json()
                .get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            if text:
                _log(f"LLM response via Gemini ({model_id})")
                return text, f"Gemini ({model_id})"
    except Exception as e:
        _log(f"Gemini {model_id} failed: {e}")
    
    return None


# ═══════════════════════════════════════════════════════════
#  LLM-BASED INTENT CLASSIFICATION & TOOL SELECTION
# ═══════════════════════════════════════════════════════════

_ROUTE_CLASSIFIER_PROMPT = """\
You are an intent classifier for an AI assistant. Given the user's query, classify it into exactly ONE route.

*** CRITICAL: Time-Sensitive Keywords Take Priority ***
If the query contains time-sensitive keywords (current, latest, recent, new, live, today, now, this week, this month, 2024, 2025, 2026),
ALWAYS prefer "mcp_only" for real-world entities OR "hybrid" for OpenText queries. Do NOT use "rag_only" for time-sensitive requests.

Routes:
- "rag_only": Query about internal knowledge topics ONLY (and NOT time-sensitive) — these live in our document store:
  OpenText products (OTCS, Content Server, Documentum, xECM, Exstream, TeamSite, AppWorks, Fortify, ArcSight, NetIQ, Voltage, EnCase, LoadRunner, SMAX, Magellan, Aviator, Trading Grid),
  RAG / retrieval-augmented generation, LangGraph, LangChain, MCP protocol, agentic AI architecture, embeddings, vector databases, AI pipelines and orchestration.

- "mcp_only": Query that needs external tools or real-time data — weather, stock prices,
  stock predictions/forecasts, time/timezone, math calculations, word definitions,
  Wikipedia lookups, general knowledge questions, current events, people's recent activities,
  company leadership (CEO, CFO, executives), earnings, latest news, any time-sensitive factual question.

- "hybrid": Query that is about OpenText (the company/corporation/leadership) AND needs
  real-time or current information (e.g., "OpenText stock price", "OpenText CEO", "OpenText latest news", "OpenText revenue 2025").
  Note: Use hybrid ONLY if explicitly about the OpenText company. If asking about OpenText products/features, use rag_only.

- "direct": Simple greetings (hi, hello, hey, thanks, bye), chitchat, or trivial
  conversation that needs no data lookup at all.

Respond with ONLY valid JSON (no markdown, no explanation):
{"route": "<route>", "reasoning": "<one sentence>"}"""

_TOOL_SELECTOR_PROMPT = """\
You are an intelligent tool selector. Given a user's query, pick the CORRECT tool(s) and extract the CLEAN entity.

=== AVAILABLE TOOLS ===
- "stock_price": Current/live stock price. Entity = company name or ticker ONLY (e.g. "nvidia", "AAPL").
- "stock_analysis": Stock trend prediction/forecast. Entity = company name or ticker ONLY.
- "weather": Current weather, temperature, conditions. Entity = city or location name ONLY.
- "currency": Currency conversion. Entity = "from_currency,to_currency" pair (e.g. "USD,INR", "EUR,GBP").
- "world_clock": Current time in a timezone/city. Entity = city or IANA timezone (default "UTC").
- "dictionary": Word definition. Entity = single word to define.
- "calculator": Math expression. Entity = mathematical expression (e.g. "2+2", "sqrt(144)").
- "wikipedia": Factual info about people, places, concepts, companies. Entity = topic name ONLY.
- "web_search": General web search fallback. Entity = concise search query.

=== CRITICAL RULES FOR ENTITY EXTRACTION ===
1. TEMPORAL MODIFIERS ARE NOT PART OF ENTITY:
   - "weather TODAY in London" -> tool="weather", entity="London" (NOT "today London")
   - "weather TOMORROW in Paris" -> tool="weather", entity="Paris"
   - "weather NOW in Tokyo" -> tool="weather", entity="Tokyo"
   - "what's weather CURRENTLY in Sydney" -> tool="weather", entity="Sydney"
   
2. TIME-FRAME PHRASES ARE NOT PART OF ENTITY:
   - "stock prediction FOR NEXT 3 MONTHS of apple" -> tool="stock_analysis", entity="apple" (NOT "3 months apple")
   - "OTEX stock forecast for 2 MONTHS" -> tool="stock_analysis", entity="OTEX"
   - "predict TESLA stock FOR NEXT QUARTER" -> tool="stock_analysis", entity="TESLA"

3. ACTION WORDS ARE NOT PART OF ENTITY:
   - "CALCULATE 15+27" -> tool="calculator", entity="15+27"
   - "DEFINE serendipity" -> tool="dictionary", entity="serendipity"
   - "Time IN Tokyo" -> tool="world_clock", entity="Tokyo"

4. FOR STOCK PREDICTION QUERIES -> ALWAYS return BOTH tools:
   - [{"tool":"stock_analysis", "entity":"<ticker/company>"}, {"tool":"wikipedia", "entity":"<company_name>"}]
   - Example: "will apple stock go up next year" -> [{"tool":"stock_analysis","entity":"apple"},{"tool":"wikipedia","entity":"Apple Inc"}]
   - Example: "OTEX stock forecast for 3 months" -> [{"tool":"stock_analysis","entity":"OTEX"},{"tool":"wikipedia","entity":"OpenText"}]

5. ENTITY MUST BE CLEAN:
   - No filler words (the, a, an, about, for, please, tell, me, what, is, will, how, etc.)
   - No temporal words (today, tomorrow, now, currently, next, last, etc.)
   - No duration words (months, years, weeks, days, quarters)
   - No action words (predict, forecast, analyze, calculate, define, etc.)
   - Just the CORE SUBJECT

6. SPECIAL CASES:
   - Currency: "100 USD to INR" -> tool="currency", entity="USD,INR" (amount ignored, derived from query)
   - Weather: "is it raining in Seattle" -> tool="weather", entity="Seattle"
   - Time: "5pm UTC to IST" -> tool="world_clock", entity="UTC" then call again for "IST"

Respond with ONLY a valid JSON array (no markdown, no explanation, no code blocks):
[{"tool": "<name>", "entity": "<clean_entity>"}]"""


def _llm_classify_route(prompt: str) -> tuple[str, str] | None:
    """Use the LLM to classify intent → route. Returns (route, reasoning) or None."""
    response, model = call_llm(
        [{"role": "user", "content": prompt}],
        system_prompt=_ROUTE_CLASSIFIER_PROMPT,
        task_type=TaskType.FACTUAL,  # Classification is a simple factual task
    )
    if not response:
        return None

    try:
        cleaned = re.sub(r"```(?:json)?\s*", "", response).strip().rstrip("`")
        data = json.loads(cleaned)
        route = data.get("route", "").lower().strip()
        reasoning = data.get("reasoning", "")
        if route in ("rag_only", "mcp_only", "hybrid", "direct"):
            _log(f"LLM classify → {route} ({reasoning}) via {model}")
            return route, reasoning
    except (json.JSONDecodeError, AttributeError, KeyError):
        # Try to extract route from free-text response
        for r in ("rag_only", "mcp_only", "hybrid", "direct"):
            if r in response.lower():
                _log(f"LLM classify (free-text) → {r} via {model}")
                return r, response.strip()[:120]
    _log(f"LLM classify: could not parse response: {response[:200]}")
    return None


def _is_prediction_query(prompt: str) -> bool:
    """Deterministic check: does this prompt ask for a stock prediction/forecast?"""
    lower = prompt.lower()
    has_prediction_kw = bool(re.search(
        r"\b(predict(?:ion)?|forecast|outlook|future|will\s+(?:go|be|rise|fall|drop|increase|crash)|"
        r"next\s+(?:\d+\s*)?(?:days?|weeks?|months?|years?|quarters?)|"
        r"\d+\s*(?:months?|years?|weeks?|quarters?))\b",
        lower,
    ))
    has_stock_kw = bool(re.search(
        r"\b(stock|share|ticker|market|price)\b", lower
    )) or any(t in lower for t in _COMMON_TICKERS) or bool(re.search(r"\b[A-Z]{2,5}\b", prompt))
    return has_prediction_kw and has_stock_kw


def _postprocess_llm_tools(tools: list[dict], prompt: str) -> list[dict]:
    """Deterministic corrections on LLM tool selections — fixes known LLM mistakes."""
    lower = prompt.lower()
    is_prediction = _is_prediction_query(prompt)
    
    # ─── Check for time-sensitive keywords (highest priority) ───
    has_time_sensitive = bool(
        re.search(
            r"\b(current|latest|recent|new|live|today|now|recently|this\s+(?:week|month|year)|upcoming|\d{4})\b",
            lower,
        )
    )
    
    original_tools = [t["tool"] for t in tools]
    _log(f"\n>>> POST-PROCESS START: prompt='{prompt}'")
    _log(f"    Original tools: {original_tools}")
    _log(f"    Has time-sensitive: {has_time_sensitive}")
    _log(f"    Is prediction: {is_prediction}")
    
    # If time-sensitive, prefer web_search over wikipedia (wikipedia is static/outdated)
    if has_time_sensitive:
        _log(f"    TIME-SENSITIVE DETECTED - Converting tools...")
        # Replace any wikipedia calls with web_search for current/latest queries
        modified = False
        for t in tools:
            if t["tool"] == "wikipedia":
                old_tool = t["tool"]
                t["tool"] = "web_search"
                modified = True
                _log(f"    ✓ Converted: {old_tool} → {t['tool']}")
        if not modified:
            _log(f"    No Wikipedia tools found to convert")
        _log(f"    Final tools after time-sensitive block: {[t['tool'] for t in tools]}")
    
    # Aggressive fix: convert stock_price to stock_analysis for ANY query with prediction keywords
    for t in tools:
        if t["tool"] == "stock_price" and is_prediction:
            t["tool"] = "stock_analysis"
            _log(f"    POST-PROCESS: forced stock_price → stock_analysis (prediction query)")
    
    # For prediction queries, ENFORCE stock_analysis + wikipedia together
    # BUT: Skip wikipedia addition if query is time-sensitive (already converted to web_search above)
    if is_prediction and not has_time_sensitive:
        has_stock_analysis = any(t["tool"] == "stock_analysis" for t in tools)
        has_wikipedia = any(t["tool"] == "wikipedia" for t in tools)
        
        # If we have ANY stock tool but no stock_analysis, add it
        if not has_stock_analysis and any(t["tool"] in ("stock_price", "web_search") for t in tools):
            # Extract stock entity from the prompt
            stock_entity = _extract_stock_entity_from_prompt(prompt)
            if stock_entity:
                tools.append({"tool": "stock_analysis", "entity": stock_entity})
                _log(f"    POST-PROCESS: added stock_analysis('{stock_entity}') for prediction query")
                has_stock_analysis = True
        
        # If we have stock_analysis but no wikipedia, add it
        if has_stock_analysis and not has_wikipedia:
            # Get the entity from the stock_analysis tool call
            stock_entity = next((t["entity"] for t in tools if t["tool"] == "stock_analysis"), "")
            if not stock_entity:
                stock_entity = _extract_stock_entity_from_prompt(prompt) or ""
            
            # Try to get full company name from common tickers
            wiki_entity = stock_entity
            lower_entity = stock_entity.lower().strip()
            if lower_entity in _COMMON_TICKERS:
                # Reverse-lookup: find a nicer name for Wikipedia
                ticker = _COMMON_TICKERS[lower_entity]
                _TICKER_TO_COMPANY = {
                    "AAPL": "Apple Inc", "MSFT": "Microsoft", "GOOGL": "Alphabet Inc",
                    "AMZN": "Amazon", "META": "Meta Platforms", "TSLA": "Tesla",
                    "NVDA": "Nvidia", "NFLX": "Netflix", "DIS": "Disney",
                    "OTEX": "OpenText", "INTC": "Intel", "AMD": "AMD",
                    "BA": "Boeing", "IBM": "IBM", "F": "Ford Motor Company",
                    "GM": "General Motors", "GE": "General Electric",
                }
                wiki_entity = _TICKER_TO_COMPANY.get(ticker, stock_entity)
            elif re.match(r"^[A-Z]{2,5}$", stock_entity):
                # It's a ticker, try to expand it
                _TICKER_TO_COMPANY = {
                    "AAPL": "Apple Inc", "MSFT": "Microsoft", "GOOGL": "Alphabet Inc",
                    "AMZN": "Amazon", "META": "Meta Platforms", "TSLA": "Tesla",
                    "NVDA": "Nvidia", "NFLX": "Netflix", "DIS": "Disney",
                    "OTEX": "OpenText", "INTC": "Intel", "AMD": "AMD",
                    "BA": "Boeing", "IBM": "IBM", "F": "Ford Motor Company",
                    "GM": "General Motors", "GE": "General Electric",
                }
                wiki_entity = _TICKER_TO_COMPANY.get(stock_entity, stock_entity)
            
            if wiki_entity:
                tools.append({"tool": "wikipedia", "entity": wiki_entity})
                _log(f"    POST-PROCESS: added wikipedia('{wiki_entity}') for prediction context")
        
        # Remove web_search with stock terms (DuckDuckGo can't do stock forecasts)
        tools = [t for t in tools if not (
            t["tool"] == "web_search" and
            any(w in t["entity"].lower() for w in ("stock", "forecast", "prediction", "analysis"))
        )]
    
    _log(f"<<< POST-PROCESS END: Final tools = {[t['tool'] for t in tools]}\n")
    return tools


def _llm_select_tools(prompt: str) -> list[dict] | None:
    """
    Use the LLM to pick which tool(s) to call + extract entities.
    Returns list of {tool, entity} or None (only if LLM fails completely).
    More lenient parsing to reduce false negatives.
    """
    response, model = call_llm(
        [{"role": "user", "content": prompt}],
        system_prompt=_TOOL_SELECTOR_PROMPT,
        task_type=TaskType.FACTUAL,  # Tool selection is a factual classification task
    )
    if not response:
        _log(f"LLM tool select: no response from {model}")
        return None

    try:
        # Strategy 1: Try to clean and parse as JSON
        cleaned = re.sub(r"```(?:json)?\s*", "", response).strip().rstrip("`").strip()
        data = json.loads(cleaned)
        
        # Normalize format (single dict → list of dicts)
        if isinstance(data, dict):
            data = [data]
        
        # Validate structure
        valid_tools = {
            "stock_price", "stock_analysis", "weather", "wikipedia",
            "dictionary", "calculator", "world_clock", "web_search", "currency",
        }
        
        if isinstance(data, list) and len(data) > 0:
            # Check if items have required fields (lenient check)
            valid_items = [d for d in data if isinstance(d, dict) and "tool" in d and "entity" in d]
            
            if valid_items:
                # Clean up each item
                for d in valid_items:
                    d["tool"] = str(d["tool"]).lower().strip()
                    # Fallback unknown tools to web_search
                    if d["tool"] not in valid_tools:
                        d["tool"] = "web_search"
                    d["entity"] = str(d.get("entity", "")).strip()
                
                _log(f"✓ LLM tool select (parsed): {[{'tool': d['tool'], 'entity': d['entity'][:30]} for d in valid_items]} via {model}")
                
                # Deterministic post-processing: fix known LLM mistakes
                data = _postprocess_llm_tools(valid_items, prompt)
                return data
    
    except (json.JSONDecodeError, AttributeError, KeyError, TypeError) as e:
        _log(f"LLM tool select: JSON parse error: {e}")
    
    # Strategy 2: Try to extract pattern from free-text response
    try:
        # Look for keyword mentions that indicate tool choice
        response_lower = response.lower()
        tools_found = []
        
        if "weather" in response_lower:
            # Extract location (anything in "in <location>" pattern)
            loc_match = re.search(r"(?:weather\s+)?in\s+([^,\.]+)", response, re.IGNORECASE)
            if loc_match:
                tools_found.append({"tool": "weather", "entity": loc_match.group(1).strip()})
        
        if "stock" in response_lower and ("predict" in response_lower or "forecast" in response_lower):
            # Extract ticker/company
            entity_match = re.search(r'(?:entity|stock|ticker|company)[\s:="′\']+([A-Za-z0-9\s]+)', response, re.IGNORECASE)
            if entity_match:
                tools_found.append({"tool": "stock_analysis", "entity": entity_match.group(1).strip()})
        
        if "time" in response_lower:
            tz_match = re.search(r'(?:timezone|city|entity)[\s:="′\']+([A-Za-z0-9/\s]+)', response, re.IGNORECASE)
            if tz_match:
                tools_found.append({"tool": "world_clock", "entity": tz_match.group(1).strip()})
        
        if tools_found:
            _log(f"✓ LLM tool select (free-text fallback): {tools_found} via {model}")
            # Apply post-processing to fix known mistakes
            tools_found = _postprocess_llm_tools(tools_found, prompt)
            return tools_found
    except Exception as e:
        _log(f"LLM tool select: free-text parse error: {e}")
    
    _log(f"✗ LLM tool select: could not parse response from {model}: {response[:150]}")
    return None


def _extract_stock_entity_from_prompt(prompt: str) -> str | None:
    """Extract a company name or ticker from a stock-related prompt."""
    lower = prompt.lower()
    # 1. Check common tickers map
    for company in _COMMON_TICKERS:
        if company in lower:
            return company
    # 2. Regex patterns: "<company> stock ...", "stock ... <company>", "<company> price"
    patterns = [
        r'(?:predict(?:ion)?|forecast|analysis|price|worth)\s+(?:of\s+|for\s+)?([a-zA-Z][a-zA-Z .]+?)\s+(?:stock|share)',
        r'([a-zA-Z][a-zA-Z .]+?)\s+stock',
        r'stock\s+(?:prediction|forecast|price|analysis)\s+(?:of|for)\s+([a-zA-Z][a-zA-Z .]+?)(?:\s|$)',
        r'(?:predict(?:ion)?|forecast)\s+(?:for\s+)?([a-zA-Z][a-zA-Z .]+?)(?:\s+stock|\s+for|\s*$)',
    ]
    for pat in patterns:
        m = re.search(pat, prompt, re.IGNORECASE)
        if m:
            candidate = m.group(1).strip().lower()
            # Filter out filler words
            candidate = re.sub(
                r'\b(the|a|an|for|of|next|\d+\s*months?|\d+\s*years?|\d+\s*weeks?)\b',
                '', candidate, flags=re.IGNORECASE
            ).strip()
            if candidate and len(candidate) >= 2:
                return candidate
    # 3. Look for uppercase tickers (2-5 chars) in the prompt
    tickers = re.findall(r'\b([A-Z]{2,5})\b', prompt)
    if tickers:
        return tickers[0]
    return None


def _execute_tool_call(tool_name: str, entity: str, original_prompt: str = "") -> str | None:
    """Execute a single tool call by name. Returns the formatted result string or None."""
    _log(f"\n  _execute_tool_call: tool={tool_name}, entity='{entity}'")
    
    # ═══ ABSOLUTE GUARD: Block Wikipedia for time-sensitive queries ═══
    if tool_name == "wikipedia":
        has_time_sensitive = bool(
            re.search(
                r"\b(current|latest|recent|new|live|today|now|recently|this\s+(?:week|month|year)|upcoming|\d{4})\b",
                original_prompt.lower(),
            )
        )
        _log(f"  Wikipedia check: prompt='{original_prompt[:50]}...', has_time_sensitive={has_time_sensitive}")
        if has_time_sensitive:
            _log("  ⚠ GUARD: Wikipedia blocked → using web search instead")
            result = tool_web_search(original_prompt)
            if result:
                return f"Tool [WebSearch]: {result}"
            return "Tool [WebSearch]: Web search attempted but no results returned."
        else:
            _log(f"  ✓ GUARD PASSED: Allowing Wikipedia (not time-sensitive)")
    
    if not entity or not entity.strip():
        _log(f"  Skipping {tool_name}: empty entity")
        return None
    entity = entity.strip()

    # Clean stock-related filler words from stock tool entities
    if tool_name in ("stock_price", "stock_analysis"):
        # Phase 1: Remove time-frame phrases (with or without spaces between number and unit)
        entity = re.sub(
            r'\b(?:for\s+)?(?:the\s+)?(?:next|coming|upcoming|following)?\s*'
            r'\d+\s*(?:months?|years?|weeks?|days?|quarters?)\b',
            '', entity, flags=re.IGNORECASE
        ).strip()
        # Phase 2: Remove stock-related filler words and standalone time units
        entity = re.sub(
            r'\b(stock|stocks|price|share|shares|ticker|predict(?:ion)?|forecast|'
            r'analysis|outlook|trend|market|current|live|latest|today|now|'
            r'next|coming|future|for|of|in|the|a|an|about|please|tell|me|'
            r'what|is|will|how|much|worth|get|show|find|'
            r'months?|years?|weeks?|days?|quarters?)\b',
            '', entity, flags=re.IGNORECASE
        ).strip(" ,.?!-")
        entity = re.sub(r'\s+', ' ', entity).strip()  # collapse whitespace

        # Phase 3: If entity is empty or looks like garbage, re-extract from the prompt
        is_garbage = (
            not entity
            or re.match(r'^\s*\d*\s*(months?|years?|weeks?|days?|quarters?)?\s*$', entity, re.IGNORECASE)
            or len(entity) < 2
        )
        if is_garbage:
            _log(f"Stock entity '{entity}' is garbage after cleaning, re-extracting from prompt")
            entity = _extract_stock_entity_from_prompt(original_prompt)
            if not entity:
                _log(f"Skipping {tool_name}: no company found in prompt")
                return None
            _log(f"Re-extracted stock entity: '{entity}'")
        else:
            # Phase 4: Try to match against _COMMON_TICKERS for best accuracy
            key = entity.lower().strip()
            if key not in _COMMON_TICKERS and not re.match(r'^[A-Z]{1,5}$', entity):
                # Entity survived cleaning but isn't a known company — try the map
                extracted = _extract_stock_entity_from_prompt(original_prompt)
                if extracted:
                    _log(f"Cleaned entity '{entity}' not in common map, using '{extracted}' from prompt")
                    entity = extracted

    if tool_name == "stock_price":
        r = tool_stock_price(entity)
        return f"Tool [StockPrice]: {r}" if r else None
    elif tool_name == "stock_analysis":
        r = tool_stock_analysis(entity)
        return f"Tool [StockAnalysis]: {r}" if r else None
    elif tool_name == "weather":
        r = tool_weather(entity)
        return f"Tool [Weather]: {r}" if r else None
    elif tool_name == "wikipedia":
        r = tool_wikipedia(entity)
        return f"Tool [Wikipedia]: {r}" if r else None
    elif tool_name == "dictionary":
        r = tool_dictionary(entity)
        return f"Tool [Dictionary]: {r}" if r else None
    elif tool_name == "calculator":
        r = tool_calculator(entity)
        return f"Tool [Calculator]: {r}" if r else None
    elif tool_name == "world_clock":
        r = tool_world_clock(entity)
        return f"Tool [WorldClock]: {r}"
    elif tool_name == "currency":
        # Entity format for currency is "from_currency,to_currency"
        parts = entity.split(",")
        if len(parts) == 2:
            from_cur = parts[0].strip()
            to_cur = parts[1].strip()
            r = tool_currency(from_cur, to_cur)
            return f"Tool [Currency]: {r}" if r else None
        else:
            _log(f"Currency: invalid entity format '{entity}', expected 'from_cur,to_cur'")
            return None
    elif tool_name == "web_search":
        r = tool_web_search(entity)
        if not r and original_prompt:
            # Retry with the original prompt as search query
            r = tool_web_search(original_prompt)
        if not r:
            # DuckDuckGo instant-answer API often misses; try Wikipedia as safety net
            # But skip Wikipedia fallback for stock forecast queries — Wikipedia
            # won't have stock predictions and may return wrong articles (e.g. "OTEX" → "Otep")
            is_stock_query = any(w in entity.lower() for w in ('stock', 'forecast', 'analysis', 'prediction', 'price'))
            if not is_stock_query:
                core = entity.split(' stock ')[0] if ' stock ' in entity else entity
                wiki = tool_wikipedia(core)
                if wiki:
                    return f"Tool [Wikipedia]: {wiki}"
        return f"Tool [WebSearch]: {r}" if r else None
    return None


# ═══════════════════════════════════════════════════════════
#  AGENT STATE
# ═══════════════════════════════════════════════════════════


class AgentState(TypedDict):
    """The state object that flows through every node in the graph."""
    run_id: str
    user_prompt: str
    route: str  # rag_only | mcp_only | hybrid | direct
    plan_reasoning: str
    rag_context: str
    rag_sources: list  # [{source, score, preview}]
    tool_results: list  # ["Tool [Name]: data..."]
    final_response: str
    active_model: str
    execution_log: Annotated[list, operator.add]  # Accumulates across all nodes
    error: str
    interrupt_requested: bool
    interrupt_reason: str
    human_approved: bool


# ═══════════════════════════════════════════════════════════
#  GRAPH NODES
# ═══════════════════════════════════════════════════════════


def intake_node(state: AgentState) -> dict:
    """Receive and sanitize the user prompt."""
    prompt = state["user_prompt"].strip()
    _log(f"INTAKE: \"{prompt[:80]}{'...' if len(prompt) > 80 else ''}\"")
    return {
        "user_prompt": prompt,
        "execution_log": [
            {
                "node": "intake",
                "action": "received_prompt",
                "prompt_length": len(prompt),
                "timestamp": time.time(),
            }
        ],
    }


def _regex_classify_route(prompt: str) -> tuple[str, str]:
    """Regex-based fallback for intent classification (used when LLM is unavailable)."""
    lower = prompt.lower()

    # ─── Check for time-sensitive keywords FIRST (highest priority) ───
    has_time_sensitive = bool(
        re.search(
            r"\b(current|latest|recent|new|live|today|now|recently|this\s+(?:week|month|year)|upcoming|\d{4})\b",
            lower,
        )
    )

    is_opentext_product = bool(
        re.search(
            r"\b(otcs|content\s*server|documentum|extended\s*ecm|xecm|exstream|"
            r"teamsite|appworks|fortify|arcsight|netiq|voltage|encase|loadrunner|"
            r"smax|magellan|aviator|trading\s*grid)\b",
            lower,
        )
    )
    is_opentext_general = not is_opentext_product and bool(
        re.search(r"\b(opentext|open\s*text|otex)\b", lower)
    )
    is_rag_preferred = is_opentext_product or bool(
        re.search(
            r"\b(polic(?:y|ies)|guide|doc(?:s|ument(?:ation)?)?|internal|knowledge|support|"
            r"rag|retrieval|vector|embedding|langgraph|langchain|orchestrat|agentic|mcp|"
            r"protocol|architecture|pipeline|workflow)\b",
            lower,
        )
    )
    needs_realtime = bool(
        re.search(
            r"\b(weather|temperature|stock|price|news|latest|currency|"
            r"exchange\s*rate|live|traffic|flight|crypto|score|sports)\b",
            lower,
        )
    )
    is_prediction = bool(
        re.search(
            r"\b(predict(?:ion)?|forecast|outlook|future|tomorrow|"
            r"next\s+(?:\d+\s*)?(?:days?|weeks?|months?|years?|quarters?)|"
            r"\d+\s*(?:months?|years?|weeks?|days?|quarters?)|"
            r"will\s+(?:go|be|rise|fall|drop|increase|crash)|trend|estimate|projection)\b",
            lower,
        )
    ) or (
        "forecast" in lower
        and any(w in lower for w in ("stock", "share", "market", "price", "ticker"))
    )
    is_factual = bool(
        re.search(
            r"\b(who is|who was|what is|what are|ceo|president|founder|chairman|"
            r"headquarters|revenue|employees|founded|market\s*cap)\b",
            lower,
        )
    )
    needs_web = bool(re.search(r"^(who|what|where|when|why|how|which)\b", lower)) or is_factual
    is_greeting = any(lower.startswith(g) for g in ("hello", "hi ", "hi!", "hey", "greetings", "thank", "thanks"))
    is_math = bool(re.match(r"^[\d\s+\-*/().^]+$", prompt)) or bool(
        re.search(r"\b(calculate|convert|compute)\b", lower)
    )
    is_time_query = bool(re.search(r"\b(time\s+(?:in|at)|what\s+time|timezone|clock\s+(?:in|at|for))\b", lower))
    is_dictionary = bool(re.search(r"\b(define|meaning\s+of|definition)\b", lower))
    is_tell_about = bool(re.search(r"\b(tell\s+(?:me\s+)?about|who\s+is|who\s+was)\b", lower))

    if is_greeting:
        return "direct", "[regex] Simple greeting → direct LLM response."
    if is_math:
        return "mcp_only", "[regex] Math/computation detected → calculator tool."
    if is_time_query:
        return "mcp_only", "[regex] Time/timezone query → world clock tool."
    if is_dictionary:
        return "mcp_only", "[regex] Dictionary/definition query → dictionary tool."
    
    # ═══ TIME-SENSITIVE QUERIES (Priority Override) ═══
    # If query has time-sensitive keywords, prioritize real-time data sources
    if has_time_sensitive:
        if is_opentext_general or (is_opentext_product and is_factual):
            # "opentext ceo latest" → hybrid (OpenText company info + current data)
            return "hybrid", "[regex] OpenText + time-sensitive → RAG + web search."
        if is_rag_preferred or is_factual or needs_web:
            # Time-sensitive + factual = use web search, not RAG
            return "mcp_only", "[regex] Time-sensitive query → prioritize real-time data."
    
    if is_prediction and needs_realtime:
        return "mcp_only", "[regex] Prediction/forecast query → web search."
    if is_opentext_product and not needs_realtime:
        return "rag_only", "[regex] OpenText product query → internal docs."
    if is_rag_preferred and not needs_realtime and not has_time_sensitive:
        return "rag_only", "[regex] Internal knowledge query → document store."
    if (is_opentext_general or is_rag_preferred) and (needs_realtime or is_factual) and not is_prediction:
        return "hybrid", "[regex] Knowledge query + real-time data → RAG + MCP."
    if needs_realtime or needs_web:
        return "mcp_only", "[regex] Real-time or factual question → external tools."
    if is_tell_about:
        return "mcp_only", "[regex] Informational query → external knowledge."
    return "direct", "[regex] General question → direct LLM response."


def planner_node(state: AgentState) -> dict:
    """Classify intent and decide the execution route using LLM (regex fallback)."""
    prompt = state["user_prompt"]
    lower = prompt.lower()

    # ─── Quick overrides (no LLM needed) ───
    if "rag only" in lower:
        route, reasoning = "rag_only", "Explicit RAG override → searching internal knowledge base only."
    elif "mcp tools only" in lower:
        route, reasoning = "mcp_only", "Explicit MCP override → using external tools only."
    else:
        # ─── Try LLM-based classification first ───
        llm_result = _llm_classify_route(prompt)
        if llm_result:
            route, reasoning = llm_result
            reasoning = f"[LLM] {reasoning}"
        else:
            # ─── Fallback Strategy ───
            if _llm_keys_available():
                _log("PLANNER: LLM failed despite keys; defaulting to mcp_only")
                route, reasoning = "mcp_only", "[LLM-fallback] Defaulted to tools for external context."
            else:
                # ─── Regex Fallback (when LLM is unavailable) ───
                _log("PLANNER: LLM unavailable, falling back to regex classification")
                route, reasoning = _regex_classify_route(prompt)

    _log(f"PLANNER: route={route} | {reasoning}")

    log_entry = {
        "node": "planner",
        "route": route,
        "reasoning": reasoning,
        "timestamp": time.time(),
    }

    return {
        "route": route,
        "plan_reasoning": reasoning,
        "execution_log": [log_entry],
    }


def rag_node(state: AgentState) -> dict:
    """Retrieve relevant context from the built-in knowledge base via TF-IDF."""
    query = state["user_prompt"]
    _log(f"RAG: searching for \"{query[:60]}...\"")

    start = time.time()
    results = _rag_engine.search(query, top_k=5)
    elapsed_ms = round((time.time() - start) * 1000, 1)

    sources = []
    context_parts = []
    for r in results:
        chunk = r["chunk"]
        sources.append(
            {
                "source": chunk["source"],
                "score": r["score"],
                "preview": chunk["content"][:120] + "...",
            }
        )
        context_parts.append(f"[Source: {chunk['source']}]\n{chunk['content']}")

    context = "\n\n".join(context_parts) if context_parts else ""
    top_score = results[0]["score"] if results else 0.0
    _log(f"RAG: {len(results)} chunks in {elapsed_ms}ms (top score: {top_score})")

    return {
        "rag_context": context,
        "rag_sources": sources,
        "execution_log": [
            {
                "node": "rag",
                "chunks_found": len(results),
                "search_time_ms": elapsed_ms,
                "top_score": top_score,
                "sources": [s["source"] for s in sources],
                "timestamp": time.time(),
            }
        ],
    }


def tool_node(state: AgentState) -> dict:
    """Execute external tool calls (real API calls) based on the user prompt."""
    prompt = state["user_prompt"]
    _log("TOOLS: analyzing prompt for tool calls...")

    # System is fully autonomous - execute tools immediately without approval gates
    start = time.time()
    results = run_tools(prompt)
    elapsed_ms = round((time.time() - start) * 1000, 1)

    _log(f"TOOLS: {len(results)} tool(s) executed in {elapsed_ms}ms")
    for r in results:
        _log(f"  → {r[:120]}...")

    return {
        "tool_results": results,
        "execution_log": [
            {
                "node": "tools",
                "tools_executed": len(results),
                "tool_names": [
                    (re.match(r"Tool \[(\w+)\]", r) or type("", (), {"group": lambda s, i: "?"})())
                    .group(1)
                    for r in results
                ],
                "execution_time_ms": elapsed_ms,
                "timestamp": time.time(),
            }
        ],
    }


def synthesizer_node(state: AgentState) -> dict:
    """Combine RAG context + tool results and produce the final response via LLM."""
    prompt = state["user_prompt"]
    rag_context = state.get("rag_context", "")
    tool_results = state.get("tool_results", [])
    _log("SYNTHESIZER: assembling final response...")

    # Classify task type for intelligent model routing
    task = classify_task(prompt, rag_context, tool_results)
    _log(f"SYNTHESIZER: classified task as {task.value}")

    # Build enhanced prompt with all collected context
    parts = [prompt]
    if rag_context:
        parts.append(f"\n\n[RETRIEVED KNOWLEDGE (RAG)]\n{rag_context}")
    if tool_results:
        parts.append(f"\n\n[TOOL RESULTS (MCP)]\n" + "\n".join(tool_results))

    enhanced = "\n".join(parts)

    system = (
        "You are an intelligent AI agent. You have retrieved knowledge from an internal "
        "document store (RAG) and/or executed live tools (MCP) to gather information.\n\n"
        "RULES:\n"
        "1. Use the provided context and tool data to answer the user's question directly and professionally.\n"
        "2. Do NOT invent numbers or data points that are not in the provided context.\n"
        "3. For STOCK PREDICTION / FORECAST queries: you MUST use the trend data, price ranges, "
        "and percentage changes from the tool results to provide a data-driven outlook and analysis. "
        "Discuss the current trend direction, momentum, support/resistance levels from the 30-day range, "
        "and any relevant context. Add a disclaimer that this is analysis, not financial advice.\n"
        "4. Cite sources when relevant. Be concise and confident.\n"
        "5. NEVER say 'I cannot answer' or 'the tool could not find data' when tool results ARE present — "
        "always use the data you have."
    )

    # Try LLM synthesis with task-aware routing
    response, model = call_llm(
        [{"role": "user", "content": enhanced}],
        system_prompt=system,
        task_type=task,
    )

    if not response:
        # Template-based fallback when no LLM is available
        model = "template (offline)"
        sections = []
        if rag_context:
            source_names = list(set(s["source"] for s in state.get("rag_sources", [])))
            sections.append(f"**Retrieved from knowledge base** ({', '.join(source_names)}):\n")
            for s in state.get("rag_sources", [])[:3]:
                sections.append(f"> {s['preview']}\n")
        if tool_results:
            sections.append("\n**Tool Results:**\n")
            for tr in tool_results:
                sections.append(f"- {tr}\n")
        if not sections:
            # Last-resort: try quick tool calls for direct-route queries with no data
            _log("SYNTHESIZER: no context available, attempting quick tool lookup...")
            quick_results = run_tools(prompt)
            if quick_results:
                sections.append("**Results:**\n")
                for tr in quick_results:
                    sections.append(f"- {tr}\n")
            else:
                sections.append(
                    f'Processed your query: "{prompt}". '
                    f"I don't have enough context to provide a detailed answer. "
                    f"Try rephrasing or asking about weather, stocks, time, definitions, or topics in our knowledge base."
                )
        response = "\n".join(sections)

    _log(f"SYNTHESIZER: response via {model} ({len(response)} chars)")

    return {
        "final_response": response,
        "active_model": model,
        "execution_log": [
            {
                "node": "synthesizer",
                "model": model,
                "response_length": len(response),
                "context_sources": {"rag": bool(rag_context), "tools": len(tool_results)},
                "timestamp": time.time(),
            }
        ],
    }


# ═══════════════════════════════════════════════════════════
#  CONDITIONAL ROUTERS
# ═══════════════════════════════════════════════════════════


def route_after_plan(state: AgentState) -> str:
    """Route from planner → rag, tools, or synthesizer."""
    route = state.get("route", "direct")
    if route in ("rag_only", "hybrid"):
        return "rag"
    elif route == "mcp_only":
        return "tools"
    return "synthesizer"


def route_after_rag(state: AgentState) -> str:
    """After RAG: continue to tools (hybrid) or synthesize (rag_only)."""
    if state.get("route") == "hybrid":
        return "tools"
    return "synthesizer"


# ═══════════════════════════════════════════════════════════
#  GRAPH ASSEMBLY
# ═══════════════════════════════════════════════════════════


def build_graph(checkpointer: Any = None):
    """Construct and compile the LangGraph directed workflow."""
    builder = StateGraph(AgentState)

    # ── Register Nodes ──
    builder.add_node("intake", intake_node)
    builder.add_node("planner", planner_node)
    builder.add_node("rag", rag_node)
    builder.add_node("tools", tool_node)
    builder.add_node("synthesizer", synthesizer_node)

    # ── Define Edges ──
    builder.add_edge(START, "intake")
    builder.add_edge("intake", "planner")

    # Conditional: planner → rag | tools | synthesizer
    builder.add_conditional_edges(
        "planner",
        route_after_plan,
        {"rag": "rag", "tools": "tools", "synthesizer": "synthesizer"},
    )

    # Conditional: rag → tools (hybrid) | synthesizer (rag_only)
    builder.add_conditional_edges(
        "rag",
        route_after_rag,
        {"tools": "tools", "synthesizer": "synthesizer"},
    )

    # Tools always → synthesizer
    builder.add_edge("tools", "synthesizer")

    # Synthesizer → END
    builder.add_edge("synthesizer", END)

    # Compile graph (interrupts disabled - system runs fully autonomous)
    compile_kwargs = {}
    if checkpointer:
        compile_kwargs["checkpointer"] = checkpointer
        # Removed interrupt_before - system executes autonomously without human gate
    
    return builder.compile(**compile_kwargs)


# ═══════════════════════════════════════════════════════════
#  PUBLIC API
# ═══════════════════════════════════════════════════════════

# Pre-compiled graph singleton
_graph = None
_checkpointer = None


def get_checkpointer():
    """Get or create the checkpointer for interrupt support."""
    global _checkpointer
    if _checkpointer is None and MemorySaver:
        _checkpointer = MemorySaver()
    return _checkpointer


def get_graph():
    """Get (or build) the compiled LangGraph workflow."""
    global _graph
    if _graph is None:
        checkpointer = get_checkpointer()
        _graph = build_graph(checkpointer=checkpointer)
    return _graph


def run_workflow(prompt: str, run_id: str | None = None, enable_interrupts: bool = False) -> dict:
    # Note: enable_interrupts is kept for backward compatibility but is ignored.
    # The system now runs fully autonomous with intelligent routing.
    """
    Run the full agentic workflow for a given prompt.

    Args:
        prompt: The user query to process
        run_id: Optional workflow run identifier
        enable_interrupts: If True, pause before tool execution for human approval

    Returns the complete final state including the response,
    execution log, model used, RAG sources, and tool results.
    """
    graph = get_graph()
    request_run_id = run_id or f"run_{uuid.uuid4().hex[:12]}"
    initial_state: dict = {
        "run_id": request_run_id,
        "user_prompt": prompt,
        "route": "",
        "plan_reasoning": "",
        "rag_context": "",
        "rag_sources": [],
        "tool_results": [],
        "final_response": "",
        "active_model": "",
        "execution_log": [],
        "error": "",
        "interrupt_requested": False,  # Always False - autonomous execution
        "interrupt_reason": "",
        "human_approved": True,  # Always approved - autonomous execution
    }

    if _state_store.enabled:
        _state_store.save_snapshot(request_run_id, "initial", dict(initial_state))

    try:
        config = {"configurable": {"thread_id": request_run_id}}
        
        # Execute workflow end-to-end (fully autonomous, no interrupts)
        result = dict(graph.invoke(initial_state, config))

        result["run_id"] = request_run_id
        result["redis_persisted"] = _state_store.enabled
        result["interrupted"] = False  # System is fully autonomous - never interrupted

        if _state_store.enabled:
            _state_store.save_snapshot(request_run_id, "completed", dict(result))
        return dict(result)
    except Exception as e:
        failure = {
            **initial_state,
            "run_id": request_run_id,
            "redis_persisted": _state_store.enabled,
            "error": str(e),
            "final_response": f"Workflow error: {e}",
        }
        if _state_store.enabled:
            _state_store.save_snapshot(request_run_id, "error", dict(failure))
        return failure


def resume_workflow(run_id: str, approved: bool, reason: str | None = None) -> dict:
    """
    Resume an interrupted workflow after human approval/rejection.
    
    Args:
        run_id: The workflow run identifier
        approved: Whether to approve (True) or reject (False) execution
        reason: Optional reason for the decision
        
    Returns:
        Updated workflow state with completion status
    """
    graph = get_graph()
    checkpointer = get_checkpointer()
    
    if not checkpointer:
        return {
            "error": "Checkpointer not available - cannot resume workflows without persistence",
            "run_id": run_id,
        }
    
    try:
        # Get the latest state from checkpoint
        config = {"configurable": {"thread_id": run_id}}
        state = graph.get_state(config)
        
        if not state or not state.values:
            return {
                "error": f"No checkpoint found for run_id={run_id}",
                "run_id": run_id,
            }
        
        current_state = dict(state.values)
        
        # Check if workflow was actually interrupted
        if not current_state.get("interrupt_requested"):
            return {
                "error": f"Workflow {run_id} was not interrupted - cannot approve/reject",
                "run_id": run_id,
                "current_state": current_state,
            }
        
        # Update state with approval decision
        current_state["human_approved"] = approved
        
        if not approved:
            # Rejected - mark as completed with rejection message
            current_state["final_response"] = f"[REJECTED] {reason or 'User declined tool execution'}"
            current_state["error"] = reason or "User declined"
            
            if _state_store.enabled:
                _state_store.save_snapshot(run_id, "rejected", dict(current_state))
            
            return {
                "run_id": run_id,
                "status": "rejected",
                "final_response": current_state["final_response"],
                "redis_persisted": _state_store.enabled,
            }
        
        # Approved - update state and resume from checkpoint
        graph.update_state(config, current_state)
        
        # Resume execution from the checkpoint
        result_state = dict(current_state)
        for update in graph.stream(None, config, stream_mode="updates"):
            if not isinstance(update, dict):
                continue
            for stage, delta in update.items():
                if isinstance(delta, dict):
                    _merge_state(result_state, delta)
                if _state_store.enabled:
                    _state_store.save_snapshot(run_id, f"resumed_{stage}", dict(result_state))
        
        result_state["run_id"] = run_id
        result_state["redis_persisted"] = _state_store.enabled
        result_state["status"] = "completed_after_approval"
        
        if _state_store.enabled:
            _state_store.save_snapshot(run_id, "completed", dict(result_state))
        
        return dict(result_state)
        
    except Exception as e:
        error_msg = f"Failed to resume workflow {run_id}: {str(e)}"
        return {
            "error": error_msg,
            "run_id": run_id,
            "redis_persisted": _state_store.enabled,
        }


# ═══════════════════════════════════════════════════════════
#  CLI ENTRY POINT
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    prompt = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "What is RAG in AI?"

    print(f"\n{'=' * 60}")
    print(f"  LangGraph Agentic Workflow")
    print(f"{'=' * 60}")
    print(f"  Prompt: {prompt}")
    print(f"{'=' * 60}\n")

    # Enable verbose logging for CLI
    os.environ["VERBOSE"] = "true"

    start_time = time.time()
    result = run_workflow(prompt)
    elapsed = time.time() - start_time

    print(f"\n{'─' * 60}")
    print(f"  RESPONSE (via {result['active_model']})")
    print(f"{'─' * 60}")
    print(f"\n{result['final_response']}\n")

    print(f"{'─' * 60}")
    print(f"  EXECUTION SUMMARY")
    print(f"{'─' * 60}")
    print(f"  Route:    {result['route']}")
    print(f"  Reason:   {result['plan_reasoning']}")
    print(f"  RAG:      {len(result['rag_sources'])} sources retrieved")
    print(f"  Tools:    {len(result['tool_results'])} results")
    print(f"  Model:    {result['active_model']}")
    print(f"  Time:     {elapsed:.2f}s")
    print(f"  Steps:    {len(result['execution_log'])} nodes executed")
    print()

    if result.get("error"):
        print(f"  ⚠ Error: {result['error']}")

    # Print detailed execution trace
    print(f"{'─' * 60}")
    print(f"  EXECUTION TRACE")
    print(f"{'─' * 60}")
    for i, entry in enumerate(result.get("execution_log", []), 1):
        node = entry.get("node", "?")
        ts = entry.get("timestamp", 0)
        details = {k: v for k, v in entry.items() if k not in ("node", "timestamp")}
        print(f"  {i}. [{node}] {json.dumps(details, default=str)}")
    print()
