# Human-in-the-Loop Interrupt System

## Overview
The AI Visual Workflow now includes a production-ready human-in-the-loop interrupt system that pauses workflow execution before sensitive tool operations, requiring explicit user approval to proceed.

## Architecture

### Components
1. **AgentState Fields** (langgraph_workflow.py):
   - `interrupt_requested`: Boolean flag indicating interrupt is enabled
   - `interrupt_reason`: Human-readable explanation for why interrupt was triggered
   - `human_approved`: Boolean flag indicating approval status

2. **Tool Node Guard** (langgraph_workflow.py):
   - Checks `interrupt_requested` and `human_approved` state before tool execution
   - Returns early with "awaiting_approval" log entry if not approved
   - Proceeds with normal tool execution if approved

3. **LangGraph Checkpointer Integration**:
   - Graph compiled with `interrupt_before=["tools"]` parameter
   - MemorySaver/Redis checkpointer saves state at each node
   - State persists with thread_id (run_id) for resume capability

4. **API Endpoints** (langgraph_api.py):
   - `POST /api/run` with `enable_interrupts: true` to trigger interrupts
   - `POST /api/approve/{run_id}` to approve/reject and resume workflows
   - Response includes `interrupted: boolean` status field

## Usage Flow

### 1. Start Workflow with Interrupts
```bash
curl -X POST http://localhost:5001/api/run \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is the weather in Paris?",
    "enable_interrupts": true
  }'
```

Response:
```json
{
  "run_id": "run_abc123def456",
  "interrupted": true,
  "final_response": "[AWAITING HUMAN APPROVAL] Workflow paused before tool execution.",
  "route": "mcp_only",
  "redis_persisted": true,
  ...
}
```

### 2. Review Tool Parameters
Inspect the execution_log to see what tools would be executed:
```json
{
  "execution_log": [
    {"node": "intake", "cleaned_prompt": "What is the weather in Paris?"},
    {"node": "planner", "route": "mcp_only", "reasoning": "Real-time weather data required"},
    {"node": "tools", "status": "awaiting_approval", "pending_tools": ["weather_api"]}
  ]
}
```

### 3a. Approve and Resume
```bash
curl -X POST http://localhost:5001/api/approve/run_abc123def456 \
  -H "Content-Type: application/json" \
  -d '{
    "approved": true,
    "reason": "Weather tool is safe to execute"
  }'
```

Response:
```json
{
  "run_id": "run_abc123def456",
  "status": "resumed",
  "message": "Workflow approved and resumed successfully",
  "result": {
    "final_response": "The weather in Paris is currently 15°C...",
    "tool_results": [{"tool": "weather_api", "result": {"temp": 15, "condition": "cloudy"}}],
    "status": "completed_after_approval"
  }
}
```

### 3b. Reject Execution
```bash
curl -X POST http://localhost:5001/api/approve/run_abc123def456 \
  -H "Content-Type: application/json" \
  -d '{
    "approved": false,
    "reason": "User declined weather API access"
  }'
```

Response:
```json
{
  "run_id": "run_abc123def456",
  "status": "rejected",
  "message": "Workflow rejected: User declined weather API access",
  "result": {
    "final_response": "[REJECTED] User declined weather API access",
    "error": "User declined"
  }
}
```

## State Persistence

### Redis (Optional)
When Redis is available (REDIS_URL environment variable set):
- State snapshots saved at every node execution
- Checkpoints persist with 24-hour TTL
- Resume retrieves state by thread_id (run_id)

### In-Memory Fallback
When Redis is not available:
- LangGraph MemorySaver provides in-memory checkpoints
- Survives within single API server process
- Lost if server restarts (not production-grade persistence)

### Checkpoint Structure
```python
{
  "thread_id": "run_abc123def456",
  "checkpoint_id": "tools",
  "state": {
    "run_id": "run_abc123def456",
    "user_prompt": "What is the weather in Paris?",
    "route": "mcp_only",
    "interrupt_requested": true,
    "human_approved": false,
    "rag_context": "",
    "tool_results": [],
    "execution_log": [...]
  }
}
```

## Implementation Details

### Tool Node Guard Logic
```python
def tool_node(state: AgentState) -> AgentState:
    # Check interrupt status before tool execution
    if state.get("interrupt_requested") and not state.get("human_approved"):
        _log("⏸ tools", "Workflow paused - awaiting human approval")
        return {
            "execution_log": [
                {
                    "node": "tools",
                    "status": "awaiting_approval",
                    "reason": state.get("interrupt_reason", "Human approval required"),
                    "timestamp": time.time(),
                }
            ]
        }
    
    # Normal tool execution path
    prompt = state.get("user_prompt", "")
    tool_output = run_tools(prompt)
    # ... handle tool results
```

