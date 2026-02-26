/**
 * ============================================================
 *  RAG Pipeline Service — Real Retrieval-Augmented Generation
 * ============================================================
 *
 * This module implements a REAL RAG pipeline that runs entirely
 * in the browser. It provides:
 *
 *   1. Document ingestion & chunking
 *   2. Embedding generation (via Gemini API)
 *   3. In-memory vector store with cosine similarity search
 *   4. Query expansion (multi-query generation)
 *   5. Re-ranking by cross-similarity
 *
 * The pipeline ships with a set of built-in knowledge documents
 * so it works out of the box. Users can also add their own docs.
 *
 * NOTE: Embeddings require a valid Gemini API key. If no key is
 * available, the service falls back to TF-IDF style keyword
 * matching which still demonstrates a real retrieval pipeline.
 * ============================================================
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Types ─────────────────────────────────────────────────

export interface DocumentChunk {
  id: string;
  content: string;
  source: string;
  metadata: {
    chunkIndex: number;
    totalChunks: number;
    charStart: number;
    charEnd: number;
  };
  embedding?: number[];
}

export interface SearchResult {
  chunk: DocumentChunk;
  score: number;
  method: "vector" | "keyword";
}

export interface RAGPipelineResult {
  query: string;
  expandedQueries: string[];
  retrievedChunks: SearchResult[];
  rerankedChunks: SearchResult[];
  contextBlock: string;
  stats: {
    totalDocuments: number;
    totalChunks: number;
    searchTimeMs: number;
    embeddingModel: string;
    topScore: number;
  };
}

// ─── Configuration ─────────────────────────────────────────

const CHUNK_SIZE = 400; // chars per chunk
const CHUNK_OVERLAP = 80; // overlap between chunks
const TOP_K = 5; // number of results to retrieve
const RERANK_TOP = 3; // number of results after re-ranking
const EMBEDDING_MODEL = "text-embedding-004";

// ─── Built-in Knowledge Base ───────────────────────────────
// These documents ship with the app so RAG works immediately.

const BUILT_IN_DOCUMENTS: { title: string; content: string }[] = [
  {
    title: "Agentic AI Architecture Guide",
    content: `Agentic AI Architecture Guide — Version 2.2

An agentic AI system is an autonomous software agent that can perceive its environment, make decisions, and take actions to achieve goals without continuous human guidance. Unlike traditional chatbots that simply respond to prompts, agentic systems plan multi-step workflows, use tools, and self-correct.

Core Components of an Agentic System:
1. Orchestrator (LangGraph/LangChain): The central controller that manages state, routes requests, and coordinates between the LLM, tools, and memory. It implements a directed graph where nodes represent processing steps and edges represent transitions. State is persisted to Redis or PostgreSQL for fault tolerance.

2. Large Language Model (LLM): The reasoning engine that generates plans, evaluates tool outputs, and synthesizes final responses. Modern agentic systems use models like Llama 3.3 70B or GPT-4 with function calling capabilities. The LLM receives a structured prompt with the user query, retrieved context, and tool results.

3. Retrieval-Augmented Generation (RAG): A pattern that augments LLM responses with relevant documents retrieved from a vector database. The RAG pipeline consists of query expansion, embedding generation, similarity search, and re-ranking. This grounds the LLM's response in factual information rather than relying solely on training data.

4. Vector Database: Stores document embeddings as high-dimensional vectors. Supports nearest-neighbor search using algorithms like HNSW (Hierarchical Navigable Small World). Popular options include Pinecone, ChromaDB, Weaviate, and pgvector. Typical embedding dimensions are 768 or 1536.

5. Tool Integration (MCP): The Model Context Protocol provides a standardized interface for the agent to interact with external services — APIs, databases, file systems, and enterprise applications. Tools are registered with JSON schemas describing their inputs and outputs.

Planning and Execution Loop:
The agent follows a Plan-Execute-Evaluate cycle. First, the LLM generates an execution plan from the user query. The orchestrator then executes each step, calling tools or retrieving documents as needed. After execution, the LLM evaluates whether the goal has been achieved. If not, it replans and continues. This loop is bounded by a maximum iteration count to prevent infinite recursion.

Error Handling and Recovery:
Agentic systems must handle failures gracefully. If a tool call fails, the orchestrator can retry with different parameters, fall back to an alternative tool, or ask the LLM to reformulate the request. Checkpoint-based recovery allows resuming from the last successful state after a crash.

Security Considerations:
- Input sanitization to prevent prompt injection attacks
- Output guardrails to filter harmful or sensitive content
- Tool sandboxing to limit the blast radius of malicious code execution
- Rate limiting and quota enforcement per user or tenant
- RBAC (Role-Based Access Control) for tool and document access`
  },
  {
    title: "RAG Pipeline Best Practices",
    content: `RAG Pipeline Best Practices — Enterprise Deployment Guide

Retrieval-Augmented Generation (RAG) is the most common pattern for grounding LLM responses in enterprise knowledge. This guide covers production-grade RAG implementation.

Document Ingestion:
Documents must be preprocessed before they can be searched. This involves:
- Format parsing: Extract text from PDFs, DOCX, HTML, and other formats
- Cleaning: Remove headers, footers, page numbers, and formatting artifacts
- Chunking: Split documents into overlapping segments of 200-500 tokens
- Metadata extraction: Capture source, author, date, and section information

Chunking Strategies:
1. Fixed-size chunking: Split at fixed character or token counts with overlap. Simple but may break sentences mid-thought.
2. Semantic chunking: Use sentence boundaries and paragraph breaks. Preserves meaning but produces variable-sized chunks.
3. Recursive chunking: Try paragraph splits first, then sentence splits, then word splits. Best balance of coherence and size.
4. Document-aware chunking: Use document structure (headers, sections) to create meaningful chunks.

Embedding Generation:
Text chunks are converted to dense vector representations using embedding models:
- OpenAI text-embedding-3-large (3072 dimensions)
- Google text-embedding-004 (768 dimensions)
- Cohere embed-v3 (1024 dimensions)
- Open-source: BGE, E5, GTE models (768-1024 dimensions)

Embeddings capture semantic meaning, so "automobile" and "car" will have similar vectors even though they share no characters.

Hybrid Search:
Combining vector search with keyword search (BM25) produces better results than either alone:
- Vector search excels at semantic similarity ("What causes rust?" matches "Iron oxidation process")
- Keyword search excels at exact matches (product IDs, error codes, names)
- Reciprocal Rank Fusion (RRF) merges both result sets

Re-ranking:
Initial retrieval returns a candidate set. A cross-encoder re-ranker then scores each candidate against the original query for higher precision. Cross-encoders like ms-marco-MiniLM are more accurate than bi-encoders but slower.

Query Expansion:
Generating multiple reformulations of the user query improves recall:
- Synonym expansion: "cost" → "price", "expense", "fee"
- Hypothetical Document Embedding (HyDE): Generate a hypothetical answer and use its embedding
- Multi-query generation: Ask the LLM to generate 3 variants of the query

Evaluation Metrics:
- Precision@K: Fraction of relevant documents in top-K results
- Recall@K: Fraction of all relevant documents found in top-K
- MRR (Mean Reciprocal Rank): Average position of first relevant result
- NDCG: Normalized Discounted Cumulative Gain
- Faithfulness: Does the LLM response stay grounded in retrieved context?`
  },
  {
    title: "LangGraph Orchestration Patterns",
    content: `LangGraph Orchestration Patterns — Advanced Agent Workflows

LangGraph is a framework for building stateful, multi-step agent workflows as directed graphs. Each node is a function that transforms the graph state, and edges define the control flow.

Graph State Management:
The graph state is a TypedDict (Python) or interface (TypeScript) that flows through every node. It typically contains:
- messages: The conversation history
- plan: The current execution plan
- tool_results: Results from tool calls
- context: Retrieved documents from RAG
- metadata: Request ID, timestamps, retry counts

Conditional Routing:
Edges can be conditional — the next node is determined at runtime based on the current state:
- If the LLM's plan includes "search_documents", route to the RAG node
- If the plan includes "call_api", route to the MCP/tool node
- If all steps are complete, route to the synthesis node

Checkpointing:
LangGraph supports persistent checkpointing, saving the graph state after each node execution. This enables:
- Fault tolerance: Resume from the last checkpoint after a crash
- Human-in-the-loop: Pause execution, show intermediate results to a human, and resume
- Time travel: Replay the graph from any previous state for debugging

Subgraph Composition:
Complex workflows can be decomposed into subgraphs. For example:
- Research subgraph: Query expansion → Vector search → Re-ranking
- Tool execution subgraph: Tool selection → Parameter validation → API call → Result parsing
- Synthesis subgraph: Context assembly → LLM generation → Citation linking

Error Handling Patterns:
1. Retry with backoff: Retry failed nodes with exponential delays
2. Fallback nodes: If primary tool fails, try alternative
3. Graceful degradation: Continue without the failed component
4. Human escalation: Route to a human operator when confidence is low

Loop Detection:
Agents can get stuck in infinite loops (e.g., repeatedly calling the same tool). LangGraph provides:
- Max iteration limits per node and globally
- Cycle detection in the graph topology
- Timeout-based circuit breakers

Streaming:
LangGraph supports streaming intermediate results:
- Token-level streaming from the LLM
- Node-level events when each step completes
- Custom event channels for monitoring dashboards`
  },
  {
    title: "Vector Database Operations",
    content: `Vector Database Operations — Performance and Scaling Guide

Vector databases store high-dimensional embeddings and support efficient nearest-neighbor search. This guide covers operational best practices.

Index Types:
1. HNSW (Hierarchical Navigable Small World): The most popular index for production use. Builds a multi-layer graph where each layer has fewer nodes. Search starts at the top layer and descends. Offers O(log n) query time with high recall.

2. IVF (Inverted File Index): Clusters vectors using k-means, then searches only the nearest clusters. Faster build time than HNSW but lower recall at the same speed.

3. Flat (Brute Force): Computes distance to every vector. Perfect recall but O(n) time. Only viable for small collections (<100K vectors).

4. PQ (Product Quantization): Compresses vectors by splitting them into sub-vectors and quantizing each. Reduces memory by 4-8x with some recall loss.

Distance Metrics:
- Cosine Similarity: Measures angle between vectors. Best for text embeddings where magnitude doesn't matter.
- Euclidean (L2): Measures straight-line distance. Better for image embeddings.
- Dot Product: Fast computation, equivalent to cosine for normalized vectors.

Scaling Strategies:
- Sharding: Distribute vectors across multiple nodes by hash or range
- Replication: Read replicas for high query throughput
- Tiered storage: Hot vectors in memory, warm on SSD, cold on object storage
- Namespace isolation: Separate vector spaces per tenant for multi-tenancy

Metadata Filtering:
Most queries combine vector similarity with metadata filters:
- "Find documents about RAG published after 2024" → vector search + date filter
- Pre-filtering: Apply metadata filter first, then vector search on subset
- Post-filtering: Vector search first, then filter results (faster but may miss results)

Monitoring:
- Query latency (p50, p95, p99)
- Index size and memory usage
- Recall at different query loads
- Ingestion throughput (vectors/second)

Backup and Recovery:
- Regular snapshots of the index
- Write-ahead logs for point-in-time recovery
- Cross-region replication for disaster recovery`
  },
  {
    title: "MCP Protocol Specification",
    content: `Model Context Protocol (MCP) — Tool Integration Standard

The Model Context Protocol is an open standard for connecting AI agents to external tools and data sources. It provides a unified interface so agents can discover, authenticate with, and call tools without custom integration code.

Protocol Overview:
MCP uses JSON-RPC 2.0 over stdio or HTTP/SSE transport. The client (agent) sends requests to an MCP server, which executes the tool and returns results. The protocol supports:
- Tool discovery: List available tools with their schemas
- Tool execution: Call a tool with validated parameters
- Resource access: Read files, database records, or API responses
- Prompts: Pre-defined prompt templates for common tasks

Tool Registration:
Each tool is registered with:
- name: Unique identifier (e.g., "get_stock_price")
- description: Human-readable description for the LLM to understand when to use it
- input_schema: JSON Schema defining required and optional parameters
- output_schema: Expected response format

Authentication:
MCP supports multiple auth mechanisms:
- API keys: Simple bearer token authentication
- OAuth 2.0: Delegated access with scopes
- mTLS: Mutual TLS for service-to-service calls
- Custom: Plugin-based auth adapters

Security:
- Sandbox execution: Tools run in isolated containers or microVMs
- Input validation: Parameters are validated against the schema before execution
- Output sanitization: Results are cleaned before being passed to the LLM
- Rate limiting: Per-tool and per-user request quotas
- Audit logging: All tool calls are recorded for compliance

Enterprise Integration:
MCP enables agents to interact with enterprise systems:
- CRM: Query customer records, update opportunities
- ERP: Check inventory, process orders
- ITSM: Create tickets, check status, escalate issues
- Knowledge bases: Search Confluence, SharePoint, Notion
- Communication: Send emails, Slack messages, Teams notifications

Best Practices:
1. Start with read-only tools, add write capabilities gradually
2. Implement confirmation for destructive actions
3. Use structured outputs that the LLM can parse reliably
4. Cache frequently accessed data to reduce API load
5. Version your tool schemas to support backward compatibility`
  },
  {
    title: "Enterprise AI Security Policy",
    content: `Enterprise AI Security Policy — Version 3.1

This document outlines security requirements for deploying AI agents in enterprise environments.

Data Classification:
All data processed by AI agents must be classified:
- PUBLIC: Can be shared externally (marketing content, public docs)
- INTERNAL: For employee use only (policies, procedures)
- CONFIDENTIAL: Sensitive business data (financials, strategy)
- RESTRICTED: Regulated data (PII, PHI, PCI) — requires encryption at rest and in transit

Access Control:
- Role-Based Access Control (RBAC) for all agent capabilities
- Principle of least privilege — agents should only access tools and data required for the task
- Multi-factor authentication for administrative access
- Session tokens with 15-minute expiry for agent-to-service calls

Prompt Security:
- Input sanitization: Strip potential injection patterns before sending to LLM
- System prompt protection: Never expose system prompts to end users
- Output filtering: Scan LLM responses for PII, credentials, and sensitive data
- Jailbreak detection: Monitor for attempts to override safety guidelines

Data Retention:
- Conversation logs: Retained for 90 days, then anonymized
- Tool execution logs: Retained for 1 year for audit purposes
- Embeddings: Retained as long as source documents are valid
- Model outputs: Not retained unless explicitly saved by the user

Incident Response:
If an AI agent produces harmful, biased, or incorrect output:
1. Immediately flag the conversation for review
2. Disable the specific tool or model version if pattern persists
3. Notify the AI Ethics Board within 24 hours
4. Document root cause and implement guardrails
5. Conduct post-incident review within 5 business days

Compliance:
- SOC 2 Type II compliant infrastructure
- GDPR data processing agreements for EU data
- HIPAA BAA for healthcare data
- Regular penetration testing and vulnerability assessments
- Annual third-party AI safety audits`
  },
  {
    title: "OpenText Corporate Overview",
    content: `OpenText Corporation — Corporate Overview & Product Portfolio

OpenText Corporation is a Canadian company that develops and sells enterprise information management (EIM) software. Founded in 1991 and headquartered in Waterloo, Ontario, Canada, OpenText is the largest Canadian software company by revenue and one of the largest software companies globally. The company trades on NASDAQ (OTEX) and the Toronto Stock Exchange (OTEX).

OpenText acquired Micro Focus International in 2023 for approximately $5.8 billion, significantly expanding its product portfolio in DevOps, IT operations, security, and application modernization.

Core Product Categories:

1. Content Management:
   - OpenText Content Server (formerly Livelink): Enterprise content management platform for managing documents, records, and digital assets throughout their lifecycle. Supports workflows, retention policies, and compliance requirements.
   - OpenText Documentum: Industry-leading content services platform for managing unstructured content at enterprise scale. Used extensively in life sciences, financial services, and government.
   - OpenText Core Content: Cloud-native content management designed for modern workplaces, offering seamless integration with SAP, Salesforce, and Microsoft 365.
   - OpenText Extended ECM: Extends content management into leading business applications (SAP, Microsoft 365, Salesforce, SuccessFactors) to manage content in context of business processes.

2. Business Network & Supply Chain:
   - OpenText Business Network: The world's largest business-to-business (B2B) network, connecting over 1 million trading partners. Supports EDI, API-based integrations, and supply chain visibility.
   - OpenText Trading Grid: Cloud-based integration platform for B2B commerce, facilitating electronic data interchange (EDI), supply chain management, and partner onboarding.
   - OpenText Freight Management: Transportation management solution for optimizing logistics, freight audit, and payment processing.
   - OpenText Active Orders: Real-time order management and supply chain collaboration platform.

3. Digital Experience:
   - OpenText TeamSite: Web content management system for creating, managing, and delivering personalized digital experiences across websites, mobile apps, and portals.
   - OpenText Exstream: Customer communications management (CCM) platform for creating highly personalized, omnichannel customer communications including statements, bills, policies, and correspondence.
   - OpenText Media Management: Digital asset management (DAM) solution for managing rich media assets — images, videos, audio, and creative files.
   - OpenText Experience Platform: Unified platform combining content management, digital asset management, and AI-powered personalization.

4. Security & Protection:
   - OpenText NetIQ: Identity and access management (IAM) suite providing single sign-on, multi-factor authentication, privileged access management, and identity governance.
   - OpenText ArcSight: Security information and event management (SIEM) platform for real-time threat detection, security monitoring, and compliance reporting.
   - OpenText Fortify: Application security testing suite including static analysis (SAST), dynamic analysis (DAST), and software composition analysis (SCA).
   - OpenText Voltage: Data-centric security platform offering format-preserving encryption, tokenization, and data masking for protecting sensitive data.
   - OpenText EnCase: Digital forensics and incident response platform used by law enforcement and enterprises for investigating cybersecurity incidents.
   - OpenText Data Protector: Enterprise backup and disaster recovery solution supporting physical, virtual, and cloud environments.

5. AI & Analytics:
   - OpenText Magellan: AI and analytics platform that combines machine learning, advanced analytics, and business intelligence. Provides text mining, sentiment analysis, predictive analytics, and anomaly detection.
   - OpenText Content Intelligence: AI-powered content analysis that automatically classifies, extracts, and enriches information from unstructured content.
   - OpenText Aviator: Next-generation AI platform leveraging large language models (LLMs) for enterprise use cases including intelligent search, content summarization, and conversational AI assistants.

6. IT Operations Management:
   - OpenText SMAX: IT service management (ITSM) platform built on machine learning for automated ticket classification, virtual agent support, and service desk operations.
   - OpenText Operations Bridge: AIOps platform for IT event correlation, performance monitoring, and automated remediation across hybrid IT environments.
   - OpenText Network Operations Management: Network monitoring and management for enterprise and service provider environments.
   - OpenText Universal Discovery and CMDB: Automated asset discovery and configuration management database for IT infrastructure visibility.

7. Application Modernization & DevOps:
   - OpenText COBOL Development: Tools for maintaining and modernizing COBOL applications on mainframe and distributed environments.
   - OpenText Enterprise Analyzer: Code analysis and documentation tools for understanding legacy application portfolios.
   - OpenText LoadRunner: Performance testing solution for load testing applications, APIs, and microservices.
   - OpenText ALM Quality Center: Application lifecycle management for test management, requirements traceability, and defect tracking.
   - OpenText UFT One: Unified functional testing for automated testing of desktop, web, mobile, and API applications.
   - OpenText ValueEdge: End-to-end value stream management platform connecting planning, development, testing, and delivery.

Cloud Strategy:
OpenText Cloud Editions (CE) deliver quarterly releases of the full product portfolio via cloud deployment. OpenText manages infrastructure on AWS, Azure, and Google Cloud. Options include:
- OpenText Cloud: Fully managed SaaS offerings
- OpenText Managed Services: Customer-dedicated cloud environments
- Hybrid deployments: On-premise components connected to cloud services

Key Industries Served:
- Financial Services: Regulatory compliance, customer communications, risk management
- Life Sciences & Healthcare: Clinical document management, regulatory submissions, pharmacovigilance
- Government & Public Sector: Records management, FOIA compliance, secure communications
- Energy & Utilities: Asset management, safety documentation, regulatory compliance
- Manufacturing: Supply chain visibility, quality management, product lifecycle management
- Legal: Matter management, e-discovery, contract lifecycle management`
  },
  {
    title: "OpenText Content Server Administration Guide",
    content: `OpenText Content Server (OTCS) — Administration Guide v26.1 (Updated February 2026)

OpenText Content Server is the core content management platform in the OpenText product suite. Previously known as Livelink, it provides enterprise-grade document management, records management, workflow automation, and collaboration capabilities. Content Server is deployed by over 15,000 organizations worldwide managing billions of documents.

Version History (Recent):
- v24.3 (August 2024): Aviator AI integration preview, improved Smart View UI
- v25.1 (February 2025): Modern web UI refresh, Aviator-powered smart search, bulk metadata update with AI suggestions, REST API v2.1 with batch operations
- v25.4 (November 2025): Native PostgreSQL support (GA), Records Management 5.0 with AI-powered retention recommendations, governance dashboard, Zero Trust Architecture support
- v26.1 (February 2026): AI-native content creation, smart versioning with AI change summaries, cross-repository federation, sub-second search on 100M+ document repositories

System Architecture:
Content Server runs on a multi-tier architecture:
- Web Tier: Apache Tomcat or IIS serving the web interface and REST APIs. Smart View modern UI (v25.1+) uses React-based front end with responsive design
- Application Tier: Content Server engine handling business logic, indexing, and workflow execution. Supports horizontal scaling with load-balanced application nodes
- Database Tier: Microsoft SQL Server, Oracle, or PostgreSQL (GA in v25.4+) storing metadata, user data, and system configuration. PostgreSQL support reduces license costs significantly
- Storage Tier: File system, NAS/SAN, or object storage (S3-compatible, Azure Blob, Google Cloud Storage) for binary content. Content compression and deduplication available
- Search Tier: OpenText IDOL or Elasticsearch for full-text search and content analytics. IDOL 25.1+ provides 40% faster indexing
- AI Tier (v25.1+): Aviator integration layer connecting to LLM services (Azure OpenAI, Google Vertex AI, AWS Bedrock, or on-premises models via Model Broker)

Key Features:
1. Document Management:
   - Version control with major/minor versioning
   - Check-in/check-out locking mechanism
   - Metadata-driven classification using categories and attributes
   - Compound documents and document templates
   - Drag-and-drop upload via web interface
   - Microsoft Office integration via OpenText Desktop Suite
   - Smart View responsive UI with customizable widgets (v25.1+)
   - AI-native content creation: Draft documents from templates with Aviator (v26.1+)
   - Smart versioning: AI detects and summarizes changes between versions (v26.1+)

2. Records Management (RM):
   - DoD 5015.2 certified records management
   - File plan hierarchy: Classification → Folder → Record
   - Retention schedules with automatic disposition actions (destroy, transfer, review)
   - Legal holds to prevent destruction of records under litigation
   - Physical records management (PRM) for paper documents
   - RM classification can be applied automatically via Content Intelligence
   - Records Management 5.0 (v25.4+): AI-powered retention recommendations that analyze content to suggest appropriate retention schedules
   - Governance dashboard (v25.4+): Real-time compliance score, data hygiene metrics, storage analytics, and policy violation alerts

3. Workflow:
   - Visual workflow designer for creating approval, review, and routing processes
   - Parallel and serial step execution
   - Conditional branching based on metadata or user decisions
   - Sub-workflow composition for complex processes
   - Email notifications and escalation rules
   - Workflow audit trail for compliance
   - Aviator-assisted workflow creation (v25.2+): Describe what you need in natural language and Aviator generates the workflow map
   - AI-driven task assignment (v25.2+): Automatically routes tasks to the most appropriate user based on workload and expertise

4. Permissions Model:
   - Permission levels: See, See Contents, Modify, Edit Attributes, Reserve, Add Items, Delete Versions, Delete, Edit Permissions
   - Inheritance from parent containers
   - Role-based permissions for workspaces
   - Owner groups and ACLs (Access Control Lists)
   - Cross-referencing with external LDAP/Active Directory groups
   - Zero Trust Architecture (v25.4+): Every API call authenticated and authorized, continuous session validation, device trust scoring

5. Admin Center:
   - System Administration page for server configuration
   - License management and user provisioning
   - Background agent monitoring (indexing, purging, notifications)
   - Database maintenance: orphan purge, content audit, integrity check
   - Logging: server logs, audit logs, admin history
   - Health dashboard (v25.1+): Real-time system health, resource utilization, and performance metrics
   - AI usage analytics (v25.2+): Track Aviator API calls, token consumption, and user adoption metrics

6. Aviator AI Integration (v25.1+):
   - Aviator Search: Natural language queries across all content ("Find all contracts expiring this quarter")
   - Content Summarization: AI-generated summaries for documents, folders, and search results
   - Intelligent Classification: Automatic metadata tagging and categorization using AI
   - Contract Analysis: Clause extraction, risk highlighting, and obligation tracking
   - PII Detection & Auto-Redaction (v25.2+): Automatically identifies and masks sensitive data in uploaded documents
   - AI-native content drafting (v26.1+): Generate documents from prompts using enterprise templates and context

7. Cross-Repository Federation (v26.1+):
   - Unified search and browse across Content Server, Documentum, and SharePoint from a single interface
   - Federated metadata view showing aligned properties across repositories
   - Cross-system workflow orchestration: Start a workflow in Content Server that includes review steps in Documentum or SharePoint
   - Migration assistant: AI-powered tool to plan and execute content migration between repositories

REST API (v2.1 — Updated in v25.1+):
Content Server exposes a RESTful API for integration:
- Authentication: POST /api/v1/auth — returns a ticket for subsequent requests. Supports OAuth 2.0 and SAML tokens (v25.1+)
- List nodes: GET /api/v2/nodes/{id}/nodes — paginated child listing with sorting and filtering
- Create folder: POST /api/v2/nodes — body: { type: 0, parent_id: 2000, name: "New Folder" }
- Upload document: POST /api/v2/nodes — multipart form with file attachment. Supports chunked upload for large files (v25.1+)
- Batch operations: POST /api/v2/nodes/batch — create, update, or delete multiple items in a single call (v25.1+)
- Search: GET /api/v2/search?where_name=contract* — metadata, full-text, and natural language search (Aviator-powered since v25.1)
- Workflow initiation: POST /api/v2/workflows — trigger a workflow map with parameters
- Metadata: GET /api/v2/nodes/{id}/categories — retrieve applied categories
- AI endpoints (v25.2+): POST /api/v2/ai/summarize — summarize a document. POST /api/v2/ai/classify — classify a document
- Webhooks (v25.1+): Register callbacks for document events (create, update, delete, workflow state change)

Deployment Options (v25.4+):
- On-Premises: Traditional deployment on customer infrastructure
- OpenText Cloud: Fully managed SaaS on AWS/Azure/GCP
- Hybrid: On-prem Content Server connected to OpenText Cloud services (Aviator, Business Network)
- Containerized (v25.4+): Docker/Kubernetes deployment for Content Server application tier. Helm charts available for EKS, AKS, GKE

Performance Benchmarks (v26.1):
- Document ingestion: 50,000+ documents/hour (single instance)
- Search response: <200ms for queries across 100M+ documents (with IDOL 26.1)
- REST API throughput: 5,000+ requests/second per application node
- Concurrent users: 10,000+ per clustered environment
- Storage: Supports repositories exceeding 50TB of binary content

Best Practices:
- Enable HTTPS/TLS for all connections
- Configure connection pooling for database performance
- Schedule regular full and incremental backups
- Monitor disk space for content storage and temp directories
- Use OpenText Directory Services for centralized authentication
- Implement category inheritance for consistent metadata application
- Size the search index nodes based on document volume (1M docs per IDOL node)
- Enable audit logging for regulatory compliance environments
- Leverage PostgreSQL (v25.4+) to reduce database licensing costs
- Enable Aviator AI features incrementally: start with search, then classification, then content creation
- Use the governance dashboard (v25.4+) to monitor compliance posture continuously
- Configure webhooks for event-driven integrations instead of polling the REST API`
  },
  {
    title: "OpenText Aviator AI Platform Guide",
    content: `OpenText Aviator — AI Platform User Guide v2.0

OpenText Aviator is OpenText's next-generation AI and analytics platform designed to bring the power of large language models (LLMs) and generative AI to enterprise content and business processes.

Overview:
Aviator integrates AI capabilities across the entire OpenText product portfolio, enabling intelligent automation, conversational search, content summarization, and decision support. It is built on a responsible AI framework ensuring data privacy, compliance, and transparency.

Key Components:

1. Aviator Search:
   - Natural language search across all OpenText content repositories
   - Semantic understanding: "Find all contracts expiring this quarter" understands date ranges and document types
   - Multi-source search: Content Server, Documentum, SharePoint, file shares, cloud storage
   - AI-generated answer snippets from retrieved documents
   - Citation linking: Every AI response includes links to source documents
   - Respects existing permission models — users only see content they have access to

2. Aviator Chat:
   - Conversational AI assistant for business users
   - Context-aware: Understands the current workspace, project, or case the user is working in
   - Can summarize documents, extract key clauses from contracts, compare document versions
   - Supports follow-up questions with conversation memory
   - Integration with Content Server, Extended ECM, and Core Content
   - Enterprise guardrails prevent hallucination by grounding responses in indexed content

3. Aviator for IT Operations (ITSM):
   - Integrated with OpenText SMAX for intelligent service desk automation
   - Auto-classification of incoming tickets using NLP
   - Virtual agent: Resolves common IT issues (password resets, access requests) without human intervention
   - Knowledge article recommendation: Suggests relevant solutions from the knowledge base
   - Sentiment analysis: Detects frustrated users and escalates appropriately
   - Root cause analysis: Correlates events across monitoring tools to identify systemic issues

4. Aviator for DevOps:
   - Code analysis and vulnerability detection in CI/CD pipelines
   - Automated test generation from requirements and user stories
   - Intelligent code review suggestions
   - Performance optimization recommendations based on LoadRunner test results
   - Release risk assessment using historical defect data

5. Aviator IoT:
   - Real-time asset monitoring and anomaly detection for industrial equipment
   - Predictive maintenance: Forecasts equipment failures before they occur
   - Digital twin integration: AI models trained on sensor data for simulation
   - Alert correlation: Reduces alert noise by grouping related events

Architecture:
- Model Broker: Routes requests to the optimal LLM based on task type, latency requirements, and cost
  - Supports OpenText-hosted models, Azure OpenAI, Google Vertex AI, and on-premise Llama deployments
  - Model selection is transparent to the end user
- Embedding Service: Generates vector embeddings for content indexing
  - Integrates with OpenText IDOL for hybrid search (keyword + semantic)
  - Incremental embedding: Only new or modified content is re-embedded
- Retrieval Pipeline: RAG (Retrieval-Augmented Generation) for grounding LLM responses
  - Query expansion for improved recall
  - Cross-encoder re-ranking for precision
  - Configurable chunk size and overlap for different content types
- Guardrails Engine: Ensures responsible AI usage
  - PII detection and redaction in prompts and responses
  - Toxicity filtering
  - Factual grounding score: Measures how well the response is supported by retrieved content
  - Confidence thresholds: Low-confidence responses trigger fallback to human review

Deployment:
- Available as part of OpenText Cloud Editions (CE 24.2+)
- On-premise deployment via OpenText Aviator Docker containers
- Hybrid mode: Content stays on-premise, AI inference in cloud
- API access via REST and GraphQL endpoints

Data Privacy:
- No customer data is used to train foundation models
- All data processed within the customer's OpenText tenant boundary
- Audit logs track every AI interaction for compliance
- Configurable data residency (US, EU, APAC regions)
- SOC 2 Type II and ISO 27001 certified infrastructure`
  },
  {
    title: "OpenText Extended ECM Integration Guide",
    content: `OpenText Extended ECM — Integration Guide v24.2

OpenText Extended ECM (xECM) extends enterprise content management into leading business applications, creating a seamless experience where content is managed in the context of business processes.

Supported Integrations:

1. Extended ECM for SAP:
   - Manages documents directly from SAP transactions (purchase orders, invoices, HR records)
   - SAP Business Workspace: Contextual folder structure automatically created based on SAP business objects
   - Archiving: Long-term storage of SAP documents and print lists with full-text searchability
   - ArchiveLink and CMIS protocol compliance for SAP-certified document management
   - SAP Fiori integration: Content access within SAP's modern web interface
   - Supported SAP modules: FI/CO, MM, SD, HR, PM, PS, QM

2. Extended ECM for Microsoft 365:
   - Outlook integration: Save emails and attachments to Content Server with metadata
   - Teams integration: Content Server workspaces accessible as Teams tabs
   - SharePoint bridge: Unified search across SharePoint and Content Server
   - OneDrive synchronization for offline access to managed content
   - Co-authoring support with real-time collaboration

3. Extended ECM for Salesforce:
   - Documents linked to Salesforce objects (Accounts, Opportunities, Cases)
   - Automated folder creation based on Salesforce record types
   - Content visible within Salesforce Lightning interface
   - Quote and proposal generation from Salesforce data using OpenText Exstream templates

4. Extended ECM for SuccessFactors:
   - Employee file management integrated with SAP SuccessFactors HCM
   - Digital personnel folders with role-based access
   - Automated document routing for onboarding, performance reviews, and offboarding
   - Compliance with labor regulations for document retention

xECM Architecture:
- Content Server acts as the central repository
- Business Connector Module translates between business application events and Content Server actions
- Event-driven: Business application events (create PO, hire employee, close case) trigger content workflows
- REST API and OData endpoints for custom integrations
- Multi-tenant support for managed service deployments

Workspace Templates:
- Define folder structures, metadata schemas, and permission rules for each business object type
- Inheritance: Workspace template changes propagate to existing workspaces
- Classification: Documents automatically inherit metadata from the business context
- Lifecycle: Workspaces can be archived or destroyed based on the business object status

Best Practices:
- Start with high-volume, high-value processes (e.g., vendor invoices, customer contracts)
- Define workspace templates before deploying to production
- Configure metadata mapping between the business application and Content Server
- Enable audit logging for all cross-system content operations
- Use connection pooling and caching for API-heavy integrations
- Monitor synchronization queues for lag and error rates
- Plan for disaster recovery: Replicate Content Server and the business application together`
  },
  {
    title: "OpenText Developer API Reference",
    content: `OpenText Developer & API Reference Guide

OpenText provides extensive APIs across its product portfolio for custom integrations, automation, and extending platform capabilities. This guide covers the primary APIs and developer tools.

Content Server REST API v2:
- Base URL: https://{server}/otcs/cs.exe/api/v2
- Authentication: OTCS ticket via POST /api/v1/auth (username + password) or OAuth 2.0
- Common Operations:
  - GET /nodes/{id} — Retrieve node metadata
  - POST /nodes — Create folder (type:0), document (type:144), shortcut (type:1)
  - PUT /nodes/{id} — Update name, description, or metadata
  - DELETE /nodes/{id} — Delete a node
  - PUT /nodes/{id}/content — Upload new version of document
  - GET /nodes/{id}/versions — List all versions
  - GET /nodes/{id}/audit — Retrieve audit trail
  - POST /search — Full-text and metadata search
- Pagination: Use limit and page parameters for large result sets
- Expand fields: Use ?expand=properties{original_id} to include related data

OpenText Cloud Platform APIs:
- OpenText Developer Portal: https://developer.opentext.com
- Authentication: OAuth 2.0 with tenant-scoped access tokens
- Available Services:
  - Content Management Service: CRUD operations for cloud content
  - Capture Service: Document scanning, OCR, and classification
  - Notification Service: Email and push notification delivery
  - Publication Service: Document rendering and format conversion
  - Risk Guard Service: Content security scanning for malware and sensitive data
  - CSS (Content Storage Service): Binary content upload and download

OpenText Documentum REST API:
- Base URL: https://{server}/dctm-rest/repositories/{repo}
- Operations follow CMIS (Content Management Interoperability Services) standard
- Supports JSON and Atom feed response formats
- DQL (Documentum Query Language) for advanced content queries
- Lifecycle and workflow operations via REST

SDKs and Libraries:
- OpenText Content Server SDK (Java, .NET): Full client libraries for programmatic access
- OpenText Cloud SDK (JavaScript/TypeScript): npm packages for cloud platform services
- OpenText Capture SDK (iOS, Android): Mobile capture with OCR and barcode recognition
- OpenText IDOL SDK: Search and analytics API client

Webhooks and Events:
- Content Server supports event-driven notifications via OpenText Notifications Framework
- Events: node.created, node.modified, node.deleted, workflow.completed
- Webhook delivery: HTTP POST to configured endpoints with event payload
- Retry policy: 3 retries with exponential backoff

OpenText AppWorks:
- Low-code/no-code platform for building custom business applications on top of Content Server
- Visual process designer for workflows
- Form builder for data capture
- Role-based dashboards and reports
- Mobile-responsive application rendering
- Extension points for custom JavaScript widgets and server-side modules

Authentication Patterns:
- OTCS Ticket: Legacy authentication for Content Server — URL-based token
- OAuth 2.0: Recommended for cloud and modern integrations
  - Authorization Code flow for user-facing applications
  - Client Credentials flow for service-to-service communication
  - Refresh token rotation for long-lived sessions
- SAML 2.0: Federated SSO with enterprise identity providers
- OpenID Connect: Modern SSO standard supported by OpenText Cloud

Rate Limiting:
- Cloud APIs: 100 requests/second per tenant (burst to 200)
- On-premise: Configurable in Content Server admin settings
- HTTP 429 response with Retry-After header when limit exceeded

Best Practices for Developers:
- Use pagination for listing operations — never fetch all results at once
- Implement retry logic with exponential backoff for transient failures
- Cache authentication tokens and reuse within their validity period
- Use webhooks instead of polling for real-time content change detection
- Test with OpenText Sandbox environments before deploying to production
- Follow OpenText API versioning — include API version in URL path
- Use structured logging to correlate API calls with business transactions`
  },
  {
    title: "OpenText Latest News and Updates 2025-2026",
    content: `OpenText Corporation — Latest News, Updates & Strategic Direction (2025-2026)

Leadership:
- CEO: Mark J. Barrenechea (also serves as Vice Chair and CTO)
- CFO: Frank J. Sullivan
- President: Muhi Majzoub
- Headquarters: Waterloo, Ontario, Canada
- Stock: NASDAQ: OTEX / TSX: OTEX
- Employees: ~24,000 globally (as of fiscal year 2025)
- Annual Revenue: Approximately $5.8 billion USD (FY2025)

Recent Acquisitions & Divestitures:

Micro Focus Acquisition (January 2023):
OpenText completed the acquisition of Micro Focus International plc for approximately $5.8 billion in January 2023. This was the largest acquisition in OpenText's history and significantly expanded the company's portfolio in:
- IT Operations Management (ITOM)
- Application Delivery Management (ADM)
- Cybersecurity
- Application Modernization & Connectivity
The combined entity became one of the world's largest software companies with comprehensive information management capabilities.

Cybersecurity Business Divestiture (2024-2025):
In 2024, OpenText announced the divestiture of its Application Security (Fortify, WebInspect), Network Security, and Identity & Access Management businesses to focus on its core information management and AI strategy. This included some products acquired through Micro Focus. The proceeds were used to reduce debt from the Micro Focus acquisition and fund AI investments.

AMC (Application Modernization & Connectivity) Divestiture:
OpenText divested the Application Modernization and Connectivity (AMC) business line, which included COBOL-related development tools, to streamline operations and focus on cloud and AI growth areas.

OpenText Cloud Editions (CE) Release Timeline:
- CE 21.1 through CE 23.4: Quarterly releases establishing the cloud-first cadence
- CE 24.1 (February 2024): Major Aviator AI integration across the portfolio
- CE 24.2 (May 2024): Aviator for Content Server, enhanced SMAX AI capabilities
- CE 24.3 (August 2024): Expanded Aviator to Business Network, improved Exstream personalization
- CE 24.4 (November 2024): AI-powered security in NetIQ, Aviator for Extended ECM
- CE 25.1 (February 2025): Aviator 2.0 with multi-model support, Content Aviator GA
- CE 25.2 (May 2025): Enhanced RAG pipelines in Aviator, AI-driven compliance workflows
- CE 25.3 (August 2025): Aviator for Supply Chain, AI analytics in Trading Grid
- CE 25.4 (November 2025): Next-gen Content Server with native AI, expanded Aviator IoT
- CE 26.1 (February 2026): Latest release — Aviator 3.0, autonomous agent workflows, deep SAP S/4HANA Cloud integration, sustainability reporting module

OpenText Aviator Updates (2025-2026):
Aviator has been the cornerstone of OpenText's strategy since its launch in CE 24.1. Recent updates include:
- Aviator 2.0 (CE 25.1): Multi-model LLM support allowing customers to bring their own models (Azure OpenAI, Google Vertex AI, AWS Bedrock, on-prem Llama). Introduced Aviator Agents that can autonomously plan and execute multi-step workflows.
- Aviator for Content (CE 25.2): Deep integration with Content Server and Documentum. AI-powered document summarization, automatic metadata extraction, intelligent classification, and contract clause analysis.
- Aviator for Supply Chain (CE 25.3): Predictive supply chain analytics, demand forecasting, supplier risk assessment using Business Network data.
- Aviator 3.0 (CE 26.1): Autonomous agent workflows using LangGraph-style orchestration. Agents can search content, execute business rules, call APIs, and synthesize results. Retrieval-Augmented Generation (RAG) with enterprise-grade guardrails. Support for o1-class reasoning models.

Financial Highlights (Fiscal Year 2025):
- Total Revenue: ~$5.8 billion
- Cloud Revenue: ~$1.8 billion (31% of total, growing 15% YoY)
- Annual Recurring Revenue (ARR): ~$4.2 billion
- Free Cash Flow: ~$850 million
- Debt: Reduced by ~$1.5 billion post-Micro Focus, targeting investment-grade rating
- R&D Investment: ~$1 billion annually, with 40% allocated to AI/ML initiatives

OpenText Strategy — "Information Reimagined":
1. Cloud-First: All products available via OpenText Cloud Editions with quarterly releases
2. AI Everywhere: Aviator AI embedded across every product line
3. Business Network: Leveraging the world's largest B2B network (1M+ trading partners) as a competitive moat
4. Total Growth: Combination of organic cloud growth, cross-sell, and strategic acquisitions
5. Developer Ecosystem: OpenText Developer Portal, APIs, SDKs, and marketplace for partner integrations

Competitive Positioning:
- vs. Microsoft 365: OpenText offers deeper ECM capabilities, regulatory compliance, and SAP integration
- vs. Box/Dropbox: OpenText provides enterprise-grade records management, B2B integration, and workflow
- vs. ServiceNow: SMAX competes with AI-first ITSM, lower TCO
- vs. Salesforce (content): Extended ECM provides managed content within Salesforce context
- vs. IBM (content): Documentum and Content Server are direct alternatives with broader integration`
  },
  {
    title: "OpenText Cloud Editions CE 25 and CE 26 Release Notes",
    content: `OpenText Cloud Editions — CE 25.x and CE 26.1 Release Notes

CE 25.1 (February 2025) — Key Features:
Content Server 25.1:
- New modern web UI refresh with responsive design
- Aviator-powered smart search: Natural language queries across all content
- Bulk metadata update with AI suggestions
- Enhanced WebDAV support for desktop integration
- Performance: 40% faster search indexing with IDOL 25.1
- REST API v2.1: New batch operations endpoint, improved pagination

Extended ECM 25.1:
- SAP S/4HANA Cloud Public Edition integration (certified)
- Microsoft Teams deep integration: Workspace tabs, channel-based content management
- Salesforce Einstein integration with Aviator for intelligent case management
- New workspace analytics dashboard with usage metrics

SMAX 25.1:
- Aviator Virtual Agent 2.0: Supports 15+ languages, contextual follow-ups
- Predictive ticket routing with confidence scoring
- Change risk assessment using ML models
- Asset discovery integration with Universal Discovery CMDB
- Native integration with Microsoft Intune for device management

Business Network 25.1:
- Real-time supply chain visibility dashboard
- AI-powered shipment ETA prediction
- Carbon emissions tracking per shipment
- Expanded global compliance for e-invoicing (France, Germany, Saudi Arabia, India)

CE 25.2 (May 2025) — Key Features:
Content Aviator GA:
- Document summarization in 20+ languages
- Contract clause extraction and risk highlighting
- Automated classification with configurable confidence thresholds
- PII detection and auto-redaction in uploaded documents
- Integration with OpenText Capture Center for intelligent document processing

Documentum 25.2:
- Cloud-native Documentum as a Service (DaaS) GA
- Kubernetes-based deployment on AWS EKS and Azure AKS
- xCP 2.0 case management with AI-driven task assignment
- Interoperability with Content Server via unified REST API

Exstream 25.2:
- AI-generated content suggestions for personalized communications
- Interactive document preview with real-time data binding
- New output channels: WhatsApp Business, RCS messaging
- Accessibility compliance (WCAG 2.1 AA) for generated documents

CE 25.3 (August 2025) — Key Features:
Aviator for Supply Chain:
- Demand forecasting models trained on Business Network transaction data
- Supplier risk scoring using financial, geopolitical, and ESG data
- Automated purchase order reconciliation
- Supply chain digital twin visualization

Operations Bridge 25.3:
- AIOps 3.0: Autonomous incident remediation with approval workflows
- Multi-cloud visibility across AWS, Azure, GCP, and Oracle Cloud
- Integration with OpenText SMAX for end-to-end ITIL processes
- New Kubernetes monitoring module

Fortify 25.3 (prior to divestiture):
- AI-assisted vulnerability remediation suggestions
- Software composition analysis (SCA) with SBOM generation
- Integration with GitHub Advanced Security and GitLab

CE 25.4 (November 2025) — Key Features:
Content Server 25.4:
- Content Server running natively on PostgreSQL (GA)
- Records Management 5.0 with AI-powered retention recommendations
- New governance dashboard: Compliance score, data hygiene metrics, storage analytics
- Zero Trust Architecture support: Every API call authenticated and authorized

NetIQ 25.4:
- Passwordless authentication support (FIDO2/WebAuthn)
- AI-driven access reviews: Auto-approve low-risk, flag anomalies
- Identity governance for cloud applications (SaaS SSO catalog)

CE 26.1 (February 2026) — Latest Release:
Aviator 3.0:
- Autonomous agent workflows: Multi-step task execution with plan-execute-evaluate loops
- Agentic RAG: Retrieval pipelines that auto-select data sources based on query intent
- Model Broker 2.0: Support for reasoning models (o1, o3-mini, DeepSeek-R1, Gemini 2.5 Pro)
- Content Grounding Score: Quantifies how well AI responses are supported by retrieved documents
- Enterprise Prompt Library: Curated, IT-approved prompt templates for common business tasks

Content Server 26.1:
- AI-native content creation: Draft documents from templates with Aviator
- Smart versioning: AI detects and summarizes changes between versions
- Cross-repository federation: Unified view across Content Server, Documentum, and SharePoint
- Performance: Sub-second search on repositories with 100M+ documents

Business Network 26.1:
- AI-powered partner onboarding: Automated EDI mapping from sample documents
- Circular economy module: Track recycling and reuse across supply chains
- Real-time sanctions screening for international trade compliance
- Blockchain-verified provenance tracking for regulated industries`
  },
  {
    title: "OpenText Aviator Technical Deep Dive",
    content: `OpenText Aviator — Technical Architecture Deep Dive (CE 26.1)

Aviator is OpenText's enterprise AI platform that brings large language models, retrieval-augmented generation, and autonomous agents to information management workflows.

Architecture Overview:

1. Model Broker Layer:
The Model Broker is the central LLM routing component. It abstracts model selection from the application layer, enabling:
- Multi-model support: Azure OpenAI (GPT-4o, o1), Google Vertex AI (Gemini 2.5 Pro, Gemini 2.5 Flash), AWS Bedrock (Claude, Llama 3.3), OpenText-hosted models
- Intelligent routing: Selects the optimal model based on task type (summarization → fast model, reasoning → o1-class), latency requirements, cost, and tenant configuration
- Fallback chains: If the primary model is unavailable or rate-limited, automatically falls back to the next model in the chain
- Usage metering: Tracks token consumption per user, department, and tenant for chargeback and capacity planning
- Model versioning: Supports pinning business-critical workflows to specific model versions

2. Embedding Pipeline:
- Default model: OpenText Embedding Model v3 (768 dimensions), fine-tuned on enterprise content
- Alternative: Google text-embedding-004, OpenAI text-embedding-3-large
- Incremental embedding: Only new or modified content chunks are re-embedded, reducing compute by ~90%
- Multi-language support: Embeddings trained on 50+ languages for global enterprise deployments
- Embedding cache: Frequently accessed embeddings kept in Redis for sub-millisecond retrieval

3. Retrieval-Augmented Generation (RAG):
Aviator's RAG pipeline ensures LLM responses are grounded in enterprise content:

a) Document Ingestion:
   - Automated parsing of 400+ file formats (PDF, DOCX, PPTX, XLSX, emails, CAD, DICOM, etc.)
   - Layout-aware chunking: Preserves tables, headers, lists, and page structure
   - Metadata enrichment: Extracts author, date, classification, and custom categories
   - Incremental sync: Watches Content Server events for real-time index updates

b) Query Processing:
   - Intent detection: Classifies query as factual, analytical, procedural, or conversational
   - Query expansion: Generates synonym-based and hypothetical-answer variants for broader recall
   - Multi-repository routing: Searches Content Server, Documentum, SharePoint, file shares simultaneously
   - Permission filtering: Query results respect source system ACLs — no unauthorized content leakage

c) Retrieval Strategy:
   - Hybrid search: Vector similarity (cosine) + keyword (BM25) merged via Reciprocal Rank Fusion
   - Contextual re-ranking: Cross-encoder model scores each candidate against the query
   - Chunk assembly: Adjacent chunks are merged for coherent context windows
   - Citation extraction: Each retrieved chunk is tagged with source, page, and section for traceability

d) Generation:
   - Context injection: Retrieved chunks are formatted and injected into the LLM prompt
   - Grounding score: Each generated sentence is scored against the retrieved context (0.0-1.0)
   - Hallucination detection: Sentences with grounding score < 0.5 are flagged or suppressed
   - Streaming: Token-level streaming for responsive user experience

4. Aviator Agents (CE 26.1):
Autonomous agents extend Aviator beyond Q&A into multi-step task execution:
- Plan-Execute-Evaluate loop: Agent decomposes complex tasks, executes steps, and evaluates results
- Tool integration: Agents can call Content Server APIs, Business Network services, SMAX ticket operations, and custom webhooks
- Memory: Session-level memory for multi-turn conversations, long-term memory via user profile embeddings
- Guardrails: Maximum iteration limits, cost caps, and human-in-the-loop checkpoints for sensitive actions
- Observability: Full execution trace logged for audit, debugging, and optimization

5. Guardrails Engine:
- PII Detection: Named Entity Recognition (NER) for names, SSNs, credit cards, addresses, phone numbers
- Toxicity Filter: Multi-label classifier for harmful, biased, or offensive content
- Topic Restrictions: Configurable blocklists for topics the AI should not discuss
- Data Residency: Ensures all processing stays within configured geographic boundaries
- Audit Trail: Every prompt, context, response, and moderation decision is logged with timestamps

6. Integration Points:
- Content Server: Aviator sidebar in the web UI for instant document Q&A
- Extended ECM: AI-powered workspace summaries for SAP business objects
- SMAX: Virtual agent, ticket auto-classification, knowledge recommendation
- Exstream: AI-generated content blocks for personalized communications
- Business Network: Intelligent supplier analytics and anomaly detection
- Teams/Slack: Aviator chatbot accessible from collaboration platforms

Deployment Options:
- SaaS: Fully managed by OpenText Cloud (multi-tenant)
- Dedicated Cloud: Single-tenant deployment on AWS/Azure/GCP
- Hybrid: Content on-premise + Aviator inference in cloud (data never leaves the content repository)
- Air-gapped: Fully on-premise with local LLM (Llama 3.3 70B or Mixtral) for regulated environments

Performance Benchmarks (CE 26.1):
- Search latency: <500ms for 50M document repositories
- Embedding throughput: 10,000 documents/hour per node
- RAG end-to-end: <3 seconds from query to generated response
- Agent execution: Average 4 steps, 8 seconds for common IT service requests
- Concurrent users: Tested to 10,000 simultaneous Aviator sessions per cluster`
  },
  {
    title: "OpenText Product Licensing and Editions Guide",
    content: `OpenText Product Licensing & Editions Guide — 2025-2026

OpenText offers flexible licensing models to accommodate organizations of all sizes, from small teams to global enterprises.

Licensing Models:

1. Subscription (Cloud):
- Annual or multi-year subscription priced per user or per unit (documents, transactions, API calls)
- Includes software, hosting, maintenance, and support
- Automatic upgrades with each Cloud Editions release (quarterly)
- Tiers: Essentials, Professional, Enterprise

2. Perpetual License (On-Premise):
- One-time license fee plus annual maintenance (typically 18-22% of license cost)
- Customer manages infrastructure, upgrades, and patching
- Available for Content Server, Documentum, and legacy products
- Being phased out in favor of subscription; perpetual still honored for existing customers

3. Consumption-Based:
- Pay-per-use model for select services (Business Network transactions, API calls, Aviator tokens)
- Ideal for variable workloads and pilot projects
- Monthly billing with usage dashboards

Product Editions:

Content Server Editions:
- Content Server Essentials: Core document management, version control, metadata, basic workflow
  - Up to 1 million documents, 100 named users
  - Includes: WebDAV, Office integration, mobile access
- Content Server Professional: Adds records management, advanced workflow, e-signatures
  - Up to 10 million documents, 500 named users
  - Includes: Records Management module, digital signatures, Content Intelligence
- Content Server Enterprise: Full platform with Extended ECM, Aviator AI, ArchiveLink
  - Unlimited documents and users
  - Includes: SAP integration, multi-repository federation, high availability clustering

Aviator Editions:
- Aviator Starter: Basic search and document summarization for one content source
  - 10,000 AI queries/month, 1 LLM model, keyword + vector search
- Aviator Professional: Multi-source search, chat, classification, contract analysis
  - 100,000 AI queries/month, 3 LLM models, hybrid search + re-ranking
  - Includes: PII detection, grounding scores, conversation history
- Aviator Enterprise: Full autonomous agent capabilities, custom model integration
  - Unlimited AI queries, bring-your-own-model, agent workflows
  - Includes: Custom guardrails, API access, on-premise LLM support

SMAX Editions:
- SMAX Essentials: IT help desk with ticket management, knowledge base, SLA tracking
  - Up to 10 agents, 500 end users
- SMAX Professional: ITIL-aligned ITSM with change, problem, release management
  - Up to 50 agents, unlimited end users
  - Includes: Aviator Virtual Agent, CMDB with auto-discovery
- SMAX Enterprise: Full ITSM + ITAM + ITOM with AI-driven operations
  - Unlimited agents, multi-tenant support
  - Includes: Operations Bridge integration, financial management, vendor management

Business Network Editions:
- Trading Grid Standard: EDI translation, partner onboarding, basic compliance
  - Up to 100 trading partners, 50,000 transactions/month
- Trading Grid Professional: Advanced mapping, supply chain visibility, analytics
  - Up to 1,000 trading partners, 500,000 transactions/month
- Trading Grid Enterprise: Global network, real-time tracking, AI forecasting
  - Unlimited partners and transactions
  - Includes: Aviator for Supply Chain, carbon tracking, sanctions screening

Support Tiers:
- Standard Support: Business hours (Mon-Fri), 8-hour response for P1 issues
- Premium Support: 24/7 coverage, 2-hour response for P1, named support engineer
- Elite Support: 24/7 with 30-minute response for P1, dedicated TAM (Technical Account Manager), quarterly business reviews, early access to beta releases

Training & Certification:
- OpenText Learning Services: Instructor-led and self-paced online training
- Certifications available: Content Server Administrator, Documentum Developer, SMAX Administrator, Aviator AI Specialist, Business Network Analyst
- Partner certifications: OpenText Certified Partner (Silver, Gold, Platinum tiers)
- OpenText Community: Forums, blogs, knowledge base, and user groups at community.opentext.com`
  },
  {
    title: "OpenText Information Management Compliance and Governance",
    content: `OpenText Information Management — Compliance, Governance & Industry Solutions (2025-2026)

OpenText provides industry-specific compliance solutions leveraging its content management, archiving, and AI platforms.

Regulatory Compliance Capabilities:

1. Records Management & Retention:
- DoD 5015.2 certified records management in Content Server
- SEC Rule 17a-4 compliant archiving via OpenText InfoArchive and Archive Center
- FINRA, MiFID II, and SOX compliance for financial services
- Automated retention schedules: Apply time-based, event-based, or hybrid retention policies
- Legal hold management: Preserve content across all repositories during litigation
- Disposition: Automated review, transfer, or destruction with full audit trail

2. Data Privacy (GDPR, CCPA, LGPD, PIPA):
- PII discovery and classification across structured and unstructured content using Aviator Content Intelligence
- Data Subject Access Requests (DSAR): Automated search, collection, and export of personal data
- Right to Erasure: Verified deletion across all repositories and backups
- Consent management integration with OpenText Extended ECM
- Data Processing Agreements: Built into OpenText Cloud contracts for EU customers
- Privacy Impact Assessments: Template-driven workflows in Content Server

3. Healthcare (HIPAA, HITECH):
- OpenText Clinical Document Management for clinical trials and regulatory submissions
- HL7 FHIR compliant document exchange for health information exchange (HIE)
- PHI (Protected Health Information) encryption at rest (AES-256) and in transit (TLS 1.3)
- Audit logging: Immutable audit trails for every content access, modification, and sharing event
- HIPAA Business Associate Agreements available for all OpenText Cloud services

4. Government & Public Sector:
- FedRAMP Moderate authorized (OpenText Cloud for Government)
- FOIA (Freedom of Information Act) request management with automated redaction
- Controlled Unclassified Information (CUI) handling per NIST 800-171
- IL4/IL5 cloud deployment options for Department of Defense
- OpenText Archiving for government email and electronic records

5. Life Sciences (FDA, EMA):
- 21 CFR Part 11 compliant electronic signatures and audit trails
- GxP-validated Content Server deployments for pharmaceutical companies
- Submission-ready archives: eCTD (electronic Common Technical Document) publishing
- Clinical site master file management with automated TMF reference model mapping
- Pharmacovigilance: Adverse event reporting workflows with regulatory timeline tracking

Industry Solutions:

Financial Services:
- Customer onboarding with KYC (Know Your Customer) document verification
- Mortgage origination and servicing document management
- Insurance claims processing with AI-powered document extraction
- Wealth management: Client portal with secure document exchange
- Anti-money laundering (AML): Transaction monitoring integration with ArcSight

Manufacturing:
- Engineering document management (drawings, CAD, BOMs)
- Quality management system (QMS) with CAPA (Corrective and Preventive Action) workflows
- Supplier quality documentation and audit tracking
- IoT data management and predictive maintenance analytics via Aviator IoT
- Product lifecycle management (PLM) integration with SAP and PTC

Energy & Utilities:
- Asset information management: P&ID, ISA, and equipment records
- Pipeline and plant safety document management (OSHA, EPA compliance)
- Geological and seismic data management for exploration
- Smart grid analytics and outage management documentation
- Sustainability reporting: ESG data collection and carbon emissions tracking

Legal:
- Matter management across Content Server workspaces
- eDiscovery with OpenText Axcelerate: AI-powered predictive coding and review
- Contract lifecycle management (CLM): AI clause extraction, obligation tracking, renewal alerts
- Intellectual property management: Patent and trademark document workflows
- Legal hold: Cross-system preservation orders with compliance reporting

OpenText Information Governance Framework:
1. Discover: Identify and classify all information across the organization
2. Secure: Apply access controls, encryption, and DLP policies
3. Archive: Move inactive content to cost-effective, compliant storage
4. Analyze: Use Aviator AI to extract insights, detect risks, and identify trends
5. Act: Automate retention, disposition, and compliance workflows
6. Report: Dashboards showing compliance posture, risk scores, and audit readiness`
  },
];

// ─── Vector Store ──────────────────────────────────────────

class InMemoryVectorStore {
  private chunks: DocumentChunk[] = [];
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /** Add pre-embedded chunks to the store */
  addChunks(chunks: DocumentChunk[]): void {
    this.chunks.push(...chunks);
  }

  /** Remove all chunks */
  clear(): void {
    this.chunks = [];
    this.isInitialized = false;
    this.initPromise = null;
  }

  /** Get total chunk count */
  get size(): number {
    return this.chunks.length;
  }

  /** Get unique document count */
  get documentCount(): number {
    return new Set(this.chunks.map(c => c.source)).size;
  }

  /** Cosine similarity between two vectors */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /** Search by vector similarity */
  vectorSearch(queryEmbedding: number[], topK: number): SearchResult[] {
    const results: SearchResult[] = [];
  
    for (const chunk of this.chunks) {
      if (!chunk.embedding) continue;
      const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      results.push({ chunk, score, method: "vector" });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** Keyword search (BM25-inspired TF-IDF) as fallback */
  keywordSearch(query: string, topK: number): SearchResult[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (queryTerms.length === 0) return [];

    // Compute IDF for each term
    const docFreq: Record<string, number> = {};
    for (const term of queryTerms) {
      docFreq[term] = this.chunks.filter(c =>
        c.content.toLowerCase().includes(term)
      ).length;
    }

    const results: SearchResult[] = [];
    const N = this.chunks.length;

    for (const chunk of this.chunks) {
      const text = chunk.content.toLowerCase();
      const words = text.split(/\s+/);
      const wordCount = words.length;
      let score = 0;

      for (const term of queryTerms) {
        const tf = (text.match(new RegExp(term, "gi")) || []).length / Math.max(wordCount, 1);
        const df = docFreq[term] || 0;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        // BM25 scoring
        const k1 = 1.5;
        const b = 0.75;
        const avgDl = 100; // approximate average doc length
        const bm25 = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (wordCount / avgDl))) * idf;
        score += bm25;
      }

      if (score > 0) {
        results.push({ chunk, score, method: "keyword" });
      }
    }

    // Normalize scores to 0-1 range
    const maxScore = Math.max(...results.map(r => r.score), 0.001);
    for (const r of results) {
      r.score = r.score / maxScore;
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** Hybrid search — combines vector + keyword via Reciprocal Rank Fusion */
  hybridSearch(queryEmbedding: number[] | null, query: string, topK: number): SearchResult[] {
    const k = 60; // RRF constant
    const vectorResults = queryEmbedding ? this.vectorSearch(queryEmbedding, topK * 2) : [];
    const keywordResults = this.keywordSearch(query, topK * 2);

    // RRF merge
    const scoreMap = new Map<string, { chunk: DocumentChunk; score: number; method: "vector" | "keyword" }>();

    vectorResults.forEach((r, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = scoreMap.get(r.chunk.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scoreMap.set(r.chunk.id, { chunk: r.chunk, score: rrfScore, method: "vector" });
      }
    });

    keywordResults.forEach((r, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = scoreMap.get(r.chunk.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scoreMap.set(r.chunk.id, { chunk: r.chunk, score: rrfScore, method: "keyword" });
      }
    });

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** Initialize with built-in documents */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    console.log("[RAG] Initializing vector store with built-in documents...");

    // Chunk all built-in documents
    const allChunks: DocumentChunk[] = [];
    for (const doc of BUILT_IN_DOCUMENTS) {
      const chunks = chunkDocument(doc.content, doc.title);
      allChunks.push(...chunks);
    }

    // Try to generate embeddings via Gemini
    const embedded = await embedChunks(allChunks);
    this.addChunks(embedded);
    this.isInitialized = true;
    console.log(`[RAG] Vector store ready: ${this.documentCount} documents, ${this.size} chunks`);
  }
}

// ─── Singleton store ───────────────────────────────────────

const vectorStore = new InMemoryVectorStore();

// ─── Document Chunking ─────────────────────────────────────

function chunkDocument(text: string, source: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const cleanText = text.replace(/\r\n/g, "\n").trim();

  // Recursive chunking — try paragraph splits first, then sentence splits
  const paragraphs = cleanText.split(/\n\n+/);
  let currentChunk = "";
  let charStart = 0;
  let chunkIndex = 0;

  const flushChunk = (content: string, start: number, end: number) => {
    if (content.trim().length < 20) return; // Skip tiny fragments
    chunks.push({
      id: `${source.replace(/\s+/g, "_")}_chunk_${chunkIndex}`,
      content: content.trim(),
      source,
      metadata: {
        chunkIndex,
        totalChunks: 0, // Updated later
        charStart: start,
        charEnd: end,
      },
    });
    chunkIndex++;
  };

  let globalCharPos = 0;
  for (const para of paragraphs) {
    if ((currentChunk + "\n\n" + para).length > CHUNK_SIZE && currentChunk.length > 0) {
      flushChunk(currentChunk, charStart, globalCharPos);
      // Keep overlap
      const overlapText = currentChunk.slice(-CHUNK_OVERLAP);
      currentChunk = overlapText + "\n\n" + para;
      charStart = globalCharPos - CHUNK_OVERLAP;
    } else {
      if (currentChunk.length === 0) {
        charStart = globalCharPos;
        currentChunk = para;
      } else {
        currentChunk += "\n\n" + para;
      }
    }
    globalCharPos += para.length + 2; // +2 for \n\n
  }

  if (currentChunk.trim().length > 0) {
    flushChunk(currentChunk, charStart, globalCharPos);
  }

  // Update totalChunks in metadata
  for (const chunk of chunks) {
    chunk.metadata.totalChunks = chunks.length;
  }

  return chunks;
}

// ─── Embedding Generation ──────────────────────────────────

/** Get a Gemini API key (reuses the same key resolution as geminiService) */
function getGeminiKey(): string | null {
  // Check all possible key sources
  const sources: (string | undefined)[] = [];
  
  try {
    // @ts-ignore — Vite compile-time defines
    if (typeof __VITE_API_KEY__ !== "undefined") sources.push(__VITE_API_KEY__);
    // @ts-ignore
    if (typeof __VITE_GEMINI_API_KEY__ !== "undefined") sources.push(__VITE_GEMINI_API_KEY__);
    // @ts-ignore
    if (typeof __VITE_GEMINI_API_PRIMARY_KEY__ !== "undefined") sources.push(__VITE_GEMINI_API_PRIMARY_KEY__);
    // @ts-ignore
    if (typeof __VITE_GOOGLE_API_KEY__ !== "undefined") sources.push(__VITE_GOOGLE_API_KEY__);
    // @ts-ignore
    if (typeof __GEMINI_API_KEY__ !== "undefined") sources.push(__GEMINI_API_KEY__);
    // @ts-ignore
    if (typeof __GEMINI_API_PRIMARY_KEY__ !== "undefined") sources.push(__GEMINI_API_PRIMARY_KEY__);
  } catch { /* ignore */ }

  try {
    const metaEnv = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : undefined;
    if (metaEnv) {
      sources.push(metaEnv.VITE_API_KEY, metaEnv.VITE_GEMINI_API_KEY, metaEnv.VITE_GEMINI_API_PRIMARY_KEY, metaEnv.VITE_GOOGLE_API_KEY);
    }
  } catch { /* ignore */ }

  const key = sources.find(k => k && k.trim().length > 0);
  return key?.trim() || null;
}

declare const __VITE_API_KEY__: string | undefined;
declare const __VITE_GEMINI_API_KEY__: string | undefined;
declare const __VITE_GEMINI_API_PRIMARY_KEY__: string | undefined;
declare const __VITE_GOOGLE_API_KEY__: string | undefined;
declare const __GEMINI_API_KEY__: string | undefined;
declare const __GEMINI_API_PRIMARY_KEY__: string | undefined;

let embeddingModel: any = null;
let embeddingAvailable = false;

function getEmbeddingModel(): any {
  if (embeddingModel) return embeddingModel;
  
  const key = getGeminiKey();
  if (!key) {
    console.warn("[RAG] No Gemini API key found — falling back to keyword search");
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(key);
    embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    embeddingAvailable = true;
    return embeddingModel;
  } catch (e) {
    console.warn("[RAG] Failed to create embedding model:", e);
    return null;
  }
}

/** Generate embedding for a single text */
async function generateEmbedding(text: string): Promise<number[] | null> {
  const model = getEmbeddingModel();
  if (!model) return null;

  try {
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (e: any) {
    console.warn("[RAG] Embedding generation failed:", e.message);
    embeddingAvailable = false;
    return null;
  }
}

/** Embed multiple chunks with batching */
async function embedChunks(chunks: DocumentChunk[]): Promise<DocumentChunk[]> {
  const model = getEmbeddingModel();
  if (!model) {
    console.log("[RAG] No embedding model — chunks will use keyword search only");
    return chunks;
  }

  // Batch embed for efficiency (process in groups of 10)
  const batchSize = 10;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const promises = batch.map(async (chunk) => {
      try {
        const result = await model.embedContent(chunk.content);
        chunk.embedding = result.embedding.values;
      } catch (e: any) {
        console.warn(`[RAG] Failed to embed chunk ${chunk.id}:`, e.message);
      }
    });
    await Promise.all(promises);
  }

  const embeddedCount = chunks.filter(c => c.embedding).length;
  console.log(`[RAG] Embedded ${embeddedCount}/${chunks.length} chunks`);
  embeddingAvailable = embeddedCount > 0;
  return chunks;
}

// ─── Query Expansion ───────────────────────────────────────

/** Generate query variants for broader recall */
function expandQuery(query: string): string[] {
  const queries = [query];
  const lower = query.toLowerCase();

  // Synonym-based expansion for common terms
  const synonymMap: Record<string, string[]> = {
    "rag": ["retrieval augmented generation", "document retrieval", "knowledge retrieval"],
    "vector": ["embedding", "dense representation", "semantic vector"],
    "llm": ["large language model", "AI model", "language model"],
    "agent": ["agentic system", "autonomous agent", "AI agent"],
    "mcp": ["model context protocol", "tool integration", "tool calling"],
    "security": ["access control", "authentication", "authorization", "encryption"],
    "scale": ["scalability", "horizontal scaling", "performance", "throughput"],
    "orchestrat": ["workflow", "langgraph", "state machine", "control flow"],
    "chunk": ["segment", "split", "partition", "document chunk"],
    "embed": ["embedding", "vector representation", "encode"],
    "search": ["retrieval", "query", "find", "lookup"],
    "database": ["store", "storage", "index", "persistence"],
  };

  for (const [key, synonyms] of Object.entries(synonymMap)) {
    if (lower.includes(key)) {
      // Add one synonym-based variant
      const variant = synonyms[0];
      queries.push(query.replace(new RegExp(key, "gi"), variant));
      break;
    }
  }

  // Add a keyword-only variant (strip stop words)
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "what", "how", "why", "when", "where", "who", "which", "do", "does", "did", "can", "could", "should", "would", "will", "shall", "may", "might", "must", "to", "of", "in", "for", "on", "with", "at", "by", "from", "about", "into", "through", "during", "before", "after", "above", "below", "between", "and", "or", "but", "not", "no", "nor", "so", "yet", "both", "either", "neither", "each", "every", "all", "any", "few", "more", "most", "some", "such", "than", "too", "very", "just", "only"]);
  const keywordsOnly = query.split(/\s+/).filter(w => !stopWords.has(w.toLowerCase()) && w.length > 2).join(" ");
  if (keywordsOnly !== query && keywordsOnly.length > 3) {
    queries.push(keywordsOnly);
  }

  return [...new Set(queries)];
}

