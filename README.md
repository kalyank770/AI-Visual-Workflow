# Architect Engine: Senior Cloud Architect AI Visualizer

An interactive architectural platform for designing, simulating, and inspecting agentic LLM workflows. The app visualizes the handshake between a workflow orchestrator, reasoning engine, RAG memory, and tool execution (MCP) in a live, animated system map.

## ✨ Current Features
- Interactive SVG workflow map with UI, LG, LLM, RAG, VDB, MCP, and OUT nodes.
- Animated bi-directional traces with payload labels that open a Transaction Inspector.
- Clickable nodes that open a component panel with internal sub-systems and tech stack.
- Real-time routing logic with four paths: direct LLM, RAG-only, MCP-only, and hybrid RAG + MCP.
- Path reasoning history (last 5 runs) with deep routing rationale and quick log jump.
- Telemetry dashboard with grouped execution logs and a trace clear action.
- Pause and resume simulation while preserving animation timing.
- Zoom, pan, reset view, and fullscreen controls for the architecture canvas.
- Dark and light mode toggle.
- Synthesis drawer showing final input and model response.
- AI-driven component insight with internal model primary and Gemini fallback.
- API key detection indicator and active model status badge.
- RAG vector store persistence in browser local storage (cold-start hydration).
- ANN neighbor-graph vector retrieval path (HNSW-style) with keyword hybrid fallback.
- Redis-backed workflow state snapshots with graceful fallback to in-memory execution.
- Human-in-the-loop interrupts: pause before tool execution, approve/reject via API.
- Workflow resume from checkpoint with state persistence (LangGraph checkpointer integration).
- Frontend approval UI with "Require Approval" checkbox and modal for pending workflows.
- **Intelligent LLM routing**: Task-aware model selection with budget/latency optimization (economy/balanced/quality modes).

## 🧭 Architecture Diagram
![Architecture diagram](images/architecture-diagram.png)

## 🧩 Runtime Logic Paths
1. RAG-only: UI -> LG -> RAG -> VDB -> RAG -> LG -> OUT
2. MCP-only: UI -> LG -> MCP -> LG -> OUT
3. Hybrid: UI -> LG -> RAG -> VDB -> RAG -> LG -> MCP -> LG -> OUT
4. Direct LLM: UI -> LG -> LLM -> LG -> OUT

## �️ Human-in-the-Loop Interrupt System

The LangGraph workflow supports human approval before sensitive tool execution:

### Enable Interrupts
To enable interrupts when starting a workflow:
```bash
POST /api/run
{
  "prompt": "What's the weather in Paris?",
  "enable_interrupts": true
}
```

When interrupts are enabled:
1. Workflow runs normally through intake, planner, and RAG nodes
2. Before the tools node executes, the workflow pauses
3. Response includes `"interrupted": true` and run_id for approval tracking
4. Final response shows `[AWAITING HUMAN APPROVAL]` message

### Approve Execution
To approve and resume the interrupted workflow:
```bash
POST /api/approve/{run_id}
{
  "approved": true,
  "reason": "Weather tool is safe to execute"
}
```

### Reject Execution
To reject the interrupted workflow:
```bash
POST /api/approve/{run_id}
{
  "approved": false,
  "reason": "User declined weather API access"
}
```

### State Persistence
- Workflow checkpoints persist in Redis (optional, graceful fallback to in-memory)
- Each node execution saves state snapshot with TTL
- Resume retrieves checkpoint by thread_id (run_id)
- Approved workflows continue from last checkpoint with tools allowed

### Use Cases
- Validate API calls before execution
- Review tool parameters from LLM generation
- Prevent data modification without confirmation
- Audit sensitive operations (database writes, financial transactions)
- Cost control for expensive API calls
## 🤖 Intelligent LLM Routing

The workflow includes production-grade model selection that automatically chooses the optimal LLM based on task type, budget, and latency constraints.

### Task Types
Queries are classified into 7 categories:
- **SUMMARIZE**: Text condensation, bullet points
- **REASON**: Complex multi-step logic
- **CODE**: Programming, technical queries
- **CREATIVE**: Stories, poems, marketing
- **FACTUAL**: Q&A, information retrieval
- **CHAT**: Casual conversation
- **ANALYZE**: Data analysis, predictions

### Budget Modes
Configure via `LLM_BUDGET_MODE` environment variable:

**Economy Mode** (`economy`):
- Prioritizes cost savings (85% reduction vs always-premium)
- Routes simple queries to Gemini Flash (cheap, fast)
- Uses free internal Llama for complex tasks
- Best for: High-volume, non-critical workloads

**Balanced Mode** (`balanced`) [DEFAULT]:
- Optimizes cost vs quality tradeoff
- Routes reasoning/code to Llama 3.3 70B (free, high-quality)
- Routes summarization/chat to Gemini Flash (fast, cheap)
- Best for: Production workloads with mixed task types

**Quality Mode** (`quality`):
- Maximizes output quality regardless of cost
- Always selects highest-quality available model
- Best for: Critical decisions, premium applications

### Configuration
```bash
# Enable intelligent routing (default: true)
LLM_ROUTING_ENABLED=true

# Budget mode: "economy", "balanced", "quality"
LLM_BUDGET_MODE=balanced

# Maximum acceptable latency in milliseconds
LLM_MAX_LATENCY_MS=5000
```

