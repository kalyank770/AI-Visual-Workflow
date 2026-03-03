#!/usr/bin/env python3
"""
Test script for interrupt/approval system.

Usage:
  python test_interrupt.py
"""
import os
import sys

# Add mcp-server to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'mcp-server'))

from langgraph_workflow import run_workflow, resume_workflow

def test_interrupt_flow():
    """Test the interrupt and approval flow."""
    print("\n" + "="*60)
    print("  INTERRUPT/APPROVAL SYSTEM TEST")
    print("="*60 + "\n")
    
    # Test 1: Run workflow WITH interrupts enabled
    print("Test 1: Running workflow with interrupts enabled...")
    query = "What's the weather in Tokyo?"
    
    result1 = run_workflow(query, enable_interrupts=True)
    
    print(f"  Run ID: {result1.get('run_id')}")
    print(f"  Interrupted: {result1.get('interrupted', False)}")
    print(f"  Response: {result1.get('final_response', 'N/A')[:100]}")
    print(f"  Route: {result1.get('route', 'N/A')}")
    
    if result1.get('interrupted'):
        print("\n  ✓ Workflow properly interrupted before tool execution")
        print("\n  Execution Log:")
        for log in result1.get('execution_log', []):
            print(f"    - {log.get('node', 'unknown')}: {log.get('reasoning', log.get('reason', 'N/A'))[:80]}")
            if log.get('status'):
                print(f"      Status: {log['status']}")
        
        # Test 2: Approve and resume
        print("\n\nTest 2: Approving and resuming workflow...")
        run_id = result1.get('run_id')
        result2 = resume_workflow(run_id, approved=True, reason="Test approval")
        
        print(f"  Status: {result2.get('status', 'unknown')}")
        print(f"  Response: {result2.get('final_response', 'N/A')[:100]}")
        print(f"  Tool Results: {len(result2.get('tool_results', []))} tool(s) executed")
        
        if result2.get('final_response') and '[AWAITING' not in result2.get('final_response', ''):
            print("\n  ✓ Workflow successfully completed after approval")
        else:
            print("\n  ✗ Workflow did not complete properly")
    else:
        print("\n  ✗ Workflow did NOT interrupt as expected")
        return False
    
    # Test 3: Run workflow WITHOUT interrupts
    print("\n\nTest 3: Running workflow without interrupts...")
    result3 = run_workflow("What's the weather in London?", enable_interrupts=False)
    
    print(f"  Interrupted: {result3.get('interrupted', False)}")
    print(f"  Response: {result3.get('final_response', 'N/A')[:100]}")
    
    if not result3.get('interrupted'):
        print("\n  ✓ Workflow executed directly without interruption")
    else:
        print("\n  ✗ Workflow interrupted when it shouldn't have")
    
    print("\n" + "="*60)
    print("  TEST COMPLETE")
    print("="*60 + "\n")
    return True


if __name__ == "__main__":
    try:
        success = test_interrupt_flow()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
