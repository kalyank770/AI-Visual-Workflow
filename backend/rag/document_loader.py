"""
Document Loader for RAG System
Loads documents from files, handles multiple formats, manages persistence
"""
import os
import json
import glob
from pathlib import Path
from typing import List, Dict, Any

def load_documents_from_directory(data_dir: str) -> List[Dict[str, str]]:
    """
    Load documents from a directory, supporting .txt, .md, .json formats.
    
    Args:
        data_dir: Path to the data directory
        
    Returns:
        List of {source, content} dicts
    """
    documents = []
    data_path = Path(data_dir)
    
    if not data_path.exists():
        return documents
    
    # Load text files
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
    
    # Load markdown files
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
    
    # Load JSON files
    for json_file in data_path.glob("**/*.json"):
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    # Array of documents
                    for item in data:
                        if isinstance(item, dict) and "content" in item:
                            source = item.get("source", json_file.name)
                            documents.append({
                                "source": source,
                                "content": item["content"]
                            })
                elif isinstance(data, dict) and "content" in data:
                    # Single document
                    source = data.get("source", json_file.name)
                    documents.append({
                        "source": source,
                        "content": data["content"]
                    })
        except Exception as e:
            print(f"Error loading {json_file}: {e}")
    
    return documents


def load_all_documents(data_dir: str = None) -> List[Dict[str, str]]:
    """
    Load all documents from data directory + hardcoded fallback.
    
    Args:
        data_dir: Path to data directory (defaults to ./data)
        
    Returns:
        List of documents
    """
    if data_dir is None:
        data_dir = os.path.join(os.path.dirname(__file__), "data")
    
    # Load from files
    documents = load_documents_from_directory(data_dir)
    
    # If no documents found, use hardcoded defaults
    if not documents:
        documents = _get_default_documents()
    
    return documents