### Routing Examples
- **"Summarize this article"** → Gemini Flash (fast, cheap, good for summarization)
- **"Explain quantum physics causality"** → Llama 3.3 70B (best reasoning)
- **"Write Python function"** → Llama 3.3 70B (strong code capabilities)
- **"Hello!"** → Gemini Flash (simple chat, no need for premium)

See [LLM_ROUTING_SYSTEM.md](LLM_ROUTING_SYSTEM.md) for complete documentation.
## �🛠️ Setup From Scratch (Vite + React + TypeScript)

### 1. Create the project
```bash
mkdir architect-engine
cd architect-engine
npm create vite@latest . -- --template react-ts
npm install
```

### 2. Install dependencies
```bash
npm install @google/generative-ai react-markdown dotenv
```

### 3. Replace or add source files
Copy the files from this repository into the root of the Vite app:
- App.tsx -> src/App.tsx
- types.ts -> src/types.ts
- constants.tsx -> src/constants.tsx
- services/geminiService.ts -> src/services/geminiService.ts
- components/AnimatedFlow.tsx -> src/components/AnimatedFlow.tsx
- index.tsx -> src/index.tsx

### 4. Update index.html for styling and diagrams
Ensure the project root index.html includes these:
- Tailwind CDN script
- Mermaid CDN script
- Inter and JetBrains Mono fonts

This repo already includes those tags in [index.html](index.html).

### 5. Configure environment variables
Create a .env file in the project root. You can use either an internal model key or a Gemini key.
```text
VITE_INTERNAL_API_KEY=your_internal_model_key
VITE_API_KEY=your_gemini_api_key
```

Notes:
- The app tries the internal model first, then falls back to Gemini.
- Accepts multiple key names, including VITE_GEMINI_API_KEY and VITE_GEMINI_API_PRIMARY_KEY.

### 6. Run the app
```bash
npm run dev
```

## 🧪 Technical Details
- Frontend: React 19 + Vite + TypeScript.
- Styling: Tailwind via CDN for rapid prototyping.
- Visual system: Custom SVG renderer with animated traces and internal component flow maps.
- AI services: Internal model gateway (Llama 3.3 70B) with Gemini fallback.
- Simulation: Step metadata drives telemetry logs and payload inspectors.

## 🧰 Troubleshooting
- No AI output: verify at least one of VITE_INTERNAL_API_KEY or VITE_API_KEY is present.
- Keys not detected: restart the dev server after editing .env.
- Blank screen: ensure index.html includes the Tailwind CDN script.
- Slow or no response: internal model times out after 4 seconds and falls back to Gemini.

## ❓ FAQ
- Can I run without API keys? Yes, but AI insights and synthesis will fall back to cached/offline responses.
- Why does the path choose MCP for math? The simulator routes deterministic tasks to tools for accuracy.
- Can I change the node layout? Yes, update node positions in src/components/AnimatedFlow.tsx.
- Can I add more tools? Yes, extend the MCP node details and the tool routing logic in App.tsx.

## 🙌 Credits
- Diagram rendering: Mermaid.
- UI fonts: Inter and JetBrains Mono.
- Icons: Emoji-based node icons.

## 📄 License
- This App is created by Rajeev K.

## 🧠 Prompt to Recreate This App
Use this prompt in any AI model to rebuild a functionally identical app:

```text
Build a Vite + React + TypeScript single-page app named "AI Flow Visualizer" that simulates an agentic workflow. Requirements:

UI/UX
- Full-screen layout with a top header containing: app title, a prompt input, a Run button, Pause/Resume while running, Reset button, and a Dark/Light toggle.
- Main area has an animated SVG architecture canvas (left) and a side panel (right) for component details or path history.
- Bottom panel is a collapsible telemetry dashboard with grouped run logs and a right column of logic pattern cards.
- Provide zoom in/out, reset view, and fullscreen controls on the canvas. Support pan/drag on the canvas.
- Clicking a node opens a detail panel with name, role, tech stack, and internal component details.
- Clicking a moving payload opens a modal "Transaction Inspector" that shows ingress and egress JSON.
- Provide a final synthesis drawer with the final prompt and the model response.

Architecture
- Nodes: UI, LG (orchestrator), LLM, RAG, VDB, MCP, OUT.
- Animated traces for request/response paths between nodes.
- Internal flow maps inside nodes (small sub-nodes with arrows) for each component.

Simulation Logic
- On Run, determine the path based on prompt content:
  - "rag only" forces RAG path.
  - "mcp tools only" forces MCP path.
  - Math/unit conversions or realtime keywords route to MCP.
  - Simple greetings route to direct LLM.
  - Otherwise default to hybrid RAG + MCP.
- Step through the path on a timer, emitting telemetry logs with labels, timestamps, and input/output payloads.
- Provide Pause/Resume that freezes animation timing.

AI Integration
- Create a service that calls an internal chat endpoint first (Llama 3.3 70B) with a 4s timeout and falls back to Gemini models if it fails.
- Use environment variables VITE_INTERNAL_API_KEY and VITE_API_KEY (also accept VITE_GEMINI_API_KEY and VITE_GEMINI_API_PRIMARY_KEY).
- Provide a function to fetch node insight from the AI and show it in the component panel.

Tech
- Use Tailwind via CDN in index.html.
- Use Mermaid CDN script in index.html for documentation diagrams.
- Use React hooks only (no state libraries).
- File layout: src/App.tsx, src/components/AnimatedFlow.tsx, src/services/geminiService.ts, src/constants.tsx, src/types.ts, src/index.tsx.
```
