
import { ComponentInfo, WorkflowStep } from './types';

export interface InternalComponent {
  name: string;
  description: string;
}

export const ARCHITECTURE_COMPONENTS: Record<string, ComponentInfo & { internalDetails?: InternalComponent[] }> = {
  UI: {
    name: 'User Interface',
    role: 'Entry/Exit Point',
    description: 'The starting point for prompts and the terminal for streaming final synthesized answers.',
    techStack: ['React', 'Tailwind CSS'],
    internalComponents: ['Sanitizer', 'Session Mgr', 'Renderer'],
    internalDetails: [
      { name: 'Sanitizer', description: 'Cleans user input to prevent XSS and prompt injection attacks.' },
      { name: 'Session Mgr', description: 'Manages user state, connection health, and active websocket channels.' },
      { name: 'Renderer', description: 'Streams markdown tokens to the UI in real-time for lower perceived latency.' }
    ],
    internalFlow: {
      nodes: [
        { id: '1', label: 'Input Sanitizer', x: 100, y: 20 },
        { id: '2', label: 'Session Mgr', x: 100, y: 65 },
        { id: '3', label: 'Stream Renderer', x: 100, y: 110 }
      ],
      connections: [
        { from: '1', to: '2' },
        { from: '2', to: '3' }
      ]
    }
  },
  LG: {
    name: 'Workflow Orchestrator',
    role: 'Stateful Controller',
    description: 'The central hub managing the flow of data between tools, memory, and the reasoning engine (Internal Model Broker).',
    techStack: ['LangChain', 'Python/JS', 'State Management'],
    internalComponents: ['Graph State', 'Interrupt', 'Loop Detect'],
    internalDetails: [
      { name: 'Graph State', description: 'Persists execution context (checkpoints) to Redis for fault tolerance.' },
      { name: 'Interrupt', description: 'Allows human-in-the-loop validation before critical tool execution.' },
      { name: 'Loop Detect', description: 'Prevents infinite agent recursion by capping execution depth.' },
      { name: 'Logger', description: 'Records trace telemetry for debugging and compliance.' }
    ],
    internalFlow: {
      nodes: [
        { id: '1', label: 'Graph State', x: 40, y: 25 },
        { id: '2', label: 'Interrupt', x: 160, y: 25 },
        { id: '3', label: 'Loop Detect', x: 160, y: 80 },
        { id: '4', label: 'Trace Logger', x: 40, y: 80 }
      ],
      connections: [
        { from: '1', to: '2' }, // Check state, then check for interrupts
        { from: '2', to: '3' }, // If no interrupt, check loop constraints
        { from: '3', to: '4' }, // Log execution
        { from: '4', to: '1' }  // Update state (Feedback loop)
      ]
    }
  },
  LLM: {
    name: 'Model Broker (Aviator)',
    role: 'The Brain (Private)',
    description: 'Secure, high-throughput inference engine hosted on internal infrastructure. Routes requests to Llama 3.3 70B with Gemini Fallback.',
    techStack: ['Llama 3.3 70B', 'Gemini Fallback', 'Internal Gateway'],
    internalComponents: ['Router', 'Quota', 'Llama Nodes'],
    internalDetails: [
      { name: 'Router', description: 'Directs traffic between internal clusters and fallback APIs based on latency.' },
      { name: 'Quota', description: 'Enforces rate limits and cost controls per tenant or user.' },
      { name: 'Llama Nodes', description: 'High-performance GPU instances running the primary Llama 3.3 70B model.' }
    ],
    internalFlow: {
      nodes: [
        { id: '1', label: 'Auth/Quota', x: 100, y: 20 },
        { id: '2', label: 'Model Router', x: 100, y: 65 },
        { id: '3', label: 'Llama 3.3', x: 40, y: 110 },
        { id: '4', label: 'Gemini (F/B)', x: 160, y: 110 }
      ],
      connections: [
        { from: '1', to: '2' },
        { from: '2', to: '3' },
        { from: '2', to: '4' }
      ]
    }
  },
  RAG: {
    name: 'RAG Pipeline',
    role: 'Retrieval Logic',
    description: 'The processing layer that handles query expansion, reranking, and contextualizing retrieved documents.',
    techStack: ['LangChain', 'LlamaIndex'],
    internalComponents: ['Expander', 'Hybrid Search', 'Re-ranker'],
    internalDetails: [
      { name: 'Expander', description: 'Generates multiple search queries to cover broader semantic meaning.' },
      { name: 'Hybrid Search', description: 'Combines keyword (BM25) and vector similarity search results.' },
      { name: 'Re-ranker', description: 'Uses a cross-encoder model to sort results by true relevance.' }
    ],
    internalFlow: {
      nodes: [
        { id: '1', label: 'Query Expander', x: 100, y: 20 },
        { id: '2', label: 'Hybrid Search', x: 100, y: 65 },
        { id: '3', label: 'Re-ranker', x: 100, y: 110 }
      ],
      connections: [
        { from: '1', to: '2' },
        { from: '2', to: '3' }
      ]
    }
  },
  VDB: {
    name: 'Vector Database',
    role: 'Semantic Storage',
    description: 'High-performance storage for high-dimensional embeddings. Performs nearest-neighbor search.',
    techStack: ['Pinecone', 'ChromaDB', 'pgvector'],
    internalComponents: ['HNSW Index', 'Embedder', 'Snapshot'],
    internalDetails: [
      { name: 'Embedder', description: 'Converts text into 1536-dimensional vectors using embedding models.' },
      { name: 'HNSW Index', description: 'Hierarchical Navigable Small World graphs for fast nearest neighbor search.' },
      { name: 'Store', description: 'Persistent storage for vector data and associated metadata.' }
    ],
    internalFlow: {
      nodes: [
        { id: '1', label: 'Embedder', x: 40, y: 65 },
        { id: '2', label: 'HNSW Index', x: 100, y: 25 },
        { id: '3', label: 'Meta Store', x: 160, y: 65 }
      ],
      connections: [
        { from: '1', to: '2' }, // Query to Index
        { from: '2', to: '3' }  // Index match to Metadata fetch
      ]
    }
  },
  MCP: {
    name: 'Enterprise Service Bus (MCP)',
    role: 'Internal API Gateway',
    description: 'Secure interface (Model Context Protocol) exposing internal enterprise microservices (ERPs, CRMs) to the agent.',
    techStack: ['MCP Server', 'Internal APIs', 'OAuth2'],
    internalComponents: ['Registry', 'Sandbox', 'OIDC Valid'],
    internalDetails: [
      { name: 'OIDC Valid', description: 'Validates OAuth2 tokens to ensure secure access to enterprise tools.' },
      { name: 'Registry', description: 'Catalog of available tools and their schema definitions.' },
      { name: 'Sandbox', description: 'Isolated environment for executing untrusted tool code safely.' },
      { name: 'API Gateway', description: 'Routes validated requests to backend microservices.' }
    ],
    internalFlow: {
      nodes: [
        { id: '1', label: 'OIDC Check', x: 100, y: 20 },
        { id: '2', label: 'Tool Registry', x: 40, y: 65 },
        { id: '3', label: 'Sandbox', x: 160, y: 65 },
        { id: '4', label: 'Backend API', x: 100, y: 110 }
      ],
      connections: [
        { from: '1', to: '2' }, // Auth -> Lookup
        { from: '1', to: '3' }, // Auth -> Exec Env (Parallel)
        { from: '2', to: '4' }, // Registry -> Call
        { from: '3', to: '4' }  // Sandbox -> Call
      ]
    }
  },
  OUT: {
    name: 'Final Output',
    role: 'Data Sink',
    description: 'The final destination for the synthesized response, typically rendered as a chat message or data object.',
    techStack: ['Markdown', 'Streaming API'],
    internalComponents: ['Parser', 'Highlighter', 'TTS'],
    internalDetails: [
      { name: 'Parser', description: 'Parses raw text into structured markdown blocks.' },
      { name: 'Citations', description: 'Links response segments to source documents for verification.' },
      { name: 'Renderer', description: 'Displays the formatted content to the end user.' }
    ],
    internalFlow: {
      nodes: [
        { id: '1', label: 'MD Parser', x: 40, y: 40 },
        { id: '2', label: 'Citation Link', x: 160, y: 40 },
        { id: '3', label: 'DOM Render', x: 100, y: 90 }
      ],
      connections: [
        { from: '1', to: '3' },
        { from: '2', to: '3' } // Parallel processing merging into render
      ]
    }
  }
};

