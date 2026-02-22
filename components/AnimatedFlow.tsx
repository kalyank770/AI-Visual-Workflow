
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { WorkflowStep } from '../types';
import { ARCHITECTURE_COMPONENTS } from '../constants';

interface AnimatedFlowProps {
  currentStep: WorkflowStep;
  onNodeClick: (nodeId: string) => void;
  onPayloadClick: (payload: string) => void;
  isPaused: boolean;
  prompt?: string;
  isDarkMode?: boolean;
}

const AnimatedFlow: React.FC<AnimatedFlowProps> = ({ currentStep, onNodeClick, onPayloadClick, isPaused, prompt, isDarkMode = true }) => {
  // Center diagram in viewport: scale 0.6 fits height < 600px, x/y offsets center content (775, 465)
  const [transform, setTransform] = useState({ x: 200, y: 30, scale: 0.6 });
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateLayout = (width: number, height: number) => {
        // Bounding box + margin: Width ~1500, Height ~750 to ensure fitting
        const graphWidth = 1500; 
        const graphHeight = 800; 
        
        const scaleX = width / graphWidth;
        const scaleY = height / graphHeight;
        const newScale = Math.max(0.4, Math.min(scaleX, scaleY, 0.85)); 
        
        // Center of graph content (approx 750, 465)
        const newX = (width / 2) - (750 * newScale);
        const newY = (height / 2) - (465 * newScale);

        setTransform({ x: newX, y: newY, scale: newScale });
    };

    // Use ResizeObserver to detect container size changes (e.g. when telemetry panel expands)
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          // Use contentRect for precise dimensions
          updateLayout(entry.contentRect.width, entry.contentRect.height);
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);




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
    { id: 'LG', label: 'Orchestrator', icon: '⚡', x: 500, y: 450, color: '#8b5cf6' },
    { id: 'LLM', label: 'Model Broker', icon: '🧠', x: 1000, y: 450, color: '#ec4899' },
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
      ref={containerRef}
      className={`w-full h-full ${isDarkMode ? 'bg-[#030712] border-slate-800/40' : 'bg-slate-50 border-slate-200'} rounded-3xl border relative overflow-hidden cursor-move shadow-inner transition-colors duration-500`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => isDragging.current = false}
      onMouseLeave={() => isDragging.current = false}
    >
      <svg ref={svgRef} width="100%" height="100%" className="relative z-10 pointer-events-none">
        <defs>
          {/* Directional Arrow Head Marker */}
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={isDarkMode ? "white" : "#94a3b8"} />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
          </marker>
          <marker id="arrow-internal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={isDarkMode ? "#475569" : "#cbd5e1"} />
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
                  stroke={isActive ? "#3b82f6" : (isDarkMode ? "white" : "#94a3b8")}
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
                    <circle r="7" fill={isDarkMode ? "white" : "#2563eb"} filter="url(#packetGlow)">
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
                        fill={isDarkMode ? "#0f172a" : "#eff6ff"} 
                        stroke="#3b82f6" strokeWidth="1.5" 
                        className="group-hover/packet:stroke-white group-hover/packet:fill-slate-800 transition-colors"
                        opacity="1" 
                      />
                      <text 
                        x="60" y="0.5" textAnchor="middle" 
                        fill={isDarkMode ? "#93c5fd" : "#1e40af"} 
                        fontSize="8.5" fontWeight="900" 
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
            const internalComps = ARCHITECTURE_COMPONENTS[node.id]?.internalComponents || [];
            
            return (
              <g 
                key={node.id} 
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer pointer-events-auto group"
                onClick={() => onNodeClick(node.id)}
              >
                {/* Node Box */}
                <rect
                  x="-110" y="-100" width="220" height="200" rx="20"
                  className={`transition-all duration-500 ${
                    isDestination 
                    ? (isDarkMode ? 'fill-slate-900' : 'fill-white') + ' stroke-[4px]' 
                    : isSource 
                      ? (isDarkMode ? 'fill-slate-900' : 'fill-white') + ' stroke-[2px]' 
                      : (isDarkMode ? 'fill-slate-800/90 stroke-slate-700/50' : 'fill-slate-50 stroke-slate-300') + ' stroke-1'
                  } ${isDarkMode ? 'group-hover:stroke-blue-500' : 'group-hover:stroke-blue-400'}`}
                  stroke={isDestination || isSource ? node.color : 'currentColor'}
                  style={isDestination ? { filter: 'url(#nodeGlow)' } : {}}
                />
                
                {/* Header Section */}
                <g transform="translate(0, -75)">
                  <text y="-5" textAnchor="middle" className={`${isDarkMode ? 'fill-white' : 'fill-slate-800'} text-4xl select-none pointer-events-none`}>
                    {node.icon}
                  </text>
                  <text y="25" textAnchor="middle" className={`${isDarkMode ? 'fill-white' : 'fill-slate-900'} font-black text-[14px] uppercase tracking-wider select-none pointer-events-none`}>
                    {node.label}
                  </text>
                </g>

                {/* Internal Flow Visualization with connections */}
                <g transform="translate(-100, -35)">
                   {ARCHITECTURE_COMPONENTS[node.id]?.internalFlow?.connections && ARCHITECTURE_COMPONENTS[node.id].internalFlow!.connections.map((conn, idx) => {
                     const fromNode = ARCHITECTURE_COMPONENTS[node.id].internalFlow!.nodes.find(n => n.id === conn.from);
                     const toNode = ARCHITECTURE_COMPONENTS[node.id].internalFlow!.nodes.find(n => n.id === conn.to);
                     if (!fromNode || !toNode) return null;

                     // Calculate control points for Bezier curve
                     // Helper to shorten path end so arrow performs correctly
                     const angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
                     const nodeW = 30; // Half-width
                     const nodeH = 12; // Half-height
                     
                     // Simple box intersection logic to find edge contact point
                     const absCos = Math.abs(Math.cos(angle));
                     const absSin = Math.abs(Math.sin(angle));
                     
                     let distToEdge;
                     // Prevent division by zero and handle aspect ratio intersection
                     if (nodeH * absCos >= nodeW * absSin) {
                        // Intersects vertical sides (left/right)
                        distToEdge = nodeW / (absCos || 0.001); 
                     } else {
                        // Intersects horizontal sides (top/bottom)
                        distToEdge = nodeH / (absSin || 0.001);
                     }
                     
                     // End point at the edge of the target node
                     const endX = toNode.x - Math.cos(angle) * (distToEdge + 3); 
                     const endY = toNode.y - Math.sin(angle) * (distToEdge + 3);

                     // Start point at edge of source node
                     const startX = fromNode.x + Math.cos(angle) * (distToEdge + 2);
                     const startY = fromNode.y + Math.sin(angle) * (distToEdge + 2);

                     // Control points for a smooth S-curve
                     // If moving mostly vertical, control points should extend vertically
                     const isVertical = Math.abs(toNode.y - fromNode.y) > Math.abs(toNode.x - fromNode.x);
                     const cp1x = isVertical ? startX : (startX + endX) / 2;
                     const cp1y = isVertical ? (startY + endY) / 2 : startY;
                     const cp2x = isVertical ? endX : (startX + endX) / 2;
                     const cp2y = isVertical ? (startY + endY) / 2 : endY;

                     const pathD = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;

                     return (
                       <g key={`conn-${idx}`}>
                         <path 
                           d={pathD}
                           fill="none"
                           stroke={isDarkMode ? "#475569" : "#cbd5e1"} 
                           strokeWidth="1.5"
                           markerEnd="url(#arrow-internal)"
                           opacity="0.6"
                         />
                         {/* Moving Packet on Internal Path */}
                         {(isDestination || isSource) && !isPaused && (
                           <circle r="2" fill={isDarkMode ? "#4ade80" : "#16a34a"}>
                             <animateMotion 
                               dur="2s" 
                               repeatCount="indefinite"
                               path={pathD}
                               keyPoints="0;1"
                               keyTimes="0;1"
                               calcMode="spline"
                               keySplines="0.4 0 0.2 1"
                             />
                           </circle>
                         )}
                       </g>
                     );
                   })}

                   {ARCHITECTURE_COMPONENTS[node.id]?.internalFlow?.nodes.map((n, idx) => (
                     <g key={`inode-${node.id}-${idx}`} transform={`translate(${n.x}, ${n.y})`}>
                       {/* Internal Node - Flowchart Style */}
                       <rect 
                        x="-30" y="-12" 
                        width="60" height="24" 
                        rx="4" 
                        fill={isDarkMode ? "#1e293b" : "#ffffff"} 
                        stroke={isDarkMode ? "#475569" : "#cbd5e1"}
                        strokeWidth="1.5"
                        className="transition-colors duration-300 drop-shadow-sm"
                       />
                       <text 
                        y="4" 
                        textAnchor="middle" 
                        fill={isDarkMode ? "#e2e8f0" : "#475569"} 
                        fontSize="6.5" 
                        fontFamily="sans-serif"
                        fontWeight="600"
                        className="pointer-events-none select-none uppercase tracking-tight"
                       >
                         {n.label}
                       </text>
                     </g>
                   ))}
                   
                   {!ARCHITECTURE_COMPONENTS[node.id]?.internalFlow && (
                      <foreignObject x="0" y="0" width="200" height="135" className="pointer-events-none">
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-[8px] text-slate-500 italic">No internal flow map</span>
                        </div>
                      </foreignObject>
                   )}
                </g>

                {/* Passive Ping for active destinations */}
                {isDestination && !isPaused && (
                  <circle r="120" fill="none" stroke={node.color} strokeWidth="2" className="animate-ping opacity-10" />
                )}
              </g>

            );
          })}
        </g>
      </svg>

      <div className="absolute top-6 left-6 pointer-events-none">
        <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.4em]">AI Visual workflow</h3>
        <p className="text-[9px] text-slate-500 font-mono">Stage-by-Stage visuals</p>
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-[100]">
        <button 
          className={`p-2 rounded-lg border shadow-lg transition-all active:scale-95 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          onClick={() => setTransform(prev => ({ ...prev, scale: Math.min(2, prev.scale + 0.1) }))}
          title="Zoom In"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button 
          className={`p-2 rounded-lg border shadow-lg transition-all active:scale-95 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          onClick={() => setTransform(prev => ({ ...prev, scale: Math.max(0.2, prev.scale - 0.1) }))}
          title="Zoom Out"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
        <button 
          className={`p-2 rounded-lg border shadow-lg transition-all active:scale-95 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          onClick={() => setTransform({ x: 200, y: 30, scale: 0.6 })}
          title="Reset View"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
        </button>
      </div>
    </div>
  );
};

export default AnimatedFlow;
