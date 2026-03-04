#!/usr/bin/env python3
"""Test pure MCP compound queries (no RAG needed)"""
import sys
sys.path.insert(0, 'backend')

from backend.core.orchestrator import _regex_classify_route

test_queries = [
    ("weather in hyderabad, apple stock price, 496*96, content means", "Should be mcp_only - pure tools"),
    ("Define serendipity, weather in London, 15+20", "Should be mcp_only - no RAG"),
    ("Who is Elon Musk, time in Tokyo, AAPL price", "Should be mcp_only - pure MCP"),
    
    ("OpenText upgrade, 18*896", "Should be hybrid - RAG + math"),
    ("What is RAG, weather today", "Should be hybrid - RAG + tool"),
]

print("Testing Pure MCP Compound Queries\n" + "="*70)

for query, expected in test_queries:
    route, reasoning = _regex_classify_route(query)
    status = "[PASS]" if (expected.startswith("Should be " + route)) else "[FAIL]"
    print(f"\n{status} Query: {query}")
    print(f"  Expected: {expected}")
    print(f"  Got: {route}")

print("\n" + "="*70)
