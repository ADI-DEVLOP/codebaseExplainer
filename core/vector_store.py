import faiss
import numpy as np


class VectorStore:
    def __init__(self, dim):
        self.index = faiss.IndexFlatL2(dim)
        self.entries = []

    def add(self, embeddings, entries):
        self.index.add(np.array(embeddings).astype("float32"))
        self.entries.extend(entries)

    def search(self, query_embedding, k=3):
        distances, indices = self.index.search(
            np.array([query_embedding]).astype("float32"), k
        )

        results = []
        for idx in indices[0]:
            if idx < len(self.entries) and idx >= 0:
                results.append(self.entries[idx])

        return results