import mimetypes
import os
import re
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi import Query as FastAPIQuery
from pydantic import BaseModel
from core.retriever import Retriever
from core.chunker import chunk_documents
from core.embeddings import embed_texts
from core.loader import SUPPORTED_EXTENSIONS, load_codebase, read_document
from core.vector_store import VectorStore
from llm.explainer import explain_code
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

chat_memory = []
summary_cache = None
rag_index = None
repo_snapshot = None
SETTINGS = {
    "chunk_size": 900,
    "overlap": 50,
    "retrieval_k": 3,
}
DOCUMENTS_DIR = Path("data/repo")
SUPPORTED_UPLOAD_EXTENSIONS = set(SUPPORTED_EXTENSIONS)


class AskRequest(BaseModel):
    question: str


class SettingsRequest(BaseModel):
    chunk_size: int | None = None
    overlap: int | None = None
    retrieval_k: int | None = None


def compute_repo_snapshot():
    file_hashes = []
    for file_path in sorted(DOCUMENTS_DIR.rglob("*")):
        if file_path.is_file() and file_path.suffix.lower() in SUPPORTED_UPLOAD_EXTENSIONS:
            file_hashes.append((str(file_path.relative_to(DOCUMENTS_DIR)), file_path.stat().st_mtime))
    return tuple(file_hashes)


def get_rag_index():
    global rag_index, repo_snapshot

    current_snapshot = compute_repo_snapshot()
    if rag_index is not None and repo_snapshot == current_snapshot:
        return rag_index

    repo_snapshot = current_snapshot
    docs = load_codebase("data/repo")
    # apply current settings for chunking
    chunks = chunk_documents(docs, chunk_size=SETTINGS.get("chunk_size", 900), overlap=SETTINGS.get("overlap", 50))
    texts = [c["content"] for c in chunks]

    if not texts:
        raise HTTPException(
            status_code=400,
            detail=(
                "No readable text found in uploaded documents. "
                "If this is a scanned PDF, image-only PDF, or image file, run OCR first or upload a text-based PDF."
            ),
        )

    embeddings = embed_texts(texts)
    store = VectorStore(len(embeddings[0]))
    store.add(embeddings, chunks)

    rag_index = {
        "chunks": chunks,
        "texts": texts,
        "store": store,
        "retriever": Retriever(store, chunks),
    }
    return rag_index


def reset_rag_cache():
    global rag_index, summary_cache, chat_memory, repo_snapshot
    rag_index = None
    summary_cache = None
    chat_memory = []
    repo_snapshot = None


def sanitize_document_path(filename: str) -> Path:
    parts = Path(filename.replace("\\", "/")).parts
    safe_parts = []

    for part in parts:
        safe_part = re.sub(r"[^A-Za-z0-9._-]", "_", part)
        if not safe_part or safe_part in {".", ".."}:
            continue
        safe_parts.append(safe_part)

    if not safe_parts:
        raise HTTPException(status_code=400, detail="Invalid file name")

    return Path(*safe_parts)


def document_info(file_path: Path):
    relative_path = file_path.relative_to(DOCUMENTS_DIR)
    content_type, _ = mimetypes.guess_type(file_path.name)
    readable = False
    chunks = []

    try:
        content = read_document(file_path)
        readable = bool(content.strip())
        if readable:
            chunks = chunk_documents([{
                "content": content,
                "source": str(file_path),
            }])
    except Exception:
        readable = False

    return {
        "id": relative_path.as_posix(),
        "name": relative_path.as_posix(),
        "type": (content_type or file_path.suffix.removeprefix(".") or "unknown").upper(),
        "chunks": len(chunks),
        "readable": readable,
        "status": "Ready for chat" if readable else "No readable text",
        "uploaded": file_path.stat().st_mtime,
    }


def list_document_files():
    DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for file_path in DOCUMENTS_DIR.rglob("*"):
        if file_path.is_file() and file_path.suffix.lower() in SUPPORTED_UPLOAD_EXTENSIONS:
            files.append(document_info(file_path))
    return sorted(files, key=lambda doc: doc["uploaded"], reverse=True)


def unreadable_document_answer(question: str):
    question_text = question.lower()
    unreadable_docs = [doc for doc in list_document_files() if not doc["readable"]]

    for doc in unreadable_docs:
        name = doc["name"].lower()
        stem = Path(doc["name"]).stem.lower()
        mentions_document = any(word in question_text for word in ["pdf", "document", "file"])
        mentions_name = name in question_text or stem in question_text

        if mentions_document or mentions_name:
            return (
                f"I can see '{doc['name']}' in Documents, but it has no readable text for chat. "
                "If it is a scanned PDF, image-only PDF, or image file, run OCR first or upload a text-based PDF."
            )

    return None


