import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const SUPPORTED_EXTENSIONS = [
  ".pdf", ".txt", ".md", ".markdown", ".html", ".htm",
  ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cpp", ".c", ".h", ".hpp",
  ".cs", ".go", ".rs", ".php", ".rb", ".swift", ".kt", ".kts", ".scala",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env",
  ".css", ".scss", ".sass", ".less", ".xml", ".sql", ".sh", ".bat", ".ps1",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".svg",
];
const ACCEPTED_FILE_TYPES = SUPPORTED_EXTENSIONS.join(",");

const navItems = [
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function estimateChunks(file) {
  return Math.max(1, Math.round(file.size / 900));
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getType(file) {
  if (file.type) return file.type.toUpperCase();
  const extension = file.name.split(".").pop()?.toUpperCase();
  return extension ? `.${extension}` : "UNKNOWN";
}

function hasSupportedExtension(file) {
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function formatServerDate(value) {
  if (!value) return "";
  return formatDate(new Date(value * 1000));
}

function normalizeDocument(doc) {
  return {
    ...doc,
    uploaded: typeof doc.uploaded === "number" ? formatServerDate(doc.uploaded) : doc.uploaded,
  };
}

export default function App() {
  const [activeView, setActiveView] = useState("chat");
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [recentUploads, setRecentUploads] = useState([]);
  const [settings, setSettings] = useState({ chunk_size: 900, overlap: 50, retrieval_k: 3 });
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const chatFileInputRef = useRef(null);

  useEffect(() => {
    loadDocuments();
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const res = await fetch(`${API_URL}/settings`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
    } catch (e) {
      // ignore
    }
  }

  async function updateSettings(newSettings) {
    try {
      const res = await fetch(`${API_URL}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      if (!res.ok) throw new Error("Could not save settings");
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
      setUploadStatus("Settings saved");
    } catch (e) {
      setUploadStatus("Failed to save settings");
    }
  }

  const filteredDocuments = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((doc) => doc.name.toLowerCase().includes(needle));
  }, [documents, search]);

  async function loadDocuments() {
    try {
      const res = await fetch(`${API_URL}/documents`);
      if (!res.ok) throw new Error("Could not load documents");
      const data = await res.json();
      setDocuments((data.documents || []).map(normalizeDocument));
      setUploadStatus("");
    } catch {
      setUploadStatus("Backend is not reachable. Start FastAPI to load uploaded files.");
    }
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList).filter(hasSupportedExtension);

    if (!files.length) {
      setUploadStatus("Choose a supported document, image, config, or text file.");
      return;
    }

    const optimisticDocuments = files.map((file) => ({
      id: `${file.name}-${file.lastModified}-${file.size}`,
      name: file.name,
      type: getType(file),
      chunks: estimateChunks(file),
      uploaded: formatDate(new Date()),
    }));

    setRecentUploads(files.map((file) => file.name));
    setDocuments((current) => [...optimisticDocuments, ...current]);
    setUploadStatus(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}...`);

    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("files", file, file.webkitRelativePath || file.name);
      });

      const res = await fetch(`${API_URL}/documents/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || "Upload failed");
      }

      const data = await res.json();
      await loadDocuments();
      const unreadable = (data.documents || []).filter((doc) => doc.readable === false);
      setActiveView("chat");
      setUploadStatus(
        unreadable.length
          ? `Uploaded, but ${unreadable.map((doc) => doc.name).join(", ")} has no readable text for chat.`
          : `Uploaded ${files.length} file${files.length === 1 ? "" : "s"}.`
      );
    } catch (error) {
      setDocuments((current) =>
        current.filter((doc) => !optimisticDocuments.some((draft) => draft.id === doc.id))
      );
      setRecentUploads([]);
      setUploadStatus(error.message || "Upload failed.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
      if (chatFileInputRef.current) chatFileInputRef.current.value = "";
    }
  }

  async function deleteDocument(id) {
    setDocuments((current) => current.filter((doc) => doc.id !== id));
    setUploadStatus("Deleting document...");

    try {
      const res = await fetch(`${API_URL}/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Delete failed");
      await loadDocuments();
      setUploadStatus("Document deleted.");
    } catch {
      setUploadStatus("Could not delete document from backend.");
      loadDocuments();
    }
  }

  async function readResponse(res) {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (!res.ok) return data.detail || data.error || JSON.stringify(data, null, 2);
      return data.answer || data.summary || data.message || JSON.stringify(data, null, 2);
    }
    return res.text();
  }

  async function askQuestion(e) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const userMessage = { role: "user", text: trimmed };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      const answer = await readResponse(res);
      setMessages((current) => [...current, { role: "assistant", text: answer }]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: "Error connecting to backend." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function getSummary() {
    if (loading) return;
    setMessages((current) => [
      ...current,
      { role: "user", text: "Explain the whole codebase" },
    ]);
    setActiveView("chat");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/summary`);
      if (!res.ok) throw new Error("Request failed");
      const answer = await readResponse(res);
      setMessages((current) => [...current, { role: "assistant", text: answer }]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: "Error connecting to backend." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function resizeSidebar(clientX) {
    const nextWidth = Math.min(
      MAX_SIDEBAR_WIDTH,
      Math.max(MIN_SIDEBAR_WIDTH, Math.round(clientX))
    );
    setSidebarWidth(nextWidth);
  }

  function startSidebarResize(event) {
    event.preventDefault();
    if (!isSidebarOpen) return;
    resizeSidebar(event.clientX);

    function handlePointerMove(moveEvent) {
      resizeSidebar(moveEvent.clientX);
    }

    function handlePointerUp() {
      document.body.classList.remove("is-resizing-sidebar");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    document.body.classList.add("is-resizing-sidebar");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  

  return (
    <main
      className={`rag-shell ${isSidebarOpen ? "" : "sidebar-collapsed"}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` }}
    >
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        aria-expanded={isSidebarOpen}
        title={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={() => setIsSidebarOpen((current) => !current)}
      >
        <Icon name={isSidebarOpen ? "collapse" : "expand"} />
      </button>

      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <Icon name="database" />
          <span>RAG System</span>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeView === item.id ? "active" : ""}`}
              type="button"
              onClick={() => setActiveView(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {activeView === "chat" && (
          <div className="chat-history">
            <h3>Chat History</h3>
            <div className="history-list">
              {messages.filter((msg) => msg.role === "user").map((msg, index) => (
                <div key={index} className="history-item" title={msg.text}>
                  {msg.text.length > 50 ? `${msg.text.slice(0, 50)}...` : msg.text}
                </div>
              ))}
            </div>
            <button
              className="clear-chat-button"
              type="button"
              onClick={() => setMessages([])}
            >
              Clear Chat
            </button>
          </div>
        )}

        <button
          className="sidebar-resizer"
          type="button"
          aria-label="Resize sidebar"
          title="Drag to resize sidebar"
          onPointerDown={startSidebarResize}
          onDoubleClick={() => setSidebarWidth(300)}
        />
      </aside>

      <section className="main-panel">
        <div className="main-toolbar">
          <div className="platform-card">
            <div className="platform-brand">
              <span className="platform-logo">AI</span>
              <div>
                <strong>RAG Intelligence Suite</strong>
                <p>Enterprise-grade semantic search and code insight.</p>
              </div>
            </div>
            <div className="platform-status">
              <span className="status-pill connected">Online</span>
              <span className="status-pill">Model: llama-3.3</span>
              <span className="status-pill">Docs: {documents.length}</span>
            </div>
          </div>
        </div>

        {activeView === "documents" && (
          <DocumentsView
            documents={filteredDocuments}
            search={search}
            isDragging={isDragging}
            onSearch={setSearch}
            onBrowse={() => fileInputRef.current?.click()}
            onBrowseFolder={() => folderInputRef.current?.click()}
            onFiles={addFiles}
            onDragState={setIsDragging}
            onDelete={deleteDocument}
            fileInputRef={fileInputRef}
            folderInputRef={folderInputRef}
            uploadStatus={uploadStatus}
          />
        )}

        {activeView === "chat" && (
          <ChatView
            question={question}
            messages={messages}
            loading={loading}
            onQuestion={setQuestion}
            onAsk={askQuestion}
            onSummary={getSummary}
            onClear={() => setMessages([])}
            onUploadFiles={addFiles}
            uploadStatus={uploadStatus}
            recentUploads={recentUploads}
            chatFileInputRef={chatFileInputRef}
            folderInputRef={folderInputRef}
          />
        )}

        {activeView === "settings" && (
          <SettingsView settings={settings} onSave={updateSettings} />
        )}
      </section>

      
    </main>
  );
}

function DocumentsView({
  documents,
  search,
  isDragging,
  onSearch,
  onBrowse,
  onBrowseFolder,
  onFiles,
  onDragState,
  onDelete,
  fileInputRef,
  folderInputRef,
  uploadStatus,
}) {
  return (
    <>
      <header className="page-header">
        <h1>Documents</h1>
        <p>Upload and manage your documents for RAG processing.</p>
      </header>

      <div className="content-stack">
        <section className="panel-card upload-card">
          <div className="section-heading">
            <h2>Upload Documents</h2>
            <p>Upload documents, source files, configs, or text files for RAG processing.</p>
          </div>

          <div
            className={`drop-zone ${isDragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              onDragState(true);
            }}
            onDragLeave={() => onDragState(false)}
            onDrop={(event) => {
              event.preventDefault();
              onDragState(false);
              onFiles(event.dataTransfer.files);
            }}
          >
            <div className="upload-icon">
              <Icon name="upload" />
            </div>
            <strong>Drag and drop your files here or click to browse</strong>
            <span>Supports PDF, TXT, MD, HTML, JS, JSX, TS, TSX, Python, Java, JSON, YAML, CSS, SQL, and more.</span>
            <div className="format-row">
              <span><Icon name="file" /> PDF</span>
              <span><Icon name="file" /> JSX</span>
              <span><Icon name="file" /> TSX</span>
              <span><Icon name="file" /> JSON</span>
            </div>
            <div className="upload-actions">
              <button className="primary-button" type="button" onClick={onBrowse}>
                Browse Files
              </button>
              <button className="secondary-button" type="button" onClick={onBrowseFolder}>
                Browse Folder
              </button>
            </div>
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              onChange={(event) => onFiles(event.target.files)}
            />
            <input
              ref={folderInputRef}
              className="hidden-input"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              webkitdirectory="true"
              directory=""
              onChange={(event) => onFiles(event.target.files)}
            />
            {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
          </div>
        </section>

        <section className="panel-card documents-card">
          <div className="documents-toolbar">
            <div className="section-heading">
              <h2>Your Documents</h2>
              <p>Manage your uploaded documents for RAG processing.</p>
            </div>

            <label className="search-box">
              <Icon name="search" />
              <input
                type="search"
                placeholder="Search documents..."
                value={search}
                onChange={(event) => onSearch(event.target.value)}
              />
            </label>
          </div>

          <div className="document-table" role="table" aria-label="Uploaded documents">
            <div className="document-row table-head" role="row">
              <span>Name</span>
              <span>Type</span>
              <span>Chunks</span>
              <span>Status</span>
              <span>Uploaded</span>
              <span />
            </div>

            {documents.map((doc) => (
              <div className="document-row" role="row" key={doc.id}>
                <span className="doc-name"><Icon name="fileBlue" /> {doc.name}</span>
                <span>{doc.type}</span>
                <span>{doc.chunks}</span>
                <span className={doc.readable === false ? "doc-status warning" : "doc-status"}>
                  {doc.status || (doc.readable === false ? "No readable text" : "Ready for chat")}
                </span>
                <span>{doc.uploaded}</span>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Delete ${doc.name}`}
                  onClick={() => onDelete(doc.id)}
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))}

            {documents.length === 0 && (
              <div className="empty-row">No documents found.</div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function ChatView({ question, messages, loading, onQuestion, onAsk, onSummary, onClear, onUploadFiles, uploadStatus, recentUploads, chatFileInputRef, folderInputRef }) {
  return (
    <>
      <header className="page-header">
        <h1>Chat</h1>
        <p>Ask questions against your indexed codebase.</p>
      </header>

      <div className="content-stack">
        <section className="panel-card chat-card">
          <div className="assistant-hero">
            <div className="assistant-hero-icon">
              <Icon name="chat" />
            </div>
            <div>
              <h2>AI assistant ready</h2>
              <p>Ask questions about your uploaded files, images, and code with enterprise-grade semantic search.</p>
            </div>
          </div>

          <div className="chat-log">
            {messages.length === 0 ? (
              <div className="empty-row">Start a conversation with your RAG index.</div>
            ) : (
              messages.map((message, index) => (
                <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                  <span>{message.role === "user" ? "You" : "Assistant"}</span>
                  <p>{message.text}</p>
                </article>
              ))
            )}
            {loading && (
              <article className="message assistant">
                <span>Assistant</span>
                <p>Thinking...</p>
              </article>
            )}
          </div>

          <form className="chat-form" onSubmit={onAsk}>
            <input
              type="text"
              placeholder="Ask about your codebase..."
              value={question}
              onChange={(event) => onQuestion(event.target.value)}
            />
            <button className="primary-button" type="submit" disabled={loading || !question.trim()}>
              Send
            </button>
          </form>

          <div className="chat-actions">
            <button className="secondary-button" type="button" onClick={onSummary} disabled={loading}>
              Explain full codebase
            </button>
            <button className="secondary-button" type="button" onClick={onClear} disabled={loading}>
              Clear chat
            </button>
          </div>

          <div className="chat-upload-section">
            <div className="chat-upload-header">
              <h3>Upload Files</h3>
            </div>
            <div
              className="chat-drop-zone"
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                onUploadFiles(event.dataTransfer.files);
              }}
            >
              <div className="chat-drop-zone-content">
                <Icon name="upload" />
                <span>Drag files or </span>
              </div>
              <div className="chat-upload-actions">
                <button className="sidebar-upload-button" type="button" onClick={() => chatFileInputRef.current?.click()} disabled={loading}>
                  Browse
                </button>
                <button className="sidebar-upload-button secondary" type="button" onClick={() => folderInputRef.current?.click()} disabled={loading}>
                  Folder
                </button>
              </div>
            </div>
            <input
              ref={chatFileInputRef}
              className="hidden-input"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              onChange={(event) => onUploadFiles(event.target.files)}
            />
            <input
              ref={folderInputRef}
              className="hidden-input"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              webkitdirectory="true"
              directory=""
              onChange={(event) => onUploadFiles(event.target.files)}
            />
            {uploadStatus && <p className="sidebar-upload-status">{uploadStatus}</p>}
            {recentUploads.length > 0 && (
              <div className="chat-uploaded-info">
                <div className="chat-uploaded-label">Last uploaded:</div>
                <div className="chat-uploaded-list">
                  {recentUploads.map((name) => (
                    <a
                      key={name}
                      className="chat-uploaded-name"
                      href={`${API_URL}/documents/view/${encodeURIComponent(name)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {name}
                    </a>
                  ))}
                </div>
                <p className="chat-uploaded-by">Uploaded by: You</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function SettingsView({ settings, onSave }) {
  const [local, setLocal] = useState({
    chunk_size: settings?.chunk_size || 900,
    overlap: settings?.overlap || 50,
    retrieval_k: settings?.retrieval_k || 3,
  });

  useEffect(() => {
    setLocal({
      chunk_size: settings?.chunk_size || 900,
      overlap: settings?.overlap || 50,
      retrieval_k: settings?.retrieval_k || 3,
    });
  }, [settings]);

  return (
    <>
      <header className="page-header">
        <h1>Settings</h1>
        <p>Configure retrieval and processing preferences.</p>
      </header>

      <section className="panel-card settings-card">
        <div className="setting-row">
          <div>
            <h2>Chunk size</h2>
            <p>Default chunking behavior for uploaded sources (characters).</p>
          </div>
          <input
            type="number"
            min={64}
            value={local.chunk_size}
            onChange={(e) => setLocal((s) => ({ ...s, chunk_size: Number(e.target.value) }))}
          />
        </div>

        <div className="setting-row">
          <div>
            <h2>Chunk overlap</h2>
            <p>Number of characters to overlap between chunks.</p>
          </div>
          <input
            type="number"
            min={0}
            value={local.overlap}
            onChange={(e) => setLocal((s) => ({ ...s, overlap: Number(e.target.value) }))}
          />
        </div>

        <div className="setting-row">
          <div>
            <h2>Retrieval depth</h2>
            <p>Number of relevant chunks sent to the model (k).</p>
          </div>
          <input
            type="number"
            min={1}
            value={local.retrieval_k}
            onChange={(e) => setLocal((s) => ({ ...s, retrieval_k: Number(e.target.value) }))}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            className="primary-button"
            type="button"
            onClick={() => onSave(local)}
          >
            Save settings
          </button>
        </div>
      </section>
    </>
  );
}

function Icon({ name }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  const paths = {
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
        <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </>
    ),
    document: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6" />,
    chat: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z" />
      </>
    ),
    upload: <path d="M12 3v12M7 8l5-5 5 5M5 21h14" />,
    file: <path d="M14 2H7a2 2 0 0 0-2 2v16h14V7zM14 2v5h5" />,
    fileBlue: <path d="M14 2H7a2 2 0 0 0-2 2v16h14V7zM14 2v5h5" />,
    search: <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />,
    trash: <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" />,
    collapse: <path d="M15 18l-6-6 6-6" />,
    expand: <path d="M9 18l6-6-6-6" />,
  };

  return <svg {...common}>{paths[name]}</svg>;
}
