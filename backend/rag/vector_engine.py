#!/usr/bin/env python3
"""
============================================================
 Real RAG Engine with Vector Embeddings
============================================================

Production-grade RAG implementation using:
  - Sentence Transformers for embedding generation
  - FAISS for vector storage and similarity search
  - Advanced chunking strategies
  - Query expansion and re-ranking
  
This replaces the simple TF-IDF approach with true semantic search.
============================================================
"""
from __future__ import annotations

import os
import re
import math
import hashlib
from typing import List, Dict, Any, Optional, Tuple
from collections import Counter

try:
    from sentence_transformers import SentenceTransformer  # type: ignore[import-not-found]
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    SentenceTransformer = None  # type: ignore[assignment]

try:
    import faiss  # type: ignore[import-not-found]
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False
    faiss = None  # type: ignore[assignment]

try:
    import numpy as np  # type: ignore[import-not-found]
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False
    np = None  # type: ignore[assignment]


def _log(msg: str):
    """Print debug message when VERBOSE is enabled."""
    if os.environ.get("VERBOSE", "").lower() == "true":
        msg = msg.replace("→", "->").replace("←", "<-").replace("↔", "<->")
        print(f"  [VECTOR_RAG] {msg}")


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
            documents: List of dicts with 'title' and 'content' keys
            model_name: Sentence transformer model to use
            chunk_size: Characters per chunk
            chunk_overlap: Overlap between chunks
            collection_name: Collection name (for compatibility)
        """
        self.documents = documents
        self.model_name = model_name
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.collection_name = collection_name
        
        # Check if dependencies are available
        if not SENTENCE_TRANSFORMERS_AVAILABLE or not FAISS_AVAILABLE or not NUMPY_AVAILABLE:
            raise ImportError(
                "Vector RAG requires sentence-transformers, faiss-cpu, and numpy. "
                "Install with: pip install sentence-transformers faiss-cpu numpy"
            )
        
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
        
        _log(f"Initialized: {len(documents)} docs -> {len(self.chunks)} chunks indexed")
    
    @staticmethod
    def _tokenize(text: str) -> List[str]:
        """Split text into lowercase alphanumeric tokens."""
        return re.findall(r"[a-z0-9]+", text.lower())
    
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
    
    def _chunk_and_index_documents(self):
        """Chunk all documents and index them with embeddings."""
        all_chunks = []
        
        # Chunk all documents
        for doc in self.documents:
            # Support both 'title' and 'source' keys (from different loaders)
            title = doc.get("title") or doc.get("source", "unknown")
            chunks = self._chunk_text(doc["content"], title)
            all_chunks.extend(chunks)
        
        self.chunks = all_chunks
        
        if not all_chunks:
            _log("No chunks to index")
            return
        
        # Generate embeddings for all chunks
        _log(f"Generating embeddings for {len(all_chunks)} chunks...")
        chunk_texts = [chunk["content"] for chunk in all_chunks]
        embeddings = self.model.encode(
            chunk_texts,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True  # Normalize for cosine similarity
        )
        
        # Create FAISS index with L2 distance (cosine similarity after normalization)
        _log("Creating FAISS index...")
        self.index = faiss.IndexFlatIP(self.embedding_dim)  # Inner Product = cosine for normalized vectors
        self.index.add(embeddings.astype(np.float32))
        
        _log(f"Indexed {len(all_chunks)} chunks in FAISS")
    
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
        
        # Query expansion
        queries = self._expand_query(query) if use_query_expansion else [query]
        _log(f"Searching with {len(queries)} query variants")
        
        # Encode all queries
        query_embeddings = self.model.encode(
            queries,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True
        )
        
        # Get more results than needed for re-ranking
        search_k = min(top_k * 3 if rerank else top_k, len(self.chunks))
        
        # Vector search for each query variant
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
                vector_score = float(scores[0][j])  # Already cosine similarity
                
                # Keyword score for hybrid search
                keyword_score = 0.0
                if use_hybrid:
                    keyword_score = self._keyword_score(queries[i], chunk['content'])
                
                # Combined score (70% vector, 30% keyword)
                combined_score = (0.7 * vector_score + 0.3 * keyword_score) if use_hybrid else vector_score
                
                all_results.append({
                    'chunk': chunk,
                    'vector_score': vector_score,
                    'keyword_score': keyword_score,
                    'combined_score': combined_score,
                    'query_variant': i,
                    'method': 'hybrid' if use_hybrid else 'vector'
                })
        
        # Deduplicate by chunk ID (keep highest score)
        seen_ids = {}
        for result in all_results:
            chunk_id = result['chunk']['id']
            if chunk_id not in seen_ids or result['combined_score'] > seen_ids[chunk_id]['combined_score']:
                seen_ids[chunk_id] = result
        
        deduplicated = list(seen_ids.values())
        
        # Sort by combined score
        deduplicated.sort(key=lambda x: x['combined_score'], reverse=True)
        
        # Return top k with simplified format
        results = []
        for result in deduplicated[:top_k]:
            results.append({
                'chunk': result['chunk'],
                'score': round(result['combined_score'], 4),
                'method': result['method']
            })
        
        _log(f"Found {len(results)} relevant chunks (scores: {[r['score'] for r in results]})")
        
        return results
    
    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the indexed data."""
        return {
            "total_documents": len(self.documents),
            "total_chunks": len(self.chunks),
            "embedding_model": self.model_name,
            "embedding_dimension": self.embedding_dim,
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "vector_db": "FAISS"
        }
    
    def save_index(self, index_path: str) -> bool:
        """
        Save FAISS index and metadata to disk for persistence.
        
        Args:
            index_path: Path to save the index (without extension)
            
        Returns:
            True if successful
        """
        try:
            os.makedirs(os.path.dirname(index_path) or ".", exist_ok=True)
            
            # Save FAISS index
            faiss.write_index(self.index, f"{index_path}.faiss")
            
            # Save metadata (chunks, model name, embedding dim)
            import json
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
    
    @staticmethod
    def load_index(index_path: str) -> Optional['VectorRAGEngine']:
        """
        Load FAISS index from disk.
        
        Args:
            index_path: Path to the saved index (without extension)
            
        Returns:
            VectorRAGEngine instance or None if load fails
        """
        try:
            import json
            
            # Load metadata
            with open(f"{index_path}.json", 'r') as f:
                metadata = json.load(f)
            
            # Load FAISS index
            index = faiss.read_index(f"{index_path}.faiss")
            
            # Create engine instance with loaded metadata
            engine = VectorRAGEngine.__new__(VectorRAGEngine)
            engine.documents = metadata["documents"]
            engine.model_name = metadata["model_name"]
            engine.embedding_dim = metadata["embedding_dim"]
            engine.chunk_size = metadata["chunk_size"]
            engine.chunk_overlap = metadata["chunk_overlap"]
            engine.chunks = metadata["chunks"]
            engine.index = index
            engine.collection_name = "rag_documents"
            
            # Initialize the model
            engine.model = SentenceTransformer(engine.model_name)
            
            _log(f"Loaded FAISS index from {index_path} ({len(engine.chunks)} chunks)")
            return engine
        except Exception as e:
            _log(f"Failed to load index: {e}")
            return None
    
    def add_documents(self, documents: List[Dict[str, str]]) -> None:
        """
        Add new documents to the index dynamically.
        
        Args:
            documents: List of {source, content} dicts
        """
        self.documents.extend(documents)
        
        # Re-index all documents
        self.chunks = []
        self.index = None
        self._chunk_and_index_documents()
        
        _log(f"Added documents. Total: {len(self.documents)} docs -> {len(self.chunks)} chunks")


