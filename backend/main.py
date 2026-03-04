#!/usr/bin/env python3
"""
============================================================
 AI Visual Workflow — Backend Entry Point
============================================================

Main server launcher for the agentic AI workflow.

Architecture:
  core/       → LangGraph orchestration (intent routing, state management)
  rag/        → Retrieval-Augmented Generation (semantic search)
  tools/      → Tool integration (MCP protocol, external APIs)
  data/       → Knowledge base (documents for RAG)
  api.py      → FastAPI REST server

Usage:
  python main.py                 # Start on default port 5001
  python main.py --port 8000     # Custom port

The frontend calls the REST API at http://localhost:5001/api/*
"""
import sys
import os

# Ensure backend module can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if __name__ == "__main__":
    # Import after path is set
    from backend import api
    import argparse
    import uvicorn
    
    parser = argparse.ArgumentParser(description="AI Visual Workflow Backend Server")
    parser.add_argument("--port", type=int, default=5001, help="Port to listen on (default: 5001)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()
    
    print(f"\n{'='*60}")
    print(f"  AI Visual Workflow — Backend Server")
    print(f"  http://{args.host}:{args.port}")
    print(f"  API Docs: http://localhost:{args.port}/docs")
    print(f"{'='*60}\n")
    
    uvicorn.run(
        "backend.api:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
