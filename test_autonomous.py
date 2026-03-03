#!/usr/bin/env python3
"""
Test autonomous workflow execution.

Usage:
  python test_autonomous.py
"""
import os
import sys

# Add mcp-server to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'mcp-server'))

from langgraph_workflow import run_workflow

def test_autonomous_workflow():
    """Test that system runs fully autonomous without approvals."""
    print("\n" + "="*60)
    print("  AUTONOMOUS WORKFLOW TEST")
    print("="*60 + "\n")
    
    test_queries = [
        ("What's the weather in New York?", "mcp_only"),
        ("Who is the CEO of OpenText?", "hybrid"),
        ("What is RAG in AI?", "rag_only"),
        ("Calculate 2^10", "mcp_only"),
    ]
    
    for query, expected_route in test_queries:
        print(f"\nQuery: {query}")
        print(f"Expected Route: {expected_route}")
        
        result = run_workflow(query, enable_interrupts=False)
        
        print(f"  ✓ Completed autonomously")
        print(f"  Route: {result.get('route', 'unknown')}")
        print(f"  Model: {result.get('active_model', 'unknown')}")
        print(f"  Interrupted: {result.get('interrupted', False)}")
        
        # Verify it wasn't interrupted
        if result.get('interrupted'):
            print(f"  ✗ ERROR: Workflow interrupted unexpectedly!")
            return False
        
        # Verify we got a response
        if not result.get('final_response'):
            print(f"  ✗ ERROR: No response generated!")
            return False
        
        print(f"  Response: {result.get('final_response', '')[:100]}...")
    
    print("\n" + "="*60)
    print("  ✓ ALL TESTS PASSED - System is Fully Autonomous")
    print("="*60 + "\n")
    return True


if __name__ == "__main__":
    try:
        success = test_autonomous_workflow()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
