# LangGraph Configuration Guide

## Overview
This document explains how LangGraph is configured in the AI Visual Workflow system to orchestrate the agentic AI workflow with state management, conditional routing, and fault tolerance.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [State Management](#state-management)
3. [Graph Construction](#graph-construction)
4. [Node Implementation](#node-implementation)
5. [Conditional Routing](#conditional-routing)
6. [Checkpointing & Persistence](#checkpointing--persistence)
7. [Execution Flow](#execution-flow)

---

## Architecture Overview

### File Location
- **Primary File**: [backend/core/orchestrator.py](backend/core/orchestrator.py) (Lines 3050-3323)

### Core Concept
LangGraph implements a **directed graph** where:
- **Nodes** represent processing steps (intake, planner, rag, tools, synthesizer)
- **Edges** represent transitions between steps
- **State** flows through the graph, accumulating data at each node

### Key Features
- ✅ Type-safe state management with `TypedDict`
- ✅ Conditional routing based on intent classification
- ✅ Fault tolerance with Redis checkpointing
- ✅ Execution logging for observability
- ✅ Fully autonomous execution (no human-in-the-loop gates)

---

## State Management

### AgentState Definition
**Location**: [orchestrator.py#L2647-L2662](backend/core/orchestrator.py#L2647-L2662)

```python
class AgentState(TypedDict):
    """The state object that flows through every node in the graph."""
    run_id: str                     # Unique workflow execution ID
    user_prompt: str                # Original user query
    route: str                      # Execution path: rag_only | mcp_only | hybrid | direct
    plan_reasoning: str             # Intent classification reasoning
    rag_context: str                # Retrieved knowledge base content
    rag_sources: list               # Sources with scores and previews
    tool_results: list              # External tool execution results
    final_response: str             # LLM-generated final answer
    active_model: str               # LLM model used for synthesis
    execution_log: Annotated[list, operator.add]  # Cumulative execution trace
    error: str                      # Error messages (if any)
    interrupt_requested: bool       # Human approval flag (always False - autonomous)
    interrupt_reason: str           # Reason for interrupt (unused)
    human_approved: bool            # Approval status (always True - autonomous)
```

### State Accumulation Pattern
The `execution_log` uses `operator.add` annotation for automatic merging:
```python
execution_log: Annotated[list, operator.add]
```

This ensures each node's log entries are **appended** to the list rather than replaced.

**Example**:
```python
# Node 1 returns:
{"execution_log": [{"node": "intake", "action": "received_prompt"}]}

# Node 2 returns:
{"execution_log": [{"node": "planner", "route": "hybrid"}]}

# Final state has BOTH entries:
{"execution_log": [
    {"node": "intake", "action": "received_prompt"},
    {"node": "planner", "route": "hybrid"}
]}
```

---

## Graph Construction

### Build Process
**Location**: [orchestrator.py#L3067-L3103](backend/core/orchestrator.py#L3067-L3103)

```python
def build_graph(checkpointer: Any = None):
    """Construct and compile the LangGraph directed workflow."""
    builder = StateGraph(AgentState)

    # ── Register Nodes ──
    builder.add_node("intake", intake_node)
    builder.add_node("planner", planner_node)
    builder.add_node("rag", rag_node)
    builder.add_node("tools", tool_node)
    builder.add_node("synthesizer", synthesizer_node)

    # ── Define Edges ──
    builder.add_edge(START, "intake")
    builder.add_edge("intake", "planner")

    # Conditional: planner → rag | tools | synthesizer
    builder.add_conditional_edges(
        "planner",
        route_after_plan,
        {"rag": "rag", "tools": "tools", "synthesizer": "synthesizer"},
    )

    # Conditional: rag → tools (hybrid) | synthesizer (rag_only)
    builder.add_conditional_edges(
        "rag",
        route_after_rag,
        {"tools": "tools", "synthesizer": "synthesizer"},
    )

    # Tools always → synthesizer
    builder.add_edge("tools", "synthesizer")

    # Synthesizer → END
    builder.add_edge("synthesizer", END)

    # Compile graph (fully autonomous - no interrupts)
    compile_kwargs = {}
    if checkpointer:
        compile_kwargs["checkpointer"] = checkpointer
    
    return builder.compile(**compile_kwargs)
```

### Graph Topology Visualization

```
START
  ↓
[Intake Node]
  ↓
[Planner Node] ────→ (Intent Classification)
  ├─ rag_only  → [RAG Node] ───────────→ [Synthesizer]
  ├─ mcp_only  → [Tools Node] ─────────→ [Synthesizer]
  ├─ hybrid    → [RAG Node] → [Tools] → [Synthesizer]
  └─ direct    → [Synthesizer]
                       ↓
                     END
```

### Singleton Pattern
**Location**: [orchestrator.py#L3110-L3120](backend/core/orchestrator.py#L3110-L3120)

The graph is compiled once and reused across all requests:

```python
_graph = None  # Global singleton

def get_graph():
    """Get (or build) the compiled LangGraph workflow."""
    global _graph
    if _graph is None:
        checkpointer = get_checkpointer()
        _graph = build_graph(checkpointer=checkpointer)
    return _graph
```

**Benefits**:
- Fast request handling (no graph recompilation)
- Consistent behavior across requests
- Shared checkpointer for state persistence

---

## Node Implementation

Each node is a Python function that:
1. Receives the current `AgentState`
2. Performs its processing
3. Returns a **partial state update** (only changed fields)

### 1. Intake Node
**Location**: [orchestrator.py#L2670-L2685](backend/core/orchestrator.py#L2670-L2685)

```python
def intake_node(state: AgentState) -> dict:
    """Receive and sanitize the user prompt."""
    prompt = state["user_prompt"].strip()
    _log(f"INTAKE: \"{prompt[:80]}{'...' if len(prompt) > 80 else ''}\"")
    return {
        "user_prompt": prompt,
        "execution_log": [{
            "node": "intake",
            "action": "received_prompt",
            "prompt_length": len(prompt),
            "timestamp": time.time(),
        }],
    }
```

### 2. Planner Node
**Location**: [orchestrator.py#L2826-L2856](backend/core/orchestrator.py#L2826-L2856)

Classifies user intent and selects execution route:

```python
def planner_node(state: AgentState) -> dict:
    """Classify intent and decide the execution route using LLM (regex fallback)."""
    prompt = state["user_prompt"]
    lower = prompt.lower()

    # Quick overrides
    if "rag only" in lower:
        route, reasoning = "rag_only", "Explicit RAG override"
    elif "mcp tools only" in lower:
        route, reasoning = "mcp_only", "Explicit MCP override"
    else:
        # Try LLM-based classification first
        llm_result = _llm_classify_route(prompt)
        if llm_result:
            route, reasoning = llm_result
            reasoning = f"[LLM] {reasoning}"
        else:
            # Regex fallback when LLM unavailable
            route, reasoning = _regex_classify_route(prompt)

    return {
        "route": route,
        "plan_reasoning": reasoning,
        "execution_log": [{
            "node": "planner",
            "route": route,
            "reasoning": reasoning,
            "timestamp": time.time(),
        }],
    }
```

**Routes**:
- `rag_only`: Query internal knowledge base only
- `mcp_only`: Use external tools only (weather, stocks, web search)
- `hybrid`: RAG + Tools combined
- `direct`: LLM-only response (greetings, simple questions)

### 3. RAG Node
**Location**: [orchestrator.py#L2859-L2892](backend/core/orchestrator.py#L2859-L2892)

Retrieves relevant context from the vector database:

```python
def rag_node(state: AgentState) -> dict:
    """Retrieve relevant context from the knowledge base via vector search."""
    query = state["user_prompt"]
    _log(f"RAG: searching for \"{query[:60]}...\"")

    start = time.time()
    results = _rag_engine.search(query, top_k=5)
    elapsed_ms = round((time.time() - start) * 1000, 1)

    sources = []
    context_parts = []
    for r in results:
        chunk = r["chunk"]
        sources.append({
            "source": chunk["source"],
            "score": r["score"],
            "preview": chunk["content"][:120] + "...",
        })
        context_parts.append(f"[Source: {chunk['source']}]\n{chunk['content']}")

    context = "\n\n".join(context_parts) if context_parts else ""
    
    return {
        "rag_context": context,
        "rag_sources": sources,
        "execution_log": [{
            "node": "rag",
            "chunks_found": len(results),
            "search_time_ms": elapsed_ms,
            "top_score": results[0]["score"] if results else 0.0,
            "sources": [s["source"] for s in sources],
            "timestamp": time.time(),
        }],
    }
```

### 4. Tool Node
**Location**: [orchestrator.py#L2895-L2921](backend/core/orchestrator.py#L2895-L2921)

Executes external tool calls (weather, stocks, Wikipedia, etc.):

```python
def tool_node(state: AgentState) -> dict:
    """Execute external tool calls (real API calls) based on user prompt."""
    prompt = state["user_prompt"]
    _log("TOOLS: analyzing prompt for tool calls...")

    start = time.time()
    results = run_tools(prompt)  # Pattern matching + API calls
    elapsed_ms = round((time.time() - start) * 1000, 1)

    _log(f"TOOLS: {len(results)} tool(s) executed in {elapsed_ms}ms")

    return {
        "tool_results": results,
        "execution_log": [{
            "node": "tools",
            "tools_executed": len(results),
            "tool_names": [extract_tool_name(r) for r in results],
            "execution_time_ms": elapsed_ms,
            "timestamp": time.time(),
        }],
    }
```

### 5. Synthesizer Node
**Location**: [orchestrator.py#L2924-L3010](backend/core/orchestrator.py#L2924-L3010)

Combines all context and generates the final response:

```python
def synthesizer_node(state: AgentState) -> dict:
    """Combine RAG context + tool results and produce final response via LLM."""
    prompt = state["user_prompt"]
    rag_context = state.get("rag_context", "")
    tool_results = state.get("tool_results", [])

    # Classify task type for intelligent model routing
    task = classify_task(prompt, rag_context, tool_results)

    # Build enhanced prompt with all collected context
    parts = [prompt]
    if rag_context:
        parts.append(f"\n\n[RETRIEVED KNOWLEDGE (RAG)]\n{rag_context}")
    if tool_results:
        parts.append(f"\n\n[TOOL RESULTS (MCP)]\n" + "\n".join(tool_results))

    enhanced = "\n".join(parts)

    # System prompt for LLM
    system = (
        "You are an intelligent AI agent. Use the provided context and tool data "
        "to answer the user's question directly and professionally. "
        "Cite sources when relevant. Be concise and confident."
    )

    # Try LLM synthesis with task-aware routing
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
            "context_sources": {"rag": bool(rag_context), "tools": len(tool_results)},
            "timestamp": time.time(),
        }],
    }
```

---

## Conditional Routing

### Route After Plan
**Location**: [orchestrator.py#L3019-L3026](backend/core/orchestrator.py#L3019-L3026)

Determines the next node after intent classification:

```python
def route_after_plan(state: AgentState) -> str:
    """Route from planner → rag, tools, or synthesizer."""
    route = state.get("route", "direct")
    if route in ("rag_only", "hybrid"):
        return "rag"          # Retrieve from knowledge base
    elif route == "mcp_only":
        return "tools"        # Execute external tools
    return "synthesizer"      # Direct LLM response
```

### Route After RAG
**Location**: [orchestrator.py#L3029-L3033](backend/core/orchestrator.py#L3029-L3033)

Determines if tools are needed after RAG retrieval:

```python
def route_after_rag(state: AgentState) -> str:
    """After RAG: continue to tools (hybrid) or synthesize (rag_only)."""
    if state.get("route") == "hybrid":
        return "tools"        # RAG + Tools combined
    return "synthesizer"      # RAG only
```

### Flow Examples

**Example 1: Simple Greeting**
```
User: "Hello!"
→ Planner: direct → Synthesizer → END
```

**Example 2: Stock Price Query**
```
User: "What's the AAPL stock price?"
→ Planner: mcp_only → Tools → Synthesizer → END
```

**Example 3: OpenText Product Query**
```
User: "What is OpenText Content Server?"
→ Planner: rag_only → RAG → Synthesizer → END
```

**Example 4: Hybrid Query**
```
User: "What is OpenText and who is the current CEO?"
→ Planner: hybrid → RAG → Tools → Synthesizer → END
```

---

## Checkpointing & Persistence

### Redis State Persistence
**Location**: [orchestrator.py#L127-L200](backend/core/orchestrator.py#L127-L200)

Saves workflow state at each node for fault tolerance and debugging:

```python
class RedisStatePersistence:
    """Persist graph state snapshots in Redis for each workflow run."""

    def __init__(self):
        self.enabled = False
        self.reason = ""
        self.client = None
        self.url = REDIS_URL
        self.key_prefix = REDIS_KEY_PREFIX
        self.ttl_seconds = REDIS_STATE_TTL_SECONDS
        self._connect()

    def save_snapshot(self, run_id: str, stage: str, state: dict):
        """Save a state snapshot to Redis with TTL."""
        if not self.enabled or self.client is None:
            return
        payload = {
            "run_id": run_id,
            "stage": stage,
            "timestamp": time.time(),
            "state": state,
        }
        try:
            encoded = json.dumps(payload, default=str)
            pipe = self.client.pipeline()
            pipe.rpush(self._states_key(run_id), encoded)
            pipe.expire(self._states_key(run_id), self.ttl_seconds)
            pipe.set(self._latest_key(run_id), encoded, ex=self.ttl_seconds)
            pipe.execute()
        except Exception as e:
            _log(f"REDIS persistence write failed: {e}")
```

### Checkpointer Configuration
**Location**: [orchestrator.py#L3105-L3109](backend/core/orchestrator.py#L3105-L3109)

```python
def get_checkpointer():
    """Get or create the checkpointer for interrupt support."""
    global _checkpointer
    if _checkpointer is None and MemorySaver:
        _checkpointer = MemorySaver()  # In-memory state for development
    return _checkpointer
```

**Environment Variables**:
```bash
REDIS_URL=redis://localhost:6379/0          # Redis connection string
REDIS_KEY_PREFIX=aiwf:langgraph              # Key prefix for namespacing
REDIS_STATE_TTL_SECONDS=86400                # 24-hour retention
```

---

## Execution Flow

### Main Entry Point
**Location**: [orchestrator.py#L3123-L3182](backend/core/orchestrator.py#L3123-L3182)

```python
def run_workflow(prompt: str, run_id: str | None = None, enable_interrupts: bool = False) -> dict:
    """
    Run the full agentic workflow for a given prompt.

    Args:
        prompt: The user query to process
        run_id: Optional workflow run identifier
        enable_interrupts: Kept for backward compatibility (ignored - always False)

    Returns:
        Complete final state including response, execution log, model used, etc.
    """
    graph = get_graph()
    request_run_id = run_id or f"run_{uuid.uuid4().hex[:12]}"
    
    initial_state: dict = {
        "run_id": request_run_id,
        "user_prompt": prompt,
        "route": "",
        "plan_reasoning": "",
        "rag_context": "",
        "rag_sources": [],
        "tool_results": [],
        "final_response": "",
        "active_model": "",
        "execution_log": [],
        "error": "",
        "interrupt_requested": False,  # Always False - autonomous
        "interrupt_reason": "",
        "human_approved": True,         # Always True - autonomous
    }

    # Save initial state to Redis (if enabled)
    if _state_store.enabled:
        _state_store.save_snapshot(request_run_id, "initial", dict(initial_state))

    try:
        config = {"configurable": {"thread_id": request_run_id}}
        
        # Execute workflow end-to-end (fully autonomous)
        result = dict(graph.invoke(initial_state, config))

        result["run_id"] = request_run_id
        result["redis_persisted"] = _state_store.enabled
        result["interrupted"] = False  # Never interrupted

        # Save completed state
        if _state_store.enabled:
            _state_store.save_snapshot(request_run_id, "completed", dict(result))
        
        return dict(result)
        
    except Exception as e:
        failure = {
            **initial_state,
            "run_id": request_run_id,
            "redis_persisted": _state_store.enabled,
            "error": str(e),
            "final_response": f"Workflow error: {e}",
        }
        if _state_store.enabled:
            _state_store.save_snapshot(request_run_id, "error", dict(failure))
        return failure
```

### API Integration
**Location**: [backend/api.py#L226-L272](backend/api.py#L226-L272)

FastAPI endpoint exposes the workflow as a REST API:

```python
@app.post("/api/run", response_model=RunResponse)
async def api_run(request: RunRequest):
    """Run the full LangGraph agentic workflow for a prompt."""
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
        run_id=result.get("run_id", ""),
        prompt=result.get("user_prompt", ""),
        route=result.get("route", ""),
        plan_reasoning=result.get("plan_reasoning", ""),
        final_response=result.get("final_response", ""),
        active_model=result.get("active_model", ""),
        redis_persisted=bool(result.get("redis_persisted", False)),
        interrupted=False,
        rag_sources=result.get("rag_sources", []),
        tool_results=result.get("tool_results", []),
        execution_log=result.get("execution_log", []),
        execution_time_s=elapsed,
        error=result.get("error", ""),
    )
```

---

## Key Takeaways

### ✅ What Makes This LangGraph Implementation Production-Ready

1. **Type Safety**: `AgentState` uses `TypedDict` for compile-time validation
2. **Observability**: Every node logs actions to `execution_log`
3. **Fault Tolerance**: Redis checkpointing enables recovery from failures
4. **Intelligent Routing**: Conditional edges dynamically select the optimal path
5. **Autonomous Execution**: No human-in-the-loop gates (system runs fully autonomous)
6. **Modular Design**: Each node is independent and testable
7. **Scalability**: Singleton graph pattern ensures efficient resource usage

### 🔍 Debugging Tips

**View State at Any Point**:
```python
result = run_workflow("What is RAG?")
print(result["execution_log"])  # Trace through all nodes
print(result["route"])           # See which path was taken
print(result["rag_sources"])     # Inspect retrieved documents
print(result["tool_results"])    # See tool call results
```

**Enable Verbose Logging**:
```bash
export VERBOSE=true
python backend/core/orchestrator.py "What is the weather in London?"
```

**Check Graph Structure**:
```python
from backend.core.orchestrator import get_graph
graph = get_graph()
print(graph.get_graph().nodes)
print(graph.get_graph().edges)
```

---

## Next Steps

- **Customize Nodes**: Add new processing steps (e.g., sentiment analysis, entity extraction)
- **Enhanced Routing**: Use LLM-based routing with confidence scores
- **Streaming**: Implement streaming responses for better UX
- **Human-in-the-Loop**: Re-enable interrupts for high-stakes workflows
- **Subgraphs**: Decompose complex nodes into nested subgraphs

---

**📚 Related Documentation**:
- [RAG Pipeline Configuration](RAG_PIPELINE.md)
- [LLM Configuration & Routing](LLM_CONFIGURATION.md)
- [MCP Tools Integration](MCP_TOOLS.md)
- [Overall Architecture](WORKFLOW_ARCHITECTURE.md)