def get_latest_readable_file_chunks():
    for doc in list_document_files():
        if doc["readable"]:
            file_path = DOCUMENTS_DIR / Path(doc["name"])
            try:
                content = read_document(file_path)
                if content.strip():
                    return chunk_documents([
                        {"content": content, "source": str(file_path)}
                    ])
            except Exception:
                continue
    return []


@app.get("/")
def home():
    return {"message": "Codebase Explainer API running"}


@app.get("/settings")
def get_settings():
    return {"settings": SETTINGS}


@app.post("/settings")
def set_settings(req: SettingsRequest):
    # update only provided values
    updated = False
    if req.chunk_size is not None:
        SETTINGS["chunk_size"] = max(64, int(req.chunk_size))
        updated = True
    if req.overlap is not None:
        SETTINGS["overlap"] = max(0, int(req.overlap))
        updated = True
    if req.retrieval_k is not None:
        SETTINGS["retrieval_k"] = max(1, int(req.retrieval_k))
        updated = True

    if updated:
        reset_rag_cache()

    return {"settings": SETTINGS}


@app.get("/documents")
def get_documents():
    return {"documents": list_document_files()}


@app.get("/documents/view/{filename:path}")
def view_document(filename: str):
    safe_path = sanitize_document_path(filename)
    target_path = (DOCUMENTS_DIR / safe_path).resolve()
    documents_root = DOCUMENTS_DIR.resolve()

    if documents_root not in target_path.parents and target_path != documents_root:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="Document not found")

    content_type, _ = mimetypes.guess_type(str(target_path))
    # Serve file with inline disposition so browsers display images/PDFs instead of forcing download
    headers = {"Content-Disposition": f"inline; filename=\"{target_path.name}\""}
    return FileResponse(path=str(target_path), media_type=content_type or "application/octet-stream", headers=headers)


@app.post("/documents/upload")
async def upload_documents(files: list[UploadFile] = File(...)):
    DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
    uploaded = []

    for file in files:
        safe_path = sanitize_document_path(file.filename or "")
        extension = safe_path.suffix.lower()

        if extension not in SUPPORTED_UPLOAD_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {safe_path}")

        target_path = DOCUMENTS_DIR / safe_path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        content = await file.read()
        target_path.write_bytes(content)
        uploaded.append(document_info(target_path))

    reset_rag_cache()
    return {"documents": uploaded}


@app.delete("/documents/{filename:path}")
def delete_document(filename: str):
    safe_path = sanitize_document_path(filename)
    target_path = (DOCUMENTS_DIR / safe_path).resolve()
    documents_root = DOCUMENTS_DIR.resolve()

    if documents_root not in target_path.parents:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="Document not found")

    target_path.unlink()
    for parent in target_path.parents:
        if parent == documents_root or documents_root not in parent.parents:
            break
        try:
            parent.rmdir()
        except OSError:
            break

    reset_rag_cache()
    return {"message": "Document deleted", "name": safe_path.as_posix()}


@app.post("/ask")
def ask_question(query: AskRequest):
    question = query.question
    unreadable_answer = unreadable_document_answer(question)
    if unreadable_answer:
        return {
            "question": question,
            "answer": unreadable_answer,
        }

    history_text = ""
    for item in chat_memory[-3:]:
        history_text += f"Q: {item['question']}\nA: {item['answer']}\n"

    enhanced_query = f"""
Conversation so far:
{history_text}

New question:
{question}
"""

    index = get_rag_index()
    results = index["retriever"].retrieve(question, k=SETTINGS.get("retrieval_k", 3))

    if not results:
        results = get_latest_readable_file_chunks()[:3]

    context = "\n\n".join(
        f"Source: {result['source']}\n{result['content']}"
        for result in results
    )

    final_question = f"""
Previous conversation:
{history_text}

Current question:
{question}
"""

    answer = explain_code(context, final_question)
    chat_memory.append({
        "question": question,
        "answer": answer,
    })

    return {
        "question": question,
        "answer": answer,
    }


@app.get("/summary")
def get_summary():
    global summary_cache

    if summary_cache:
        return {"summary": summary_cache, "cached": True}

    index = get_rag_index()
    context = "\n\n".join(index["texts"][:3])
    answer = explain_code(context, "Explain this codebase")
    summary_cache = answer

    return {"summary": answer, "cached": False}


@app.get("/ask-file")
def ask_file(file: str = FastAPIQuery(..., description="File name to explain")):
    index = get_rag_index()
    file_chunks = [c["content"] for c in index["chunks"] if file in c["source"]]

    if not file_chunks:
        return {"error": f"No file found: {file}"}

    context = "\n\n".join(file_chunks[:3])
    answer = explain_code(context, f"Explain this file: {file}")

    return {
        "file": file,
        "answer": answer,
    }
@app.post("/reset")
def reset_chat():
    global chat_memory
    chat_memory = []
    return {"message": "Chat memory cleared"}