// ─── Re-ranking ────────────────────────────────────────────

/** Re-rank results by cross-similarity with the query */
async function rerankResults(
  results: SearchResult[],
  query: string,
  topN: number
): Promise<SearchResult[]> {
  if (results.length === 0) return [];

  // If embeddings available, compute cross-similarity
  const queryEmb = await generateEmbedding(query);
  if (queryEmb) {
    // Re-score each result using direct cosine similarity with query
    const rescored = results.map(r => {
      if (r.chunk.embedding) {
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < queryEmb.length; i++) {
          dot += queryEmb[i] * r.chunk.embedding[i];
          magA += queryEmb[i] * queryEmb[i];
          magB += r.chunk.embedding[i] * r.chunk.embedding[i];
        }
        const crossScore = dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
        return { ...r, score: crossScore };
      }
      return r;
    });
    return rescored.sort((a, b) => b.score - a.score).slice(0, topN);
  }

  // Fallback: boost results that contain more query terms
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const rescored = results.map(r => {
    const text = r.chunk.content.toLowerCase();
    const termHits = queryTerms.filter(t => text.includes(t)).length;
    const boost = termHits / Math.max(queryTerms.length, 1);
    return { ...r, score: r.score * (1 + boost * 0.5) };
  });

  return rescored.sort((a, b) => b.score - a.score).slice(0, topN);
}

