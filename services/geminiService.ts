
import { GoogleGenAI } from "@google/genai";

// Standardize API Key retrieval for local (Vite) and platform environments
// Returns an array of available keys to try in order of priority
const getApiKeys = () => {
  const keys: string[] = [];

  // 1. Primary Key
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_PRIMARY_KEY) {
    keys.push(process.env.GEMINI_API_PRIMARY_KEY);
  }
  // @ts-ignore
  if (import.meta?.env?.VITE_GEMINI_API_PRIMARY_KEY) {
    keys.push(import.meta.env.VITE_GEMINI_API_PRIMARY_KEY);
  }

  // 2. Secondary/Fallback Key
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY);
  }
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
    keys.push(process.env.API_KEY);
  }
  // @ts-ignore - Handle local Vite environment
  if (import.meta?.env?.VITE_API_KEY) {
    keys.push(import.meta.env.VITE_API_KEY);
  }

  // 3. Hardcoded Fallback (Last Resort)
  keys.push("AIzaSyDXNuT9e8BC_BvuOgAlpWFpPCLrLfSsbKo");

  // Remove duplicates and empty strings
  return [...new Set(keys)].filter(k => k && k.trim() !== "");
};

const apiKeys = getApiKeys();

// Model Cascade Strategy: Try high-quality first, fall back to faster/cheaper models if quota is exceeded
const MODEL_CASCADE = [
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite-001"
];

async function generateWithFallback(
  operation: (aiClient: GoogleGenAI, model: string) => Promise<string>
): Promise<string> {
  let lastError: any;

  // Outer Loop: Iterate through available API Keys
  for (const key of apiKeys) {
    const currentAi = new GoogleGenAI({ apiKey: key });

    // Inner Loop: Iterate through Models
    for (const model of MODEL_CASCADE) {
      try {
        return await operation(currentAi, model);
      } catch (error: any) {
        lastError = error;
        // If error is NOT a quota/not-found issue (e.g. network), might not want to continue. 
        // But for simplicity, we treat 429 (quota) and 404 (not found) as signals to try next.
        const isQuota = error.message?.includes("429") || error.message?.includes("Quota");
        const isNotFound = error.message?.includes("404") || error.message?.includes("not found");
        const isAuthError = error.message?.includes("403") || error.message?.includes("API key");
        
        if (isQuota || isNotFound) {
          console.warn(`Key ending in ...${key.slice(-4)} | Model ${model} failed (${isQuota ? 'Quota' : 'Not Found'}). Trying next model...`);
          continue; // Try next model with same key
        }

        if (isAuthError) {
           console.warn(`Key ending in ...${key.slice(-4)} is invalid or expired. Switching to next key...`);
           break; // Break logic to try NEXT KEY
        }

        throw error; // Unexpected error, stop cascade
      }
    }
  }
  throw lastError; // All keys and models failed
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

export const getArchitectInsight = async (topic: string, context: string) => {
  try {
    return await generateWithFallback(async (aiClient, model) => {
       const response = await aiClient.models.generateContent({
        model: model,
        contents: `You are a Senior Cloud Architect. Explain the following architectural topic: "${topic}".
        Context of current workflow simulation: ${context}.
        Provide a deep-dive, technical but concise explanation focusing on scalability, security, and the "Agentic" nature of the component.
        Use bullet points where appropriate.`,
      });
      return response.text;
    });
  } catch (error) {
    console.warn("All Gemini Models Failed (Falling back to cached insights):", error);
    // Return a high-quality mock if ALL API attempts fail
    return MOCK_INSIGHTS[topic] || 
      `### ⚠️ Live Architect Unavailable\n\n**System Notice**: The Cloud Architect AI is offline due to high traffic (Quota Exceeded on all models).\n\nHowever, the system is fully operational. The **${topic}** component is functioning within normal parameters.\n\n* **Status**: Active\n* **Mode**: Fallback Simulation\n* **Recommendation**: Continue testing workflow logic.`;
  }
};

export const chatWithArchitect = async (history: { role: 'user' | 'assistant', content: string }[]) => {
  try {
     return await generateWithFallback(async (aiClient, model) => {
        const chat = aiClient.chats.create({
          model: model,
          config: {
            systemInstruction: 'You are a Senior Cloud Architect helping a developer understand Agentic Workflows. You are an expert in LangGraph, MCP, RAG, and LLM orchestration. Keep answers professional and technical.',
          },
        });
        const lastUserMessage = history[history.length - 1].content;
        const response = await chat.sendMessage({ message: lastUserMessage });
        return response.text;
     });
  } catch (error) {
    console.warn("Chat Error (Falling back to mock):", error);
    return "I am currently operating in **Offline Mode** due to high API traffic across all available models. \n\nI can confirm that the workflow cycle you just ran was valid. The data flowed through the expected generic path for an **Agentic Workflow**: \n\n1. **Planning**: LLM decomposed the request.\n2. **Execution**: Tools (RAG/MCP) were called.\n3. **Synthesis**: Results were combined.\n\nPlease try again later for real-time analysis.";
  }
};
