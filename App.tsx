
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { WorkflowStep, SimulationState, LogEntry } from './types';
import { ARCHITECTURE_COMPONENTS, STEP_METADATA } from './constants';
import AnimatedFlow from './components/AnimatedFlow';
import { getArchitectInsight, chatWithArchitect, hasAnyApiKeys } from './services/geminiService';

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
  const [activeLogicPanel, setActiveLogicPanel] = useState<any | null>(null);
  const [pathReasoning, setPathReasoning] = useState<string | null>(null);
  const [pathHistory, setPathHistory] = useState<{ prompt: string; reasoning: string; logId: string }[]>([]);
  const [highlightedLogId, setHighlightedLogId] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<WorkflowStep[]>([]);
  const [activeModelName, setActiveModelName] = useState<string>("Llama 3.3 70B");
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hasKeys = useMemo(() => hasAnyApiKeys(), []);
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

  const logicPanels = [
    {
      id: 'rag-only',
      title: 'Only RAG Flow Path',
      description: 'Targeted for proprietary knowledge retrieval. Skips external MCP to maintain data gravity.',
      path: 'UI → LG → RAG → VDB',
      details: 'This architectural pattern prioritizes data sovereignty and internal knowledge base retrieval. It bypasses external tool execution (MCP) to ensure that sensitive data remains within the controlled environment. Ideal for answering questions based solely on indexed documentation.',
      color: 'text-blue-400',
      borderColor: 'border-blue-500/20',
      bgColor: 'bg-blue-500/10'
    },
    {
      id: 'mcp-only',
      title: 'Only MCP Flow Path',
      description: 'Targeted for real-time external tool orchestration via standardized interface.',
      path: 'UI → LG → MCP → LG',
      details: 'Focuses on action execution and real-time data fetching from external systems. This pattern bypasses the internal knowledge base (RAG) to reduce latency when only tool interaction is required, such as checking stock prices or controlling IoT devices.',
      color: 'text-amber-400',
      borderColor: 'border-amber-500/20',
      bgColor: 'bg-amber-500/10'
    },
    {
      id: 'hybrid',
      title: 'Hybrid RAG + MCP Path',
      description: 'The optimal agentic cycle. Combines retrieved context with real-time tool execution.',
      path: 'UI → LG → RAG → MCP → LG',
      details: 'This is the most comprehensive pattern, leveraging both internal knowledge (RAG) for context and external tools (MCP) for action. It enables complex reasoning where the agent first retrieves relevant policy or history, then uses that information to parameterize external API calls.',
      color: 'text-emerald-400',
      borderColor: 'border-emerald-500/20',
      bgColor: 'bg-emerald-500/10'
    }
  ];

  const scrollRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(isPaused);
  const runIdRef = useRef(0);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [state.logs]);

  // Smarter contextualization based on prompt type
  const getStepDetails = (step: WorkflowStep, meta: any, activePrompt: string) => {
    let inputData = meta.inputData;
    let transformedData = meta.transformedData;
    
    // Determine the nature of the prompt
    const promptLower = activePrompt.toLowerCase();
    const isRagOnly = promptLower.includes("rag only");
    const isMcpOnly = promptLower.includes("mcp tools only");
    const isRagPreferred = [
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
    ].some(term => promptLower.includes(term));
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
        simpleTransformation = `Plan["Retrieve"] → { query: "keywords from ${shortPrompt}" }`;
        break;
      case WorkflowStep.RAG_TO_VDB:
        simpleTransformation = `{ query: "keywords..." } → Vector_Embedding[0.82, -0.41, 0.19, ...]`;
        break;
      case WorkflowStep.VDB_TO_RAG:
        simpleTransformation = `Vector Search → [ "Document_Chunk_A (92%)", "Document_Chunk_B (88%)" ]`;
        break;
      case WorkflowStep.RAG_TO_LG:
        simpleTransformation = `[Docs] → Context_Window("...retrieved content...")`;
        break;
      case WorkflowStep.LG_TO_MCP:
        simpleTransformation = `Plan["Execute"] → API_Call(tool="fetch_data", args={ query: "${shortPrompt}" })`;
        break;
      case WorkflowStep.MCP_TO_LG:
        simpleTransformation = `API_Response(200) → { status: "success", data: "Live Stream Result" }`;
        break;
      case WorkflowStep.LG_TO_LLM_EVAL:
        simpleTransformation = `{ context: "...", tool_data: "..." } → Final_Prompt("Synthesize answer for: ${shortPrompt}")`;
        break;
      case WorkflowStep.LLM_TO_LG_EVAL:
        simpleTransformation = "LLM writes the final response in plain language.";
        break;
      case WorkflowStep.LG_TO_OUT:
        simpleTransformation = "System streams the response to the screen in small chunks.";
        break;
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
    let replacements: Record<string, string> = {
        prompt: activePrompt,
        keywords: "Extracted Terms",
        topic: "Subject Matter",
        doc1: "Document_A.pdf",
        doc2: "Document_B.pdf",
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

    return {
      details: simpleTransformation, // Use our new readable string for the main log view
      inputData: processTemplate(inputData, replacements),
      transformedData: processTemplate(transformedData, replacements)
    };
  };

  const clearLogs = () => {
    setState(prev => ({
      ...prev,
      logs: [{ 
        id: `clear_${Date.now()}`, 
        type: 'SYSTEM', 
        message: 'Telemetry Purged', 
        timestamp: new Date().toLocaleTimeString(),
        details: 'Trace history wiped. Ready for fresh cycle.' 
      }]
    }));
  };

  const openLogEntry = (logId: string) => {
    setIsTelemetryCollapsed(false);
    setTimeout(() => {
      const target = document.getElementById(`log-${logId}`);
      if (target) {
        setHighlightedLogId(logId);
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
  };

  const runSimulation = async (customPrompt?: string) => {
    const activePrompt = customPrompt || prompt;
    if (!activePrompt.trim() || isSimulating) return;
    const runId = ++runIdRef.current;
    
    if (customPrompt) setPrompt(customPrompt);
    
    setIsSimulating(true);
    setIsPaused(false);
    setActiveModelName("llama-3.3-70b");
    // Removed auto-expansion of telemetry to keep it collapsed by default per user request
    // setIsTelemetryCollapsed(false); 


    let path: WorkflowStep[] = [
      WorkflowStep.UI_TO_LG,
      WorkflowStep.LG_TO_LLM_PLAN,
      WorkflowStep.LLM_TO_LG_PLAN,
    ];

    const promptLower = activePrompt.toLowerCase();
    
    // Improved Logic Detection
    // 1. Explicit overrides
    const isRagOnly = promptLower.includes("rag only");
    const isMcpOnly = promptLower.includes("mcp tools only");
    const isRagPreferred = /\b(polic(y|ies)|guide(s)?|doc(s|ument(ation)?)?|internal|knowledge(base)?|support|help(desk)?|in\s*house|organization(al)?)\b/.test(promptLower);
    const needsRealtimeTools = /\b(weather|temperature|forecast|news|latest|stock|price|cap|exchange|rate|currency|live|today|now|traffic|travel\s*time|flight|flights|delay|delays|arrival|departure|gate|crypto|bitcoin|ethereum|fx|forex|score|scores|sports|match|game|standings|schedule|event|events|concert|ticket|tickets|time|date|timezone|shipping|shipment|tracking|delivery|dispatch|courier|logistics|train|rail|platform|seat|availability|booking|pnr|eta|etd)\b/.test(promptLower);
    
    // 2. Direct simple query detection (Greetings)
    // Avoids RAG/MCP for trivial inputs like "Hi there"
    const isMath = !isRagOnly && !isMcpOnly && (
      /^[\d\s\+\-\*\/\(\)\.]+$/.test(activePrompt) || // Pure math
      /^\d+[\+\-\*\/]\d+/.test(activePrompt.replace(/\s/g,'')) || // Embedded math
      /\b(convert|conversion|unit|units)\b/.test(promptLower) ||
      /\b(celsius|fahrenheit|kelvin|km|kilometer|kilometre|miles|mile|meters|metres|feet|foot|inch|inches|kg|kilogram|kilograms|lb|lbs|pound|pounds|liter|litre|liters|litres|gallon|gallons|ml|milliliter|millilitre|milliliters|millilitres|cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|sq\s*ft|sq\s*ft\.|sq\s*feet|square\s*feet|sq\s*m|sq\s*meter|square\s*meters|square\s*metres|acre|acres|hectare|hectares|cubic\s*meter|cubic\s*metre|cubic\s*meters|cubic\s*metres|liter|litre|liters|litres|gallon|gallons|cc|cm3|m3)\b/.test(promptLower) ||
      /\b(kwh|kilowatt\s*hour|kilowatt\s*hours|btu|btus|watt\s*hour|wh|joule|joules|calorie|calories|kcal)\b/.test(promptLower) ||
      /\b(currency|exchange\s*rate|fx|forex|convert)\b/.test(promptLower) ||
      /\b(timezone|time\s*zone|utc|gmt|offset)\b/.test(promptLower) ||
      /\b(add|subtract|difference|days?|weeks?|months?|years?)\b.*\b(to|from|between)\b/.test(promptLower) ||
      /\b(date|time)\s+math\b/.test(promptLower)
    );
    const isDirect = !isRagOnly && !isMcpOnly && (
      ['hello', 'hi', 'hey', 'greetings'].some(s => promptLower.startsWith(s))
    );

    let reasoningText = "";

    if (isRagOnly) {
      // RAG Only
      path = [...path, WorkflowStep.LG_TO_RAG, WorkflowStep.RAG_TO_VDB, WorkflowStep.VDB_TO_RAG, WorkflowStep.RAG_TO_LG];
      reasoningText = "Route: RAG ONLY\n\n• User explicitly requested internal knowledge.\n• Accessing Vector DB for context.\n• Skipping external tools.";
    } else if (isMath) {
      // MCP Only for verified computation
      path = [...path, WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG];
      reasoningText = "Route: MCP ONLY\n\n• Computation detected.\n• Using tools for exact calculation.\n• Skipping internal knowledge base.";
    } else if (isMcpOnly) {
      // MCP Only
      path = [...path, WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG];
      reasoningText = "Route: MCP ONLY\n\n• User explicitly requested external tools.\n• Calling specific APIs.\n• Skipping internal knowledge base.";
    } else if (isDirect || (!isRagPreferred && !needsRealtimeTools)) {
      // Direct / Simple
      // Remove planning steps for super simple queries? 
      // Actually, let's keep planning but make it fast. 
      // But path above ALREADY added Plan steps.
      // So we just add EVAL steps. 
      // Wait, for simple math, we might want to skip RAG/MCP steps which is what the `else` block did.
      // So here we add NOTHING (no RAG, no MCP).
      reasoningText = isDirect
        ? "Route: DIRECT LLM\n\n• Query classified as simple/direct.\n• No retrieval needed.\n• No external tools needed.\n• Resolving via LLM internal knowledge."
        : "Route: DIRECT LLM\n\n• General question detected.\n• RAG not required.\n• No external tools needed.\n• Resolving via LLM internal knowledge.";
    } else if (needsRealtimeTools) {
      // MCP Only for real-time data
      path = [...path, WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG];
      reasoningText = "Route: MCP ONLY\n\n• Real-time data requested.\n• Calling external tools.\n• Skipping internal knowledge base.";
    } else {
      // Hybrid (Default for complex)
      path = [...path, WorkflowStep.LG_TO_RAG, WorkflowStep.RAG_TO_VDB, WorkflowStep.VDB_TO_RAG, WorkflowStep.RAG_TO_LG, WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG];
      reasoningText = "Route: HYBRID (RAG + MCP)\n\n• Complex intent detected.\n• Retrieving context from Vector DB.\n• Executing external tools for real-time data.\n• Synthesizing full response.";
    }

    const handshakeId = `handshake_${Date.now()}`;
    setPathReasoning(reasoningText);
    setPathHistory(prev => [{ prompt: activePrompt, reasoning: reasoningText, logId: handshakeId }, ...prev].slice(0, 5));

    path = [...path, WorkflowStep.LG_TO_LLM_EVAL, WorkflowStep.LLM_TO_LG_EVAL, WorkflowStep.LG_TO_OUT, WorkflowStep.COMPLETED];
    setActivePath(path);


    setState(prev => ({ 
      ...prev, 
      currentStep: WorkflowStep.UI_TO_LG, 
      logs: [...prev.logs, {
        id: handshakeId,
        type: 'SYSTEM',
        message: 'Handshake initiated',
        details: `Request: "${activePrompt}"`,
        timestamp: new Date().toLocaleTimeString()
      }],
      finalInput: undefined,
      finalOutput: undefined
    }));

    const stepInterval = 1200; 

    for (let i = 0; i < path.length; i++) {
      if (runIdRef.current !== runId) {
        setIsSimulating(false);
        return;
      }
      const step = path[i];
      let elapsed = 0;
      const pollFreq = 50;
      
      while (elapsed < stepInterval) {
        if (runIdRef.current !== runId) {
          setIsSimulating(false);
          return;
        }
        if (isPausedRef.current) {
          await new Promise(r => setTimeout(r, 100));
        } else {
          await new Promise(r => setTimeout(r, pollFreq));
          elapsed += pollFreq;
        }
      }
      
      let aiGeneratedOutput = '';
      if (step === WorkflowStep.COMPLETED) {
        if (runIdRef.current !== runId) {
          setIsSimulating(false);
          return;
        }
        let systemPrompt = undefined;
        let enhancedPrompt = activePrompt;
        
        if (isDirect) {
           systemPrompt = "You are a precise calculation and logic engine. Meaningful, direct, and concise answers only. Do not provide explanations unless asked. Do not use conversational filler. Be brief.";
        } else {
           // Simulate Tool Data Injection for Demo
           // In a real app, this data would come from the MCP tool execution in previous steps.
           const toolData = [];
           const promptLower = activePrompt.toLowerCase();
           
           if (promptLower.includes("stock") || promptLower.includes("price") || promptLower.includes("cap")) {
             // Extract potential ticker (first word or capitalized word)
             const potentialTicker = activePrompt.match(/\b[A-Z]{2,5}\b/)?.[0] || "Requested Asset";
             toolData.push(`Tool [StockTicker]: ${potentialTicker} is currently trading at $${(Math.random() * 1000).toFixed(2)}. ${Math.random() > 0.5 ? 'Up' : 'Down'} ${(Math.random() * 5).toFixed(2)}% today.`);
             toolData.push("Tool [MarketData]: Volume is high. Analyst rating: Buy.");
           }
           
           if (promptLower.includes("weather") || promptLower.includes("temperature")) {
             toolData.push("Tool [WeatherAPI]: Current conditions: 72°F (22°C), Sunny. Humidity: 45%. Wind: 10mph NW.");
           }
           
           if (promptLower.includes("news") || promptLower.includes("latest")) {
             toolData.push("Tool [NewsSearch]: Top headline: 'Market rally continues as AI adoption accelerates'. Source: Bloomberg.");
             toolData.push(`Tool [NewsSearch]: Breaking news for ${activePrompt}: Quarterly earnings exceed expectations.`);
           }

           if (toolData.length > 0) {
             enhancedPrompt = `${activePrompt}\n\n[SYSTEM: The following data was retrieved by the autonomous agent tools. Use it to answer the user query directly as if you knew it all along.]\n${toolData.join('\n')}`;
             // Update system instruction for the "Architect" persona to be a helpful assistant using the provided data
             systemPrompt = "You are an intelligent agent. You have just executed tools to gather information. Using the tool data provided in the context, answer the user's question directly and professionally. Do not mention 'As an AI' or 'I do not have access'. You HAVE the access via the tool data provided. Be confident.";
           }
        }

        const aiResponse = await chatWithArchitect([
          { role: 'user', content: enhancedPrompt }
        ], systemPrompt);
        if (runIdRef.current !== runId) {
          setIsSimulating(false);
          return;
        }
        aiGeneratedOutput = aiResponse.content;
        setActiveModelName(aiResponse.model);
      }

      setState(prev => {
        const meta = STEP_METADATA[step];
        const logId = `log_${Date.now()}_${step}`;
        
        // Dynamically contextualize input/output based on active user prompt
        // Use our new helper function which handles replacements
        // Note: getStepDetails is defined in component scope
        const { details, inputData, transformedData } = getStepDetails(step, meta, activePrompt);

        const newEntry: LogEntry = {
          id: logId,
          type: (meta.sourceId && meta.targetId) ? 'EXEC' : 'SYSTEM',
          message: meta.label,
          details: details,
          source: meta.sourceId ? ARCHITECTURE_COMPONENTS[meta.sourceId]?.name : undefined,
          destination: meta.targetId ? ARCHITECTURE_COMPONENTS[meta.targetId]?.name : undefined,
          inputData: inputData,
          transformedData: transformedData,
          timestamp: new Date().toLocaleTimeString()
        };

        const newState = {
          ...prev,
          currentStep: step,
          logs: [...prev.logs, newEntry]
        };

        if (step === WorkflowStep.COMPLETED) {
          newState.finalInput = activePrompt;
          newState.finalOutput = aiGeneratedOutput || "Architect response error.";
          setIsSimulating(false);
          setPrompt('');
        }
        
        return newState;
      });
    }
  };

  const handleNodeClick = async (nodeId: string) => {
    setSelectedNode(nodeId);
    setLoadingInsight(true);
    setNodeInsight(null);
    const component = ARCHITECTURE_COMPONENTS[nodeId];
    if (component) {
      const insightData = await getArchitectInsight(component.name, `Component: ${nodeId}. Status: ${state.currentStep || 'Idle'}. Task: ${prompt || 'None'}`);
      setNodeInsight(insightData.content || "Failed to retrieve architect's insight.");
      setActiveModelName(insightData.model);
    }
    setLoadingInsight(false);
  };

  const samples = [
    { label: "Only RAG", prompt: "Perform internal knowledge retrieval via RAG only." },
    { label: "Only MCP", prompt: "Execute external API calls via MCP tools only." },
    { label: "RAG + MCP", prompt: "Use internal knowledge and external tools to answer this request." }
  ];

  return (
    <div className={`flex flex-col h-screen ${isDarkMode ? 'bg-[#020617] text-slate-200' : 'bg-slate-50 text-slate-700'} overflow-hidden font-sans selection:bg-blue-500/30`}>
      <header className={`flex justify-between items-center px-10 py-6 border-b ${isDarkMode ? 'border-slate-800/50 bg-[#080c14]/90' : 'border-slate-200 bg-white/90'} backdrop-blur-2xl shrink-0 z-20`}>
        <div className="flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.15)] border border-white/5 group">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="group-hover:scale-110 transition-transform">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <h1 className={`text-xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'} uppercase italic leading-tight`}>AI Flow <span className="text-blue-500 font-light">Visualizer</span></h1>
            <div className="flex items-center gap-2 mt-1">
              {isSimulating && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full animate-pulse">
                  <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                  <span className="text-[9px] font-bold text-emerald-400 uppercase">{isPaused ? 'Paused' : 'Synchronizing'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-2 mr-4">
            {samples.map((s) => (
              <button
                key={s.label}
                onClick={() => runSimulation(s.prompt)}
                disabled={isSimulating}
                className={`px-3 py-1.5 rounded-lg border ${isDarkMode ? 'border-slate-800 bg-slate-900/40 text-slate-400 hover:text-white' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:border-slate-300'} text-[9px] font-bold uppercase tracking-widest hover:border-blue-500/50 transition-all disabled:opacity-50`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={prompt}
            disabled={isSimulating}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSimulation()}
            placeholder="Describe your agentic objective..."
            className={`${isDarkMode ? 'bg-slate-900/60 border-slate-800/80 placeholder:text-slate-700 text-slate-200' : 'bg-white border-slate-200 placeholder:text-slate-400 text-slate-800'} border px-6 py-3 rounded-2xl w-[300px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all shadow-lg disabled:opacity-50`}
          />
          
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
                onClick={() => runSimulation()}
                disabled={!prompt.trim()}
                className="px-8 py-3 rounded-2xl font-black text-[10px] bg-blue-600 hover:bg-blue-500 text-white uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95 disabled:opacity-50"
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

          {activeLogicPanel && (
            <div className={`fixed inset-0 ${isDarkMode ? 'bg-[#020617]/70' : 'bg-slate-200/50'} backdrop-blur-2xl z-[300] flex items-center justify-center p-6 md:p-12 animate-in fade-in duration-300`}>
              <div className={`w-full max-w-2xl ${isDarkMode ? 'bg-[#0b1120]' : 'bg-white'} border ${activeLogicPanel.borderColor} rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,0.5)] p-6 md:p-10 relative overflow-hidden`}>
                <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent ${activeLogicPanel.bgColor.replace('bg-', 'via-').replace('/10', '')} to-transparent opacity-80`} />
                
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-[0.4em] text-slate-500">Logic Pattern Inspector</h3>
                    <h2 className={`text-2xl font-black ${activeLogicPanel.color} mt-2`}>{activeLogicPanel.title}</h2>
                  </div>
                  <button 
                    onClick={() => setActiveLogicPanel(null)}
                    className={`p-3 ${isDarkMode ? 'bg-white/5 hover:bg-white/10 hover:text-white' : 'bg-slate-100 hover:bg-slate-200 hover:text-slate-900'} rounded-2xl transition-all text-slate-400 group border border-transparent`}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="group-hover:rotate-90 transition-transform">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>

                <div className="space-y-6">
                  <div className={`p-5 ${isDarkMode ? 'bg-slate-950/40 border-white/5' : 'bg-slate-50 border-slate-200'} rounded-2xl border`}>
                    <h4 className="text-xs font-black uppercase text-slate-500 mb-2 tracking-widest">Execution Path</h4>
                    <p className={`text-base font-mono ${isDarkMode ? 'text-white/90' : 'text-slate-800'}`}>{activeLogicPanel.path}</p>
                  </div>

                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-500 mb-3 tracking-widest">Strategic Overview</h4>
                    <p className={`text-base ${isDarkMode ? 'text-slate-300' : 'text-slate-600'} leading-relaxed font-medium`}>
                      {activeLogicPanel.details}
                    </p>
                  </div>

                  <div className={`p-4 rounded-2xl ${activeLogicPanel.bgColor} border ${activeLogicPanel.borderColor}`}>
                     <div className="flex items-start gap-3">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={activeLogicPanel.color}>
                           <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                        </svg>
                        <div>
                           <h4 className={`text-xs font-black uppercase tracking-widest mb-1 ${activeLogicPanel.color}`}>Performance Profile</h4>
                           <p className="text-xs text-slate-400 leading-relaxed">
                              Optimized for specific latency and data privacy requirements tailored to this architectural configuration.
                           </p>
                        </div>
                     </div>
                  </div>
                </div>

                <div className={`mt-8 pt-6 border-t ${isDarkMode ? 'border-white/5' : 'border-slate-200'} flex justify-between items-center`}>
                   <p className="text-xs text-slate-600 font-bold uppercase tracking-widest">Pattern ID: {activeLogicPanel.id.toUpperCase()}</p>
                   <button 
                     onClick={() => {
                        const prompt = activeLogicPanel.id === 'rag-only' ? "Perform internal knowledge retrieval via RAG only." : 
                                       activeLogicPanel.id === 'mcp-only' ? "Execute external API calls via MCP tools only." :
                                       "Complete hybrid synthesis using both RAG and MCP.";
                        setActiveLogicPanel(null);
                        runSimulation(prompt);
                     }}
                     className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'bg-white/5 hover:bg-white/10 text-white border-white/10' : 'bg-slate-100 hover:bg-slate-200 text-slate-900 border-slate-200'} border transition-all`}
                   >
                      Initialize This Pattern
                   </button>
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
                            <button
                              onClick={() => openLogEntry(item.logId)}
                              className={`${isDarkMode ? 'bg-slate-900/60 text-slate-300 border-slate-700/60 hover:bg-slate-900' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'} text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors`}
                            >
                              Log
                            </button>
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
              <span className="text-slate-600 uppercase font-black tracking-[0.3em] text-[10px]">Dashboard</span>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${hasKeys ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className={`text-[8px] font-bold uppercase tracking-tighter ${hasKeys ? 'text-emerald-400' : 'text-red-400'}`}>
                  Keys: {hasKeys ? 'Found' : 'Not Found'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${isSimulating ? 'bg-blue-500 animate-pulse' : 'bg-slate-700'}`} />
                <span className="text-[8px] text-slate-600 font-bold uppercase tracking-tighter">Sync: {isSimulating ? 'Active' : 'Standby'}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
               {!isTelemetryCollapsed && (
                 <button 
                  onClick={clearLogs}
                  className="px-3 py-1 rounded bg-red-500/10 border border-red-500/20 text-[8px] font-black text-red-400 hover:bg-red-500/20 transition-all uppercase tracking-widest"
                 >
                   Clear Trace
                 </button>
               )}
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
                <div className="flex-1 overflow-y-auto space-y-4 pr-3 custom-scrollbar font-mono text-xs" ref={scrollRef}>
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
                            <span className="text-slate-700 font-black tabular-nums shrink-0 uppercase w-12 tracking-tighter">
                              {log.timestamp.split(' ')[0]}
                            </span>
                            <div className="flex-1">
                               {isExec ? (
                                 <div className="flex justify-between items-start pr-12">
                                   <div className="flex flex-col gap-0.5">
                                     <div className="text-blue-400 font-black uppercase tracking-widest text-[10px]">
                                       {log.source} → {log.destination}
                                     </div>
                                     <div className="text-slate-500 leading-tight text-xs">
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
              
              <div className={`flex-none w-[260px] p-5 flex flex-col overflow-y-auto custom-scrollbar ${isDarkMode ? 'bg-slate-900/20' : 'bg-slate-50'}`}>
                <div className="flex flex-col items-start space-y-4">
                  {logicPanels.map((panel) => (
                    <div 
                      key={panel.id}
                      onClick={() => setActiveLogicPanel(panel)}
                      className={`p-3 w-fit max-w-[240px] ${isDarkMode ? 'bg-slate-950/40 border-white/5 hover:bg-slate-900/60 hover:border-white/10' : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-blue-200'} rounded-xl border cursor-pointer transition-all select-none group`}
                    >
                      <h5 className={`text-xs ${panel.color.replace('text-','text-')} font-black uppercase mb-1 group-hover:underline decoration-white/20 underline-offset-2`}>{panel.title}</h5>
                      <div className="max-h-0 opacity-0 overflow-hidden transition-all duration-300 group-hover:max-h-24 group-hover:opacity-100">
                        <p className="text-[10px] text-slate-400 leading-normal font-mono mb-1">{panel.path}</p>
                        <p className="text-[10px] text-slate-500 leading-normal italic">{panel.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>

        {(state.finalInput && state.finalOutput) && (
          <div className="fixed top-1/2 right-10 -translate-y-1/2 w-full max-w-xl bg-[#080c14]/98 border border-emerald-500/20 backdrop-blur-3xl rounded-[2.5rem] p-8 shadow-[0_50px_100px_rgba(0,0,0,0.8)] z-[200] animate-in slide-in-from-right duration-500 max-h-[85vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center gap-4 mb-6 sticky top-0 py-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
              <span className="text-[12px] font-black uppercase tracking-[0.4em] text-emerald-400">Synthesis Complete</span>
              <button onClick={() => setState(s => ({...s, finalInput: undefined, finalOutput: undefined}))} className="ml-auto p-2.5 text-slate-600 hover:text-white transition-colors bg-white/5 rounded-2xl border border-white/5">
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
