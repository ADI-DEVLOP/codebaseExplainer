from core.loader import load_codebase
from core.chunker import chunk_documents

docs = load_codebase("data/repo")
chunks = chunk_documents(docs)

print(f"Total chunks: {len(chunks)}")

# preview first chunk
if chunks:
    print(chunks[0]["source"])
    print(chunks[0]["content"][:200]) 