export const STEP_METADATA: Record<WorkflowStep, { label: string; details: string; sourceId?: string; targetId?: string; inputData?: any; transformedData?: any }> = {
  [WorkflowStep.IDLE]: { 
    label: 'System Idle', 
    details: 'Awaiting architectural prompt execution.' 
  },
  [WorkflowStep.UI_TO_LG]: { 
    label: 'Ingesting Prompt', 
    details: 'Raw Input: "{prompt}"', 
    sourceId: 'UI', 
    targetId: 'LG',
    inputData: "{prompt}",
    transformedData: { request_id: "REQ_GENERIC", type: "AGENTIC_SEARCH", priority: "HIGH" }
  },
  [WorkflowStep.LG_TO_LLM_PLAN]: { 
    label: 'Tasking Brain', 
    details: 'Transforming Raw Input → Structured Execution Plan Request', 
    sourceId: 'LG', 
    targetId: 'LLM',
    inputData: { nodes_visited: [], graph_state: "INITIALIZED" },
    transformedData: { instruction: "GENERATE_PLAN", schema: "PLAN_V2" }
  },
  [WorkflowStep.LLM_TO_LG_PLAN]: { 
    label: 'Receiving Plan', 
    details: 'Received Plan: [Determine intent, Retrieve context, execute tools]', 
    sourceId: 'LLM', 
    targetId: 'LG',
    inputData: "PLANNING_PROMPT_REASONING",
    transformedData: { steps: ["INTENT_RECOG", "CONTEXT_RETRIEVAL", "TOOL_EXECUTION"] }
  },
  [WorkflowStep.LG_TO_RAG]: { 
    label: 'RAG Pipeline', 
    details: 'Extracting Keywords: "{keywords}" → Generating Vector Query', 
    sourceId: 'LG', 
    targetId: 'RAG',
    inputData: { topic: "{topic}" },
    transformedData: { task: "CONTEXT_RETRIEVAL", filter: { recent: true } }
  },
  [WorkflowStep.RAG_TO_VDB]: { 
    label: 'VDB Search', 
    details: 'Converting "{keywords}" → Vector Embedding [0.12, -0.98, 0.45...]', 
    sourceId: 'RAG', 
    targetId: 'VDB',
    inputData: "Vector embedding for '{keywords}'",
    transformedData: { search_params: { top_k: 3, metric: "cosine" } }
  },
  [WorkflowStep.VDB_TO_RAG]: { 
    label: 'Data Retrieval', 
    details: 'Found Matches: "{doc1}" (Score: 0.92) & "{doc2}"', 
    sourceId: 'VDB', 
    targetId: 'RAG',
    inputData: "DB_INDEX_SCAN",
    transformedData: { documents: ["{doc1}", "{doc2}"] }
  },
  [WorkflowStep.RAG_TO_LG]: { 
    label: 'RAG Finalized', 
    details: 'Context Block Created: "Retrieved knowledge about {topic}..."', 
    sourceId: 'RAG', 
    targetId: 'LG',
    inputData: ["{doc1}", "{doc2}"],
    transformedData: { context_tokens: 1250, integrity: "VERIFIED" }
  },
  [WorkflowStep.LG_TO_MCP]: { 
    label: 'MCP Call', 
    details: 'Identifying Missing Data → Calling Tool: {tool_name}', 
    sourceId: 'LG', 
    targetId: 'MCP',
    inputData: { tool_id: "{tool_id}", query: "{query}" },
    transformedData: { tool_request: "MCP_JSON_RPC_V1", method: "fetch" }
  },
  [WorkflowStep.MCP_TO_LG]: { 
    label: 'External Data', 
    details: 'Tool Result: {tool_result} → Appending to Graph State', 
    sourceId: 'MCP', 
    targetId: 'LG',
    inputData: "EXTERNAL_API_STREAM",
    transformedData: { status: "success", result: "{tool_result}" }
  },
  [WorkflowStep.LG_TO_LLM_EVAL]: { 
    label: 'Evaluating', 
    details: 'Aggregating: {User Query + Context + Tool Data} → Final Prompt', 
    sourceId: 'LG', 
    targetId: 'LLM',
    inputData: { context: "Retrieved docs", tool_data: "External Data" },
    transformedData: { command: "SYNTHESIZE_MARKDOWN", tone: "Professional" }
  },
  [WorkflowStep.LLM_TO_LG_EVAL]: { 
    label: 'Synthesized', 
    details: 'Generated Response: "{response_snippet}..."', 
    sourceId: 'LLM', 
    targetId: 'LG',
    inputData: "EVALUATION_HIDDEN_STATE",
    transformedData: { markdown: "## Summary\n{response_snippet}...", confidence: 0.98 }
  },
  [WorkflowStep.LG_TO_OUT]: { 
    label: 'Streaming', 
    details: 'Final Output: Streaming Markdown Bytes to UI', 
    sourceId: 'LG', 
    targetId: 'OUT',
    inputData: { result_buffer: "..." },
    transformedData: { event: "DATA_PUSH", protocol: "SSE" }
  },
  [WorkflowStep.COMPLETED]: { 
    label: 'Execution Done', 
    details: 'Full transaction cycle finished successfully.' 
  }
};
