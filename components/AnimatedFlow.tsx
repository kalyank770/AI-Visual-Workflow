
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { WorkflowStep } from '../types';

interface AnimatedFlowProps {
  currentStep: WorkflowStep;
  onNodeClick: (nodeId: string) => void;
  onPayloadClick: (payload: string) => void;
  isPaused: boolean;
  prompt?: string;
}

const AnimatedFlow: React.FC<AnimatedFlowProps> = ({ currentStep, onNodeClick, onPayloadClick, isPaused, prompt }) => {
  const [transform, setTransform] = useState({ x: 50, y: 50, scale: 0.75 });
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  // Synchronize SVG animation clock with pause state
  useEffect(() => {
    if (svgRef.current) {
      if (isPaused) {
        svgRef.current.pauseAnimations();
      } else {
        svgRef.current.unpauseAnimations();
      }
    }
  }, [isPaused]);

  const nodes = useMemo(() => [
    { id: 'UI', label: 'User Interface', icon: '📱', x: 50, y: 450, color: '#3b82f6' },
    { id: 'LG', label: 'LangGraph Hub', icon: '🕸️', x: 500, y: 450, color: '#8b5cf6' },
    { id: 'LLM', label: 'LLM Reasoning', icon: '🧠', x: 1000, y: 450, color: '#ec4899' },
    { id: 'RAG', label: 'RAG Pipeline', icon: '🔄', x: 500, y: 150, color: '#10b981' },
    { id: 'VDB', label: 'Vector DB', icon: '🗄️', x: 950, y: 150, color: '#059669' },
    { id: 'MCP', label: 'MCP Server', icon: '🛠️', x: 500, y: 780, color: '#f59e0b' },
    { id: 'OUT', label: 'Final Output', icon: '📤', x: 1450, y: 450, color: '#06b6d4' },
  ], []);

  // Bi-directional paths with improved visibility and directional logic
  const traces = useMemo(() => [
    { id: 'UI_LG_REQ', from: 'UI', to: 'LG', path: "M 140 450 L 410 450", type: 'req' },
    
    { id: 'LG_LLM_REQ', from: 'LG', to: 'LLM', path: "M 590 435 L 910 435", type: 'req' },
    { id: 'LG_LLM_RES', from: 'LLM', to: 'LG', path: "M 910 465 L 590 465", type: 'res' },
    
    { id: 'LG_RAG_REQ', from: 'LG', to: 'RAG', path: "M 485 360 L 485 240", type: 'req' },
    { id: 'LG_RAG_RES', from: 'RAG', to: 'LG', path: "M 515 240 L 515 360", type: 'res' },
    
    { id: 'RAG_VDB_REQ', from: 'RAG', to: 'VDB', path: "M 590 135 L 860 135", type: 'req' },
    { id: 'RAG_VDB_RES', from: 'VDB', to: 'RAG', path: "M 860 165 L 590 165", type: 'res' },
    
    { id: 'LG_MCP_REQ', from: 'LG', to: 'MCP', path: "M 485 540 L 485 690", type: 'req' },
    { id: 'LG_MCP_RES', from: 'MCP', to: 'LG', path: "M 515 690 L 515 540", type: 'res' },
    
    { id: 'LG_OUT_REQ', from: 'LG', to: 'OUT', path: "M 590 445 C 800 350 1200 350 1360 445", type: 'req' },
  ], []);

  const activeTraceId = useMemo(() => {
    switch (currentStep) {
      case WorkflowStep.UI_TO_LG: return 'UI_LG_REQ';
      case WorkflowStep.LG_TO_LLM_PLAN: return 'LG_LLM_REQ';
      case WorkflowStep.LLM_TO_LG_PLAN: return 'LG_LLM_RES';
      case WorkflowStep.LG_TO_RAG: return 'LG_RAG_REQ';
      case WorkflowStep.RAG_TO_VDB: return 'RAG_VDB_REQ';
      case WorkflowStep.VDB_TO_RAG: return 'RAG_VDB_RES';
      case WorkflowStep.RAG_TO_LG: return 'LG_RAG_RES';
      case WorkflowStep.LG_TO_MCP: return 'LG_MCP_REQ';
      case WorkflowStep.MCP_TO_LG: return 'LG_MCP_RES';
      case WorkflowStep.LG_TO_LLM_EVAL: return 'LG_LLM_REQ';
      case WorkflowStep.LLM_TO_LG_EVAL: return 'LG_LLM_RES';
      case WorkflowStep.LG_TO_OUT: return 'LG_OUT_REQ';
      default: return null;
    }
  }, [currentStep]);

  const activePayload = useMemo(() => {
    switch (currentStep) {
      case WorkflowStep.UI_TO_LG: return "query_raw";
      case WorkflowStep.LG_TO_LLM_PLAN: return "gen_plan";
      case WorkflowStep.LLM_TO_LG_PLAN: return "plan_obj";
      case WorkflowStep.LG_TO_RAG: return "rag_req";
      case WorkflowStep.RAG_TO_VDB: return "v_query";
      case WorkflowStep.VDB_TO_RAG: return "ctx_matches";
      case WorkflowStep.RAG_TO_LG: return "aug_context";
      case WorkflowStep.LG_TO_MCP: return "tool_call";
      case WorkflowStep.MCP_TO_LG: return "api_res";
      case WorkflowStep.LG_TO_LLM_EVAL: return "synthesis_req";
      case WorkflowStep.LLM_TO_LG_EVAL: return "final_md";
      case WorkflowStep.LG_TO_OUT: return "data_stream";
      default: return "";
    }
  }, [currentStep]);

  const handleWheel = (e: React.WheelEvent) => {
    const scaleFactor = 0.05;
    const delta = e.deltaY < 0 ? 1 + scaleFactor : 1 - scaleFactor;
    setTransform(prev => ({
      ...prev,
      scale: Math.max(0.2, Math.min(2, prev.scale * delta))
    }));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = (e.clientX - lastMousePos.current.x);
    const dy = (e.clientY - lastMousePos.current.y);
    setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const animDuration = "1.5s";
  const easing = "0.42, 0, 0.58, 1"; // Smoother easeInOut

  return (
    <div 
      className="w-full h-full bg-[#030712] rounded-3xl border border-slate-800/40 relative overflow-hidden cursor-move shadow-inner"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => isDragging.current = false}
      onMouseLeave={() => isDragging.current = false}
    >
      <svg ref={svgRef} width="100%" height="100%" className="relative z-10 pointer-events-none">
        <defs>
          {/* Directional Arrow Head Marker */}
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="white" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
          </marker>
          
          <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="15" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="packetGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Render All Traces for 2-way Visibility with White Color and Arrows */}
          {traces.map((trace) => {
            const isActive = activeTraceId === trace.id;
            return (
              <g key={trace.id}>
                {/* Background trace line - White and Always Visible */}
                <path
                  d={trace.path}
                  fill="none"
                  stroke={isActive ? "#3b82f6" : "white"}
                  strokeWidth={isActive ? "3" : "2"}
                  opacity={isActive ? "1" : "0.25"}
                  className="transition-all duration-300 ease-in-out"
                  strokeDasharray={isActive ? "none" : "8,8"}
                  markerEnd={isActive ? "url(#arrow-active)" : "url(#arrow)"}
                />
                
                {/* Active Flow Animation */}
                {isActive && (
                  <g>
                    {/* Primary Data Packet */}
                    <circle r="7" fill="white" filter="url(#packetGlow)">
                      <animateMotion 
                        dur={animDuration} 
                        repeatCount="indefinite" 
                        path={trace.path}
                        calcMode="spline"
                        keySplines={easing}
                      />
                    </circle>
                    
                    {/* Pulsing Aura around Packet */}
                    <circle r="12" fill="#3b82f6" opacity="0.4" filter="url(#packetGlow)">
                      <animateMotion 
                        dur={animDuration} 
                        repeatCount="indefinite" 
                        path={trace.path}
                        calcMode="spline"
                        keySplines={easing}
                      />
                    </circle>

                    {/* Packet Label with interactive look */}
                    <g 
                      className="cursor-pointer pointer-events-auto group/packet"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPayloadClick(activePayload);
                      }}
                    >
                      <animateMotion 
                        dur={animDuration} 
                        repeatCount="indefinite" 
                        path={trace.path} 
                        calcMode="spline" 
                        keySplines={easing} 
                      />
                      <rect 
                        x="15" y="-14" width="90" height="20" rx="5" 
                        fill="#0f172a" stroke="#3b82f6" strokeWidth="1.5" 
                        className="group-hover/packet:stroke-white group-hover/packet:fill-slate-800 transition-colors"
                        opacity="1" 
                      />
                      <text 
                        x="60" y="0.5" textAnchor="middle" 
                        fill="#93c5fd" fontSize="8.5" fontWeight="900" 
                        className="group-hover/packet:fill-white font-mono uppercase tracking-widest"
                      >
                        {activePayload}
                      </text>
                    </g>
                  </g>
                )}
              </g>
            );
          })}

          {/* Render Nodes */}
          {nodes.map((node) => {
            const isDestination = traces.find(t => t.id === activeTraceId)?.to === node.id;
            const isSource = traces.find(t => t.id === activeTraceId)?.from === node.id;
            
            return (
              <g 
                key={node.id} 
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer pointer-events-auto group"
                onClick={() => onNodeClick(node.id)}
              >
                {/* Node Box */}
                <rect
                  x="-90" y="-65" width="180" height="130" rx="28"
                  className={`transition-all duration-500 ${
                    isDestination 
                    ? 'fill-slate-900 stroke-[5px]' 
                    : isSource 
                      ? 'fill-slate-900 stroke-[3px]' 
                      : 'fill-slate-800/80 stroke-slate-700/50 stroke-1'
                  } group-hover:stroke-blue-400 group-hover:fill-slate-800`}
                  stroke={isDestination || isSource ? node.color : 'currentColor'}
                  style={isDestination ? { filter: 'url(#nodeGlow)' } : {}}
                />
                
                {/* Node Icon and Labels */}
                <text y="-20" textAnchor="middle" className="fill-white text-3xl select-none pointer-events-none">
                  {node.icon}
                </text>
                <text y="15" textAnchor="middle" className="fill-white font-black text-[14px] uppercase tracking-wider select-none pointer-events-none">
                  {node.id}
                </text>
                <text y="38" textAnchor="middle" className="fill-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] select-none pointer-events-none">
                  {node.label}
                </text>

                {/* Passive Ping for active destinations */}
                {isDestination && !isPaused && (
                  <circle r="100" fill="none" stroke={node.color} strokeWidth="2" className="animate-ping opacity-10" />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute top-6 left-6 pointer-events-none">
        <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.4em]">AI Visual workflow</h3>
        <p className="text-[9px] text-slate-500 font-mono">Sync Mode: Stage-by-Stage v3.3</p>
      </div>
    </div>
  );
};

export default AnimatedFlow;
