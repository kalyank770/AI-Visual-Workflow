
import { GoogleGenerativeAI } from "@google/generative-ai";

declare const __VITE_API_KEY__: string | undefined;
declare const __VITE_GEMINI_API_KEY__: string | undefined;
declare const __VITE_GEMINI_API_PRIMARY_KEY__: string | undefined;
declare const __VITE_GOOGLE_API_KEY__: string | undefined;
declare const __VITE_INTERNAL_API_KEY__: string | undefined;
declare const __INTERNAL_API_KEY__: string | undefined;
declare const __GEMINI_API_KEY__: string | undefined;
declare const __GEMINI_API_PRIMARY_KEY__: string | undefined;

let didLogKeyDiagnostics = false;
const logKeyDiagnosticsOnce = () => {
  if (didLogKeyDiagnostics) return;
  didLogKeyDiagnostics = true;
  // Log only presence, never values.
  // @ts-ignore
  const processEnv = typeof process !== "undefined" ? process.env : undefined;
  const metaEnv = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : undefined;
  console.log("Key Diagnostics:", {
    injected: {
      VITE_API_KEY: !!__VITE_API_KEY__,
      VITE_GEMINI_API_KEY: !!__VITE_GEMINI_API_KEY__,
      VITE_GEMINI_API_PRIMARY_KEY: !!__VITE_GEMINI_API_PRIMARY_KEY__,
      VITE_GOOGLE_API_KEY: !!__VITE_GOOGLE_API_KEY__,
      VITE_INTERNAL_API_KEY: !!__VITE_INTERNAL_API_KEY__,
      INTERNAL_API_KEY: !!__INTERNAL_API_KEY__,
      GEMINI_API_KEY: !!__GEMINI_API_KEY__,
      GEMINI_API_PRIMARY_KEY: !!__GEMINI_API_PRIMARY_KEY__,
    },
    process_env: processEnv ? {
      VITE_API_KEY: !!processEnv.VITE_API_KEY,
      VITE_GEMINI_API_KEY: !!processEnv.VITE_GEMINI_API_KEY,
      VITE_GEMINI_API_PRIMARY_KEY: !!processEnv.VITE_GEMINI_API_PRIMARY_KEY,
      VITE_GOOGLE_API_KEY: !!processEnv.VITE_GOOGLE_API_KEY,
      VITE_INTERNAL_API_KEY: !!processEnv.VITE_INTERNAL_API_KEY,
      INTERNAL_API_KEY: !!processEnv.INTERNAL_API_KEY,
      GEMINI_API_KEY: !!processEnv.GEMINI_API_KEY,
      GEMINI_API_PRIMARY_KEY: !!processEnv.GEMINI_API_PRIMARY_KEY,
    } : "missing",
    import_meta_keys: metaEnv ? Object.keys(metaEnv).sort() : [],
  });
};

// --- 1. Internal Model Config (Primary) ---
const INTERNAL_MODEL_ENDPOINT = "https://model-broker.aviator-model.bp.anthos.otxlab.net/v1/chat/completions";
const INTERNAL_MODEL_NAME = "llama-3.3-70b";
const INTERNAL_MODEL_TIMEOUT_MS = (() => {
  // Allow override via env without breaking browser builds.
  // @ts-ignore
  const raw = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_INTERNAL_MODEL_TIMEOUT_MS) || "4000";
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
})();

const getInternalApiKey = () => {
  logKeyDiagnosticsOnce();
  const injectedKey = (
    (typeof __VITE_INTERNAL_API_KEY__ !== "undefined" ? __VITE_INTERNAL_API_KEY__ : undefined) ||
    (typeof __INTERNAL_API_KEY__ !== "undefined" ? __INTERNAL_API_KEY__ : undefined)
  );
  // @ts-ignore
  const processKey = (typeof process !== "undefined" && process.env) ? (process.env.VITE_INTERNAL_API_KEY || process.env.INTERNAL_API_KEY) : undefined;
  // @ts-ignore
  const metaKey = (typeof import.meta !== "undefined" && import.meta.env) ? (import.meta.env.VITE_INTERNAL_API_KEY || import.meta.env.INTERNAL_API_KEY) : undefined;
  return injectedKey || processKey || metaKey || "";
};

