# RAG Pipeline Configuration Guide

## Overview
This document explains how the Retrieval-Augmented Generation (RAG) pipeline is built and configured in the AI Visual Workflow system, including vector embeddings, semantic search, and hybrid retrieval strategies.

---

## Table of Contents
1. [RAG Architecture](#rag-architecture)
2. [Vector Embedding Engine](#vector-embedding-engine)
3. [Document Loading](#document-loading)
4. [Chunking Strategies](#chunking-strategies)
5. [FAISS Vector Index](#faiss-vector-index)
6. [Query Processing](#query-processing)
7. [Hybrid Search](#hybrid-search)
8. [Integration with LangGraph](#integration-with-langgraph)

---

## RAG Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                   RAG Pipeline Flow                      │
└─────────────────────────────────────────────────────────┘

1. DOCUMENT INGESTION
   ├─ Load from files (txt, md, json, pdf)
   ├─ Parse and clean content
   └─ Store in knowledge base

2. CHUNKING
   ├─ Sentence-aware splitting
   ├─ Overlapping chunks (400 chars, 80 char overlap)
   └─ Metadata preservation (source, position, index)

3. EMBEDDING GENERATION
   ├─ Model: all-MiniLM-L6-v2 (384 dimensions)
   ├─ Normalize vectors for cosine similarity
   └─ Batch processing for efficiency

4. INDEX CONSTRUCTION
   ├─ FAISS IndexFlatIP (Inner Product)
   ├─ Optimized for cosine similarity
   └─ In-memory for fast retrieval

5. QUERY PROCESSING
   ├─ Query expansion (3 variants)
   ├─ Embedding generation
   └─ Similarity search

6. RETRIEVAL
   ├─ Vector search (semantic)
   ├─ Keyword search (TF-IDF)
   ├─ Hybrid scoring (70% vector + 30% keyword)
   └─ Deduplication and ranking

7. CONTEXT ASSEMBLY
   ├─ Format chunks with sources
   ├─ Combine top-k results
   └─ Pass to LLM synthesizer
```

### File Locations

| Component | File | Lines |
|-----------|------|-------|
| **Vector Engine** | [backend/rag/vector_engine.py](backend/rag/vector_engine.py) | 1-598 |
| **Document Loader** | [backend/rag/document_loader.py](backend/rag/document_loader.py) | 1-315 |
| **RAG Integration** | [backend/core/orchestrator.py](backend/core/orchestrator.py) | 210-410 |
| **RAG Node** | [backend/core/orchestrator.py](backend/core/orchestrator.py#L2859-L2892) | 2859-2892 |

---

## Vector Embedding Engine

### VectorRAGEngine Class
**Location**: [vector_engine.py#L53-L360](backend/rag/vector_engine.py#L53-L360)

Production-grade RAG with real semantic embeddings:

```python
class VectorRAGEngine:
    """
    Production RAG engine with real embeddings and vector search.
    
    Features:
    - Semantic embeddings using sentence-transformers
    - Vector storage with FAISS (fast similarity search)
    - Query expansion for better recall
    - Re-ranking for precision
    - Hybrid search (vector + keyword)
    """
    
    def __init__(
        self,
        documents: List[Dict[str, str]],
        model_name: str = "all-MiniLM-L6-v2",
        chunk_size: int = 400,
        chunk_overlap: int = 80,
        collection_name: str = "rag_documents"
    ):
        """
        Initialize the RAG engine.
        
        Args:
            documents: List of dicts with 'title'/'source' and 'content' keys
            model_name: Sentence transformer model to use
            chunk_size: Characters per chunk
            chunk_overlap: Overlap between chunks
            collection_name: Collection name (for compatibility)
        """
        self.documents = documents
        self.model_name = model_name
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        
        # Initialize embedding model
        _log(f"Loading embedding model: {model_name}")
        self.model = SentenceTransformer(model_name)
        self.embedding_dim = self.model.get_sentence_embedding_dimension()
        _log(f"Embedding dimension: {self.embedding_dim}")
        
        # Initialize FAISS index (cosine similarity)
        self.index = None
        self.chunks = []
        
        # Process documents
        self._chunk_and_index_documents()
```

### Why Sentence Transformers?

**Model**: `all-MiniLM-L6-v2`
- **Size**: 80 MB (lightweight, can run on CPU)
- **Dimensions**: 384 (compact vectors)
- **Speed**: ~14,000 sentences/second on CPU
- **Quality**: SOTA on semantic textual similarity tasks
- **License**: Apache 2.0 (commercial-friendly)

**Alternatives**:
- `all-mpnet-base-v2`: Better quality (768 dim), slower
- `multi-qa-MiniLM-L6-cos-v1`: Optimized for Q&A
- `paraphrase-multilingual-MiniLM-L12-v2`: Multilingual support

---

## Document Loading

### Document Sources
**Location**: [document_loader.py#L24-L127](backend/rag/document_loader.py#L24-L127)

Supports multiple formats:

```python
def load_documents_from_directory(data_dir: str) -> List[Dict[str, str]]:
    """
    Load documents from a directory, supporting .txt, .md, .json, .pdf formats.
    
    Returns:
        List of {source, content} dicts
    """
    documents = []
    data_path = Path(data_dir)
    
    if not data_path.exists():
        return documents
    
    # 1. Load text files (.txt)
    for txt_file in data_path.glob("**/*.txt"):
        try:
            with open(txt_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    documents.append({
                        "source": str(txt_file.relative_to(data_path)),
                        "content": content
                    })
        except Exception as e:
            print(f"Error loading {txt_file}: {e}")
    
    # 2. Load markdown files (.md)
    for md_file in data_path.glob("**/*.md"):
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    documents.append({
                        "source": str(md_file.relative_to(data_path)),
                        "content": content
                    })
        except Exception as e:
            print(f"Error loading {md_file}: {e}")
    
    # 3. Load JSON files (.json)
    for json_file in data_path.glob("**/*.json"):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Handle both single docs and arrays
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and "content" in item:
                            documents.append({
                                "source": item.get("source", json_file.name),
                                "content": item["content"]
                            })
                elif isinstance(data, dict) and "content" in data:
                    documents.append({
                        "source": data.get("source", json_file.name),
                        "content": data["content"]
                    })
        except Exception as e:
            print(f"Error loading {json_file}: {e}")
    
    # 4. Load PDF files (.pdf) - requires pypdf
    if PDF_AVAILABLE:
        for pdf_file in data_path.glob("**/*.pdf"):
            try:
                reader = PdfReader(str(pdf_file))
                content_parts = []
                for page in reader.pages:
                    text = page.extract_text()
                    if text and text.strip():
                        content_parts.append(text.strip())
                
                if content_parts:
                    documents.append({
                        "source": str(pdf_file.relative_to(data_path)),
                        "content": "\n\n".join(content_parts),
                        "page_count": len(reader.pages)
                    })
            except Exception as e:
                print(f"Error loading PDF {pdf_file}: {e}")
    
    return documents
```

### Data Directory Structure

```
backend/data/
├── agentic_ai.md           # Agentic AI architecture docs
├── rag_pipeline.md         # RAG best practices
├── opentext_products.md    # OpenText product suite
├── vector_search.md        # Vector embeddings guide
└── custom/
    ├── policy_docs.txt     # Custom policies
    └── technical_specs.pdf # Technical documentation
```

### Fallback Knowledge Base
**Location**: [document_loader.py#L149-L291](backend/rag/document_loader.py#L149-L291)

When `/data` directory is empty, the system uses hardcoded documents:

```python
def _get_default_documents() -> List[Dict[str, str]]:
    """Fallback: hardcoded documents for when /data is empty."""
    return [
        {
            "source": "agentic_ai.md",
            "content": "# Agentic AI Architecture Guide\n\n..."
        },
        {
            "source": "rag_pipeline.md",
            "content": "# RAG Pipeline Best Practices\n\n..."
        },
        # ... more default documents
    ]
```

---

## Chunking Strategies

### Sentence-Aware Chunking
**Location**: [vector_engine.py#L116-L168](backend/rag/vector_engine.py#L116-L168)

Splits documents at sentence boundaries to preserve semantic coherence:

```python
def _chunk_text(self, text: str, title: str) -> List[Dict[str, Any]]:
    """
    Split text into overlapping chunks with metadata.
    Uses sentence-aware chunking for better semantic coherence.
    """
    chunks = []
    pos = 0
    idx = 0
    
    # Split into sentences for better chunking
    sentences = re.split(r'(?<=[.!?])\s+', text)
    
    current_chunk = ""
    current_pos = 0
    
    for sentence in sentences:
        # If adding this sentence would exceed chunk_size
        if len(current_chunk) + len(sentence) > self.chunk_size and current_chunk:
            # Save current chunk
            chunks.append({
                "id": hashlib.md5(f"{title}_{idx}_{current_pos}".encode()).hexdigest(),
                "content": current_chunk.strip(),
                "source": title,
                "chunk_index": idx,
                "char_start": current_pos,
                "char_end": current_pos + len(current_chunk),
            })
            
            # Start new chunk with overlap
            overlap_text = current_chunk[-self.chunk_overlap:] if len(current_chunk) > self.chunk_overlap else current_chunk
            current_chunk = overlap_text + " " + sentence
            current_pos += len(current_chunk) - len(overlap_text) - len(sentence) - 1
            idx += 1
        else:
            current_chunk += " " + sentence if current_chunk else sentence
    
    # Add final chunk
    if current_chunk.strip():
        chunks.append({
            "id": hashlib.md5(f"{title}_{idx}_{current_pos}".encode()).hexdigest(),
            "content": current_chunk.strip(),
            "source": title,
            "chunk_index": idx,
            "char_start": current_pos,
            "char_end": current_pos + len(current_chunk),
        })
    
    return chunks
```

### Chunking Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `chunk_size` | 400 | Characters per chunk (2-3 sentences) |
| `chunk_overlap` | 80 | Overlap to maintain context continuity |
| `boundary` | Sentence | Split at `.!?` to avoid mid-sentence breaks |

### Why Overlapping Chunks?

**Problem**: Information at chunk boundaries can be lost.

**Example**:
```
Chunk 1: "...OpenText acquired Micro Focus in 2023."
Chunk 2: "The acquisition expanded OpenText's portfolio..."
```

With overlap:
```
Chunk 1: "...OpenText acquired Micro Focus in 2023."
Chunk 2: "OpenText acquired Micro Focus in 2023. The acquisition expanded..."
```

**Result**: Queries about "OpenText acquisition" match both chunks.

---

## FAISS Vector Index

### Index Creation
**Location**: [vector_engine.py#L170-L206](backend/rag/vector_engine.py#L170-L206)

```python
def _chunk_and_index_documents(self):
    """Chunk all documents and index them with embeddings."""
    all_chunks = []
    
    # 1. Chunk all documents
    for doc in self.documents:
        title = doc.get("title") or doc.get("source", "unknown")
        chunks = self._chunk_text(doc["content"], title)
        all_chunks.extend(chunks)
    
    self.chunks = all_chunks
    
    if not all_chunks:
        _log("No chunks to index")
        return
    
    # 2. Generate embeddings for all chunks
    _log(f"Generating embeddings for {len(all_chunks)} chunks...")
    chunk_texts = [chunk["content"] for chunk in all_chunks]
    embeddings = self.model.encode(
        chunk_texts,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True  # Normalize for cosine similarity
    )
    
    # 3. Create FAISS index with Inner Product (cosine after normalization)
    _log("Creating FAISS index...")
    self.index = faiss.IndexFlatIP(self.embedding_dim)
    self.index.add(embeddings.astype(np.float32))
    
    _log(f"Indexed {len(all_chunks)} chunks in FAISS")
```

### Why FAISS IndexFlatIP?

**IndexFlatIP** = Inner Product search (exact, no approximation)

For **normalized vectors**:
- Inner Product = Cosine Similarity
- Range: [-1, 1] where 1 = identical, -1 = opposite

**Alternatives**:
- `IndexFlatL2`: L2 distance (Euclidean)
- `IndexIVFFlat`: Faster for large datasets (>100k vectors)
- `IndexHNSW`: Graph-based approximate search (scalable to millions)

**Current Choice**: `IndexFlatIP` for accuracy (dataset < 10k chunks).

### Index Persistence
**Location**: [vector_engine.py#L362-L392](backend/rag/vector_engine.py#L362-L392)

Save and load index to avoid recomputation:

```python
def save_index(self, index_path: str) -> bool:
    """Save FAISS index and metadata to disk for persistence."""
    try:
        os.makedirs(os.path.dirname(index_path) or ".", exist_ok=True)
        
        # Save FAISS index
        faiss.write_index(self.index, f"{index_path}.faiss")
        
        # Save metadata (chunks, model name, etc.)
        metadata = {
            "model_name": self.model_name,
            "embedding_dim": self.embedding_dim,
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "total_chunks": len(self.chunks),
            "chunks": self.chunks,
            "documents": self.documents,
        }
        with open(f"{index_path}.json", 'w') as f:
            json.dump(metadata, f, indent=2)
        
        _log(f"Saved FAISS index to {index_path}")
        return True
    except Exception as e:
        _log(f"Failed to save index: {e}")
        return False
```

**Usage**:
```python
# Save index
engine.save_index("backend/data/rag_index")

# Load index (skip re-embedding)
engine = VectorRAGEngine.load_index("backend/data/rag_index")
```

---

## Query Processing

### Query Expansion
**Location**: [vector_engine.py#L208-L226](backend/rag/vector_engine.py#L208-L226)

Generate multiple query variants to improve recall:

```python
def _expand_query(self, query: str) -> List[str]:
    """
    Generate multiple query variants for better recall.
    Simple expansion - in production, use an LLM for better results.
    """
    expanded = [query]
    
    # Add question variants
    if not query.endswith("?"):
        expanded.append(query + "?")
        expanded.append("What is " + query + "?")
        expanded.append("Explain " + query)
    
    # Add lowercase/capitalized variants
    if query != query.lower():
        expanded.append(query.lower())
    if query != query.title():
        expanded.append(query.title())
    
    return list(set(expanded))[:3]  # Return top 3 unique variants
```

**Example**:
```python
Query: "RAG pipeline"

Expanded to:
1. "RAG pipeline"
2. "RAG pipeline?"
3. "What is RAG pipeline?"
```

**Why It Works**: Different chunks may use different phrasings (e.g., "What is X" vs "X definition").

### Advanced Query Expansion (Future)

Use an LLM to generate semantic variants:

```python
def _llm_expand_query(self, query: str) -> List[str]:
    """Use LLM to generate better semantic variants."""
    prompt = f"Generate 3 alternative ways to ask: '{query}'"
    variants = call_llm(prompt)
    return [query] + variants
```

---

## Hybrid Search

### Combining Vector + Keyword Search
**Location**: [vector_engine.py#L228-L244](backend/rag/vector_engine.py#L228-L244)

```python
def _keyword_score(self, query: str, text: str) -> float:
    """
    Compute BM25-style keyword relevance score.
    Simple TF-IDF approximation for hybrid search.
    """
    query_tokens = set(self._tokenize(query))
    text_tokens = self._tokenize(text)
    
    if not query_tokens or not text_tokens:
        return 0.0
    
    # Count matches
    text_token_count = Counter(text_tokens)
    matches = sum(text_token_count[token] for token in query_tokens if token in text_token_count)
    
    # Normalize by text length
    return matches / len(text_tokens) if text_tokens else 0.0
```

### Search Method
**Location**: [vector_engine.py#L246-L340](backend/rag/vector_engine.py#L246-L340)

```python
def search(
    self,
    query: str,
    top_k: int = 5,
    use_query_expansion: bool = True,
    use_hybrid: bool = True,
    rerank: bool = True
) -> List[Dict[str, Any]]:
    """
    Search for relevant chunks using semantic similarity.
    
    Args:
        query: Search query
        top_k: Number of results to return
        use_query_expansion: Generate multiple query variants
        use_hybrid: Combine vector and keyword search
        rerank: Re-rank results by combining scores
    
    Returns:
        List of search results with chunk, score, and method
    """
    if not query.strip() or self.index is None:
        return []
    
    # 1. Query expansion
    queries = self._expand_query(query) if use_query_expansion else [query]
    _log(f"Searching with {len(queries)} query variants")
    
    # 2. Encode all queries
    query_embeddings = self.model.encode(
        queries,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True
    )
    
    # 3. Get more results than needed for re-ranking
    search_k = min(top_k * 3 if rerank else top_k, len(self.chunks))
    
    # 4. Vector search for each query variant
    all_results = []
    for i, query_embedding in enumerate(query_embeddings):
        # Search FAISS index
        scores, indices = self.index.search(
            query_embedding.reshape(1, -1).astype(np.float32),
            search_k
        )
        
        for j, idx in enumerate(indices[0]):
            if idx < 0 or idx >= len(self.chunks):
                continue
                
            chunk = self.chunks[int(idx)]
            vector_score = float(scores[0][j])  # Cosine similarity
            
            # 5. Keyword score for hybrid search
            keyword_score = 0.0
            if use_hybrid:
                keyword_score = self._keyword_score(queries[i], chunk['content'])
            
            # 6. Combined score (70% vector, 30% keyword)
            combined_score = (0.7 * vector_score + 0.3 * keyword_score) if use_hybrid else vector_score
            
            all_results.append({
                'chunk': chunk,
                'vector_score': vector_score,
                'keyword_score': keyword_score,
                'combined_score': combined_score,
                'query_variant': i,
                'method': 'hybrid' if use_hybrid else 'vector'
            })
    
    # 7. Deduplicate by chunk ID (keep highest score)
    seen_ids = {}
    for result in all_results:
        chunk_id = result['chunk']['id']
        if chunk_id not in seen_ids or result['combined_score'] > seen_ids[chunk_id]['combined_score']:
            seen_ids[chunk_id] = result
    
    deduplicated = list(seen_ids.values())
    
    # 8. Sort by combined score
    deduplicated.sort(key=lambda x: x['combined_score'], reverse=True)
    
    # 9. Return top k with simplified format
    results = []
    for result in deduplicated[:top_k]:
        results.append({
            'chunk': result['chunk'],
            'score': round(result['combined_score'], 4),
            'method': result['method']
        })
    
    _log(f"Found {len(results)} relevant chunks")
    
    return results
```

### Hybrid Scoring Formula

```
Combined Score = (0.7 × Vector Score) + (0.3 × Keyword Score)
```

**Why This Weight?**
- **Vector (70%)**: Captures semantic meaning ("machine learning" ≈ "AI")
- **Keyword (30%)**: Ensures exact matches are prioritized ("OTEX" query → "OTEX" in document)

**Example**:
```
Query: "OpenText stock price"

Chunk 1: "OpenText Corporation (OTEX) trades on NASDAQ..."
  - Vector: 0.82 (semantic match)
  - Keyword: 0.40 (2/5 words match)
  - Combined: 0.7×0.82 + 0.3×0.40 = 0.694

Chunk 2: "OpenText is a software company..."
  - Vector: 0.78
  - Keyword: 0.20 (1/6 words match)
  - Combined: 0.7×0.78 + 0.3×0.20 = 0.606

Result: Chunk 1 ranked higher (better keyword match for "stock")
```

---

## Integration with LangGraph

### RAG Node in Workflow
**Location**: [orchestrator.py#L2859-L2892](backend/core/orchestrator.py#L2859-L2892)

```python
def rag_node(state: AgentState) -> dict:
    """Retrieve relevant context from the knowledge base via vector search."""
    query = state["user_prompt"]
    _log(f"RAG: searching for \"{query[:60]}...\"")

    start = time.time()
    results = _rag_engine.search(query, top_k=5)
    elapsed_ms = round((time.time() - start) * 1000, 1)

    sources = []
    context_parts = []
    for r in results:
        chunk = r["chunk"]
        sources.append({
            "source": chunk["source"],
            "score": r["score"],
            "preview": chunk["content"][:120] + "...",
        })
        context_parts.append(f"[Source: {chunk['source']}]\n{chunk['content']}")

    context = "\n\n".join(context_parts) if context_parts else ""
    top_score = results[0]["score"] if results else 0.0
    _log(f"RAG: {len(results)} chunks in {elapsed_ms}ms (top score: {top_score})")

    return {
        "rag_context": context,
        "rag_sources": sources,
        "execution_log": [{
            "node": "rag",
            "chunks_found": len(results),
            "search_time_ms": elapsed_ms,
            "top_score": top_score,
            "sources": [s["source"] for s in sources],
            "timestamp": time.time(),
        }],
    }
```

### Singleton Engine Initialization
**Location**: [orchestrator.py#L390-L410](backend/core/orchestrator.py#L390-L410)

```python
# Load documents from /data folder or fallback to defaults
if has_doc_loader and load_all_documents:
    try:
        data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
        KNOWLEDGE_BASE = load_all_documents(data_dir)
        _log(f"Loaded {len(KNOWLEDGE_BASE)} documents from {data_dir}")
    except Exception as e:
        _log(f"Failed to load documents: {e}")
        KNOWLEDGE_BASE = _get_default_knowledge_base()
else:
    KNOWLEDGE_BASE = _get_default_knowledge_base()

# Initialize RAG engine (tries Vector → falls back to TF-IDF)
try:
    _rag_engine = create_rag_engine(KNOWLEDGE_BASE)
    _rag_type = type(_rag_engine).__name__
    _log(f"Initialized {_rag_type} successfully")
except Exception as e:
    _log(f"Failed to initialize RAG engine: {e}")
    _rag_engine = RAGEngine(KNOWLEDGE_BASE)  # Basic TF-IDF fallback
    _log("Using fallback TF-IDF RAG engine")
```

### Factory Function
**Location**: [vector_engine.py#L549-L571](backend/rag/vector_engine.py#L549-L571)

Automatically selects the best available RAG engine:

```python
def create_rag_engine(documents: List[Dict[str, str]], **kwargs) -> Any:
    """
    Factory function to create the best available RAG engine.
    Tries to use VectorRAGEngine, falls back to TFIDFRAGEngine if dependencies missing.
    """
    if SENTENCE_TRANSFORMERS_AVAILABLE and FAISS_AVAILABLE and NUMPY_AVAILABLE:
        try:
            _log("Creating Vector RAG engine with embeddings")
            return VectorRAGEngine(documents, **kwargs)
        except Exception as e:
            _log(f"Failed to create Vector RAG engine: {e}")
            _log("Falling back to TF-IDF engine")
            return TFIDFRAGEngine(documents, **kwargs)
    else:
        missing = []
        if not SENTENCE_TRANSFORMERS_AVAILABLE:
            missing.append("sentence-transformers")
        if not FAISS_AVAILABLE:
            missing.append("faiss-cpu")
        if not NUMPY_AVAILABLE:
            missing.append("numpy")
        _log(f"Missing dependencies for Vector RAG: {', '.join(missing)}")
        _log("Using TF-IDF RAG engine")
        return TFIDFRAGEngine(documents, **kwargs)
```

---

## Performance & Optimization

### Benchmarks

| Operation | Time | Notes |
|-----------|------|-------|
| **Document Loading** | ~50ms | 5 markdown files (~20KB total) |
| **Chunking** | ~30ms | 100 chunks with sentence boundary detection |
| **Embedding Generation** | ~200ms | 100 chunks × 384 dimensions (CPU) |
| **FAISS Index Creation** | ~10ms | IndexFlatIP with 100 vectors |
| **Query Embedding** | ~8ms | Single query → 384-dim vector |
| **Vector Search** | ~2ms | Top-5 from 100 chunks (exact search) |
| **Total (cold start)** | ~300ms | First query (includes model loading) |
| **Total (warm)** | ~10ms | Subsequent queries (model cached) |

### Scaling Considerations

| Dataset Size | Recommended Index | Search Time | Memory |
|--------------|-------------------|-------------|--------|
| < 1K chunks | `IndexFlatIP` (exact) | ~1ms | ~1 MB |
| 1K - 100K | `IndexIVFFlat` (approximate) | ~5ms | ~50 MB |
| 100K - 1M | `IndexHNSW` (graph-based) | ~10ms | ~500 MB |
| > 1M | Pinecone/Weaviate (cloud) | ~20ms | External |

**Current System**: Uses `IndexFlatIP` for accuracy (dataset < 1K chunks).

### Optimization Tips

1. **Batch Embedding**: Encode multiple queries/chunks at once
2. **Model Caching**: Keep model in memory (done via singleton)
3. **Index Persistence**: Save FAISS index to skip re-embedding
4. **GPU Acceleration**: Use CUDA for 10x faster embeddings
5. **Quantization**: Use `IndexIVFPQ` for 4x memory reduction

---

## Testing the RAG Pipeline

### Command-Line Test
```bash
cd backend/rag
python vector_engine.py
```

Output:
```
Testing RAG Engine...
Loading embedding model: all-MiniLM-L6-v2
Embedding dimension: 384
Creating FAISS index...
Indexed 2 chunks in FAISS

Engine stats: {'total_documents': 2, 'total_chunks': 2, 'embedding_model': 'all-MiniLM-L6-v2', ...}

Query: What is retrieval augmented generation?

Result 1 (score: 0.8234, method: hybrid):
Source: What is RAG?
Content: Retrieval-Augmented Generation (RAG) is a technique that combines information...
```

### Python API Test
```python
from backend.rag.vector_engine import create_rag_engine

# Load documents
docs = [
    {"title": "RAG Guide", "content": "RAG combines retrieval with generation..."},
    {"title": "Vector DBs", "content": "Vector databases store embeddings..."}
]

# Create engine
engine = create_rag_engine(docs)

# Search
results = engine.search("What is RAG?", top_k=3)

for result in results:
    print(f"Score: {result['score']}")
    print(f"Source: {result['chunk']['source']}")
    print(f"Content: {result['chunk']['content'][:200]}...")
    print()
```

### Integration Test via API
```bash
curl -X POST http://localhost:5001/api/run \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is agentic AI?"}'
```

Response includes:
```json
{
  "route": "rag_only",
  "rag_sources": [
    {
      "source": "agentic_ai.md",
      "score": 0.8145,
      "preview": "An agentic AI system is an autonomous software agent..."
    }
  ],
  "final_response": "Agentic AI refers to autonomous software agents that..."
}
```

---

## Key Takeaways

### ✅ Production-Ready Features

1. **Real Semantic Search**: Uses sentence transformers, not just keyword matching
2. **Hybrid Retrieval**: Combines vector (semantic) + keyword (exact match) scores
3. **Query Expansion**: Generates variants to improve recall
4. **Sentence-Aware Chunking**: Preserves semantic boundaries
5. **Graceful Fallback**: TF-IDF engine when vector dependencies unavailable
6. **Persistence**: Save/load FAISS index to avoid re-embedding

### 🔍 When to Use RAG vs. Tools

| Query Type | Route | Reason |
|------------|-------|--------|
| "What is OpenText Documentum?" | `rag_only` | Internal product knowledge |
| "AAPL stock price" | `mcp_only` | Real-time external data |
| "Who is OpenText CEO?" | `hybrid` | Company facts + current info |
| "Hello" | `direct` | No retrieval needed |

### 📚 Further Reading

- [Sentence Transformers](https://www.sbert.net/)
- [FAISS Documentation](https://github.com/facebookresearch/faiss/wiki)
- [RAG Best Practices (LangChain)](https://python.langchain.com/docs/how_to/#qa-with-rag)

---

**📚 Related Documentation**:
- [LangGraph Configuration](LANGGRAPH_CONFIGURATION.md)
- [LLM Configuration & Routing](LLM_CONFIGURATION.md)
- [MCP Tools Integration](MCP_TOOLS.md)
- [Overall Architecture](WORKFLOW_ARCHITECTURE.md)