def _get_default_documents() -> List[Dict[str, str]]:
    """Fallback: hardcoded documents for when /data is empty."""
    return [
        {
            "source": "agentic_ai.md",
            "content": (
                "# Agentic AI Architecture Guide\n\n"
                "An agentic AI system is an autonomous software agent that perceives its "
                "environment, makes decisions, and takes actions to achieve goals without "
                "continuous human guidance. Core components include:\n\n"
                "## (1) Orchestrator (LangGraph/LangChain)\n"
                "The central controller managing state, routing requests, and coordinating "
                "between the LLM, tools, and memory. It implements a directed graph where "
                "nodes represent processing steps and edges represent transitions. State is "
                "persisted to Redis or PostgreSQL for fault tolerance.\n\n"
                "## (2) Large Language Model\n"
                "The reasoning engine that generates plans, evaluates tool outputs, and "
                "synthesizes final responses. Models like Llama 3.3 70B or GPT-4 with "
                "function calling capabilities are used.\n\n"
                "## (3) RAG (Retrieval-Augmented Generation)\n"
                "Augments LLM responses with relevant documents from a vector database. "
                "The pipeline includes query expansion, embedding generation, similarity "
                "search, and re-ranking.\n\n"
                "## (4) Vector Database\n"
                "Stores document embeddings as high-dimensional vectors supporting "
                "nearest-neighbor search using HNSW algorithms. Options include Pinecone, "
                "ChromaDB, Weaviate, and pgvector.\n\n"
                "## (5) Tool Integration (MCP)\n"
                "Model Context Protocol provides a standardized interface for agents to "
                "interact with external services, APIs, databases, and enterprise applications."
            )
        },
        {
            "source": "rag_pipeline.md",
            "content": (
                "# RAG Pipeline Best Practices\n\n"
                "Retrieval-Augmented Generation (RAG) grounds LLM responses in enterprise "
                "knowledge. Document ingestion involves:\n\n"
                "## Document Processing\n"
                "- Format parsing and cleaning\n"
                "- Chunking into 200-500 token overlapping segments\n"
                "- Metadata extraction and preservation\n"
                "- Deduplication and quality filtering\n\n"
                "## Chunking Strategies\n"
                "1. **Fixed-size**: Simple but may break semantic boundaries\n"
                "2. **Semantic**: Splits at sentence boundaries, preserves meaning\n"
                "3. **Recursive**: Hierarchical splitting for complex documents\n"
                "4. **Document-aware**: Uses document structure (headings, sections)\n\n"
                "## Embeddings\n"
                "Generated using models like text-embedding-004 (768 dimensions) or "
                "text-embedding-3-large (3072 dimensions). We use Sentence Transformers "
                "with all-MiniLM-L6-v2 (384 dimensions) for efficiency.\n\n"
                "## Hybrid Search\n"
                "Combines vector similarity (semantic) with keyword search (BM25) via "
                "Reciprocal Rank Fusion (RRF) for better recall.\n\n"
                "## Re-ranking\n"
                "Uses cross-encoder models like ms-marco-MiniLM to sort results by "
                "true relevance, improving precision."
            )
        },
        {
            "source": "opentext_products.md",
            "content": (
                "# OpenText Product Suite\n\n"
                "OpenText Corporation is a Canadian enterprise information management "
                "company founded in 1991, headquartered in Waterloo, Ontario. It trades "
                "on NASDAQ and TSX as OTEX.\n\n"
                "## Core Products\n\n"
                "### Content Management\n"
                "- **Content Server**: Enterprise content management platform\n"
                "- **Documentum**: Content services platform\n"
                "- **Extended ECM**: Content in business process context\n"
                "- **TeamSite**: Web content management system\n\n"
                "### Integration & Communications\n"
                "- **Trading Grid**: B2B integration network\n"
                "- **Exstream**: Customer communications management\n\n"
                "### Security & Operations\n"
                "- **Fortify**: Application security testing\n"
                "- **ArcSight**: SIEM threat detection\n"
                "- **NetIQ**: Identity and access management\n"
                "- **Voltage**: Data-centric encryption\n"
                "- **EnCase**: Digital forensics\n\n"
                "### Performance & Monitoring\n"
                "- **LoadRunner**: Performance testing\n"
                "- **SMAX**: IT service management with ML\n\n"
                "### AI & Analytics\n"
                "- **Magellan**: AI and analytics platform\n"
                "- **Aviator**: Next-generation AI platform leveraging LLMs"
            )
        },
        {
            "source": "vector_search.md",
            "content": (
                "# Vector Search & Embeddings\n\n"
                "Vector embeddings are numerical representations of text that capture "
                "semantic meaning. They enable similarity-based search.\n\n"
                "## How Embeddings Work\n"
                "1. **Text Input**: \"What is machine learning?\"\n"
                "2. **Model Processing**: Sentence Transformer encodes the text\n"
                "3. **Vector Output**: [0.45, -0.23, 0.89, ..., -0.12] (384 dimensions)\n"
                "4. **Similarity**: Compare vectors using cosine similarity\n\n"
                "## FAISS Index\n"
                "Facebook AI Similarity Search (FAISS) provides:\n"
                "- **IndexFlatIP**: Inner product search for cosine similarity\n"
                "- **Indexing**: O(1) add, O(n) search (suitable for < 1M vectors)\n"
                "- **Scaling**: Can handle billions of vectors with HNSW variants\n\n"
                "## Query Expansion\n"
                "Generate multiple query variants to improve recall:\n"
                "- Original: \"What is RAG?\"\n"
                "- Variant 1: \"Retrieval-augmented generation explained\"\n"
                "- Variant 2: \"How to use RAG in LLM applications\"\n"
                "- Variant 3: \"RAG systems and knowledge bases\"\n\n"
                "Search with all variants, combine results using RRF (Reciprocal Rank Fusion)."
            )
        }
    ]


def add_document(document: Dict[str, str], data_dir: str = None) -> bool:
    """
    Add a new document to the data directory.
    
    Args:
        document: {source, content} dict
        data_dir: Path to data directory
        
    Returns:
        True if successful
    """
    if data_dir is None:
        data_dir = os.path.join(os.path.dirname(__file__), "data")
    
    os.makedirs(data_dir, exist_ok=True)
    
    source = document.get("source", "document.txt")
    content = document.get("content", "")
    
    # Ensure .txt or .md extension
    if not source.endswith((".txt", ".md")):
        source += ".txt"
    
    file_path = os.path.join(data_dir, source)
    
    # Create subdirectories if needed
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    except Exception as e:
        print(f"Error saving document: {e}")
        return False


def get_document_stats(data_dir: str = None) -> Dict[str, Any]:
    """
    Get statistics about loaded documents.
    
    Returns:
        Stats dict with count, total_size, formats
    """
    if data_dir is None:
        data_dir = os.path.join(os.path.dirname(__file__), "data")
    
    docs = load_all_documents(data_dir)
    
    return {
        "total_documents": len(docs),
        "total_characters": sum(len(d.get("content", "")) for d in docs),
        "sources": [d.get("source", "unknown") for d in docs],
    }
