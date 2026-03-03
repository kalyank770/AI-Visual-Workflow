#!/usr/bin/env python3
"""
Test script demonstrating the LLM Routing System.

Usage:
  python test_llm_routing.py
"""
import os
import sys

# Add mcp-server to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'mcp-server'))

from langgraph_workflow import (  # type: ignore
    TaskType,
    classify_task,
    select_model,
    MODEL_REGISTRY,
)

def test_task_classification():
    """Test task classification heuristics."""
    print("\n" + "="*60)
    print("  TASK CLASSIFICATION TESTS")
    print("="*60 + "\n")
    
    test_cases = [
        ("Write a Python function to sort a list", TaskType.CODE),
        ("Predict Apple stock for next month", TaskType.ANALYZE),
        ("Summarize this article in 3 bullet points", TaskType.SUMMARIZE),
        ("Hello, how are you?", TaskType.CHAT),
        ("Why does the sky appear blue?", TaskType.REASON),
        ("Write a creative story about a robot", TaskType.CREATIVE),
        ("What is the capital of France?", TaskType.FACTUAL),
    ]
    
    passed = 0
    for prompt, expected in test_cases:
        result = classify_task(prompt)
        status = "✓" if result == expected else "✗"
        print(f"{status} '{prompt[:50]}...'")
        print(f"   Expected: {expected.value}, Got: {result.value}")
        if result == expected:
            passed += 1
    
    print(f"\nPassed: {passed}/{len(test_cases)} tests")


def test_model_selection():
    """Test model selection across different budget modes."""
    print("\n" + "="*60)
    print("  MODEL SELECTION TESTS")
    print("="*60 + "\n")
    
    # Ensure we have at least one model available
    os.environ["INTERNAL_API_KEY"] = "test_key"
    os.environ["GEMINI_API_KEY"] = "test_key"
    
    test_scenarios = [
        {
            "name": "Simple Chat (Economy)",
            "task": TaskType.CHAT,
            "prompt_length": 50,
            "budget": "economy",
            "expected_contains": "Gemini",  # Cheap and fast
        },
        {
            "name": "Code Generation (Balanced)",
            "task": TaskType.CODE,
            "prompt_length": 500,
            "budget": "balanced",
            "expected_contains": "Llama",  # Strong code capabilities
        },
        {
            "name": "Complex Reasoning (Quality)",
            "task": TaskType.REASON,
            "prompt_length": 1000,
            "budget": "quality",
            "expected_contains": "Llama",  # Highest quality
        },
        {
            "name": "Summarization (Economy)",
            "task": TaskType.SUMMARIZE,
            "prompt_length": 200,
            "budget": "economy",
            "expected_contains": "Gemini",  # Fast and cheap
        },
    ]
    
    for scenario in test_scenarios:
        print(f"\nScenario: {scenario['name']}")
        print(f"  Task: {scenario['task'].value}")
        print(f"  Budget: {scenario['budget']}")
        
        selected = select_model(
            task=scenario['task'],
            prompt_length=scenario['prompt_length'],
            budget_mode=scenario['budget'],
            max_latency_ms=5000,
        )
        
        if selected:
            status = "✓" if scenario['expected_contains'] in selected.name else "✗"
            print(f"  {status} Selected: {selected.name}")
            print(f"     Cost: ${selected.cost_per_1k_tokens:.6f}/1k tokens")
            print(f"     Latency: {selected.avg_latency_ms}ms")
            print(f"     Quality: {selected.quality_score:.2f}")
        else:
            print(f"  ✗ No model selected")


def test_routing_with_different_budgets():
    """Compare model selection across budget modes for same task."""
    print("\n" + "="*60)
    print("  BUDGET MODE COMPARISON")
    print("="*60 + "\n")
    
    os.environ["INTERNAL_API_KEY"] = "test_key"
    os.environ["GEMINI_API_KEY"] = "test_key"
    
    task = TaskType.ANALYZE
    prompt_length = 800
    
    print(f"Task: {task.value}")
    print(f"Prompt length: {prompt_length} tokens\n")
    
    for budget_mode in ["economy", "balanced", "quality"]:
        selected = select_model(
            task=task,
            prompt_length=prompt_length,
            budget_mode=budget_mode,
            max_latency_ms=5000,
        )
        
        if selected:
            print(f"{budget_mode.upper():12} → {selected.name}")
            print(f"{'':12}   Cost: ${selected.cost_per_1k_tokens:.6f}/1k, "
                  f"Latency: {selected.avg_latency_ms}ms, "
                  f"Quality: {selected.quality_score:.2f}")
        else:
            print(f"{budget_mode.upper():12} → No model available")


def print_model_registry():
    """Display all registered models."""
    print("\n" + "="*60)
    print("  REGISTERED MODELS")
    print("="*60 + "\n")
    
    for model in MODEL_REGISTRY:
        print(f"• {model.name}")
        print(f"  Type: {model.api_type}")
        print(f"  Strengths: {', '.join(t.value for t in model.strengths)}")
        print(f"  Cost: ${model.cost_per_1k_tokens:.6f}/1k tokens")
        print(f"  Latency: {model.avg_latency_ms}ms")
        print(f"  Quality: {model.quality_score:.2f}")
        print()


def main():
    """Run all tests."""
    print("\n" + "="*60)
    print("  LLM ROUTING SYSTEM - TEST SUITE")
    print("="*60)
    
    try:
        print_model_registry()
        test_task_classification()
        test_model_selection()
        test_routing_with_different_budgets()
        
        print("\n" + "="*60)
        print("  ALL TESTS COMPLETED")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
