
export enum WorkflowStep {
  IDLE = 'IDLE',
  UI_TO_LG = 'UI_TO_LG',
  LG_TO_LLM_PLAN = 'LG_TO_LLM_PLAN',
  LLM_TO_LG_PLAN = 'LLM_TO_LG_PLAN',
  LG_TO_RAG = 'LG_TO_RAG',
  RAG_TO_VDB = 'RAG_TO_VDB',
  VDB_TO_RAG = 'VDB_TO_RAG',
  RAG_TO_LG = 'RAG_TO_LG',
  LG_TO_MCP = 'LG_TO_MCP',
  MCP_TO_LG = 'MCP_TO_LG',
  LG_TO_LLM_EVAL = 'LG_TO_LLM_EVAL',
  LLM_TO_LG_EVAL = 'LLM_TO_LG_EVAL',
  LG_TO_OUT = 'LG_TO_OUT',
  COMPLETED = 'COMPLETED'
}

export interface ComponentInfo {
  name: string;
  role: string;
  description: string;
  techStack: string[];
}

export interface LogEntry {
  id: string;
  type: 'SYSTEM' | 'EXEC';
  message: string;
  details?: string;
  source?: string;
  destination?: string;
  inputData?: any;
  transformedData?: any;
  timestamp: string;
}

export interface SimulationState {
  currentStep: WorkflowStep;
  logs: LogEntry[];
  isLooping: boolean;
  loopCount: number;
  finalInput?: string;
  finalOutput?: string;
}
