# Architect Engine: Senior Cloud Architect AI Visualizer

An interactive architectural platform for designing, simulating, and inspecting agentic LLM workflows. This system visualizes the complex handshake between orchestration hubs (LangGraph), reasoning engines (LLMs), internal knowledge (RAG), and external capabilities (MCP).

## 🚀 Local Deployment Guide (Vite)

To deploy this project in a local environment while maintaining full functionality, follow these steps:

### 1. Initialize Project
```bash
# Create directory
mkdir architect-engine && cd architect-engine

# Initialize Vite with React & TypeScript
npm create vite@latest . -- --template react-ts

# Install Dependencies
npm install
npm install @google/genai tailwindcss postcss autoprefixer
```

### 2. Tailwind CSS Configuration
Run `npx tailwindcss init -p` and update `tailwind.config.js`:
```javascript
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
```
Add to `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 3. File Architecture Mapping
Move the files from this repository into your local `src/` directory:
- `App.tsx` -> `src/App.tsx`
- `types.ts` -> `src/types.ts`
- `constants.tsx` -> `src/constants.tsx`
- `services/geminiService.ts` -> `src/services/geminiService.ts`
- `components/AnimatedFlow.tsx` -> `src/components/AnimatedFlow.tsx`

### 4. Environment Configuration
Create a `.env` file in the project root:
```text
VITE_API_KEY=your_google_gemini_api_key
```

### 5. Launch
```bash
npm run dev
```

---

## 🏗️ Architectural Specification

### Core Components
- **LangGraph Hub (LG):** The stateful controller managing the Directed Acyclic Graph (DAG) logic.
- **LLM Reasoning (LLM):** The engine determining "Next Action" based on state.
- **RAG Pipeline:** Logic layer for semantic retrieval from vector stores.
- **MCP Server:** Interface for real-time external tool orchestration (Model Context Protocol).
- **Vector DB (VDB):** High-dimensional storage for proprietary knowledge.

### Logic Pathways
1. **Only RAG:** `UI → LG → RAG → VDB`. Optimized for internal knowledge lookup.
2. **Only MCP:** `UI → LG → MCP → LG`. Optimized for external tool use (e.g., live stock data).
3. **Hybrid RAG + MCP:** The full agentic cycle. Combines retrieved context with tool execution.

### Inspection Features
- **Node Telemetry:** Click any component node to trigger a "Senior Architect Insight" generated via Gemini.
- **Packet Tracing:** Click the floating data packets on the visual paths to open the **Transaction Inspector**, revealing raw Input (Ingress) and Transformed (Egress) data buffers.

---

## 🛠️ Technical Implementation Details
- **Styling:** Tailwind CSS with a deep "Space Slate" aesthetic.
- **Visuals:** Custom SVG animation engine with bi-directional path logic.
- **AI Integration:** `@google/genai` using the `gemini-3-pro-preview` model for architectural reasoning and workflow synthesis.
- **State Management:** React `useState` and `useRef` for high-frequency animation synchronization and telemetry logging.
