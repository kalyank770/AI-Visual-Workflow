#!/usr/bin/env python3
"""
============================================================
 AI Visual Workflow — LangGraph API Server
============================================================

FastAPI server exposing the LangGraph workflow as a REST API.

Endpoints:
  POST /api/run           Run the full agentic workflow for a prompt
  GET  /api/health        Health check with system info
  GET  /api/graph         Get the graph structure (nodes & edges)

Usage:
  python langgraph_api.py                    # Start on port 5001
  python langgraph_api.py --port 8000        # Custom port

Or with uvicorn directly:
  uvicorn langgraph_api:app --port 5001 --reload
============================================================
"""
from __future__ import annotations

import os
import sys
import time
import argparse

# Add current directory to path for relative imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel, Field
    import uvicorn
except ImportError:
    sys.exit(
        "Error: FastAPI and uvicorn required.\n"
        "Run: pip install fastapi uvicorn"
    )

from langgraph_workflow import run_workflow, get_graph, KNOWLEDGE_BASE, _rag_engine, get_persistence_status, resume_workflow


# ─── FastAPI App ────────────────────────────────────────────

app = FastAPI(
    title="AI Visual Workflow — LangGraph API",
    description=(
        "Real LangGraph agentic workflow with RAG retrieval, "
        "live tool execution (stocks, weather, Wikipedia, etc.), "
        "and LLM synthesis."
    ),
    version="2.0.0",
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response Models ──────────────────────────────


class RunRequest(BaseModel):
    prompt: str = Field(
        ...,
        description="The user prompt to process through the agentic workflow",
        min_length=1,
        max_length=5000,
    )
    run_id: str | None = Field(
        None,
        description="Optional workflow run identifier (auto-generated if omitted)",
    )
    verbose: bool = Field(
        False,
        description="Enable verbose execution logging to stdout",
    )
    enable_interrupts: bool = Field(
        False,
        description="Enable human-in-the-loop interrupts before tool execution",
    )


class RunResponse(BaseModel):
    run_id: str
    prompt: str
    route: str
    plan_reasoning: str
    final_response: str
    active_model: str
    redis_persisted: bool
    interrupted: bool = False
    rag_sources: list
    tool_results: list
    execution_log: list
    execution_time_s: float
    error: str


class HealthResponse(BaseModel):
    status: str
    graph_compiled: bool
    rag_chunks: int
    knowledge_docs: int
    llm_available: dict
    persistence: dict


class GraphInfoResponse(BaseModel):
    nodes: list[str]
    edges: list[dict]


class ApprovalRequest(BaseModel):
    approved: bool = Field(
        ...,
        description="Whether to approve (True) or reject (False) the workflow execution",
    )
    reason: str | None = Field(
        None,
        description="Optional reason for approval or rejection",
    )


class ApprovalResponse(BaseModel):
    run_id: str
    status: str  # "approved", "rejected", "resumed"
    message: str
    result: dict | None = None


# ─── Endpoints ──────────────────────────────────────────────


@app.post("/api/run", response_model=RunResponse)
async def api_run(request: RunRequest):
    """
    Run the full LangGraph agentic workflow for a prompt.

    The workflow:
    1. Intake — sanitize prompt
    2. Planner — classify intent, choose route (rag_only / mcp_only / hybrid / direct)
    3. RAG — retrieve context from knowledge base (if route includes RAG)
    4. Tools — execute real API calls (if route includes MCP)
    5. Synthesizer — combine everything via LLM (or template fallback)
    """
    if request.verbose:
        os.environ["VERBOSE"] = "true"

    start = time.time()
    try:
        result = run_workflow(
            request.prompt,
            run_id=request.run_id,
            enable_interrupts=request.enable_interrupts
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    elapsed = round(time.time() - start, 3)

    return RunResponse(
        run_id=result.get("run_id", request.run_id or ""),
        prompt=result.get("user_prompt", request.prompt),
        route=result.get("route", ""),
        plan_reasoning=result.get("plan_reasoning", ""),
        final_response=result.get("final_response", ""),
        active_model=result.get("active_model", ""),
        redis_persisted=bool(result.get("redis_persisted", False)),
        interrupted=bool(result.get("interrupted", False)),
        rag_sources=result.get("rag_sources", []),
        tool_results=result.get("tool_results", []),
        execution_log=result.get("execution_log", []),
        execution_time_s=elapsed,
        error=result.get("error", ""),
    )


@app.post("/api/approve/{run_id}", response_model=ApprovalResponse)
async def api_approve(run_id: str, request: ApprovalRequest):
    """
    Approve or reject an interrupted workflow and optionally resume execution.
    
    If approved=True, sets human_approved flag and resumes the workflow from checkpoint.
    If approved=False, marks the workflow as rejected without resuming.
    """
    try:
        if request.approved:
            # Approve and resume the workflow
            result = resume_workflow(run_id, approved=True, reason=request.reason)
            
            if result.get("error"):
                return ApprovalResponse(
                    run_id=run_id,
                    status="error",
                    message=result["error"],
                    result=None,
                )
            
            return ApprovalResponse(
                run_id=run_id,
                status="resumed",
                message="Workflow approved and resumed successfully",
                result=result,
            )
        else:
            # Reject the workflow
            result = resume_workflow(run_id, approved=False, reason=request.reason or "Rejected by user")
            
            return ApprovalResponse(
                run_id=run_id,
                status="rejected",
                message=f"Workflow rejected: {request.reason or 'User declined'}",
                result=result,
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process approval for run_id={run_id}: {str(e)}"
        )


@app.get("/api/health", response_model=HealthResponse)
async def api_health():
    """Health check returning system information and capability status."""
    internal_key = os.environ.get("INTERNAL_API_KEY") or os.environ.get(
        "VITE_INTERNAL_API_KEY", ""
    )
    gemini_key = (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("VITE_GEMINI_API_KEY")
        or os.environ.get("VITE_API_KEY", "")
    )

    return HealthResponse(
        status="healthy",
        graph_compiled=get_graph() is not None,
        rag_chunks=len(_rag_engine.chunks),
        knowledge_docs=len(KNOWLEDGE_BASE),
        llm_available={
            "internal_llama": bool(internal_key),
            "gemini": bool(gemini_key),
            "template_fallback": True,
        },
        persistence=get_persistence_status(),
    )


@app.get("/api/graph", response_model=GraphInfoResponse)
async def api_graph():
    """
    Get the graph topology for visualization.

    Returns the list of node names and all edges (including conditional ones).
    """
    # Ensure the graph is compiled
    get_graph()

    nodes = ["intake", "planner", "rag", "tools", "synthesizer"]
    edges = [
        {"from": "__start__", "to": "intake"},
        {"from": "intake", "to": "planner"},
        {"from": "planner", "to": "rag", "condition": "route in (rag_only, hybrid)"},
        {"from": "planner", "to": "tools", "condition": "route == mcp_only"},
        {"from": "planner", "to": "synthesizer", "condition": "route == direct"},
        {"from": "rag", "to": "tools", "condition": "route == hybrid"},
        {"from": "rag", "to": "synthesizer", "condition": "route == rag_only"},
        {"from": "tools", "to": "synthesizer"},
        {"from": "synthesizer", "to": "__end__"},
    ]

    return GraphInfoResponse(nodes=nodes, edges=edges)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Catch-all error handler."""
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}"},
    )


# ─── Server Startup ─────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LangGraph API Server")
    parser.add_argument(
        "--port", type=int, default=5001, help="Port to listen on (default: 5001)"
    )
    parser.add_argument(
        "--host", type=str, default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--reload", action="store_true", help="Enable auto-reload for development"
    )
    args = parser.parse_args()

    print(f"\n{'=' * 60}")
    print(f"  LangGraph API Server")
    print(f"  http://{args.host}:{args.port}")
    print(f"  Docs: http://localhost:{args.port}/docs")
    print(f"{'=' * 60}\n")

    uvicorn.run(
        "langgraph_api:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
