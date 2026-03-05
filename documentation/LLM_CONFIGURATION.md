# LLM Configuration & Routing Guide

## Overview
This document explains how Large Language Models (LLMs) are configured, routed, and integrated into the AI Visual Workflow system with intelligent model selection, multi-provider support, and graceful fallbacks.

---

## Table of Contents
1. [LLM Architecture](#llm-architecture)
2. [Model Registry](#model-registry)
3. [Intelligent Routing System](#intelligent-routing-system)
4. [Task Classification](#task-classification)
5. [Provider Integration](#provider-integration)
6. [Intent Classification](#intent-classification)
7. [Configuration & Environment Variables](#configuration--environment-variables)

---

## LLM Architecture

### Multi-LLM Strategy

```
┌────────────────────────────────────────────────────────┐
│              LLM Routing Architecture                   │
└────────────────────────────────────────────────────────┘

1. TASK CLASSIFICATION
   ├─ Analyze prompt content
   ├─ Detect task type (summarize, reason, code, etc.)
   └─ Estimate prompt token length

2. MODEL SELECTION
   ├─ Check available API keys
   ├─ Filter by latency constraints
   ├─ Score models by:
   │   ├─ Task fit (strengths)
   │   ├─ Quality score
   │   ├─ Cost per token
   │   └─ Budget mode (economy/balanced/quality)
   └─ Select highest-scoring model

3. LLM CALL
   ├─ Try selected model
   ├─ If fails → cascade fallback:
   │   ├─ Internal Llama 3.3 70B
   │   ├─ Gemini 2.5 Flash
   │   ├─ Gemini 1.5 Flash
   │   └─ Template response (offline)
   └─ Return (response, model_name)

4. SYNTHESIS
   ├─ System prompt injection
   ├─ Context assembly (RAG + Tools)
   ├─ LLM generation
   └─ Response formatting
```

### File Locations

| Component | File | Lines |
|-----------|------|-------|
| **Task Classification** | [orchestrator.py](backend/core/orchestrator.py#L1848-L1875) | 1848-1875 |
| **Model Registry** | [orchestrator.py](backend/core/orchestrator.py#L1878-L1947) | 1878-1947 |
| **Model Selection** | [orchestrator.py](backend/core/orchestrator.py#L1950-L2048) | 1950-2048 |
| **LLM Caller** | [orchestrator.py](backend/core/orchestrator.py#L2055-L2119) | 2055-2119 |
| **Internal Llama** | [orchestrator.py](backend/core/orchestrator.py#L2122-L2152) | 2122-2152 |
| **Gemini API** | [orchestrator.py](backend/core/orchestrator.py#L2155-L2211) | 2155-2211 |
| **Intent Classification** | [orchestrator.py](backend/core/orchestrator.py#L2014-L2083) | 2014-2083 |

---

## Model Registry

### ModelProfile Class
**Location**: [orchestrator.py#L1841-L1872](backend/core/orchestrator.py#L1841-L1872)

Defines model capabilities and performance characteristics:

```python
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
        self.strengths = strengths              # Best-fit task types
        self.cost_per_1k_tokens = cost_per_1k_tokens
        self.avg_latency_ms = avg_latency_ms    # Average response time
        self.max_tokens = max_tokens            # Context window size
        self.quality_score = quality_score      # Relative quality (0.0-1.0)
```

### Registered Models
**Location**: [orchestrator.py#L1878-L1916](backend/core/orchestrator.py#L1878-L1916)

```python
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
```

### Model Comparison Table

| Model | Provider | Strengths | Latency | Cost | Quality | Context |
|-------|----------|-----------|---------|------|---------|---------|
| **Llama 3.3 70B** | Internal | Reasoning, Code, Analysis | 2500ms | Free | 0.95 | 8K |
| **Gemini 2.5 Flash** | Google | Summarize, Factual, Chat | 800ms | $0.00005/1K | 0.75 | 8K |
| **Gemini 1.5 Flash** | Google | Summarize, Factual, Chat | 900ms | $0.00005/1K | 0.70 | 8K |

---

## Intelligent Routing System

### Task Classification
**Location**: [orchestrator.py#L1848-L1875](backend/core/orchestrator.py#L1848-L1875)

```python
class TaskType(str, Enum):
    """Task classification for intelligent model routing."""
    SUMMARIZE = "summarize"  # Condensing long text, bullet points
    REASON = "reason"        # Complex reasoning, multi-step logic
    CODE = "code"            # Programming, technical queries
    CREATIVE = "creative"    # Stories, poems, marketing copy
    FACTUAL = "factual"      # Q&A, information retrieval
    CHAT = "chat"            # Casual conversation, greetings
    ANALYZE = "analyze"      # Data analysis, comparisons


def classify_task(prompt: str, rag_context: str = "", tool_results: list = None) -> TaskType:
    """
    Classify the task type based on prompt content and context.
    Uses heuristics to determine the most appropriate task category.
    """
    prompt_lower = prompt.lower()
    tool_results = tool_results or []
    
    # Code/Technical queries
    if any(kw in prompt_lower for kw in ("code", "function", "program", "script", 
                                          "api", "syntax", "debug", "error")):
        return TaskType.CODE
    
    # Reasoning/Analysis with tools
    if tool_results and any(kw in prompt_lower for kw in ("predict", "forecast", 
                                                          "analyze", "compare")):
        return TaskType.ANALYZE
    
    # Summarization
    if any(kw in prompt_lower for kw in ("summar", "brief", "tldr", "bullet", 
                                          "key points", "overview")):
        return TaskType.SUMMARIZE
    
    # Creative writing
    if any(kw in prompt_lower for kw in ("write a story", "poem", "creative", 
                                          "imagine", "marketing copy")):
        return TaskType.CREATIVE
    
    # Complex reasoning
    if any(kw in prompt_lower for kw in ("why", "how would", "explain", "reasoning", 
                                          "logic")) and len(prompt.split()) > 15:
        return TaskType.REASON
    
    # Simple chat/greetings
    if any(kw in prompt_lower for kw in ("hello", "hi", "hey", "thanks", 
                                          "bye")) and len(prompt.split()) < 10:
        return TaskType.CHAT
    
    # Default: Factual Q&A
    return TaskType.FACTUAL
```

**Examples**:
```python
classify_task("Write a Python function")          → TaskType.CODE
classify_task("What is the AAPL stock forecast?") → TaskType.ANALYZE
classify_task("Summarize this document")          → TaskType.SUMMARIZE
classify_task("Hello!")                           → TaskType.CHAT
classify_task("What is RAG?")                     → TaskType.FACTUAL
```

### Model Selection
**Location**: [orchestrator.py#L1950-L2048](backend/core/orchestrator.py#L1950-L2048)

Selects the best model based on task type, budget, and latency:

```python
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
        prompt_length: Estimated token count
        budget_mode: "economy" (cheapest), "balanced" (cost vs quality), "quality" (best)
        max_latency_ms: Maximum acceptable latency
    
    Returns:
        Selected ModelProfile or None if no suitable model found
    """
    # 1. Filter models by API key availability
    available_models = []
    
    internal_key = os.environ.get("INTERNAL_API_KEY") or os.environ.get("VITE_INTERNAL_API_KEY", "")
    if internal_key:
        available_models.extend([m for m in MODEL_REGISTRY if m.api_type == "internal"])
    
    gemini_key = (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("VITE_GEMINI_API_KEY")
        or os.environ.get("VITE_API_KEY", "")
    )
    if gemini_key:
        available_models.extend([m for m in MODEL_REGISTRY if m.api_type == "gemini"])
    
    if not available_models:
        return None
    
    # 2. Filter by latency constraint
    available_models = [m for m in available_models if m.avg_latency_ms <= max_latency_ms]
    
    # 3. Filter by token capacity
    available_models = [m for m in available_models if m.max_tokens >= prompt_length]
    
    if not available_models:
        return None
    
    # 4. Score models
    def score_model(model: ModelProfile) -> float:
        score = 0.0
        
        # Task strength bonus (+50 points)
        if task in model.strengths:
            score += 50.0
        
        # Quality factor (+30 points)
        score += model.quality_score * 30.0
        
        # Budget mode scoring
        if budget_mode == "economy":
            # Prioritize cost (inverted: lower cost = higher score)
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
        
        # Latency penalty (faster is better, +20 points)
        max_latency = max(m.avg_latency_ms for m in available_models)
        if max_latency > 0:
            latency_factor = 1.0 - (model.avg_latency_ms / max_latency)
            score += latency_factor * 20.0
        
        return score
    
    # 5. Rank models by score
    ranked = sorted(available_models, key=score_model, reverse=True)
    selected = ranked[0]
    
    _log(
        f"MODEL SELECTION: {selected.name} | Task: {task.value} | "
        f"Budget: {budget_mode} | Score: {score_model(selected):.1f}"
    )
    
    return selected
```

### Scoring Example

**Query**: "What is the AAPL stock forecast for next quarter?"

**Task Classification**: `ANALYZE`

**Available Models**:
1. Llama 3.3 70B (Internal) — strengths: [REASON, CODE, ANALYZE]
2. Gemini 2.5 Flash — strengths: [SUMMARIZE, FACTUAL, CHAT]

**Scoring** (Budget Mode: `balanced`):

```
Llama 3.3 70B:
  + Task fit: 50 (ANALYZE is a strength)
  + Quality: 0.95 × 30 = 28.5
  + Cost: Free → 25.0
  + Quality bonus: 0.95 × 25 = 23.75
  + Latency: (1 - 2500/2500) × 20 = 0
  = Total: 127.25

Gemini 2.5 Flash:
  + Task fit: 0 (ANALYZE not a strength)
  + Quality: 0.75 × 30 = 22.5
  + Cost: (1 - 0.00005/0.00005) × 25 = 0
  + Quality bonus: 0.75 × 25 = 18.75
  + Latency: (1 - 800/2500) × 20 = 13.6
  = Total: 54.85
```

**Selected**: Llama 3.3 70B (127.25 > 54.85)

---

## Provider Integration

### Main LLM Caller
**Location**: [orchestrator.py#L2055-L2119](backend/core/orchestrator.py#L2055-L2119)

```python
def call_llm(
    messages: list[dict[str, str]],
    system_prompt: str | None = None,
    task_type: TaskType = TaskType.FACTUAL,
) -> tuple[str, str]:
    """
    Call an LLM with intelligent model routing.
    
    If LLM_ROUTING_ENABLED=true, selects optimal model based on:
    - Task type (summarize, reason, code, etc.)
    - Budget mode (economy, balanced, quality)
    - Latency constraints
    - Available API keys
    
    Falls back to simple cascade if routing disabled or no suitable model.
    
    Returns:
        (response_text, model_name) or ("", "none") if no LLM available
    """
    # Estimate prompt tokens
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
    
    # 3. No LLM available → template fallback
    return "", "none"
```

### Internal Llama 3.3 70B
**Location**: [orchestrator.py#L2122-L2152](backend/core/orchestrator.py#L2122-L2152)

```python
def _call_internal_llm(
    messages: list[dict[str, str]],
    system_prompt: str | None = None,
) -> tuple[str, str] | None:
    """Call internal Llama endpoint. Returns (text, model_name) or None."""
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
```

**Endpoint**: OpenAI-compatible chat completions API

**Configuration**:
```python
INTERNAL_MODEL_ENDPOINT = os.environ.get(
    "INTERNAL_MODEL_ENDPOINT",
    "https://model-broker.aviator-model.bp.anthos.otxlab.net/v1/chat/completions",
)
INTERNAL_MODEL_NAME = os.environ.get("INTERNAL_MODEL_NAME", "llama-3.3-70b")
LLM_TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "8"))  # seconds
```

### Gemini API
**Location**: [orchestrator.py#L2155-L2211](backend/core/orchestrator.py#L2155-L2211)

```python
def _call_gemini_llm(
    messages: list[dict[str, str]],
    system_prompt: str | None = None,
    model_id: str = "gemini-2.5-flash",
) -> tuple[str, str] | None:
    """Call Gemini API. Returns (text, model_name) or None."""
    gemini_key = (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("VITE_GEMINI_API_KEY")
        or os.environ.get("VITE_API_KEY", "")
    )
    if not gemini_key:
        return None
    
    try:
        # Convert messages to Gemini format
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
        
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_id}:generateContent?key={gemini_key}"
        )
        
        resp = httpx.post(url, json=body, timeout=LLM_TIMEOUT)
        
        if resp.status_code == 200:
            data = resp.json()
            text = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            if text:
                _log(f"LLM response via {model_id}")
                return text, model_id
    except Exception as e:
        _log(f"Gemini LLM ({model_id}) failed: {e}")
    
    return None
```

**Endpoint**: Google Generative AI API

**Supported Models**:
- `gemini-2.5-flash`: Latest, fastest
- `gemini-1.5-flash`: Fallback
- `gemini-1.5-pro`: Higher quality (can be added to registry)

---

## Intent Classification

### LLM-Based Classification
**Location**: [orchestrator.py#L2014-L2088](backend/core/orchestrator.py#L2014-L2088)

Uses an LLM to classify user intent and select the execution route:

```python
def _llm_classify_route(prompt: str) -> tuple[str, str] | None:
    """
    Use LLM to classify the user's intent and select the optimal route.
    
    Returns:
        (route, reasoning) tuple or None if LLM unavailable
    """
    if not _llm_keys_available():
        return None
    
    classification_prompt = f"""Classify this user query into ONE of these routes:
- "rag_only": Query about internal documentation, policies, products, or technical architecture
- "mcp_only": Query needing external tools, real-time data (weather, stock prices, etc.)
- "hybrid": Query combining internal knowledge AND real-time data
- "direct": Simple greetings, acknowledgments, or general conversation

IMPORTANT RULES:
- ALWAYS prefer "mcp_only" for real-world entities (stocks, weather, current events)
- Use "hybrid" for queries like "What is OpenText and who is the CEO?"
- Use "rag_only" ONLY for pure technical/documentation queries

User query: "{prompt}"

Respond with ONLY the route name (rag_only/mcp_only/hybrid/direct) followed by a brief reason.
Format: ROUTE: <route>
REASON: <reasoning>"""
    
    # Use fast Gemini model for classification (low-cost, high-speed)
    response, model = call_llm(
        [{"role": "user", "content": classification_prompt}],
        task_type=TaskType.CHAT,
    )
    
    if not response:
        return None
    
    # Parse response
    route_match = re.search(r"ROUTE:\s*(\w+)", response, re.IGNORECASE)
    reason_match = re.search(r"REASON:\s*(.+?)(?:\n|$)", response, re.IGNORECASE | re.DOTALL)
    
    if route_match:
        route = route_match.group(1).strip().lower()
        reasoning = reason_match.group(1).strip() if reason_match else "LLM classified intent"
        
        # Validate route
        if route in ("rag_only", "mcp_only", "hybrid", "direct"):
            return route, reasoning
    
    return None
```

**Example**:
```
Input: "What is the current stock price of Apple?"

LLM Response:
ROUTE: mcp_only
REASON: Query requires real-time stock data from external APIs.

Output: ("mcp_only", "Query requires real-time stock data from external APIs.")
```

### Regex Fallback Classification
**Location**: [orchestrator.py#L2688-L2814](backend/core/orchestrator.py#L2688-L2814)

When LLM is unavailable, uses pattern matching:

```python
def _regex_classify_route(prompt: str) -> tuple[str, str]:
    """Regex-based fallback for intent classification."""
    lower = prompt.lower()

    # Time-sensitive queries (highest priority)
    has_time_sensitive = bool(
        re.search(r"\b(current|latest|recent|live|today|now)\b", lower)
    )

    # OpenText queries
    is_opentext_product = bool(
        re.search(r"\b(content\s+server|documentum|fortify|aviator)\b", lower)
    )
    
    # Real-time data needs
    needs_realtime = bool(
        re.search(r"\b(weather|stock|price|currency|live)\b", lower)
    )
    
    # Classification logic
    if any(lower.startswith(g) for g in ("hello", "hi ", "hey")):
        return "direct", "[regex] Simple greeting"
    
    if needs_realtime:
        return "mcp_only", "[regex] Real-time data query"
    
    if is_opentext_product and not has_time_sensitive:
        return "rag_only", "[regex] OpenText product query"
    
    if is_opentext_product and has_time_sensitive:
        return "hybrid", "[regex] OpenText + current info"
    
    return "direct", "[regex] General question"
```

### Route Decision Flow

```
┌─────────────────────────────────────┐
│       Planner Node Execution         │
└─────────────────────────────────────┘
              ↓
    ┌─────────────────────┐
    │ Check for Overrides │
    │ "rag only" in query?│
    └─────────┬───────────┘
              ↓ No
    ┌─────────────────────┐
    │  Try LLM-Based      │
    │  Classification     │
    └─────────┬───────────┘
              ↓ Success
    ┌─────────────────────┐
    │ Return (route,      │
    │        reasoning)   │
    └─────────────────────┘
              ↓ Fail
    ┌─────────────────────┐
    │ Fallback to Regex   │
    │ Pattern Matching    │
    └─────────┬───────────┘
              ↓
    ┌─────────────────────┐
    │ Return (route,      │
    │        reasoning)   │
    └─────────────────────┘
```

---

## Configuration & Environment Variables

### LLM Routing Settings

```bash
# Enable intelligent routing (default: true)
LLM_ROUTING_ENABLED=true

# Budget mode: economy | balanced | quality (default: balanced)
LLM_BUDGET_MODE=balanced

# Maximum acceptable latency in milliseconds (default: 5000)
LLM_MAX_LATENCY_MS=5000
```

### Internal Llama Configuration

```bash
# Endpoint URL (OpenAI-compatible chat completions API)
INTERNAL_MODEL_ENDPOINT=https://model-broker.aviator-model.bp.anthos.otxlab.net/v1/chat/completions

# Model ID
INTERNAL_MODEL_NAME=llama-3.3-70b

# API key (required for internal LLM)
INTERNAL_API_KEY=your_internal_api_key_here
# OR
VITE_INTERNAL_API_KEY=your_internal_api_key_here

# Request timeout (seconds)
LLM_TIMEOUT=8
```

### Gemini Configuration

```bash
# Gemini API key (get from https://makersuite.google.com/app/apikey)
GEMINI_API_KEY=your_gemini_api_key_here
# OR (frontend compatibility)
VITE_GEMINI_API_KEY=your_gemini_api_key_here
VITE_API_KEY=your_gemini_api_key_here
```

### Timeout Configuration

```bash
# LLM request timeout (seconds)
LLM_TIMEOUT=8

# External HTTP requests timeout (seconds)
HTTP_TIMEOUT=10
```

### Debugging

```bash
# Enable verbose logging
VERBOSE=true
```

---

## Usage Examples

### Basic LLM Call

```python
from backend.core.orchestrator import call_llm, TaskType

# Simple question
response, model = call_llm(
    messages=[{"role": "user", "content": "What is RAG?"}],
    task_type=TaskType.FACTUAL,
)

print(f"Model: {model}")
print(f"Response: {response}")
```

### With System Prompt

```python
system = "You are a helpful AI assistant specializing in AI/ML topics."

response, model = call_llm(
    messages=[{"role": "user", "content": "Explain embeddings"}],
    system_prompt=system,
    task_type=TaskType.REASON,
)
```

### Multi-Turn Conversation

```python
conversation = [
    {"role": "user", "content": "What is OpenText?"},
    {"role": "assistant", "content": "OpenText is an enterprise software company..."},
    {"role": "user", "content": "What products do they offer?"},
]

response, model = call_llm(
    messages=conversation,
    task_type=TaskType.FACTUAL,
)
```

### Integration in Synthesizer Node

**Location**: [orchestrator.py#L2924-L3010](backend/core/orchestrator.py#L2924-L3010)

```python
def synthesizer_node(state: AgentState) -> dict:
    """Combine RAG context + tool results and produce final response via LLM."""
    prompt = state["user_prompt"]
    rag_context = state.get("rag_context", "")
    tool_results = state.get("tool_results", [])

    # Classify task type for intelligent model routing
    task = classify_task(prompt, rag_context, tool_results)

    # Build enhanced prompt
    parts = [prompt]
    if rag_context:
        parts.append(f"\n\n[RETRIEVED KNOWLEDGE (RAG)]\n{rag_context}")
    if tool_results:
        parts.append(f"\n\n[TOOL RESULTS (MCP)]\n" + "\n".join(tool_results))

    enhanced = "\n".join(parts)

    system = (
        "You are an intelligent AI agent. Use the provided context and tool data "
        "to answer the user's question directly and professionally."
    )

    # Call LLM with task-aware routing
    response, model = call_llm(
        [{"role": "user", "content": enhanced}],
        system_prompt=system,
        task_type=task,
    )

    # Template fallback if LLM unavailable
    if not response:
        model = "template (offline)"
        response = generate_template_response(state)

    return {
        "final_response": response,
        "active_model": model,
        "execution_log": [{
            "node": "synthesizer",
            "model": model,
            "response_length": len(response),
            "timestamp": time.time(),
        }],
    }
```

---

## Key Takeaways

### ✅ Production-Ready Features

1. **Multi-Provider Support**: Internal Llama + Gemini with automatic fallback
2. **Intelligent Routing**: Task-aware model selection (code → Llama, chat → Gemini)
3. **Budget Control**: Economy/Balanced/Quality modes for cost optimization
4. **Graceful Degradation**: LLM → Regex → Template fallback chain
5. **Performance Optimization**: Low-latency models for simple tasks
6. **Intent Classification**: LLM-based routing with regex fallback

### 🎯 When to Use Each Model

| Task Type | Best Model | Reason |
|-----------|------------|--------|
| Complex reasoning | Llama 3.3 70B | High quality, designed for reasoning |
| Code generation | Llama 3.3 70B | Strong code understanding |
| Stock analysis | Llama 3.3 70B | Better at interpreting numeric data |
| Simple Q&A | Gemini Flash | Fast, cheap, good enough |
| Greetings | Gemini Flash | Minimal latency matters |
| Summarization | Gemini Flash | Optimized for concise outputs |

### 📊 Cost Optimization

**Scenario**: 1000 queries/day, average 500 tokens/query

**All Llama**: Free (internal)
**All Gemini**: 1000 × 500 tokens = 500K tokens/day × $0.00005 = **$0.025/day** = $9/year

**Hybrid (Intelligent Routing)**:
- 300 complex queries → Llama (free)
- 700 simple queries → Gemini ($0.0175/day)
- **Total: $6.40/year**

### 🔍 Debugging Tips

**Check Model Selection**:
```python
from backend.core.orchestrator import select_model, TaskType, estimate_tokens

task = TaskType.ANALYZE
prompt_tokens = estimate_tokens("What is the AAPL stock forecast?")
model = select_model(task, prompt_tokens, budget_mode="balanced")

print(f"Selected: {model.name}")
print(f"Latency: {model.avg_latency_ms}ms")
print(f"Cost: ${model.cost_per_1k_tokens}/1K tokens")
```

**Test Intent Classification**:
```python
from backend.core.orchestrator import _llm_classify_route, _regex_classify_route

prompt = "What is the weather in London?"

# LLM-based
llm_result = _llm_classify_route(prompt)
print(f"LLM: {llm_result}")

# Regex fallback
regex_result = _regex_classify_route(prompt)
print(f"Regex: {regex_result}")
```

---

## Next Steps

- **Add More Models**: GPT-4, Claude, Mixtral to MODEL_REGISTRY
- **Fine-Tune Classification**: Use embeddings for better task detection
- **Cost Tracking**: Log token usage per model for analytics
- **A/B Testing**: Compare model performance on real queries
- **Streaming**: Implement token-level streaming for better UX

---

**📚 Related Documentation**:
- [LangGraph Configuration](LANGGRAPH_CONFIGURATION.md)
- [RAG Pipeline Configuration](RAG_PIPELINE.md)
- [MCP Tools Integration](MCP_TOOLS.md)
- [Overall Architecture](WORKFLOW_ARCHITECTURE.md)
