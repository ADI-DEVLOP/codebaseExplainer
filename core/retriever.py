from core.embeddings import embed_texts


class Retriever:
    def __init__(self, store, chunks):
        self.store = store
        self.chunks = chunks

    def retrieve(self, question, k=3):
        """
        Perform semantic search with optional keyword filtering
        """

        # 🔹 Enhance query
        enhanced_query = f"""
Find relevant code for:
{question}

Focus on:
- functions
- logic
- important operations
"""

        # 🔹 Embed query
        query_embedding = embed_texts([enhanced_query])[0]

        # 🔹 Vector search
        return self.store.search(query_embedding, k=k)