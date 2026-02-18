
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
