"""
RAG SYSTEM - Retrieval-Augmented Generation

Provides semantic search over knowledge base:
- Vector embeddings (Sentence Transformers)
- FAISS vector database
- Hybrid search (vector + keyword)
- Query expansion
- Document loading and indexing
"""

from backend.rag.vector_engine import create_rag_engine, VectorRAGEngine, TFIDFRAGEngine
from backend.rag.document_loader import load_all_documents, load_documents_from_directory, add_document

__all__ = ["create_rag_engine", "VectorRAGEngine", "TFIDFRAGEngine", "load_all_documents", "add_document"]
