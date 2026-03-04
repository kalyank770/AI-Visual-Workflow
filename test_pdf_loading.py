#!/usr/bin/env python3
"""Test script to verify PDF loading"""
import sys
sys.path.insert(0, 'backend')

from rag.document_loader import load_documents_from_directory

print("Testing PDF document loading...")
docs = load_documents_from_directory('backend/data')
print(f"\nLoaded {len(docs)} documents:")

for doc in docs:
    source = doc['source']
    content_len = len(doc['content'])
    page_count = doc.get('page_count', 'N/A')
    print(f"  - {source}: {content_len:,} chars, {page_count} pages")
    
    # Show first 200 chars of content
    preview = doc['content'][:200].replace('\n', ' ')
    print(f"    Preview: {preview}...")

print("\nPDF loading test complete!")