// ─── Main Pipeline ─────────────────────────────────────────

/**
 * Execute the full RAG pipeline:
 *   Query → Expand → Embed → Hybrid Search → Re-rank → Context Block
 *
 * Returns real data suitable for injection into the LLM prompt.
 */
export async function runRAGPipeline(query: string): Promise<RAGPipelineResult> {
  const startTime = performance.now();

  // Ensure store is initialized
  await vectorStore.initialize();

  // 1. Query Expansion
  const expandedQueries = expandQuery(query);
  console.log(`[RAG] Expanded queries: ${expandedQueries.join(" | ")}`);

  // 2. Embed the primary query
  const queryEmbedding = await generateEmbedding(query);

  // 3. Hybrid Search across all expanded queries
  const allResults = new Map<string, SearchResult>();

  for (const q of expandedQueries) {
    const qEmb = q === query ? queryEmbedding : await generateEmbedding(q);
    const results = vectorStore.hybridSearch(qEmb, q, TOP_K);
    for (const r of results) {
      const existing = allResults.get(r.chunk.id);
      if (!existing || r.score > existing.score) {
        allResults.set(r.chunk.id, r);
      }
    }
  }

  const retrievedChunks = Array.from(allResults.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  // 4. Re-rank
  const rerankedChunks = await rerankResults(retrievedChunks, query, RERANK_TOP);

  // 5. Build context block
  const contextBlock = rerankedChunks
    .map((r, i) => `[Source ${i + 1}: ${r.chunk.source} | Relevance: ${(r.score * 100).toFixed(1)}%]\n${r.chunk.content}`)
    .join("\n\n---\n\n");

  const elapsed = performance.now() - startTime;

  const result: RAGPipelineResult = {
    query,
    expandedQueries,
    retrievedChunks,
    rerankedChunks,
    contextBlock,
    stats: {
      totalDocuments: vectorStore.documentCount,
      totalChunks: vectorStore.size,
      searchTimeMs: Math.round(elapsed),
      embeddingModel: embeddingAvailable ? EMBEDDING_MODEL : "keyword-fallback (TF-IDF/BM25)",
      topScore: rerankedChunks.length > 0 ? rerankedChunks[0].score : 0,
    },
  };

  console.log(`[RAG] Pipeline complete in ${result.stats.searchTimeMs}ms — ${rerankedChunks.length} results (top score: ${result.stats.topScore.toFixed(3)})`);
  return result;
}

/**
 * Add a custom document to the RAG knowledge base.
 * Can be called by the user to extend the built-in corpus.
 */
export async function addDocument(title: string, content: string): Promise<{ chunksAdded: number }> {
  await vectorStore.initialize();
  const chunks = chunkDocument(content, title);
  const embedded = await embedChunks(chunks);
  vectorStore.addChunks(embedded);
  console.log(`[RAG] Added document "${title}" — ${embedded.length} chunks`);
  return { chunksAdded: embedded.length };
}

/**
 * Get current RAG store statistics
 */
export function getRAGStats(): { documents: number; chunks: number; embeddingModel: string } {
  return {
    documents: vectorStore.documentCount,
    chunks: vectorStore.size,
    embeddingModel: embeddingAvailable ? EMBEDDING_MODEL : "keyword-fallback",
  };
}
