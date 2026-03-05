#!/usr/bin/env python3
"""
============================================================
 AI Visual Workflow — MCP Server (HTTP/SSE)
============================================================

Minimal MCP-compatible server exposing tool discovery and execution.

Endpoints:
  GET  /mcp/tools    List available tools
  POST /mcp          JSON-RPC 2.0 (tools/list, tools/call)
  GET  /mcp/sse      Server-sent events for tool activity

Usage:
  python mcp_server.py --port 5002
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import uvicorn

from backend.tools.mcp_registry import call_tool, list_tools


app = FastAPI(
    title="AI Visual Workflow — MCP Server",
    description="HTTP/SSE MCP server exposing tool discovery and execution.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


EVENT_QUEUE: "asyncio.Queue[dict[str, Any]]" = asyncio.Queue()


def _publish_event(event_type: str, payload: dict[str, Any]) -> None:
    try:
        EVENT_QUEUE.put_nowait({"type": event_type, "payload": payload})
    except asyncio.QueueFull:
        pass


@app.get("/mcp/tools")
async def get_tools() -> dict[str, Any]:
    return {"tools": list_tools()}


@app.post("/mcp")
async def handle_jsonrpc(request: Request) -> JSONResponse:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON-RPC payload")

    method = body.get("method")
    params = body.get("params", {})
    request_id = body.get("id")

    if method == "tools/list":
        result = {"tools": list_tools()}
        return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": result})

    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        original_prompt = params.get("original_prompt", "")
        if not isinstance(name, str):
            raise HTTPException(status_code=400, detail="tools/call requires params.name")

        _publish_event("tool_call", {"name": name, "arguments": arguments})
        result = call_tool(name, arguments, original_prompt=original_prompt)
        _publish_event("tool_result", {"name": name, "result": result})

        if result is None:
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32001, "message": "Tool returned no data"},
                }
            )

        return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": {"text": result}})

    return JSONResponse(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }
    )


@app.get("/mcp/sse")
async def stream_events() -> StreamingResponse:
    async def event_generator():
        while True:
            event = await EVENT_QUEUE.get()
            data = json.dumps(event)
            yield f"event: mcp\ndata: {data}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def main() -> None:
    parser = argparse.ArgumentParser(description="AI Visual Workflow MCP Server")
    parser.add_argument("--port", type=int, default=int(os.environ.get("MCP_PORT", "5002")))
    parser.add_argument("--host", type=str, default=os.environ.get("MCP_HOST", "0.0.0.0"))
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("  AI Visual Workflow — MCP Server")
    print(f"  http://{args.host}:{args.port}")
    print("  MCP Tools: /mcp/tools")
    print("  MCP JSON-RPC: /mcp")
    print("  MCP SSE: /mcp/sse")
    print("=" * 60 + "\n")

    uvicorn.run(
        "backend.mcp_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