class TFIDFRAGEngine:
    """
    Fallback TF-IDF based RAG engine (original implementation).
    Used when vector dependencies are not available.
    """
    
    def __init__(self, documents: List[Dict[str, str]], chunk_size: int = 300, chunk_overlap: int = 60):
        self.chunks: List[Dict] = []
        self.idf: Dict[str, float] = {}
        self.chunk_vectors: List[Dict[str, float]] = []
        self._chunk_documents(documents, chunk_size, chunk_overlap)
        self._build_index()
        _log(f"TF-IDF RAG Engine: {len(documents)} docs -> {len(self.chunks)} chunks indexed")

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        """Split text into lowercase alphanumeric tokens."""
        return re.findall(r"[a-z0-9]+", text.lower())

    def _chunk_documents(self, docs: List[Dict], size: int, overlap: int):
        """Split documents into overlapping chunks, breaking at sentence boundaries."""
        for doc in docs:
            text = doc["content"]
            # Support both 'title' and 'source' keys (from different loaders)
            title = doc.get("title") or doc.get("source", "unknown")
            pos, idx = 0, 0
            while pos < len(text):
                end = min(pos + size, len(text))
                # Try to break at a sentence boundary
                if end < len(text):
                    last_period = text.rfind(". ", pos, end)
                    if last_period > pos + size // 2:
                        end = last_period + 2
                self.chunks.append(
                    {
                        "content": text[pos:end].strip(),
                        "source": title,
                        "chunk_index": idx,
                        "char_start": pos,
                        "char_end": end,
                    }
                )
                pos = max(pos + 1, end - overlap)
                idx += 1

    def _build_index(self):
        """Compute IDF across the corpus and TF-IDF vectors per chunk."""
        N = len(self.chunks)
        if N == 0:
            return
        all_tokens = [self._tokenize(c["content"]) for c in self.chunks]
        # Inverse Document Frequency
        doc_freq: Dict[str, int] = {}
        for tokens in all_tokens:
            for t in set(tokens):
                doc_freq[t] = doc_freq.get(t, 0) + 1
        self.idf = {t: math.log((N + 1) / (1 + df)) for t, df in doc_freq.items()}
        # TF-IDF vectors
        for tokens in all_tokens:
            tf = Counter(tokens)
            total = len(tokens) or 1
            vec = {t: (c / total) * self.idf.get(t, 0) for t, c in tf.items()}
            self.chunk_vectors.append(vec)

    @staticmethod
    def _cosine_sim(v1: Dict[str, float], v2: Dict[str, float]) -> float:
        """Compute cosine similarity between two sparse TF-IDF vectors."""
        shared = set(v1) & set(v2)
        if not shared:
            return 0.0
        dot = sum(v1[k] * v2[k] for k in shared)
        n1 = math.sqrt(sum(x * x for x in v1.values()))
        n2 = math.sqrt(sum(x * x for x in v2.values()))
        return dot / (n1 * n2) if n1 and n2 else 0.0

    def search(self, query: str, top_k: int = 5, **kwargs) -> List[Dict]:
        """Search the index for chunks most relevant to the query."""
        tokens = self._tokenize(query)
        if not tokens:
            return []
        tf = Counter(tokens)
        total = len(tokens)
        q_vec = {t: (c / total) * self.idf.get(t, 0) for t, c in tf.items()}
        scored = []
        for i, c_vec in enumerate(self.chunk_vectors):
            score = self._cosine_sim(q_vec, c_vec)
            if score > 0.01:
                scored.append((score, i))
        scored.sort(key=lambda x: -x[0])
        return [
            {"chunk": self.chunks[i], "score": round(s, 4), "method": "tfidf"}
            for s, i in scored[:top_k]
        ]
    
    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the indexed data."""
        return {
            "total_documents": len(self.chunks),
            "total_chunks": len(self.chunks),
            "method": "TF-IDF",
            "chunk_size": "variable",
            "vector_db": "None (in-memory)"
        }


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


if __name__ == "__main__":
    # Test the RAG engine
    test_docs = [
        {
            "title": "What is RAG?",
            "content": "Retrieval-Augmented Generation (RAG) is a technique that combines information retrieval with language generation. It retrieves relevant documents from a knowledge base and uses them to provide context for generating responses."
        },
        {
            "title": "Vector Databases",
            "content": "Vector databases store high-dimensional embeddings and support efficient similarity search. Popular options include Pinecone, Weaviate, FAISS, and Milvus. They use algorithms like HNSW for fast approximate nearest neighbor search."
        }
    ]
    
    print("Testing RAG Engine...")
    engine = create_rag_engine(test_docs)
    print(f"\nEngine stats: {engine.get_stats()}")
    
    query = "What is retrieval augmented generation?"
    print(f"\nQuery: {query}")
    results = engine.search(query, top_k=2)
    
    for i, result in enumerate(results, 1):
        print(f"\nResult {i} (score: {result['score']}, method: {result['method']}):")
        print(f"Source: {result['chunk']['source']}")
        print(f"Content: {result['chunk']['content'][:200]}...")