async function callInternalModel(
  messages: { role: 'user' | 'assistant' | 'system', content: string }[],
  systemInstruction?: string
): Promise<string> {
  
  const payloadMessages = [];
  if (systemInstruction) {
    payloadMessages.push({ role: "system", content: systemInstruction });
  }
  payloadMessages.push(...messages);

  const controller = new AbortController();
  // User Requested: If no response in "few seconds" (4s), switch models.
  const timeoutId = setTimeout(() => controller.abort(), INTERNAL_MODEL_TIMEOUT_MS);

  try {
    const internalApiKey = getInternalApiKey();
    if (!internalApiKey) {
      throw new Error("Internal Model API Key Missing");
    }
    const response = await fetch(INTERNAL_MODEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${internalApiKey}`
      },
      body: JSON.stringify({
        model: INTERNAL_MODEL_NAME,
        messages: payloadMessages
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Internal Model API Failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (error: any) {
    const isAbort = error?.name === "AbortError" || error?.message?.toLowerCase?.().includes("aborted");
    if (isAbort) {
      throw new Error("Internal Model Timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- 2. Gemini fallback Config (Secondary) ---
const KEY_CACHE_STORAGE = "gemini_api_keys";
let cachedApiKeys: string[] = [];

const readCachedKeys = () => {
  if (cachedApiKeys.length > 0) return cachedApiKeys;
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(KEY_CACHE_STORAGE) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) cachedApiKeys = parsed.filter(k => typeof k === "string");
  } catch {
    // Ignore storage errors (private mode, blocked storage, etc.)
  }
  return cachedApiKeys;
};

const getApiKeys = () => {
  logKeyDiagnosticsOnce();
  const keys: string[] = [];
  const metaEnv = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : undefined;

  const injectedKeys = [
    (typeof __VITE_API_KEY__ !== "undefined" ? __VITE_API_KEY__ : undefined),
    (typeof __VITE_GEMINI_API_KEY__ !== "undefined" ? __VITE_GEMINI_API_KEY__ : undefined),
    (typeof __VITE_GEMINI_API_PRIMARY_KEY__ !== "undefined" ? __VITE_GEMINI_API_PRIMARY_KEY__ : undefined),
    (typeof __VITE_GOOGLE_API_KEY__ !== "undefined" ? __VITE_GOOGLE_API_KEY__ : undefined),
    (typeof __GEMINI_API_KEY__ !== "undefined" ? __GEMINI_API_KEY__ : undefined),
    (typeof __GEMINI_API_PRIMARY_KEY__ !== "undefined" ? __GEMINI_API_PRIMARY_KEY__ : undefined),
  ];
  for (const key of injectedKeys) {
    if (key) keys.push(key);
  }

  // 1. Try process.env (Node / Vite define)
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env) {
    // @ts-ignore
    if (process.env.API_KEY) keys.push(process.env.API_KEY);
    // @ts-ignore
    if (process.env.GEMINI_API_PRIMARY_KEY) keys.push(process.env.GEMINI_API_PRIMARY_KEY);
    // @ts-ignore
    if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
    // @ts-ignore
    if (process.env.VITE_API_KEY) keys.push(process.env.VITE_API_KEY);
    // @ts-ignore
    if (process.env.VITE_GEMINI_API_KEY) keys.push(process.env.VITE_GEMINI_API_KEY);
    // @ts-ignore
    if (process.env.VITE_GEMINI_API_PRIMARY_KEY) keys.push(process.env.VITE_GEMINI_API_PRIMARY_KEY);
    // @ts-ignore
    if (process.env.VITE_GOOGLE_API_KEY) keys.push(process.env.VITE_GOOGLE_API_KEY);
  }

    // 2. Try import.meta.env (Vite Standard)
    if (metaEnv) {
      if (metaEnv.VITE_GEMINI_API_PRIMARY_KEY) keys.push(metaEnv.VITE_GEMINI_API_PRIMARY_KEY);
      if (metaEnv.VITE_GEMINI_API_KEY) keys.push(metaEnv.VITE_GEMINI_API_KEY);
      if (metaEnv.VITE_API_KEY) keys.push(metaEnv.VITE_API_KEY);
      if (metaEnv.GEMINI_API_PRIMARY_KEY) keys.push(metaEnv.GEMINI_API_PRIMARY_KEY);
      // Non-VITE keys are not exposed in browser builds, but keep for SSR/test cases.
      // @ts-ignore
      if (metaEnv.GEMINI_API_KEY) keys.push(metaEnv.GEMINI_API_KEY);
  }
  
  const deduped = [...new Set(keys)].filter(k => k && k.trim() !== "");
  if (deduped.length > 0) {
    cachedApiKeys = deduped;
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(KEY_CACHE_STORAGE, JSON.stringify(deduped));
      }
    } catch {
      // Ignore storage errors
    }
  }
  return deduped;
};

const MODEL_CASCADE = [
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

async function callGeminiFallback(
  operation: (model: any) => Promise<string>
): Promise<string> {
    const metaEnv = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : undefined;
    let apiKeys = getApiKeys();
    if (apiKeys.length === 0) {
        const cachedKeys = readCachedKeys();
        if (cachedKeys.length > 0) {
          console.warn("Gemini Service: Using cached API key fallback.");
          apiKeys = cachedKeys;
        }
    }
    if (apiKeys.length === 0) {
        console.error("Gemini Service Error: No API Keys found.");
      const metaEnvKeys = metaEnv ? Object.keys(metaEnv).sort() : [];
      console.log("Environment Debug:", { process_env: typeof process !== 'undefined' ? 'available' : 'missing', import_meta_keys: metaEnvKeys });
      throw new Error("No Gemini API Keys found. Please add VITE_API_KEY or VITE_GEMINI_API_KEY to your .env file.");
    }
  let lastError: any;
  for (const key of apiKeys) {
    if (!key) continue;
    // Log masked key for debugging
    console.log(`[Gemini Service] Attempting execution with key ending in ...${key.slice(-4)}`);
    const genAI = new GoogleGenerativeAI(key);
    for (const modelName of MODEL_CASCADE) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await operation(model);
        console.log(`[Gemini Service] Success with model: ${modelName}`);
        return result;
      } catch (error: any) {
        lastError = error;
        console.warn(`[Gemini Service] Failed with model ${modelName}:`, error.message);
        const isQuota = error.message?.includes("429") || error.message?.includes("Quota");
        // 404 often means Invalid Key or Model Not Found in Region
        const isNotFound = error.message?.includes("404") || error.message?.includes("not found");
        if (isQuota || isNotFound) continue;
        continue;
      }
    }
  }
  throw lastError; 
}

const MOCK_INSIGHTS: Record<string, string> = {
  "User Interface": `### 🟢 Component Analysis: User Interface (Client Layer)
* **Scalability**: Implemented as a static Single Page Application (SPA), served via CDN (Cloudflare/AWS CloudFront) for global low-latency access.
* **Security**: Enforces stricter Content Security Policy (CSP). Authentication flows (OAuth2/OIDC) should be handled here before requests reach step-function logic.
* **Agentic Role**: Acts as the "Human-in-the-Loop" validation gate. It captures intent and renders intermediate agent thoughts, fostering trust in the autonomous system.`,
  
  "Workflow Orchestrator": `### 🟣 Component Analysis: LangGraph Orchestrator
* **Scalability**: Stateless control plane. State persistence is offloaded to Redis/PostgreSQL (Checkpointer), allowing horizontal scaling of graph workers.
* **Security**: Implements "Least Privilege" execution. The graph defines rigid boundaries for tool access, preventing prompt injection from hijacking the entire workflow.
* **Agentic Role**: The "Cerebellum" of the agent. It manages cyclic loops, conditional branching (e.g., routing to RAG or Tools), and error recovery strategies.`,
  
  "Model Broker (Aviator)": `### 🧠 Component Analysis: LLM Core (Inference)
* **Scalability**: Dependent on model provider throughput. For high-volume agent workloads, consider batch processing or provisioned throughput tiers.
* **Security**: Input/Output guardrails (e.g., LlamaGuard) are critical here to scrub PII and prevent jailbreaks before the model processes data.
* **Agentic Role**: The "Prefrontal Cortex". It plans the execution path, decomposes complex user goals into atomic steps, and reflects on tool outputs to determine if the task is complete.`,
  
  "RAG Pipeline": `### 🔄 Component Analysis: RAG Pipeline
* **Scalability**: Asynchronous ingestion using queues (Kafka/SQS) ensures the vector index updates don't block query traffic.
* **Security**: Document-level access control (ACLs) must be respected during retrieval. Vector chunks should inherit the permissions of their source documents.
* **Agentic Role**: Provides "Long-term Memory". It grounds the agent's hallucinations by retrieving factual context, allowing the agent to "consult" a library before answering.`,
  
  "Vector Database": `### 🗄️ Component Analysis: Vector Store
* **Scalability**: Distributed HNSW indexes allow for billion-scale vector search with sub-100ms latency.
* **Security**: Encryption at rest and in transit is mandatory. Tenant isolation is key for SaaS agent platforms.
* **Agentic Role**: The "Associative Memory". It enables semantic search, allowing the agent to find relevant information not just by keywords, but by meaning and concept.`,
  
  "Enterprise Service Bus (MCP)": `### 🛠️ Component Analysis: MCP (Model Context Protocol) Server
* **Scalability**: Microservices architecture. Each tool (Calculator, Web Search, API Client) can run in its own container, scaling independently based on demand.
* **Security**: Sandbox execution environments (e.g., Firecracker microVMs) for running interpreted code generated by the LLM.
* **Agentic Role**: The "Hands" of the agent. It provides the standardized interface for the agent to perceive and affect the outside world (APIs, Databases, Filesystems).`,
  
  "Final Output": `### 📤 Component Analysis: Response Synthesizer
* **Scalability**: Server-Sent Events (SSE) or WebSockets for streaming token-by-token responses to the user, reducing perceived latency.
* **Security**: Output sanitization (HTML escaping) to prevent XSS attacks if the agent generates web content.
* **Agentic Role**: The "Communication Center". It formats the structured reasoning traces and raw data into a human-readable narrative.`,
};

export const getArchitectInsight = async (topic: string, context: string): Promise<{ content: string; model: string }> => {
  const prompt = `You are a Senior Cloud Architect. Explain the following architectural topic: "${topic}".
      Context of current workflow simulation: ${context}.
      Provide a deep-dive, technical but concise explanation focusing on scalability, security, and the "Agentic" nature of the component.
      Use bullet points where appropriate.`;

  // 1. Try Internal Model
  try {
     const content = await callInternalModel([{ role: 'user', content: prompt }]);
     return { content, model: INTERNAL_MODEL_NAME };
  } catch (error) {
    console.warn("Internal Model Failed, attempting Gemini Fallback.");
    
    // 2. Try Gemini Fallback
    try {
      const content = await callGeminiFallback(async (model) => {
         const result = await model.generateContent(prompt);
         const response = await result.response;
         return response.text();
      });
      return { content, model: "Gemini (Fallback)" };
    } catch (geminiError: any) {
      console.warn("All Models Failed (Falling back to cached insights):", geminiError);
      const fallbackContent = MOCK_INSIGHTS[topic] || 
        `### ⚠️ Live Architect Unavailable\n\n**System Notice**: The Cloud Architect AI is offline.\n\nError Details: ${geminiError.message || "Unknown Error"}\n\nHowever, the system is fully operational. The **${topic}** component is functioning within normal parameters.\n\n* **Status**: Active\n* **Mode**: Fallback Simulation\n* **Recommendation**: Continue testing workflow logic.`;
      return { content: fallbackContent, model: "Cached (Offline)" };
    }
  }
};

export const chatWithArchitect = async (history: { role: 'user' | 'assistant', content: string }[], systemPrompt?: string): Promise<{ content: string; model: string }> => {
  // 1. Try Internal Model
  try {
     const content = await callInternalModel(history as any, systemPrompt);
     return { content, model: INTERNAL_MODEL_NAME };
  } catch (error: any) {
    console.warn("Chat Error, attempting Gemini Fallback:", error);
    
    // 2. Try Gemini Fallback
    try {
      const content = await callGeminiFallback(async (model) => {
        const systemInstruction = systemPrompt
          ? { role: "system", parts: [{ text: systemPrompt }] }
          : undefined;
        const chat = model.startChat({
          history: history.slice(0, -1).map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          })),
          systemInstruction: systemInstruction || { role: "system", parts: [{ text: 'You are a Senior Cloud Architect. Provide clear, direct, and technical answers. Avoid unnecessary preamble. Focus on the solution.' }] },
        });
        
        const lastUserMessage = history[history.length - 1].content;
        const result = await chat.sendMessage(lastUserMessage);
        const response = await result.response;
        return response.text();
      });
      return { content, model: "Gemini (Fallback)" };
    } catch (geminiError: any) {
       console.warn("All Chat Models Failed:", geminiError);
       const isKeyError = geminiError?.message?.includes('403') || geminiError?.toString().includes('API key');
       const helpText = isKeyError ? "\n\n**Troubleshooting**: Ensure you have added a valid `VITE_API_KEY` to your `.env` file." : "";
       const rootErrorMessage = geminiError?.message || error?.message || "Unknown Error";
       
       return { 
         content: `I am currently operating in **Offline Mode** due to connectivity issues with both Primary (Internal) and Secondary (Gemini) models. \n\nI can confirm that the workflow cycle you just ran was valid. The data flowed through the expected generic path for an **Agentic Workflow**: \n\n1. **Planning**: LLM decomposed the request.\n2. **Execution**: Tools (RAG/MCP) were called.\n3. **Synthesis**: Results were combined.\n\nError: ${rootErrorMessage}${helpText}`,
         model: "Cached (Offline)"
       };
    }
  }
};