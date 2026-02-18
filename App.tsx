
import React, { useState, useEffect, useRef } from 'react';
import { WorkflowStep, SimulationState, LogEntry } from './types';
import { ARCHITECTURE_COMPONENTS, STEP_METADATA } from './constants';
import AnimatedFlow from './components/AnimatedFlow';
import { getArchitectInsight, chatWithArchitect } from './services/geminiService';

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.logs]);

  // Helper to make static mock data feel prompt-relevant
  const contextualizeData = (data: any, userPrompt: string): any => {
    if (!data) return data;
    const searchTerms = /NVIDIA|NVDA|stock price|stock/gi;
    
    if (typeof data === 'string') {
      return data.replace(searchTerms, userPrompt);
    }
    
    if (Array.isArray(data)) {
      return data.map(item => contextualizeData(item, userPrompt));
    }
    
    if (typeof data === 'object') {
      const result: any = {};
      for (const key in data) {
        result[key] = contextualizeData(data[key], userPrompt);
      }
      return result;
    }
    
    return data;
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

  const resetSimulation = () => {
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
  };

  const runSimulation = async (customPrompt?: string) => {
    const activePrompt = customPrompt || prompt;
    if (!activePrompt.trim() || isSimulating) return;
    
    if (customPrompt) setPrompt(customPrompt);
    
    setIsSimulating(true);
    setIsPaused(false);
    setIsTelemetryCollapsed(false); // Auto-expand telemetry when starting

    let path: WorkflowStep[] = [
      WorkflowStep.UI_TO_LG,
      WorkflowStep.LG_TO_LLM_PLAN,
      WorkflowStep.LLM_TO_LG_PLAN,
    ];

    const isRagOnly = activePrompt.toLowerCase().includes("rag only");
    const isMcpOnly = activePrompt.toLowerCase().includes("mcp tools only");

    if (isRagOnly) {
      path = [...path, WorkflowStep.LG_TO_RAG, WorkflowStep.RAG_TO_VDB, WorkflowStep.VDB_TO_RAG, WorkflowStep.RAG_TO_LG];
    } else if (isMcpOnly) {
      path = [...path, WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG];
    } else {
      path = [...path, WorkflowStep.LG_TO_RAG, WorkflowStep.RAG_TO_VDB, WorkflowStep.VDB_TO_RAG, WorkflowStep.RAG_TO_LG, WorkflowStep.LG_TO_MCP, WorkflowStep.MCP_TO_LG];
    }

    path = [...path, WorkflowStep.LG_TO_LLM_EVAL, WorkflowStep.LLM_TO_LG_EVAL, WorkflowStep.LG_TO_OUT, WorkflowStep.COMPLETED];

    setState(prev => ({ 
      ...prev, 
      currentStep: WorkflowStep.UI_TO_LG, 
      logs: [...prev.logs, {
        id: `handshake_${Date.now()}`,
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
      const step = path[i];
      let elapsed = 0;
      const pollFreq = 50;
      
      while (elapsed < stepInterval) {
        if (isPausedRef.current) {
          await new Promise(r => setTimeout(r, 100));
        } else {
          await new Promise(r => setTimeout(r, pollFreq));
          elapsed += pollFreq;
        }
      }
      
      let aiGeneratedOutput = '';
      if (step === WorkflowStep.COMPLETED) {
        aiGeneratedOutput = await chatWithArchitect([
          { role: 'user', content: activePrompt }
        ]);
      }

      setState(prev => {
        const meta = STEP_METADATA[step];
        const logId = `log_${Date.now()}_${step}`;
        
        // Dynamically contextualize input/output based on active user prompt
        const dynamicInput = contextualizeData(meta.inputData || activePrompt, activePrompt);
        const dynamicTransformed = contextualizeData(meta.transformedData, activePrompt);

        const newEntry: LogEntry = {
          id: logId,
          type: (meta.sourceId && meta.targetId) ? 'EXEC' : 'SYSTEM',
          message: meta.label,
          details: meta.details,
          source: meta.sourceId ? ARCHITECTURE_COMPONENTS[meta.sourceId]?.name : undefined,
          destination: meta.targetId ? ARCHITECTURE_COMPONENTS[meta.targetId]?.name : undefined,
          inputData: dynamicInput,
          transformedData: dynamicTransformed,
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
      const insight = await getArchitectInsight(component.name, `Component: ${nodeId}. Status: ${state.currentStep}. Task: ${prompt || 'Idle'}`);
      setNodeInsight(insight || "Failed to retrieve architect's insight.");
    }
    setLoadingInsight(false);
  };

  const samples = [
    { label: "Only RAG", prompt: "Perform internal knowledge retrieval via RAG only." },
    { label: "Only MCP", prompt: "Execute external API calls via MCP tools only." },
    { label: "RAG + MCP", prompt: "Complete hybrid synthesis using both RAG and MCP." }
  ];

  return (
    <div className="flex flex-col h-screen bg-[#020617] text-slate-200 overflow-hidden font-sans selection:bg-blue-500/30">
      <header className="flex justify-between items-center px-10 py-6 border-b border-slate-800/50 bg-[#080c14]/90 backdrop-blur-2xl shrink-0 z-20">
        <div className="flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.15)] border border-white/5 group">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="group-hover:scale-110 transition-transform">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-white uppercase italic leading-tight">Architect <span className="text-blue-500 font-light">Engine</span></h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] font-black bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-full border border-blue-500/20 uppercase tracking-[0.1em]">Stateful Hub</span>
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
                className="px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/40 text-[9px] font-bold uppercase tracking-widest text-slate-400 hover:text-white hover:border-blue-500/50 transition-all disabled:opacity-50"
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
            className="bg-slate-900/60 border border-slate-800/80 px-6 py-3 rounded-2xl w-[300px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all shadow-lg placeholder:text-slate-700 disabled:opacity-50"
          />
          
          <div className="flex gap-2">
            {isSimulating ? (
              <button
                onClick={() => setIsPaused(!isPaused)}
                className="px-6 py-3 rounded-2xl font-black text-[10px] bg-slate-800 text-white uppercase tracking-[0.2em] shadow-xl hover:bg-slate-700 transition-all active:scale-95"
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
              className="px-4 py-3 rounded-2xl border border-slate-800 hover:bg-slate-800 transition-colors"
              title="Reset Simulation"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 md:p-8 overflow-hidden relative">
        <div className="flex-1 relative mb-4">
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
          />
          
          {activePayloadDetail && (
            <div className="fixed inset-0 bg-[#020617]/70 backdrop-blur-2xl z-[100] flex items-center justify-center p-6 md:p-12 animate-in fade-in duration-300">
               <div className="w-full max-w-2xl bg-[#0b1120] border border-blue-500/30 rounded-[2.5rem] shadow-[0_0_100px_rgba(37,99,235,0.2)] p-6 md:p-10 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-emerald-500" />
                  
                  <div className="flex justify-between items-start mb-8">
                    <div>
                      <h3 className="text-[14px] font-black uppercase tracking-[0.4em] text-blue-400">Component Transaction Inspector</h3>
                      <p className="text-[11px] text-slate-500 mt-2 font-mono flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-slate-900 rounded border border-slate-800">{activePayloadDetail.source || 'SYSTEM'}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                        <span className="px-2 py-0.5 bg-slate-900 rounded border border-slate-800">{activePayloadDetail.destination || 'NODE'}</span>
                      </p>
                    </div>
                    <button 
                      onClick={() => setActivePayloadDetail(null)}
                      className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all text-slate-400 hover:text-white group border border-white/5"
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
                        <h4 className="text-[11px] font-black uppercase text-slate-500 tracking-widest">Ingress Packet</h4>
                      </div>
                      <div className="bg-[#020617] p-6 rounded-2xl border border-white/5 font-mono text-xs overflow-x-auto shadow-inner">
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
                        <h4 className="text-[11px] font-black uppercase text-blue-500 tracking-widest">Egress Result</h4>
                      </div>
                      <div className="bg-[#020617] p-6 rounded-2xl border border-blue-500/20 font-mono text-xs overflow-x-auto">
                        <pre className="text-emerald-400 leading-relaxed">
                          {typeof activePayloadDetail.transformedData === 'string' ? activePayloadDetail.transformedData : JSON.stringify(activePayloadDetail.transformedData, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-6">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                      <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Trace Protocol: AGENT-v3</p>
                    </div>
                    <p className="text-[10px] text-slate-700 font-mono font-bold uppercase">{activePayloadDetail.timestamp}</p>
                  </div>
               </div>
            </div>
          )}

          {selectedNode && (
            <div className="absolute inset-y-0 right-0 w-[400px] bg-[#020617]/95 backdrop-blur-3xl border-l border-slate-800/60 shadow-2xl z-40 flex flex-col animate-in slide-in-from-right duration-500 ease-out rounded-l-[2rem]">
              <div className="p-10 flex flex-col h-full overflow-hidden">
                <header className="flex justify-between items-start mb-10 shrink-0">
                  <div className="space-y-2">
                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500/80">Component Specification</h2>
                    <h3 className="text-2xl font-black text-white leading-tight">{ARCHITECTURE_COMPONENTS[selectedNode]?.name}</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{ARCHITECTURE_COMPONENTS[selectedNode]?.role}</p>
                  </div>
                  <button 
                    onClick={() => setSelectedNode(null)}
                    className="p-2 hover:bg-white/5 rounded-xl transition-colors text-slate-500 hover:text-white"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </header>

                <div className="flex-1 space-y-10 overflow-y-auto pr-2 custom-scrollbar">
                  <section>
                    <h4 className="text-[10px] font-black uppercase text-slate-600 mb-3 tracking-widest">Logic Role</h4>
                    <p className="text-[13px] text-slate-400 leading-relaxed">
                      {ARCHITECTURE_COMPONENTS[selectedNode]?.description}
                    </p>
                  </section>

                  <section>
                    <h4 className="text-[10px] font-black uppercase text-slate-600 mb-4 tracking-widest">Deep-Dive Assessment</h4>
                    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/50 min-h-[160px] relative shadow-inner">
                      {loadingInsight ? (
                        <div className="flex items-center gap-4 text-slate-600 font-mono text-[11px] animate-pulse">
                          <div className="w-4 h-4 border-2 border-slate-700 border-t-blue-500 animate-spin rounded-full" />
                          <span>Generating architectural briefing...</span>
                        </div>
                      ) : (
                        <div className="prose prose-invert prose-xs text-slate-300 leading-relaxed text-[13px] font-medium">
                          {nodeInsight?.split('\n').map((line, i) => <p key={i} className="mb-3">{line}</p>)}
                        </div>
                      )}
                    </div>
                  </section>

                  <section>
                    <h4 className="text-[10px] font-black uppercase text-slate-600 mb-3 tracking-widest">Environment Stack</h4>
                    <div className="flex flex-wrap gap-2">
                      {ARCHITECTURE_COMPONENTS[selectedNode]?.techStack.map(s => (
                        <span key={s} className="px-3 py-1 bg-blue-500/5 text-blue-400 border border-blue-500/10 rounded-lg text-[10px] font-black uppercase tracking-wider">
                          {s}
                        </span>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className={`transition-all duration-500 ease-in-out bg-slate-950/40 border border-slate-800/40 rounded-3xl flex flex-col overflow-hidden shadow-2xl ${isTelemetryCollapsed ? 'h-12' : 'h-80'}`}>
          <div className="flex justify-between items-center px-6 py-3 border-b border-slate-800/30">
            <div 
              className="flex items-center gap-4 cursor-pointer"
              onClick={() => setIsTelemetryCollapsed(!isTelemetryCollapsed)}
            >
              <span className="text-slate-600 uppercase font-black tracking-[0.3em] text-[10px]">Telemetry Dashboard</span>
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
            <div className="flex-1 flex divide-x divide-slate-800/30 overflow-hidden">
              <div className="flex-[3] p-5 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-3 custom-scrollbar font-mono text-[10px]" ref={scrollRef}>
                  {state.logs.map((log) => {
                    const isExec = log.type === 'EXEC';
                    return (
                      <div key={log.id} className="group/log flex gap-4 items-start animate-in fade-in slide-in-from-left-4 duration-500 border-l-2 border-transparent hover:border-blue-500/30 pl-2 transition-colors relative">
                        <span className="text-slate-700 font-black tabular-nums shrink-0 uppercase w-12 tracking-tighter">
                          {log.timestamp.split(' ')[0]}
                        </span>
                        <div className="flex-1">
                           {isExec ? (
                             <div className="flex justify-between items-start pr-12">
                               <div className="flex flex-col gap-0.5">
                                 <div className="text-blue-400 font-black uppercase tracking-widest text-[9px]">
                                   {log.source} → {log.destination}
                                 </div>
                                 <div className="text-slate-500 leading-tight text-[11px]">
                                   {log.details}
                                 </div>
                               </div>
                             </div>
                           ) : (
                             <span className={`${log.type === 'SYSTEM' ? 'text-white font-bold' : 'text-slate-600'} leading-tight`}>
                               {log.message}: {log.details}
                             </span>
                           )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div className="flex-[2] p-5 flex flex-col overflow-y-auto custom-scrollbar bg-slate-900/20">
                <h4 className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] mb-4">Architectural Logic Panels</h4>
                <div className="space-y-4">
                  <div className="p-3 bg-slate-950/40 rounded-xl border border-white/5">
                    <h5 className="text-[9px] text-blue-400 font-black uppercase mb-1">Only RAG Flow Path</h5>
                    <p className="text-[9px] text-slate-400 leading-normal font-mono mb-1">UI → LG → RAG → VDB</p>
                    <p className="text-[8px] text-slate-500 leading-normal italic">Targeted for proprietary knowledge retrieval. Skips external MCP to maintain data gravity.</p>
                  </div>
                  <div className="p-3 bg-slate-950/40 rounded-xl border border-white/5">
                    <h5 className="text-[9px] text-amber-400 font-black uppercase mb-1">Only MCP Flow Path</h5>
                    <p className="text-[9px] text-slate-400 leading-normal font-mono mb-1">UI → LG → MCP → LG</p>
                    <p className="text-[8px] text-slate-500 leading-normal italic">Targeted for real-time external tool orchestration via standardized interface.</p>
                  </div>
                  <div className="p-3 bg-slate-950/40 rounded-xl border border-white/5">
                    <h5 className="text-[9px] text-emerald-400 font-black uppercase mb-1">Hybrid RAG + MCP Path</h5>
                    <p className="text-[9px] text-slate-400 leading-normal font-mono mb-1">UI → LG → RAG → MCP → LG</p>
                    <p className="text-[8px] text-slate-500 leading-normal italic">The optimal agentic cycle. Combines retrieved context with real-time tool execution.</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-5 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Node State</span>
                    <span className="text-[11px] text-emerald-500 font-black uppercase tracking-widest">{state.currentStep === WorkflowStep.IDLE ? 'IDLE' : 'BUSY'}</span>
                  </div>
                </div>
                
                <div className="pt-2">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-[9px] text-slate-700 font-black uppercase">Progression</span>
                    <span className="text-[9px] text-blue-500 font-black">
                      {Math.round((Object.values(WorkflowStep).indexOf(state.currentStep) / (Object.values(WorkflowStep).length - 1)) * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1 bg-slate-800/50 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 transition-all duration-700 ease-out" 
                      style={{ width: `${(Object.values(WorkflowStep).indexOf(state.currentStep) / (Object.values(WorkflowStep).length - 1)) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {(state.finalInput && state.finalOutput) && (
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-[#080c14]/98 border border-emerald-500/20 backdrop-blur-3xl rounded-[3rem] p-10 shadow-[0_50px_100px_rgba(0,0,0,0.8)] z-[110] animate-in zoom-in-95 duration-500 max-h-[85vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center gap-4 mb-6 sticky top-0 bg-[#080c14]/40 py-2">
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
