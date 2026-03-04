#!/usr/bin/env python3
"""Test compound query routing logic"""
import sys
sys.path.insert(0, 'backend')

from backend.core.orchestrator import _regex_classify_route

test_queries = [
    "Opentext content management for oracle upgrade, 18*896",
    "What is RAG in AI, weather in London",
    "LangGraph documentation, define serendipity",
    "Content Server features, 15+20",
    "OpenText upgrade steps",  # Pure RAG - should be rag_only
    "18*896",  # Pure math - should be mcp_only
    "weather in Paris",  # Pure tool - should be mcp_only
]

print("Testing Compound Query Routing\n" + "="*60)

for query in test_queries:
    route, reasoning = _regex_classify_route(query)
    print(f"\nQuery: {query}")
    print(f"Route: {route}")
    print(f"Reasoning: {reasoning}")

print("\n" + "="*60)
print("Test complete!")
