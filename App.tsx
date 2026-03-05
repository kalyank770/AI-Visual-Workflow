
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { WorkflowStep, SimulationState, LogEntry } from './types';
import { ARCHITECTURE_COMPONENTS, STEP_METADATA } from './constants';
import AnimatedFlow from './components/AnimatedFlow';

const InternalComponentDetail = ({ detail, isDarkMode }: { detail: any, isDarkMode: boolean }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className={`flex flex-col border rounded-md overflow-hidden ${isDarkMode ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200'} transition-all duration-300`}>
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-slate-500/5 transition-colors group"
      >
        <div className="flex items-center gap-2">
           <div className={`w-1.5 h-1.5 rounded-full ${isExpanded ? 'bg-emerald-400' : 'bg-emerald-500/40'} transition-colors`} />
           <span className={`text-[10px] font-bold tracking-wide uppercase ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{detail.name}</span>
        </div>
        <svg 
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" 
          className={`text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-emerald-400' : ''}`}
        >
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-32 opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className={`px-3 pb-3 pt-0`}>
          <div className={`text-[10px] leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'} border-l-2 ${isDarkMode ? 'border-slate-800' : 'border-slate-100'} pl-2 ml-0.5`}>
            {detail.description}
          </div>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [state, setState] = useState<SimulationState>({
    currentStep: WorkflowStep.IDLE,
    logs: [{ 
      id: 'init', 
      type: 'SYSTEM', 
      message: 'Architectural Simulator Ready', 
      timestamp: new Date().toLocaleTimeString(),
      details: 'Ingest instructions to begin cycle.' 
    }],
    isLooping: false,
    loopCount: 0,
    finalInput: undefined,
    finalOutput: undefined
  });

  const [prompt, setPrompt] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeInsight, setNodeInsight] = useState<string | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTelemetryCollapsed, setIsTelemetryCollapsed] = useState(true);
  const [activePayloadDetail, setActivePayloadDetail] = useState<LogEntry | null>(null);
  const [pathReasoning, setPathReasoning] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<{ prompt: string; reasoning: string; logId: string; output?: string }[]>([]);
  const [highlightedLogId, setHighlightedLogId] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<WorkflowStep[]>([]);
  const [activeModelName, setActiveModelName] = useState<string>("Llama 3.3 70B");
  const [isUsingRealLLM, setIsUsingRealLLM] = useState<boolean>(true);
  const [pathOutputView, setPathOutputView] = useState<{ prompt: string; output: string } | null>(null);
  const [showFinalOutput, setShowFinalOutput] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [enableInterrupts, setEnableInterrupts] = useState(false);
  const RAG_TERMS = [
    "rag",
    "internal",
    "policy",
    "support",
    "document",
    "guide",
    "knowledge",
    "help",
    "in house",
    "org",
    "organization",
    "doc",
    "docs",
    "documentation",
    "knowledge base",
    "kb",
    "sop",
    "handbook",
    // Note: Generic "opentext", "open text", "otex" removed — queries about the company should use web search
    // Specific product names trigger RAG for internal documentation:
    "otcs",
    "content server",
    "documentum",
    "extended ecm",
    "xecm",
    "aviator",
    "magellan",
    "exstream",
    "teamsite",
    "appworks",
    "fortify",
    "arcsight",
    "netiq",
    "voltage",
    "loadrunner",
    "smax",
  ];
  const componentSubtitles: Record<string, string> = {
    LG: 'Decision Engine',
    LLM: 'Text Generator (Brain)',
    VDB: 'Long-Term Memory',
    MCP: 'Tool Access Layer',
    RAG: 'Search System'
  };
  const activeStepMeta = STEP_METADATA[state.currentStep];
  const activeComponentId = activeStepMeta?.targetId || activeStepMeta?.sourceId;
  const activeComponentName = activeComponentId ? ARCHITECTURE_COMPONENTS[activeComponentId]?.name : null;
  const pathComponents = useMemo(() => {
    const components: string[] = [];
    activePath.forEach((step) => {
      const meta = STEP_METADATA[step];
      if (!meta) return;
      if (meta.sourceId && components[components.length - 1] !== meta.sourceId) {
        components.push(meta.sourceId);
      }
      if (meta.targetId && components[components.length - 1] !== meta.targetId) {
        components.push(meta.targetId);
      }
    });
    return components;
  }, [activePath]);
  const activeComponentIndex = activeComponentId ? pathComponents.indexOf(activeComponentId) : -1;
  const logRuns = useMemo(() => {
    const runs: LogEntry[][] = [];
    let current: LogEntry[] = [];

    state.logs.forEach((log) => {
      if (log.message === 'Handshake initiated') {
        if (current.length > 0) runs.push(current);
        current = [log];
        return;
      }
      current.push(log);
    });

    if (current.length > 0) runs.push(current);
    return runs;
  }, [state.logs]);

  // Apply dark mode class to html element for global Tailwind support if needed
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);


  const scrollRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(isPaused);
  const runIdRef = useRef(0);
  const toolDataRef = useRef<string[]>([]);
  const ragDataRef = useRef<any>(null);
  const persistedLogCountRef = useRef(0);
  const [activeToolName, setActiveToolName] = useState<string | undefined>(undefined);
  const [activeToolNames, setActiveToolNames] = useState<string[]>([]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [state.logs]);

  useEffect(() => {
    if (state.logs.length === 0) return;

    const unsentLogs = state.logs.slice(persistedLogCountRef.current);
    if (unsentLogs.length === 0) return;

    const persistLogs = async () => {
      try {
        const response = await fetch('/api/dashboard-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logs: unsentLogs }),
        });

        if (response.ok) {
          persistedLogCountRef.current = state.logs.length;
        }
      } catch {}
    };

    persistLogs();
  }, [state.logs]);

  // Health check on app initialization
  useEffect(() => {
    const checkBackendHealth = async () => {
      try {
        const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
        } else {
        }
      } catch (error) {
      }
    };
    checkBackendHealth();
  }, []);
  useEffect(() => {
    if (state.finalOutput) {
    }
  }, [state.finalOutput, state.finalInput]);

  // Smarter contextualization based on prompt type
  const getStepDetails = (step: WorkflowStep, meta: any, activePrompt: string, finalOutput?: string) => {
    let inputData = meta.inputData;
    let transformedData = meta.transformedData;
    
    // Determine the nature of the prompt
    const promptLower = activePrompt.toLowerCase();
    const isRagOnly = promptLower.includes("rag only");
    const isMcpOnly = promptLower.includes("mcp tools only");
    const isRagPreferred = RAG_TERMS.some(term => promptLower.includes(term));
    // Direct logic
    const isDirect = !isRagOnly && !isMcpOnly && (
      /^[\d\s\+\-\*\/\(\)\.]+$/.test(activePrompt) || 
      /^\d+[\+\-\*\/]\d+/.test(activePrompt.replace(/\s/g,'')) || 
      ['hello', 'hi', 'hey', 'greetings'].some(s => promptLower.startsWith(s)) ||
      (promptLower.split(' ').length < 6 && !promptLower.includes("ticket") && !promptLower.includes("status"))
    );

    // Readable Transformation Logic
    let simpleTransformation = "";
    const shortPrompt = activePrompt.length > 20 ? activePrompt.substring(0, 20) + "..." : activePrompt;

    switch (step) {
      case WorkflowStep.UI_TO_LG:
        simpleTransformation = `"${shortPrompt}" → { type: "user_request", content: "${shortPrompt}" }`;
        break;
      case WorkflowStep.LG_TO_LLM_PLAN:
        simpleTransformation = `{ content: "${shortPrompt}" } → PromptTemplate("Analyze request: ${shortPrompt}")`;
        break;
      case WorkflowStep.LLM_TO_LG_PLAN:
        simpleTransformation = `LLM Output → { plan: ["Identify Intent", "Retrieve Context", "Execute Tools"] }`;
        break;
      case WorkflowStep.LG_TO_RAG:
        if (ragDataRef.current) {
          const rag = ragDataRef.current;
          simpleTransformation = `RAG_Pipeline({ query: "${shortPrompt}", expanded: [${rag.expandedQueries.map(q => `"${q.slice(0, 30)}"`).join(', ')}], model: "${rag.stats.embeddingModel}" })`;
        } else {
          simpleTransformation = `Plan["Retrieve"] → Retrieval_Node({ query: "keywords from ${shortPrompt}" })`;
        }
        break;
      case WorkflowStep.RAG_TO_VDB:
        if (ragDataRef.current) {
          const rag = ragDataRef.current;
          simpleTransformation = `Hybrid_Search(${rag.stats.totalChunks} chunks, ${rag.stats.totalDocuments} docs) → ${rag.retrievedChunks.length} candidates in ${rag.stats.searchTimeMs}ms`;
        } else {
          simpleTransformation = `{ query: "keywords..." } → Vector_Embedding[0.82, -0.41, 0.19, ...]`;
        }
        break;
      case WorkflowStep.VDB_TO_RAG:
        if (ragDataRef.current && ragDataRef.current.retrievedChunks.length > 0) {
          const rag = ragDataRef.current;
          const topChunks = rag.retrievedChunks.slice(0, 3).map(r => `"${r.chunk.source}" (${(r.score * 100).toFixed(1)}%)`);
          simpleTransformation = `Retrieved: [${topChunks.join(', ')}] via ${rag.retrievedChunks[0].method} search`;
        } else {
          simpleTransformation = `Vector Search → [ "Document_Chunk_A (92%)", "Document_Chunk_B (88%)" ]`;
        }
        break;
      case WorkflowStep.RAG_TO_LG:
        if (ragDataRef.current && ragDataRef.current.rerankedChunks.length > 0) {
          const rag = ragDataRef.current;
          simpleTransformation = `Re-ranked → Top ${rag.rerankedChunks.length} chunks (best: ${(rag.stats.topScore * 100).toFixed(1)}%) → Context_Window(${rag.contextBlock.length} chars)`;
        } else {
          simpleTransformation = `[Docs] → Context_Window("...retrieved content...")`;
        }
        break;
      case WorkflowStep.LG_TO_MCP:
        simpleTransformation = `Plan["Execute"] → API_Call(tool="fetch_data", args={ query: "${shortPrompt}" })`;
        // If tool data is available, show which tools are being called
        if (toolDataRef.current.length > 0) {
          const toolNames = toolDataRef.current.map(t => {
            const match = t.match(/^Tool \[(.+?)\]/);
            return match ? match[1] : 'Unknown';
          });
          simpleTransformation = `MCP_Call(tools=[${toolNames.map(n => `"${n}"`).join(', ')}], query="${shortPrompt}")`;
        }
        break;
      case WorkflowStep.MCP_TO_LG:
        simpleTransformation = `API_Response(200) → { status: "success", data: "Live Stream Result" }`;
        // If tool data is available, show summary of results
        if (toolDataRef.current.length > 0) {
          const toolSummary = toolDataRef.current.map(t => {
            const nameMatch = t.match(/^Tool \[(.+?)\]:/);
            const name = nameMatch ? nameMatch[1] : 'Tool';
            const data = t.replace(/^Tool \[.+?\]:\s*/, '').slice(0, 80);
            return `${name}: ${data}${t.length > 80 ? '...' : ''}`;
          }).join(' | ');
          simpleTransformation = `MCP_Response(200) → { tools_executed: ${toolDataRef.current.length}, results: "${toolSummary.slice(0, 200)}" }`;
        }
        break;
      case WorkflowStep.LG_TO_LLM_EVAL:
        simpleTransformation = `{ context: "...", tool_data: "..." } → Final_Prompt("Synthesize answer for: ${shortPrompt}")`;
        break;
      case WorkflowStep.LLM_TO_LG_EVAL:
        simpleTransformation = "LLM writes the final response in plain language.";
        break;
      case WorkflowStep.LG_TO_OUT: {
        if (finalOutput) {
          const trimmedOutput = finalOutput.replace(/\r\n/g, "\n").trim();
          simpleTransformation = `"${trimmedOutput}"`;
        } else {
          simpleTransformation = "System streams the response to the screen in small chunks.";
        }
        break;
      }
      case WorkflowStep.COMPLETED:
        simpleTransformation = `Cycle Complete. final_state = "WAITING"`;
        break;
      default:
        simpleTransformation = meta.details;
    }

    // Helper to replace strict placeholders
    const processTemplate = (obj: any, replacements: Record<string, string>): any => {
      if (typeof obj === 'string') {
        let res = obj;
        for (const [key, val] of Object.entries(replacements)) {
          // Use callback to avoid special replacement patterns in `val` (like $)
          res = res.replace(new RegExp(`{${key}}`, 'g'), () => val);
        }
        return res;
      }
      if (Array.isArray(obj)) return obj.map(o => processTemplate(o, replacements));
      if (typeof obj === 'object' && obj !== null) {
        const newObj: any = {};
        for (const key in obj) newObj[key] = processTemplate(obj[key], replacements);
        return newObj;
      }
      return obj;
    };

    // Define replacements based on mode (Only needed for detailed payload inspectors now)
    const rag = ragDataRef.current;
    let replacements: Record<string, string> = {
        prompt: activePrompt,
        keywords: rag ? rag.expandedQueries.join(", ") : "Extracted Terms",
        topic: rag && rag.rerankedChunks.length > 0 ? rag.rerankedChunks[0].chunk.source : "Subject Matter",
        doc1: rag && rag.rerankedChunks.length > 0 ? rag.rerankedChunks[0].chunk.source : "Document_A.pdf",
        doc2: rag && rag.rerankedChunks.length > 1 ? rag.rerankedChunks[1].chunk.source : "Document_B.pdf",
        tool_name: "Generic_Tool",
        tool_id: "tool_01",
        query: "search_query",
        tool_result: "success",
        response_snippet: "Generated response...",
    };

    if (isRagOnly) {
      replacements = {
        ...replacements,
        keywords: "Internal Knowledge",
        topic: "Internal Policy",
        doc1: "Internal_Docs_v2.pdf",
        doc2: "Policy_2024.pdf",
        response_snippet: "Based on internal documents...",
      };
    } else if (isMcpOnly) {
      replacements = {
        ...replacements,
        tool_name: "fetch_api",
        tool_id: "live_stream_api",
        query: "all",
        tool_result: "Live Stream Data",
        response_snippet: "Live data indicates...",
      };
    } else if (isDirect) {
      replacements = {
        ...replacements,
        response_snippet: "Direct Answer Generated.",
      };
    }

    // Override payload data with real RAG results when available
    if (rag) {
      switch (step) {
        case WorkflowStep.LG_TO_RAG:
          inputData = { query: activePrompt, expanded_queries: rag.expandedQueries };
          transformedData = { task: "CONTEXT_RETRIEVAL", embedding_model: rag.stats.embeddingModel, total_chunks: rag.stats.totalChunks, total_docs: rag.stats.totalDocuments };
          break;
        case WorkflowStep.RAG_TO_VDB:
          inputData = { queries: rag.expandedQueries, search_type: "hybrid (vector + BM25)" };
          transformedData = { search_params: { top_k: rag.retrievedChunks.length, metric: "cosine + RRF", search_time_ms: rag.stats.searchTimeMs } };
          break;
        case WorkflowStep.VDB_TO_RAG:
          inputData = { candidates_found: rag.retrievedChunks.length };
          transformedData = { documents: rag.retrievedChunks.slice(0, 3).map(r => ({ source: r.chunk.source, score: +(r.score * 100).toFixed(1), method: r.method, preview: r.chunk.content.slice(0, 100) + "..." })) };
          break;
        case WorkflowStep.RAG_TO_LG:
          inputData = rag.rerankedChunks.map(r => ({ source: r.chunk.source, relevance: +(r.score * 100).toFixed(1) + "%" }));
          transformedData = { context_tokens: rag.contextBlock.length, integrity: "VERIFIED", reranked_count: rag.rerankedChunks.length, top_score: +(rag.stats.topScore * 100).toFixed(1) + "%" };
          break;
      }
    }

    return {
      details: simpleTransformation, // Use our new readable string for the main log view
      inputData: processTemplate(inputData, replacements),
      transformedData: processTemplate(transformedData, replacements)
    };
  };

  const openLogEntry = (logId: string) => {
    setIsTelemetryCollapsed(false);
    setTimeout(() => {
      const targetIndex = state.logs.findIndex(log => log.id === logId);
      let targetLogId = logId;

      if (targetIndex >= 0) {
        const runStartMessages = new Set([
          'Calling Backend Workflow API',
          'API Call Failed',
          'Handshake initiated',
        ]);

        let runStartIndex = 0;

        for (let i = targetIndex; i >= 0; i--) {
          const candidate = state.logs[i];
          if (runStartMessages.has(candidate.message)) {
            targetLogId = candidate.id;
            runStartIndex = i;
            break;
          }
        }

        const firstExec = state.logs.slice(runStartIndex, targetIndex + 1).find(log => log.type === 'EXEC');
        if (firstExec) {
          targetLogId = firstExec.id;
        }
      }

      const target = document.getElementById(`log-${targetLogId}`);
      if (target) {
        setHighlightedLogId(targetLogId);
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => setHighlightedLogId(null), 3500);
      }
    }, 120);
  };

  const resetSimulation = () => {
    runIdRef.current += 1;
    setState({
      currentStep: WorkflowStep.IDLE,
      logs: [{ 
        id: 'reset', 
        type: 'SYSTEM', 
        message: 'Simulator Reset', 
        timestamp: new Date().toLocaleTimeString(),
        details: 'Awaiting new instructions.' 
      }],
      isLooping: false,
      loopCount: 0,
      finalInput: undefined,
      finalOutput: undefined
    });
    setPrompt('');
    setNodeInsight(null);
    setSelectedNode(null);
    setIsSimulating(false);
    setIsPaused(false);
    setActivePayloadDetail(null);
    setPathReasoning(null);
    setPathHistory([]);
    setActivePath([]);
    setActiveModelName("Llama 3.3 70B");
    setIsUsingRealLLM(true);
    setShowFinalOutput(false);
    toolDataRef.current = [];
    ragDataRef.current = null;
    persistedLogCountRef.current = 0;
    setActiveToolName(undefined);
    setActiveToolNames([]);
  };

  const tryEvaluateMath = (text: string): string | null => {
    const cleaned = text.trim();
    if (!cleaned) return null;
    if (!/^[0-9+\-*/^().\s]+$/.test(cleaned)) return null;
    if (!/[0-9]/.test(cleaned)) return null;
    const normalized = cleaned.replace(/\s+/g, '').replace(/\^/g, '**');
    try {
      // Safe eval: digits and operators only
      const result = Function(`"use strict"; return (${normalized});`)();
      if (typeof result === 'number' && Number.isFinite(result)) {
        return `${cleaned} = ${result}`;
      }
    } catch {
      return null;
    }
    return null;
  };

  const buildStepPath = (activePrompt: string): WorkflowStep[] => {
    const promptLower = activePrompt.toLowerCase();
    const isRagOnly = promptLower.includes("rag only");
    const isMcpOnly = promptLower.includes("mcp tools only");
    const isDirect = !isRagOnly && !isMcpOnly && (
      /^[\d\s\+\-\*\/\(\)\.]+$/.test(activePrompt) ||
      /^\d+[\+\-\*\/]\d+/.test(activePrompt.replace(/\s/g, '')) ||
      ['hello', 'hi', 'hey', 'greetings'].some(s => promptLower.startsWith(s)) ||
      (promptLower.split(' ').length < 6 && !promptLower.includes("ticket") && !promptLower.includes("status"))
    );

    const steps: WorkflowStep[] = [
      WorkflowStep.UI_TO_LG,
      WorkflowStep.LG_TO_LLM_PLAN,
      WorkflowStep.LLM_TO_LG_PLAN,
    ];

    if (isDirect) {
      steps.push(
        WorkflowStep.LG_TO_LLM_EVAL,
        WorkflowStep.LLM_TO_LG_EVAL,
        WorkflowStep.LG_TO_OUT
      );
      return steps;
    }

    if (isMcpOnly) {
      steps.push(WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG);
    } else {
      steps.push(
        WorkflowStep.LG_TO_RAG,
        WorkflowStep.RAG_TO_VDB,
        WorkflowStep.VDB_TO_RAG,
        WorkflowStep.RAG_TO_LG
      );
      if (!isRagOnly) {
        steps.push(WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG);
      }
    }

    steps.push(
      WorkflowStep.LG_TO_LLM_EVAL,
      WorkflowStep.LLM_TO_LG_EVAL,
      WorkflowStep.LG_TO_OUT
    );

    return steps;
  };

  const buildStepPathFromRoute = (route?: string): WorkflowStep[] => {
    const normalizedRoute = (route || '').toLowerCase();
    const steps: WorkflowStep[] = [
      WorkflowStep.UI_TO_LG,
      WorkflowStep.LG_TO_LLM_PLAN,
      WorkflowStep.LLM_TO_LG_PLAN,
    ];

    if (normalizedRoute === 'direct') {
      steps.push(
        WorkflowStep.LG_TO_LLM_EVAL,
        WorkflowStep.LLM_TO_LG_EVAL,
        WorkflowStep.LG_TO_OUT
      );
      return steps;
    }

    if (normalizedRoute === 'mcp_only') {
      steps.push(WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG);
    } else {
      steps.push(
        WorkflowStep.LG_TO_RAG,
        WorkflowStep.RAG_TO_VDB,
        WorkflowStep.VDB_TO_RAG,
        WorkflowStep.RAG_TO_LG
      );
      if (normalizedRoute !== 'rag_only') {
        steps.push(WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG);
      }
    }

    steps.push(
      WorkflowStep.LG_TO_LLM_EVAL,
      WorkflowStep.LLM_TO_LG_EVAL,
      WorkflowStep.LG_TO_OUT
    );

    return steps;
  };

  const buildPathAnalysis = (route: string | undefined, reasoning: string | undefined, steps: WorkflowStep[]) => {
    const routeLabelMap: Record<string, { label: string; fallback: string }> = {
      rag_only: { label: 'RAG Only', fallback: 'Internal knowledge retrieval prioritized.' },
      mcp_only: { label: 'MCP Only', fallback: 'External tool execution prioritized.' },
      hybrid: { label: 'Hybrid', fallback: 'Retrieval plus tool execution for best coverage.' },
      direct: { label: 'Direct', fallback: 'Simple request resolved without tools or retrieval.' },
    };
    const normalizedRoute = (route || '').toLowerCase();
    const routeMeta = routeLabelMap[normalizedRoute] || { label: 'Hybrid', fallback: 'Standard agentic execution path.' };

    const componentPath: string[] = [];
    steps.forEach(step => {
      const meta = STEP_METADATA[step];
      if (!meta) return;
      if (meta.sourceId && componentPath[componentPath.length - 1] !== meta.sourceId) {
        componentPath.push(meta.sourceId);
      }
      if (meta.targetId && componentPath[componentPath.length - 1] !== meta.targetId) {
        componentPath.push(meta.targetId);
      }
    });

    const reasonLine = (reasoning || '').trim() || routeMeta.fallback;
    const pathLine = componentPath.length > 0 ? componentPath.join(' -> ') : 'UI -> LG -> OUT';

    return [
      `Route: ${routeMeta.label}`,
      `Why this path\n${reasonLine}`,
      `Execution sequence\n${pathLine}`,
    ].join('\n\n');
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const resolveMcpToolNames = (apiResult: any): string[] => {
    const normalizeToolName = (value: string): string | null => {
      const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const knownTools: Record<string, string> = {
        stockprice: 'StockPrice',
        weather: 'Weather',
        news: 'News',
        dictionary: 'Dictionary',
        wikipedia: 'Wikipedia',
        worldclock: 'WorldClock',
        currency: 'Currency',
        unitconverter: 'UnitConverter',
        calculator: 'Calculator',
        websearch: 'WebSearch',
      };
      return knownTools[normalized] || null;
    };

    const detectedTools = new Set<string>();

    const executionLog = Array.isArray(apiResult?.execution_log) ? apiResult.execution_log : [];
    const toolNode = executionLog.find((entry: any) => entry?.node === 'tools');
    if (Array.isArray(toolNode?.tool_names)) {
      toolNode.tool_names.forEach((name: string) => {
        const mapped = normalizeToolName(String(name));
        if (mapped) detectedTools.add(mapped);
      });
    }

    const toolResults = Array.isArray(apiResult?.tool_results) ? apiResult.tool_results : [];
    toolResults.forEach((result: string) => {
      const nameMatch = String(result).match(/^Tool\s*\[(.+?)\]/i);
      if (nameMatch?.[1]) {
        const mapped = normalizeToolName(nameMatch[1]);
        if (mapped) detectedTools.add(mapped);
      }
    });

    if (detectedTools.size > 0) {
      return Array.from(detectedTools);
    }

    const candidates = [
      apiResult?.tool_results,
      apiResult?.execution_log,
      apiResult?.final_response,
    ];
    const haystack = candidates
      .filter(Boolean)
      .map(item => (typeof item === 'string' ? item : JSON.stringify(item)))
      .join(' ')
      .toLowerCase();

    const toolMatchers: Array<{ id: string; terms: string[] }> = [
      { id: 'StockPrice', terms: ['stock', 'price', 'ticker', 'quote'] },
      { id: 'Weather', terms: ['weather', 'temperature', 'forecast'] },
      { id: 'News', terms: ['news', 'headline'] },
      { id: 'Dictionary', terms: ['dictionary', 'define', 'definition'] },
      { id: 'Wikipedia', terms: ['wikipedia'] },
      { id: 'WorldClock', terms: ['worldclock', 'world clock', 'timezone', 'time zone', 'utc'] },
      { id: 'Currency', terms: ['currency', 'exchange', 'fx', 'usd', 'eur', 'gbp', 'inr', 'jpy'] },
      { id: 'UnitConverter', terms: ['convert', 'conversion', 'meter', 'gram', 'inch', 'kg', 'lbs', 'mile', 'km'] },
      { id: 'Calculator', terms: ['calculator', 'calculate', 'math', 'equation', 'arithmetic'] },
      { id: 'WebSearch', terms: ['search', 'web', 'google'] },
    ];

    // Collect ALL matched tools, not just the first one
    const allMatched: string[] = [];
    for (const matcher of toolMatchers) {
      if (matcher.terms.some(term => haystack.includes(term))) {
        allMatched.push(matcher.id);
      }
    }

    // Remove UnitConverter if Currency is already detected (avoid ambiguity with "convert")
    if (allMatched.includes('Currency') && allMatched.includes('UnitConverter')) {
      return allMatched.filter(tool => tool !== 'UnitConverter');
    }

    return allMatched.length > 0 ? allMatched : [];
  };

  const formatArchitectureStepLog = (
    step: WorkflowStep,
    activePrompt: string,
    index: number,
    executionLog: any[],
    finalOutput?: string
  ): LogEntry | null => {
    const meta = STEP_METADATA[step];
    if (!meta || !meta.sourceId || !meta.targetId) return null;

    const stepDetails = getStepDetails(step, meta, activePrompt, finalOutput);
    const ragEntry = executionLog.find((entry: any) => entry?.node === 'rag');
    const toolEntry = executionLog.find((entry: any) => entry?.node === 'tools');
    const plannerEntry = executionLog.find((entry: any) => entry?.node === 'planner');
    const synthEntry = executionLog.find((entry: any) => entry?.node === 'synthesizer');

    let details = stepDetails.details;

    if (step === WorkflowStep.LLM_TO_LG_PLAN && plannerEntry?.reasoning) {
      details = `${details} | Planner reasoning: ${plannerEntry.reasoning}`;
    }

    return {
      id: `exec_${Date.now()}_${index}_${Math.random().toString(16).slice(2)}`,
      type: 'EXEC',
      message: meta.label,
      timestamp: new Date().toLocaleTimeString(),
      details,
      source: ARCHITECTURE_COMPONENTS[meta.sourceId]?.name || meta.sourceId,
      destination: ARCHITECTURE_COMPONENTS[meta.targetId]?.name || meta.targetId,
      inputData: stepDetails.inputData,
      transformedData: stepDetails.transformedData,
    };
  };

  const waitWithPause = async (ms: number, runId: number) => {
    let elapsed = 0;
    const tick = 80;
    while (elapsed < ms) {
      if (runIdRef.current !== runId) return false;
      if (isPausedRef.current) {
        await sleep(120);
        continue;
      }
      await sleep(tick);
      elapsed += tick;
    }
    return runIdRef.current === runId;
  };

  const animateWorkflow = async (
    steps: WorkflowStep[],
    activePrompt: string,
    runId: number,
    options?: { delayMs?: number; logExec?: boolean; mcpToolNames?: string[] }
  ) => {
    const delayMs = options?.delayMs ?? 520;
    const logExec = options?.logExec ?? true;
    const mcpToolNames = options?.mcpToolNames || [];

    setActivePath([]);

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (runIdRef.current !== runId) return false;

      if (step === WorkflowStep.LG_TO_MCP || step === WorkflowStep.MCP_TO_LG) {
        // Set all tool names for compound queries
        setActiveToolNames(mcpToolNames.length > 0 ? mcpToolNames : ['Calculator']);
        setActiveToolName(mcpToolNames.length > 0 ? mcpToolNames[0] : 'Calculator');
      } else {
        setActiveToolName(undefined);
        setActiveToolNames([]);
      }

      const meta = STEP_METADATA[step];
      const stepDetails = meta ? getStepDetails(step, meta, activePrompt) : null;
      const logEntry: LogEntry | null = logExec && meta && stepDetails ? {
        id: `step_${step}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: 'EXEC',
        message: meta.label,
        timestamp: new Date().toLocaleTimeString(),
        details: stepDetails.details,
        source: meta.sourceId,
        destination: meta.targetId,
        inputData: stepDetails.inputData,
        transformedData: stepDetails.transformedData,
      } : null;

      setState(prev => ({
        ...prev,
        currentStep: step,
        logs: logEntry ? [...prev.logs, logEntry] : prev.logs,
      }));
      setActivePath(prev => [...prev, step]);

      const shouldHold = index < steps.length - 1 || step === WorkflowStep.LG_TO_OUT;
      if (shouldHold) {
        const canContinue = await waitWithPause(delayMs, runId);
        if (!canContinue) return false;
      }
    }

    setActiveToolName(undefined);
    setActiveToolNames([]);

    if (runIdRef.current === runId) {
      setState(prev => ({
        ...prev,
        currentStep: WorkflowStep.COMPLETED,
      }));
      return true;
    }

    return false;
  };

  const runSimulation = async (customPrompt?: string) => {
    const activePrompt = customPrompt || prompt;
    if (!activePrompt.trim() || isSimulating) return;
    
    const runId = ++runIdRef.current;
    toolDataRef.current = [];
    ragDataRef.current = null;
    setActiveToolName(undefined);
    
    if (customPrompt) setPrompt(customPrompt);
    
    setIsSimulating(true);
    setIsPaused(false);
    setActiveModelName("llama-3.3-70b");
    setIsUsingRealLLM(true);
    setShowFinalOutput(false);
    setPathHistory(prev => [
      {
        prompt: activePrompt,
        reasoning: 'Processing...\n\nRoute: Detecting...\n\nExecution sequence\nPending',
        logId: `processing_${Date.now()}`,
      },
      ...prev,
    ]);

    // ═══ Backend API Mode (Always - System is Fully Autonomous) ═══════════════
    // The system now always uses intelligent backend routing without approval gates.
    // This ensures precision, accuracy, and intelligent task-based model selection.
    try {
      setState(prev => ({
        ...prev,
        logs: [
          ...prev.logs,
          {
            id: `api_call_${Date.now()}`,
            type: 'SYSTEM',
            message: 'Calling Backend Workflow API',
            timestamp: new Date().toLocaleTimeString(),
            details: `Query: "${activePrompt}"`,
          },
        ],
      }));

      // Create an abort controller with 60-second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 60000);
      
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: activePrompt,
          enable_interrupts: false,  // Always disabled for autonomous execution
          verbose: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      toolDataRef.current = Array.isArray(result.tool_results) ? result.tool_results : [];
      const activeMcpTools = resolveMcpToolNames(result);

      // Parse execution log to animate through intermediate steps
      const executionLog = result.execution_log || [];

      // Add architecture transition logs with beginner-friendly data transformations
      const expectedSteps = buildStepPathFromRoute(result.route);
      const newLogs = expectedSteps
        .map((step, index) => formatArchitectureStepLog(step, activePrompt, index, executionLog, result.final_response))
        .filter((entry): entry is LogEntry => Boolean(entry));

      // Workflow always completes (no interrupts)
      const completedLogId = `completed_${Date.now()}`;
      const analysisSteps = buildStepPathFromRoute(result.route);
      const analysisText = buildPathAnalysis(result.route, result.plan_reasoning, analysisSteps);
      setState(prev => ({
        ...prev,
        finalInput: activePrompt,
        finalOutput: result.final_response,
        logs: [
          ...prev.logs,
          ...newLogs,
          {
            id: completedLogId,
            type: 'SYSTEM',
            message: 'Workflow Completed',
            timestamp: new Date().toLocaleTimeString(),
            details: `Route: ${result.route || 'unknown'}`,
          },
        ],
      }));

      setPathHistory(prev => {
        if (prev.length === 0) {
          return [
            {
              prompt: activePrompt,
              reasoning: analysisText,
              logId: completedLogId,
              output: result.final_response,
            },
          ];
        }
        const updated = [...prev];
        updated[0] = {
          prompt: activePrompt,
          reasoning: analysisText,
          logId: completedLogId,
          output: result.final_response,
        };
        return updated;
      });

      const animationCompleted = await animateWorkflow(expectedSteps, activePrompt, runId, { delayMs: 850, logExec: false, mcpToolNames: activeMcpTools });
      if (animationCompleted && runIdRef.current === runId) {
        setShowFinalOutput(true);
      }

      setActiveModelName(result.active_model || 'Backend API');
      setIsUsingRealLLM(true);
      setIsSimulating(false);
      setPrompt('');
      return;
    } catch (error) {
      let errorMessage = String(error);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timeout - Backend is not responding (60 second timeout)';
        } else {
          errorMessage = error.message;
        }
      }
      const fallbackReason = `Backend API failed: ${errorMessage}`;
      
      setState(prev => ({
        ...prev,
        logs: [
          ...prev.logs,
          {
            id: `api_error_${Date.now()}`,
            type: 'SYSTEM',
            message: 'API Call Failed',
            timestamp: new Date().toLocaleTimeString(),
            details: `${errorMessage}. Falling back to local simulation.`,
          },
        ],
      }));
      const mathResult = tryEvaluateMath(activePrompt);
      if (mathResult) {
        const fallbackLogId = `fallback_math_${Date.now()}`;
        const analysisText = buildPathAnalysis('direct', `Local calculator used due to backend unavailability. ${fallbackReason}`, buildStepPathFromRoute('direct'));
        const fallbackSteps = buildStepPathFromRoute('direct');
        setState(prev => ({
          ...prev,
          finalInput: activePrompt,
          finalOutput: mathResult,
          logs: [
            ...prev.logs,
            {
              id: fallbackLogId,
              type: 'SYSTEM',
              message: 'Local Calculator Fallback',
              timestamp: new Date().toLocaleTimeString(),
              details: `Backend unavailable. Computation evaluated locally. ${fallbackReason}`,
            },
          ],
        }));
        setPathHistory(prev => {
          if (prev.length === 0) {
            return [{ prompt: activePrompt, reasoning: analysisText, logId: fallbackLogId, output: mathResult }];
          }
          const updated = [...prev];
          updated[0] = { prompt: activePrompt, reasoning: analysisText, logId: fallbackLogId, output: mathResult };
          return updated;
        });
        const animationCompleted = await animateWorkflow(fallbackSteps, activePrompt, runId, { delayMs: 850, logExec: false, mcpToolNames: ['Calculator'] });
        if (animationCompleted && runIdRef.current === runId) {
          setShowFinalOutput(true);
        }
        setActiveModelName('Local Calculator');
        setIsUsingRealLLM(false);
        setIsSimulating(false);
        setPrompt('');
        return;
      }
    }
  };

  const handleNodeClick = async (nodeId: string) => {
    setSelectedNode(nodeId);
    setLoadingInsight(true);
    setNodeInsight(null);
    const component = ARCHITECTURE_COMPONENTS[nodeId];
    if (component) {
      const staticInsight = `${component.description}\n\nStatus: ${state.currentStep || 'Idle'}\nTask: ${prompt || 'None'}`;
      setNodeInsight(staticInsight);
      setActiveModelName('Backend (Static)');
      setIsUsingRealLLM(false);
    }
    setLoadingInsight(false);
  };

  return (
    <div className={`flex flex-col h-screen ${isDarkMode ? 'bg-[#020617] text-slate-200' : 'bg-slate-50 text-slate-700'} overflow-hidden font-sans selection:bg-blue-500/30`}>
      <header className={`flex justify-between items-center px-10 py-6 border-b ${isDarkMode ? 'border-slate-800/50 bg-[#080c14]/90' : 'border-slate-200 bg-white/90'} backdrop-blur-2xl shrink-0 z-20`}>
        <div className="flex items-center gap-5">
          <div className={`w-12 h-12 rounded-2xl bg-transparent flex items-center justify-center border-2 border-blue-500/70 group ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
              <rect x="5" y="7" width="14" height="12" rx="3" />
              <path d="M12 4v3" />
              <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
              <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
              <path d="M9 16h6" />
              <path d="M5 11H3" />
              <path d="M21 11h-2" />
            </svg>
          </div>
          <div>
            <h1 className={`text-xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'} uppercase italic leading-tight`}>AI Flow <span className="text-blue-500 font-light">Visualizer</span></h1>
            {isSimulating && (
              <div className="flex items-center gap-2 mt-1">
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full animate-pulse">
                  <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                  <span className="text-[9px] font-bold text-emerald-400 uppercase">{isPaused ? 'Paused' : 'RUNNING'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4">

          <input
            type="text"
            value={prompt}
            disabled={isSimulating}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSimulation()}
            placeholder="Describe your agentic objective..."
            className={`${isDarkMode ? 'bg-slate-900/60 border-slate-800/80 placeholder:text-slate-700 text-slate-200' : 'bg-white border-slate-200 placeholder:text-slate-400 text-slate-800'} border px-6 py-3 rounded-2xl w-[300px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all shadow-lg disabled:opacity-50`}
          />
          
          {/* Require Approval checkbox hidden - System is fully autonomous */}
          
          <div className="flex gap-2">
            {isSimulating ? (
              <button
                onClick={() => setIsPaused(!isPaused)}
                className={`px-6 py-3 rounded-2xl font-black text-[10px] ${isDarkMode ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'} uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95`}
              >
                {isPaused ? 'Resume' : 'Pause'}
              </button>
            ) : (
              <button
                onClick={() => {
                  runSimulation();
                }}
                disabled={!prompt.trim()}
                title={!prompt.trim() ? 'Enter a prompt to run' : 'Click to run workflow'}
                className={`px-8 py-3 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95 ${
                  !prompt.trim() 
                    ? 'bg-slate-500/30 text-slate-500 cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                }`}
              >
                RUN
              </button>
            )}
            
            <button 
              onClick={resetSimulation}
              className={`px-4 py-3 rounded-2xl border ${isDarkMode ? 'border-slate-800 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-100 text-slate-600'} transition-colors`}
              title="Reset Simulation"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>

            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`px-4 py-3 rounded-2xl border ${isDarkMode ? 'border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white' : 'border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-900'} transition-colors`}
              title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDarkMode ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 md:p-8 overflow-hidden relative">
        <div className="flex-1 flex flex-row gap-6 mb-4 min-h-0 relative">
          <div className={`${isFullscreen ? '' : 'w-3/4'} relative rounded-[2.5rem] overflow-hidden border ${isDarkMode ? 'border-slate-800/20 bg-slate-900/5' : 'border-slate-200 bg-white/50'}`}>
            <AnimatedFlow 
            currentStep={state.currentStep} 
            onNodeClick={handleNodeClick} 
            onPayloadClick={(data) => {
               const matchedLog = [...state.logs].reverse().find(l => l.message.toLowerCase().includes(data.toLowerCase().replace('_', ' ')));
               if (matchedLog) {
                 setActivePayloadDetail(matchedLog);
                 setIsPaused(true);
               }
            }}
            isPaused={isPaused} 
            prompt={prompt} 
            isDarkMode={isDarkMode}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen(prev => !prev)}
            activeToolName={activeToolName}
            activeToolNames={activeToolNames}
          />
          
          {activePayloadDetail && (
            <div className={`fixed inset-0 ${isDarkMode ? 'bg-[#020617]/70' : 'bg-slate-200/50'} backdrop-blur-2xl z-[300] flex items-center justify-center p-6 md:p-12 animate-in fade-in duration-300`}>
               <div className={`w-full max-w-2xl ${isDarkMode ? 'bg-[#0b1120]' : 'bg-white'} border border-blue-500/30 rounded-[2.5rem] shadow-[0_0_100px_rgba(37,99,235,0.2)] p-6 md:p-10 relative overflow-hidden`}>
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500" />
                  
                  <div className="flex justify-between items-start mb-8">
                    <div>
                      <h3 className="text-base font-black uppercase tracking-[0.4em] text-blue-400">Component Transaction Inspector</h3>
                      <p className="text-xs text-slate-500 mt-2 font-mono flex items-center gap-2">
                        <span className={`px-2 py-0.5 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} rounded border`}>{activePayloadDetail.source || 'SYSTEM'}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                        <span className={`px-2 py-0.5 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} rounded border`}>{activePayloadDetail.destination || 'NODE'}</span>
                      </p>
                    </div>
                    <button 
                      onClick={() => setActivePayloadDetail(null)}
                      className={`p-3 ${isDarkMode ? 'bg-white/5 hover:bg-white/10 hover:text-white' : 'bg-slate-100 hover:bg-slate-200 hover:text-slate-900'} rounded-2xl transition-all text-slate-400 group border border-transparent`}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="group-hover:rotate-90 transition-transform">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                  
                  <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                        <h4 className="text-xs font-black uppercase text-slate-500 tracking-widest">Ingress Packet</h4>
                      </div>
                      <div className={`${isDarkMode ? 'bg-[#020617] border-white/5' : 'bg-slate-50 border-slate-200'} p-6 rounded-2xl border font-mono text-sm overflow-x-auto shadow-inner`}>
                        <pre className="text-slate-400 leading-relaxed">
                          {typeof activePayloadDetail.inputData === 'string' ? activePayloadDetail.inputData : JSON.stringify(activePayloadDetail.inputData, null, 2)}
                        </pre>
                      </div>
                    </div>

                    <div className="flex justify-center py-2">
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="3">
                          <path d="M12 5v14M5 12l7 7-7 7"/>
                        </svg>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                        <h4 className="text-xs font-black uppercase text-blue-500 tracking-widest">Egress Result</h4>
                      </div>
                      <div className={`${isDarkMode ? 'bg-[#020617]' : 'bg-slate-50'} p-6 rounded-2xl border border-blue-500/20 font-mono text-sm overflow-x-auto`}>
                        <pre className="text-emerald-400 leading-relaxed">
                          {typeof activePayloadDetail.transformedData === 'string' ? activePayloadDetail.transformedData : JSON.stringify(activePayloadDetail.transformedData, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>

                  <div className={`mt-8 flex items-center justify-between border-t ${isDarkMode ? 'border-white/5' : 'border-slate-200'} pt-6`}>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      <p className="text-xs text-slate-500 uppercase font-black tracking-widest">Trace Protocol: AGENT-v3</p>
                    </div>
                    <p className="text-xs text-slate-700 font-mono font-bold uppercase">{activePayloadDetail.timestamp}</p>
                  </div>
               </div>
            </div>
          )}

          </div>

          <div className={`${isFullscreen ? 'fixed right-8 top-32 bottom-24 w-[380px] z-[300] shadow-2xl pb-4' : 'w-1/4 h-full flex'} flex-col ${isDarkMode ? 'bg-slate-950/40 border-slate-800/40' : 'bg-white/80 border-slate-200'} border rounded-[2.5rem] overflow-hidden transition-all duration-300 ${!selectedNode && isFullscreen ? 'translate-x-[120%] opacity-0 pointer-events-none' : 'translate-x-0 opacity-100'}`}>
            {selectedNode ? (
              <div className={`flex flex-col h-full animate-in slide-in-from-right-8 duration-500 ${isDarkMode ? 'bg-[#020617]/90 backdrop-blur-xl' : 'bg-white/95 backdrop-blur-xl'}`}>
                <div className="p-8 pb-4 shrink-0 flex justify-between items-start">
                  <div>
                    <h2 className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-500/80 mb-2">Component</h2>
                    <h3 className={`text-xl font-black ${isDarkMode ? 'text-white' : 'text-slate-900'} leading-none`}>{ARCHITECTURE_COMPONENTS[selectedNode]?.name}</h3>
                    {componentSubtitles[selectedNode] && (
                      <p className={`text-[10px] font-black uppercase tracking-[0.2em] mt-2 ${isDarkMode ? 'text-blue-400/80' : 'text-blue-600/80'}`}>
                        {componentSubtitles[selectedNode]}
                      </p>
                    )}
                  </div>
                  <button onClick={() => setSelectedNode(null)} className={`p-2 ${isDarkMode ? 'hover:bg-white/10 text-slate-500 hover:text-white' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-800'} rounded-xl transition-colors`}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar space-y-8">
                  <div className="space-y-3">
                    <h4 className="text-[9px] font-black uppercase text-slate-600 tracking-widest">Logic Role</h4>
                    <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'} leading-relaxed font-medium`}>{ARCHITECTURE_COMPONENTS[selectedNode]?.description}</p>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-[9px] font-black uppercase text-slate-600 tracking-widest">Tech Stack</h4>
                    <div className="flex flex-wrap gap-2">
                      {ARCHITECTURE_COMPONENTS[selectedNode]?.techStack.map(s => (
                        <span key={s} className="px-2.5 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/10 rounded-md text-[9px] font-black uppercase tracking-wider">{s}</span>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-[9px] font-black uppercase text-slate-600 tracking-widest">Internal Architecture</h4>
                    <div className="flex flex-col gap-1.5">
                      {ARCHITECTURE_COMPONENTS[selectedNode]?.internalDetails ? (
                        ARCHITECTURE_COMPONENTS[selectedNode].internalDetails!.map((detail, idx) => (
                          <InternalComponentDetail key={idx} detail={detail} isDarkMode={isDarkMode} />
                        ))
                      ) : (
                         <span className="text-slate-500 text-[9px] italic">No internal component details available.</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`flex flex-col h-full ${isDarkMode ? 'bg-slate-950/30' : 'bg-slate-50/50'}`}>
                <div className="p-8 pb-4 shrink-0">
                  <h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/> Path Analysis
                  </h3>
                </div>
                <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
                  {pathHistory.length > 0 ? (
                    <div className="space-y-4 animate-in slide-in-from-right-4 fade-in duration-500">
                      {pathHistory.map((item, index) => (
                        <div key={`${item.prompt}-${index}`} className={`${index === 0 ? (isDarkMode ? 'bg-[#0b1221] border-blue-500/10' : 'bg-white border-slate-200') : (isDarkMode ? 'bg-[#0b1221]/40 border-slate-800/40' : 'bg-slate-50 border-slate-200/60')} p-4 rounded-xl border shadow-sm relative overflow-hidden`}>
                          {index === 0 && (
                            <div className="absolute top-0 left-0 w-0.5 h-full bg-gradient-to-b from-blue-500 to-transparent opacity-50 block"/>
                          )}
                          <div className="flex items-center justify-between mb-2">
                            <div className={`${index === 0 ? (isDarkMode ? 'text-slate-200' : 'text-slate-800') : (isDarkMode ? 'text-slate-500' : 'text-slate-400')} text-[10px] uppercase tracking-widest font-black`}>
                              {index === 0 ? 'Latest Question' : 'Previous Question'}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {item.output && (
                                <button
                                  onClick={() => setPathOutputView({ prompt: item.prompt, output: item.output! })}
                                  className={`${isDarkMode ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20' : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'} text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors`}
                                >
                                  Output
                                </button>
                              )}
                              <button
                                onClick={() => openLogEntry(item.logId)}
                                className={`${isDarkMode ? 'bg-slate-900/60 text-slate-300 border-slate-700/60 hover:bg-slate-900' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'} text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors`}
                              >
                                Log
                              </button>
                            </div>
                          </div>
                          <div className={`${index === 0 ? (isDarkMode ? 'text-slate-300' : 'text-slate-700') : (isDarkMode ? 'text-slate-500' : 'text-slate-400')} text-[10px] font-mono mb-3`}>
                            "{item.prompt}"
                          </div>
                          {index !== 0 && (
                            <div className="mb-2">
                              <span className={`${isDarkMode ? 'bg-slate-800/60 text-slate-400 border-slate-700/60' : 'bg-slate-100 text-slate-500 border-slate-200'} text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border`}>
                                {item.reasoning.split('\n')[0]}
                              </span>
                            </div>
                          )}
                          {index === 0 && item.reasoning.split('\n\n').map((block, i) => (
                            <div key={i} className="mb-3 last:mb-0">
                              {block.split('\n').map((line, j) => (
                                <div key={j} className={j===0 ? `font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'} text-[11px] mb-2 uppercase tracking-wide` : `text-[10px] ${isDarkMode ? 'text-slate-400 border-slate-800' : 'text-slate-600 border-slate-200'} pl-2 border-l ml-0.5 py-0.5`}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-700 opacity-60 space-y-4">
                      <div className={`w-12 h-12 rounded-full ${isDarkMode ? 'border-slate-800 bg-slate-900/50' : 'border-slate-200 bg-slate-100'} flex items-center justify-center border`}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18l6-6-6-6"/></svg>
                      </div>
                      <p className="text-[9px] uppercase font-black tracking-widest">Awaiting Input</p>
                    </div>
                  )}
                </div>
                {/* Model Indicator Footer */}
                <div className="px-8 py-3 border-t border-slate-200/5 dark:border-white/5 flex items-center justify-end gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${isSimulating ? 'bg-amber-500 animate-pulse' : (activeModelName.includes('Offline') ? 'bg-red-500' : 'bg-blue-500')}`}/>
                  <span className={`text-[9px] font-mono uppercase tracking-wider ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                    Active Model: <span className="text-slate-400 dark:text-slate-300 font-bold">{activeModelName}</span>
                  </span>
                  {isSimulating && (
                    <span className={`text-[9px] font-mono uppercase tracking-wider ${isDarkMode ? 'text-amber-400/80' : 'text-amber-600/80'}`}>
                      <span className="inline-block w-1 h-1 rounded-full bg-amber-400 mr-1 animate-pulse" />
                      Running
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className={`transition-all duration-500 ease-in-out ${isDarkMode ? 'bg-slate-950/40 border-slate-800/40' : 'bg-white/80 border-slate-200'} border rounded-3xl flex flex-col overflow-hidden shadow-2xl ${isTelemetryCollapsed ? 'h-12' : 'h-80'}`}>
          <div className={`flex justify-between items-center px-6 py-3 border-b ${isDarkMode ? 'border-slate-800/30' : 'border-slate-200'}`}>
            <div 
              className="flex items-center gap-4 cursor-pointer"
              onClick={() => setIsTelemetryCollapsed(!isTelemetryCollapsed)}
            >
              <span className="text-slate-600 uppercase font-black tracking-[0.3em] text-[10px]">Flow Activity Tracking</span>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[8px] font-bold uppercase tracking-tighter text-emerald-400">
                  LLM: {isUsingRealLLM ? 'Real' : 'Fallback'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${isSimulating ? 'bg-blue-500 animate-pulse' : 'bg-slate-700'}`} />
                <span className="text-[8px] text-slate-600 font-bold uppercase tracking-tighter">Sync: {isSimulating ? 'Active' : 'Standby'}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
               <button 
                 onClick={() => setIsTelemetryCollapsed(!isTelemetryCollapsed)}
                 className="text-slate-500 hover:text-white"
               >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform duration-300 ${isTelemetryCollapsed ? '' : 'rotate-180'}`}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            </div>
          </div>

          {!isTelemetryCollapsed && (
            <div className={`flex-1 flex divide-x ${isDarkMode ? 'divide-slate-800/30' : 'divide-slate-200'} overflow-hidden`}>
              <div className="flex-[4] p-5 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-4 pr-3 custom-scrollbar font-mono text-sm" ref={scrollRef}>
                  {[...logRuns].reverse().map((run, runIndex) => (
                    <div key={`run-${runIndex}`} className="space-y-2.5">
                      {run.map((log) => {
                        const isExec = log.type === 'EXEC';
                        return (
                          <div
                            id={`log-${log.id}`}
                            key={log.id}
                            className={`group/log flex gap-4 items-start animate-in fade-in slide-in-from-left-4 duration-500 border-l-2 pl-2 transition-colors relative ${highlightedLogId === log.id ? (isDarkMode ? 'border-blue-400 bg-blue-500/10 shadow-[0_0_12px_rgba(59,130,246,0.25)] animate-[pulse_1.1s_ease-in-out_infinite]' : 'border-blue-500 bg-blue-50 shadow-[0_0_12px_rgba(59,130,246,0.2)] animate-[pulse_1.1s_ease-in-out_infinite]') : 'border-transparent hover:border-blue-500/30'}`}
                          >
                            <span className="text-slate-700 font-black tabular-nums shrink-0 uppercase w-12 tracking-tighter text-sm">
                              {log.timestamp.split(' ')[0]}
                            </span>
                            <div className="flex-1">
                               {isExec ? (
                                 <div className="flex justify-between items-start pr-12">
                                   <div className="flex flex-col gap-0.5">
                                     <div className="text-blue-400 font-black uppercase tracking-widest text-xs">
                                       {log.source} → {log.destination}
                                     </div>
                                     <div className="text-slate-500 leading-tight text-sm">
                                       {log.details}
                                     </div>
                                   </div>
                                 </div>
                               ) : (
                                 <span className={`${log.type === 'SYSTEM' ? (isDarkMode ? 'text-white' : 'text-slate-900') + ' font-bold' : 'text-slate-600'} leading-tight`}>
                                   {log.message}: {log.details}
                                 </span>
                               )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              
            </div>
          )}
        </div>

        {(showFinalOutput && state.finalInput && state.finalOutput) && (
          <div className="fixed top-1/2 right-10 -translate-y-1/2 w-full max-w-xl bg-[#080c14]/98 border border-emerald-500/20 backdrop-blur-3xl rounded-[2.5rem] p-8 shadow-[0_50px_100px_rgba(0,0,0,0.8)] z-[300] animate-in slide-in-from-right duration-500 max-h-[85vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center gap-4 mb-6 sticky top-0 py-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
              <span className="text-[12px] font-black uppercase tracking-[0.4em] text-emerald-400">Synthesis Complete</span>
              <button onClick={() => {
                setState(s => ({...s, finalInput: undefined, finalOutput: undefined}));
                setShowFinalOutput(false);
              }} className="ml-auto p-2.5 text-slate-600 hover:text-white transition-colors bg-white/5 rounded-2xl border border-white/5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="bg-slate-950/60 p-8 rounded-[2rem] border border-white/5 space-y-6 shadow-inner">
              <div className="border-b border-white/5 pb-6">
                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3">Input Objective</h4>
                <p className="text-slate-100 text-[14px] leading-relaxed font-bold font-mono italic">
                  "{state.finalInput}"
                </p>
              </div>
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3">Architect's Response</h4>
                <div className="prose prose-invert prose-sm max-w-none">
                  <p className="text-emerald-400/90 text-[14px] leading-relaxed font-medium font-mono whitespace-pre-wrap">
                    {state.finalOutput}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-8 text-center">
              <p className="text-[9px] text-slate-600 uppercase font-black tracking-widest">Cycle verified by Architect Engine Engine-v3</p>
            </div>
          </div>
        )}

        {/* Path Analysis Output Viewer */}
        {pathOutputView && (
          <div className="fixed top-1/2 right-10 -translate-y-1/2 w-full max-w-xl bg-[#080c14]/98 border border-blue-500/20 backdrop-blur-3xl rounded-[2.5rem] p-8 shadow-[0_50px_100px_rgba(0,0,0,0.8)] z-[200] animate-in slide-in-from-right duration-500 max-h-[85vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center gap-4 mb-6 sticky top-0 py-2">
              <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]" />
              <span className="text-[12px] font-black uppercase tracking-[0.4em] text-blue-400">Stored Output</span>
              <button onClick={() => setPathOutputView(null)} className="ml-auto p-2.5 text-slate-600 hover:text-white transition-colors bg-white/5 rounded-2xl border border-white/5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="bg-slate-950/60 p-8 rounded-[2rem] border border-white/5 space-y-6 shadow-inner">
              <div className="border-b border-white/5 pb-6">
                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3">Input Objective</h4>
                <p className="text-slate-100 text-[14px] leading-relaxed font-bold font-mono italic">
                  "{pathOutputView.prompt}"
                </p>
              </div>
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3">Architect's Response</h4>
                <div className="prose prose-invert prose-sm max-w-none">
                  <p className="text-blue-400/90 text-[14px] leading-relaxed font-medium font-mono whitespace-pre-wrap">
                    {pathOutputView.output}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-8 text-center">
              <p className="text-[9px] text-slate-600 uppercase font-black tracking-widest">Retrieved from Path Analysis History</p>
            </div>
          </div>
        )}
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default App;
