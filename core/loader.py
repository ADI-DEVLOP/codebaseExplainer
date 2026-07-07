from typing import List
from pathlib import Path

from pypdf import PdfReader
from PIL import Image
import pytesseract

# If Tesseract isn't on your PATH (common on Windows), uncomment and set this:
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# Supported file types, including image uploads for metadata/listing.
IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".svg",
}

SUPPORTED_EXTENSIONS = [
    ".pdf", ".txt", ".md", ".markdown", ".html", ".htm",
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cpp", ".c", ".h", ".hpp",
    ".cs", ".go", ".rs", ".php", ".rb", ".swift", ".kt", ".kts", ".scala",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
    ".css", ".scss", ".sass", ".less", ".xml", ".sql", ".sh", ".bat", ".ps1",
    ".svg",
] + sorted(IMAGE_EXTENSIONS - {".svg"})


def read_image_text(file_path: Path) -> str:
    """Extract text from an image using OCR (Tesseract)."""
    try:
        image = Image.open(file_path)
        text = pytesseract.image_to_string(image)
        return text.strip()
    except Exception as e:
        print(f"OCR failed for {file_path}: {e}")
        return ""


def read_pdf_text(file_path: Path) -> str:
    """Extract text from a PDF using pypdf."""
    try:
        reader = PdfReader(str(file_path))
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            text_parts.append(page_text)
        return "\n".join(text_parts).strip()
    except Exception as e:
        print(f"PDF read failed for {file_path}: {e}")
        return ""


def read_document(file_path: Path) -> str:
    suffix = file_path.suffix.lower()

    if suffix == ".svg":
        # SVG is XML/text, not a raster image - read as text, don't OCR.
        return file_path.read_text(encoding="utf-8", errors="ignore")

    if suffix in IMAGE_EXTENSIONS:
        return read_image_text(file_path)

    if suffix == ".pdf":
        return read_pdf_text(file_path)

    return file_path.read_text(encoding="utf-8", errors="ignore")


def load_codebase(repo_path: str) -> List[str]:
    """
    Loads code files from a repository folder.
    Returns list of file contents.
    """
    documents = []

    for file_path in Path(repo_path).rglob("*"):
        if not file_path.is_file():
            continue

        # Filter supported file types
        if file_path.suffix.lower() in SUPPORTED_EXTENSIONS:
            try:
                content = read_document(file_path)
                if not content.strip():
                    continue

                suffix = file_path.suffix.lower()
                source_type = (
                    "image_ocr" if suffix in IMAGE_EXTENSIONS and suffix != ".svg"
                    else "pdf" if suffix == ".pdf"
                    else "text"
                )

                documents.append({
                    "content": content,
                    "source": str(file_path),
                    "source_type": source_type,
                })

            except Exception as e:
                print(f"Error reading {file_path}: {e}")

    return documents