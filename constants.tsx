
import { ComponentInfo, WorkflowStep } from './types';

export const ARCHITECTURE_COMPONENTS: Record<string, ComponentInfo> = {
  UI: {
    name: 'User Interface',
    role: 'Entry/Exit Point',
    description: 'The starting point for prompts and the terminal for streaming final synthesized answers.',
    techStack: ['React', 'Tailwind CSS']
  },
  LG: {
    name: 'LangGraph Hub',
    role: 'Stateful Controller',
    description: 'The central hub managing the flow of data between tools, memory, and the reasoning engine.',
    techStack: ['LangChain', 'Python/JS', 'State Management']
  },
  LLM: {
    name: 'LLM Reasoning Engine',
    role: 'The Brain',
    description: 'Determines the next action, evaluates tool output, and generates the final natural language response.',
    techStack: ['Gemini 3 Pro', 'Deep Reasoning']
  },
  RAG: {
    name: 'RAG Pipeline',
    role: 'Retrieval Logic',
    description: 'The processing layer that handles query expansion, reranking, and contextualizing retrieved documents.',
    techStack: ['LangChain', 'LlamaIndex']
  },
  VDB: {
    name: 'Vector Database',
    role: 'Semantic Storage',
    description: 'High-performance storage for high-dimensional embeddings. Performs nearest-neighbor search.',
    techStack: ['Pinecone', 'ChromaDB', 'pgvector']
  },
  MCP: {
    name: 'MCP Server',
    role: 'External Connector',
    description: 'Model Context Protocol interface providing standardized access to real-time external tool data.',
    techStack: ['MCP SDK', 'Real-time APIs']
  },
  OUT: {
    name: 'Final Output',
    role: 'Data Sink',
    description: 'The final destination for the synthesized response, typically rendered as a chat message or data object.',
    techStack: ['Markdown', 'Streaming API']
  }
};

export const STEP_METADATA: Record<WorkflowStep, { label: string; details: string; sourceId?: string; targetId?: string; inputData?: any; transformedData?: any }> = {
  [WorkflowStep.IDLE]: { 
    label: 'System Idle', 
    details: 'Awaiting architectural prompt execution.' 
  },
  [WorkflowStep.UI_TO_LG]: { 
    label: 'Ingesting Prompt', 
    details: 'Transmitting raw query packet for orchestration.', 
    sourceId: 'UI', 
    targetId: 'LG',
    inputData: "What is the current NVIDIA stock price combined with internal risk docs?",
    transformedData: { request_id: "REQ_102", type: "AGENTIC_SEARCH", priority: "HIGH" }
  },
  [WorkflowStep.LG_TO_LLM_PLAN]: { 
    label: 'Tasking Brain', 
    details: 'Requesting high-level execution strategy and tool routing.', 
    sourceId: 'LG', 
    targetId: 'LLM',
    inputData: { nodes_visited: [], graph_state: "INITIALIZED" },
    transformedData: { instruction: "GENERATE_PLAN", schema: "PLAN_V2" }
  },
  [WorkflowStep.LLM_TO_LG_PLAN]: { 
    label: 'Receiving Plan', 
    details: 'Returning structured plan.', 
    sourceId: 'LLM', 
    targetId: 'LG',
    inputData: "PLANNING_PROMPT_REASONING",
    transformedData: { steps: ["RAG_RETRIEVE", "MCP_MARKET_DATA", "SYNTHESIS"] }
  },
  [WorkflowStep.LG_TO_RAG]: { 
    label: 'RAG Pipeline', 
    details: 'Initiating retrieval-augmented generation sequence.', 
    sourceId: 'LG', 
    targetId: 'RAG',
    inputData: { topic: "NVIDIA risk documentation" },
    transformedData: { task: "CONTEXT_RETRIEVAL", filter: { year: 2024 } }
  },
  [WorkflowStep.RAG_TO_VDB]: { 
    label: 'VDB Search', 
    details: 'Executing vector similarity search on embedded documents.', 
    sourceId: 'RAG', 
    targetId: 'VDB',
    inputData: "Vector embedding for 'NVIDIA risk 2024'",
    transformedData: { search_params: { top_k: 3, metric: "cosine" } }
  },
  [WorkflowStep.VDB_TO_RAG]: { 
    label: 'Data Retrieval', 
    details: 'Returning semantic matches and relevant context chunks.', 
    sourceId: 'VDB', 
    targetId: 'RAG',
    inputData: "DB_INDEX_SCAN",
    transformedData: { documents: ["NVDA_Q4_RISK.pdf", "Internal_Audit_Report.docx"] }
  },
  [WorkflowStep.RAG_TO_LG]: { 
    label: 'RAG Finalized', 
    details: 'Merging retrieved context into global graph state.', 
    sourceId: 'RAG', 
    targetId: 'LG',
    inputData: ["NVDA_Q4_RISK.pdf", "Internal_Audit_Report.docx"],
    transformedData: { context_tokens: 1250, integrity: "VERIFIED" }
  },
  [WorkflowStep.LG_TO_MCP]: { 
    label: 'MCP Call', 
    details: 'Invoking dynamic toolset via Model Context Protocol.', 
    sourceId: 'LG', 
    targetId: 'MCP',
    inputData: { tool_id: "google_search", query: "NVDA stock price" },
    transformedData: { tool_request: "MCP_JSON_RPC_V1", method: "fetch" }
  },
  [WorkflowStep.MCP_TO_LG]: { 
    label: 'External Data', 
    details: 'Ingesting real-time API response and reconciling state.', 
    sourceId: 'MCP', 
    targetId: 'LG',
    inputData: "EXTERNAL_API_STREAM",
    transformedData: { status: "success", result: "$132.45 (+2.1%)" }
  },
  [WorkflowStep.LG_TO_LLM_EVAL]: { 
    label: 'Evaluating', 
    details: 'Providing unified context and tool data for final synthesis.', 
    sourceId: 'LG', 
    targetId: 'LLM',
    inputData: { context: "Retrieved docs", tool_data: "$132.45" },
    transformedData: { command: "SYNTHESIZE_MARKDOWN", tone: "Professional" }
  },
  [WorkflowStep.LLM_TO_LG_EVAL]: { 
    label: 'Synthesized', 
    details: 'Generating human-readable markdown response from agentic trace.', 
    sourceId: 'LLM', 
    targetId: 'LG',
    inputData: "EVALUATION_HIDDEN_STATE",
    transformedData: { markdown: "## Market Report\nNVIDIA is trading at...", confidence: 0.98 }
  },
  [WorkflowStep.LG_TO_OUT]: { 
    label: 'Streaming', 
    details: 'Routing verified response payload to user exit node.', 
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
