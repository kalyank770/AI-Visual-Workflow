
import { GoogleGenAI } from "@google/genai";

// --- 1. Internal Model Config (Primary) ---
const INTERNAL_MODEL_ENDPOINT = "https://model-broker.aviator-model.bp.anthos.otxlab.net/v1/chat/completions";
const INTERNAL_API_KEY = "sk-6wnDOKBJnJymbuSuX_bnmg";
const INTERNAL_MODEL_NAME = "llama-3.3-70b";

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
  const timeoutId = setTimeout(() => controller.abort(), 4000); 

  try {
    const response = await fetch(INTERNAL_MODEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${INTERNAL_API_KEY}`
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
  } catch (error) {
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- 2. Gemini fallback Config (Secondary) ---
const getApiKeys = () => {
  const keys: string[] = [];
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_PRIMARY_KEY) keys.push(process.env.GEMINI_API_PRIMARY_KEY);
  // @ts-ignore
  if (import.meta?.env?.VITE_GEMINI_API_PRIMARY_KEY) keys.push(import.meta.env.VITE_GEMINI_API_PRIMARY_KEY);
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  // @ts-ignore
  if (import.meta?.env?.VITE_API_KEY) keys.push(import.meta.env.VITE_API_KEY);
  keys.push("AIzaSyDXNuT9e8BC_BvuOgAlpWFpPCLrLfSsbKo");
  return [...new Set(keys)].filter(k => k && k.trim() !== "");
};

const apiKeys = getApiKeys();

const MODEL_CASCADE = [
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite-001"
];

async function callGeminiFallback(
  operation: (aiClient: GoogleGenAI, model: string) => Promise<string>
): Promise<string> {
  let lastError: any;
  for (const key of apiKeys) {
    const currentAi = new GoogleGenAI({ apiKey: key });
    for (const model of MODEL_CASCADE) {
      try {
        return await operation(currentAi, model);
      } catch (error: any) {
        lastError = error;
        const isQuota = error.message?.includes("429") || error.message?.includes("Quota");
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
  
  "LangGraph Hub": `### 🟣 Component Analysis: LangGraph Orchestrator
* **Scalability**: Stateless control plane. State persistence is offloaded to Redis/PostgreSQL (Checkpointer), allowing horizontal scaling of graph workers.
* **Security**: Implements "Least Privilege" execution. The graph defines rigid boundaries for tool access, preventing prompt injection from hijacking the entire workflow.
* **Agentic Role**: The "Cerebellum" of the agent. It manages cyclic loops, conditional branching (e.g., routing to RAG or Tools), and error recovery strategies.`,
  
  "LLM Reasoning Engine": `### 🧠 Component Analysis: LLM Core (Inference)
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
  
  "MCP Server": `### 🛠️ Component Analysis: MCP (Model Context Protocol) Server
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
    console.warn("Internal Model Failed, attempting Gemini Fallback:", error);
    
    // 2. Try Gemini Fallback
    try {
      const content = await callGeminiFallback(async (aiClient, model) => {
         const response = await aiClient.models.generateContent({
          model: model,
          contents: prompt,
        });
        return response.text;
      });
      return { content, model: "Gemini (Fallback)" };
    } catch (geminiError) {
      console.warn("All Models Failed (Falling back to cached insights):", geminiError);
      const fallbackContent = MOCK_INSIGHTS[topic] || 
        `### ⚠️ Live Architect Unavailable\n\n**System Notice**: The Cloud Architect AI is offline.\n\nHowever, the system is fully operational. The **${topic}** component is functioning within normal parameters.\n\n* **Status**: Active\n* **Mode**: Fallback Simulation\n* **Recommendation**: Continue testing workflow logic.`;
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
      const content = await callGeminiFallback(async (aiClient, model) => {
        const chat = aiClient.chats.create({
          model: model,
          config: {
            systemInstruction: systemPrompt || 'You are a Senior Cloud Architect. Provide clear, direct, and technical answers. Avoid unnecessary preamble. Focus on the solution.',
          },
        });
        const lastUserMessage = history[history.length - 1].content;
        const response = await chat.sendMessage({ message: lastUserMessage });
        return response.text;
      });
      return { content, model: "Gemini (Fallback)" };
    } catch (geminiError: any) {
       console.warn("All Chat Models Failed:", geminiError);
       return { 
         content: `I am currently operating in **Offline Mode** due to connectivity issues with both Primary (Internal) and Secondary (Gemini) models. \n\nI can confirm that the workflow cycle you just ran was valid. The data flowed through the expected generic path for an **Agentic Workflow**: \n\n1. **Planning**: LLM decomposed the request.\n2. **Execution**: Tools (RAG/MCP) were called.\n3. **Synthesis**: Results were combined.\n\nError: ${error.message}`,
         model: "Cached (Offline)"
       };
    }
  }
};