### Resume Workflow Function
```python
def resume_workflow(run_id: str, approved: bool, reason: str | None = None) -> dict:
    graph = get_graph()
    checkpointer = get_checkpointer()
    
    # Get state from checkpoint
    config = {"configurable": {"thread_id": run_id}}
    state = graph.get_state(config)
    current_state = dict(state.values)
    
    # Update approval status
    current_state["human_approved"] = approved
    
    if not approved:
        # Mark as rejected
        current_state["final_response"] = f"[REJECTED] {reason}"
        return current_state
    
    # Resume execution from checkpoint
    graph.update_state(config, current_state)
    result_state = dict(current_state)
    
    for update in graph.stream(None, config, stream_mode="updates"):
        # Process remaining nodes
        _merge_state(result_state, delta)
    
    return result_state
```

## Use Cases

### 1. API Call Validation
Before executing weather, stock, or search APIs:
- Review generated parameters
- Check API rate limits
- Validate cost implications
- Confirm data source appropriateness

### 2. Data Modification
Before database writes, file operations, or external system updates:
- Inspect SQL query safety
- Verify file paths
- Confirm deletion targets
- Audit permission requirements

### 3. Financial Transactions
Before payment processing or account modifications:
- Review transaction amounts
- Validate recipient addresses
- Confirm authorization scope
- Comply with regulatory requirements

### 4. Cost Control
Before expensive operations:
- Estimate LLM token usage
- Calculate API call costs
- Review bulk operation scope
- Prevent runaway spending

### 5. Security Audit
Before privileged operations:
- Verify identity/authorization
- Log security-critical actions
- Enforce multi-factor approval
- Maintain compliance audit trail

## Configuration

### Environment Variables
```bash
# Optional Redis for production-grade persistence
REDIS_URL=redis://localhost:6379/0

# LLM API keys
VITE_INTERNAL_API_KEY=your_internal_model_key
VITE_GEMINI_API_KEY=your_gemini_key
```

### Frontend Integration
To enable interrupts from the frontend (App.tsx):
```typescript
const response = await fetch('/api/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: userPrompt,
    enable_interrupts: true,  // Enable human approval
  }),
});

const result = await response.json();

if (result.interrupted) {
  // Show approval UI
  const approval = await showApprovalDialog(result);
  
  if (approval.approved) {
    // Resume workflow
    const resumeResponse = await fetch(`/api/approve/${result.run_id}`, {
      method: 'POST',
      body: JSON.stringify({
        approved: true,
        reason: approval.reason,
      }),
    });
    // Display final result
  } else {
    // Handle rejection
  }
}
```

## Benefits

### Security
- Prevents unauthorized tool execution
- Enforces explicit approval for sensitive operations
- Provides audit trail of human decisions
- Mitigates LLM prompt injection risks

### Transparency
- Shows exactly what tools will execute
- Explains reasoning for tool selection
- Exposes LLM-generated parameters before use
- Builds user trust through visibility

### Control
- User maintains final decision authority
- Can reject specific tool calls while allowing others
- Prevents runaway agentic behavior
- Enables graceful workflow cancellation

### Compliance
- Satisfies regulatory requirements for human oversight
- Provides audit logs for security reviews
- Enables multi-party approval workflows
- Supports SOC2/ISO27001 controls

## Testing

### Unit Tests
```python
def test_interrupt_blocks_tool_execution():
    state = {
        "interrupt_requested": True,
        "human_approved": False,
        "user_prompt": "test",
    }
    result = tool_node(state)
    assert result["execution_log"][0]["status"] == "awaiting_approval"

def test_approval_allows_tool_execution():
    state = {
        "interrupt_requested": True,
        "human_approved": True,
        "user_prompt": "test",
    }
    result = tool_node(state)
    assert "tool_results" in result
```

### Integration Tests
```bash
# Start workflow with interrupt
run_id=$(curl -s -X POST http://localhost:5001/api/run \
  -d '{"prompt":"test","enable_interrupts":true}' \
  | jq -r '.run_id')

# Verify interrupted
curl -s http://localhost:5001/api/run | grep "AWAITING"

# Approve and verify completion
curl -s -X POST http://localhost:5001/api/approve/$run_id \
  -d '{"approved":true}' \
  | jq '.result.final_response'
```

## Future Enhancements

### Multi-Tool Approval
- Allow per-tool approval granularity
- Support parallel tool execution with batch approval
- Enable tool-specific risk policies

### Approval Workflows
- Multi-user approval chains (manager + security team)
- Role-based approval requirements
- Time-based auto-approval for low-risk operations

### Risk Scoring
- Classify tools by risk level (read-only, write, privileged)
- Auto-approve low-risk tools, require approval for high-risk
- Machine learning risk prediction based on parameters

### Audit Dashboard
- Web UI showing pending approvals
- Historical approval decisions
- Tool execution success/failure rates
- Cost tracking per approval decision

## References

- [LangGraph Interrupts Documentation](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/)
- [BaseCheckpointSaver API](https://langchain-ai.github.io/langgraph/reference/checkpoints/)
- [Agent State Management](https://langchain-ai.github.io/langgraph/concepts/state/)
