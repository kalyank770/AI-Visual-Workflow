#!/usr/bin/env python3
"""
============================================================
 Comprehensive Tool Routing Validation Test
============================================================

Tests all 9 tools in langgraph_workflow.py to ensure queries
are properly routed to the correct tools.

Tools to test:
1. stock_price - Current stock price
2. stock_analysis - Stock trend data for predictions
3. weather - Current weather
4. currency - Currency conversion
5. world_clock - Time in different timezones
6. dictionary - Word definitions
7. calculator - Math expressions
8. wikipedia - Factual information
9. web_search - Fallback for general queries
============================================================
"""

import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Enable verbose logging
os.environ['VERBOSE'] = 'true'

from langgraph_workflow import _regex_run_tools

# ═══════════════════════════════════════════════════════════
#  TEST CASES FOR ALL 9 TOOLS
# ═══════════════════════════════════════════════════════════

TEST_CASES = {
    "stock_price": [
        "AAPL stock price",
        "what is the price of Microsoft stock",
        "current TSLA price",
        "otex stock",
    ],
    
    "stock_analysis": [
        "OTEX stock prediction for next 2 months",
        "apple stock forecast",
        "will tesla stock go up next year",
        "microsoft price prediction",
        "nvidia stock outlook",
    ],
    
    "weather": [
        "weather in New York",
        "what's the temperature in London",
        "weather forecast for Tokyo",
        "is it raining in Seattle",
    ],
    
    "currency": [
        "euro to indian rupee",
        "100 usd to inr",
        "convert 50 euros to dollars",
        "eur to gbp",
        "what is dollar to rupee",
        "pound to yen",
    ],
    
    "world_clock": [
        "what time is it in Tokyo",
        "current time in London",
        "time in New York",
        "5pm utc to ist",
        "timezone difference between UTC and IST",
    ],
    
    "dictionary": [
        "define serendipity",
        "meaning of ephemeral",
        "what does ubiquitous mean",
        "definition of paradigm",
    ],
    
    "calculator": [
        "23 + 45",
        "100 * 56 / 8",
        "sqrt(144)",
        "2^10",
        "calculate 15% of 200",
    ],
    
    "wikipedia": [
        "who is Elon Musk",
        "tell me about quantum computing",
        "what is artificial intelligence",
        "Albert Einstein biography",
        "OpenText company",
    ],
    
    "web_search": [
        "latest AI news",
        "who won the super bowl 2024",
        "best practices for Python",
    ],
}


def extract_tool_name(result_string):
    """Extract the tool name from a result string like 'Tool [StockPrice]: ...'"""
    if not result_string or "Tool [" not in result_string:
        return None
    try:
        return result_string.split("Tool [")[1].split("]")[0]
    except (IndexError, AttributeError):
        return None


def normalize_tool_name(tool_name):
    """Normalize tool names for comparison."""
    mappings = {
        "StockPrice": "stock_price",
        "StockAnalysis": "stock_analysis",
        "Weather": "weather",
        "Currency": "currency",
        "WorldClock": "world_clock",
        "Dictionary": "dictionary",
        "Calculator": "calculator",
        "Wikipedia": "wikipedia",
        "WebSearch": "web_search",
    }
    return mappings.get(tool_name, tool_name.lower().replace(" ", "_"))


def run_validation():
    """Run the comprehensive tool routing validation."""
    print("=" * 70)
    print("  COMPREHENSIVE TOOL ROUTING VALIDATION")
    print("=" * 70)
    print()
    
    total_tests = 0
    passed_tests = 0
    failed_tests = 0
    failures = []
    
    for expected_tool, queries in TEST_CASES.items():
        print(f"\n{'-' * 70}")
        print(f"  Testing: {expected_tool.upper()}")
        print(f"  Expected to route to: Tool [{expected_tool}]")
        print(f"{'-' * 70}")
        
        for query in queries:
            total_tests += 1
            print(f"\n  Query: '{query}'")
            
            try:
                results = _regex_run_tools(query)
                
                if not results:
                    print(f"    ✗ FAIL: No tool called")
                    failed_tests += 1
                    failures.append({
                        "query": query,
                        "expected": expected_tool,
                        "actual": "No tool called",
                    })
                    continue
                
                # Extract tool names from results
                tools_called = [extract_tool_name(r) for r in results]
                tools_called = [normalize_tool_name(t) for t in tools_called if t]
                
                # Check if expected tool was called
                if expected_tool in tools_called:
                    print(f"    ✓ PASS: Correctly routed to {tools_called}")
                    passed_tests += 1
                    
                    # Show abbreviated result
                    for r in results:
                        if len(r) > 120:
                            print(f"      Result: {r[:117]}...")
                        else:
                            print(f"      Result: {r}")
                else:
                    print(f"    ✗ FAIL: Routed to {tools_called}, expected {expected_tool}")
                    failed_tests += 1
                    failures.append({
                        "query": query,
                        "expected": expected_tool,
                        "actual": tools_called if tools_called else "Unknown tool",
                    })
                    
            except Exception as e:
                print(f"    ✗ ERROR: {str(e)[:100]}")
                failed_tests += 1
                failures.append({
                    "query": query,
                    "expected": expected_tool,
                    "actual": f"Exception: {str(e)[:50]}",
                })
    
    # ═══════════════════════════════════════════════════════════
    #  SUMMARY REPORT
    # ═══════════════════════════════════════════════════════════
    
    print("\n" + "=" * 70)
    print("  VALIDATION SUMMARY")
    print("=" * 70)
    print(f"  Total Tests:  {total_tests}")
    print(f"  Passed:       {passed_tests} ({passed_tests/total_tests*100:.1f}%)")
    print(f"  Failed:       {failed_tests} ({failed_tests/total_tests*100:.1f}%)")
    print("=" * 70)
    
    if failures:
        print("\n" + "=" * 70)
        print("  FAILURE DETAILS")
        print("=" * 70)
        for i, fail in enumerate(failures, 1):
            print(f"\n  {i}. Query: \"{fail['query']}\"")
            print(f"     Expected: {fail['expected']}")
            print(f"     Actual:   {fail['actual']}")
    
    # ═══════════════════════════════════════════════════════════
    #  TOOL COVERAGE REPORT
    # ═══════════════════════════════════════════════════════════
    
    print("\n" + "=" * 70)
    print("  TOOL COVERAGE REPORT")
    print("=" * 70)
    
    tools_tested = list(TEST_CASES.keys())
    print(f"  Tools tested: {len(tools_tested)}/9")
    print(f"  Tested: {', '.join(tools_tested)}")
    print("=" * 70)
    
    # Exit with appropriate code
    if failed_tests == 0:
        print("\n✅ ALL TESTS PASSED! All tools are correctly routed.\n")
        return 0
    else:
        print(f"\n❌ {failed_tests} TESTS FAILED. See details above.\n")
        return 1


if __name__ == "__main__":
    exit_code = run_validation()
    sys.exit(exit_code)
