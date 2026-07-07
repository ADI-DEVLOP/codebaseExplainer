from core.loader import load_codebase
from core.chunker import chunk_documents
from core.embeddings import embed_texts
from core.vector_store import VectorStore

# Load and chunk
docs = load_codebase("data/repo")
chunks = chunk_documents(docs)

# Extract only text
texts = [c["content"] for c in chunks]

# Embed
embeddings = embed_texts(texts)

# Create vector DB
store = VectorStore(len(embeddings[0]))
store.add(embeddings, texts)

# Test query
query = "authentication logic"
query_embedding = embed_texts([query])[0]

results = store.search(query_embedding)

print("\n🔍 Results:\n")
for r in results:
    print(r[:200])
    print("----")