from core.loader import load_codebase
from core.chunker import chunk_documents
from core.embeddings import embed_texts
from core.vector_store import VectorStore
from llm.explainer import explain_code

# Load + chunk
docs = load_codebase("data/repo")
chunks = chunk_documents(docs)

texts = [c["content"] for c in chunks]

# Embed + store
embeddings = embed_texts(texts)
store = VectorStore(len(embeddings[0]))
store.add(embeddings, texts)

# Query
question = "What does this component do?"

query_embedding = embed_texts([question])[0]
results = store.search(query_embedding)

context = "\n\n".join(results)

# LLM explanation
answer = explain_code(context, question)

print("\nExplanation:\n")
print(answer)
