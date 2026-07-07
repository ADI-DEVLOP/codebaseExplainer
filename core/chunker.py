from typing import List, Dict

def chunk_documents(documents: List[Dict], chunk_size: int = 500, overlap: int = 50):
    """
    Splits documents into smaller chunks.
    Each chunk keeps source info.
    """

    chunks = []

    for doc in documents:
        text = doc["content"]
        source = doc["source"]

        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk_text = text[start:end]

            chunks.append({
                "content": chunk_text,
                "source": source
            })

            start += chunk_size - overlap

    return chunks