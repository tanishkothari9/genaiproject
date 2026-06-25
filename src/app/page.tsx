"use client";

/**
 * page.tsx — Single-page research-synthesis workflow.
 *
 * Steps, top to bottom:
 *   1. Discover papers for a research question (arXiv + Semantic Scholar)
 *   2. Ingest selected papers (or upload a PDF) → structured fields + claims
 *   3. Select an ingested set → cross-source synthesis (themes + consensus)
 *   4. Generate a citation-traceable research brief, export citations
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Brief, Claim, Paper, StructuredPaper, Theme } from "@/types";
import { CitationText } from "./components/CitationText";

interface IngestedEntry {
  paper: StructuredPaper;
  claimCount: number;
}

const PLACEHOLDERS = [
  "Search research papers...",
  "Compare findings across papers...",
  "Generate a citation-backed research brief...",
  "Find conflicting evidence...",
  "Analyze the latest RAG papers..."
];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

function getFriendlyErrorMessage(err: unknown): string {
  console.error("Detailed backend/provider error:", err);
  const message = err instanceof Error ? err.message : String(err);
  const msgLower = message.toLowerCase();

  if (msgLower.includes("api key") || msgLower.includes("google_api_key")) {
    return "AI service configuration is incomplete. Please contact the administrator.";
  }

  if (
    msgLower.includes("503") ||
    msgLower.includes("overload") ||
    msgLower.includes("quota") ||
    msgLower.includes("rate limit") ||
    msgLower.includes("busy") ||
    msgLower.includes("limit") ||
    msgLower.includes("googlegenerativeai") ||
    msgLower.includes("model unavailable")
  ) {
    return "AI service is temporarily busy. Please try again.";
  }

  if (
    msgLower.includes("fetch failed") ||
    msgLower.includes("network") ||
    msgLower.includes("unavailable") ||
    msgLower.includes("failed to reach") ||
    msgLower.includes("failed to fetch")
  ) {
    return "Research service is temporarily unavailable. Please check your network connection.";
  }

  if (msgLower.includes("pdf") || msgLower.includes("scanned") || msgLower.includes("readable text")) {
    return "Could not extract text from this PDF. It might be scanned or image-only.";
  }

  return "An unexpected error occurred while processing your request. Please try again.";
}

async function readProgressStream<T>(
  res: Response,
  onProgress: (progress: { percentage: number; statusText: string }) => void
): Promise<T> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body to read progress.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.type === "status") {
          onProgress({ percentage: chunk.percentage, statusText: chunk.text });
        } else if (chunk.type === "result") {
          result = chunk as T;
          onProgress({ percentage: 100, statusText: "Completed" });
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!result) {
    throw new Error("Stream closed without returning a result.");
  }
  return result;
}

export default function Home() {
  // Session ID state
  const [sessionId, setSessionId] = useState("");

  // Toast State
  const [toast, setToast] = useState<{ message: string; type: "error" | "info" | "success" } | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((message: string, type: "error" | "info" | "success" = "info") => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 4500);
  }, []);

  // History State
  const [history, setHistory] = useState<Brief[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Search Layout State
  const [hasSearched, setHasSearched] = useState(false);

  // Workflow Expansion States
  const [isLibraryExpanded, setIsLibraryExpanded] = useState(false);
  const [isSynthesisExpanded, setIsSynthesisExpanded] = useState(false);
  const [isBriefExpanded, setIsBriefExpanded] = useState(false);

  // Drag-and-drop state
  const [dragActive, setDragActive] = useState(false);

  // Section scroll focusing refs
  const discoverRef = useRef<HTMLElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const synthesisRef = useRef<HTMLElement>(null);
  const briefRef = useRef<HTMLElement>(null);

  const focusStage = (ref: React.RefObject<HTMLElement | null>) => {
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void upload(e.dataTransfer.files[0]);
    }
  };

  // Step 1 — Discovery
  const [query, setQuery] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [results, setResults] = useState<Paper[]>([]);

  // Step 2 — Ingestion
  const [ingestingIds, setIngestingIds] = useState<Set<string>>(new Set());
  const [ingested, setIngested] = useState<IngestedEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claimsByPaper, setClaimsByPaper] = useState<Map<string, Claim[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Progress states
  interface ProgressState {
    percentage: number;
    statusText: string;
  }
  const [progressMap, setProgressMap] = useState<Map<string, ProgressState>>(new Map());
  const [uploadProgress, setUploadProgress] = useState<ProgressState | null>(null);

  // Step 3 — Synthesis
  const [synthesizing, setSynthesizing] = useState(false);
  const [themes, setThemes] = useState<Theme[]>([]);

  // Step 4 — Brief
  const [question, setQuestion] = useState("");
  const [generating, setGenerating] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);

  // Rotating placeholder states
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholderFade, setPlaceholderFade] = useState(false);

  // Hydration mismatch guard state
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    // Generate unique session ID on client mount
    const sid = "session_" + Math.random().toString(36).substring(2, 15);
    setSessionId(sid);

    const interval = setInterval(() => {
      setPlaceholderFade(true);
      setTimeout(() => {
        setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDERS.length);
        setPlaceholderFade(false);
      }, 200);
    }, 3500);

    return () => {
      clearInterval(interval);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const refreshPapers = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      const res = await fetch(`/api/papers?sessionId=${encodeURIComponent(sid)}`);
      const data = (await res.json()) as { papers?: IngestedEntry[]; error?: string };
      setIngested(Array.isArray(data.papers) ? data.papers : []);
      if (!res.ok) showToast(data.error ?? "Failed to load ingested papers.", "error");
    } catch {
      setIngested([]);
      showToast("Failed to reach the server.", "error");
    }
  }, [showToast]);

  const refreshHistory = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      const res = await fetch(`/api/briefs?sessionId=${encodeURIComponent(sid)}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (e) {
      console.error("Failed to fetch history");
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void refreshPapers(sessionId);
    void refreshHistory(sessionId);
  }, [sessionId, refreshPapers, refreshHistory]);

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      showToast(getFriendlyErrorMessage(e), "error");
    }
  };


  // ── Step 1 ──
  const discover = () =>
    guard(async () => {
      if (!query.trim()) return;
      setHasSearched(true);
      setDiscovering(true);
      setResults([]);
      try {
        const data = await postJson<{ papers: Paper[] }>("/api/discover", { query });
        setResults(data.papers);
        focusStage(discoverRef);
      } finally {
        setDiscovering(false);
      }
    });

  // Handle suggestion prompt clicks
  const handleSuggestionClick = (promptText: string) => {
    guard(async () => {
      setQuery(promptText);
      setHasSearched(true);
      setDiscovering(true);
      setResults([]);
      try {
        const data = await postJson<{ papers: Paper[] }>("/api/discover", { query: promptText });
        setResults(data.papers);
        focusStage(discoverRef);
      } finally {
        setDiscovering(false);
      }
    });
  };

  // ── Step 2 ──
  const ingest = (paper: Paper) =>
    guard(async () => {
      setIngestingIds((s) => new Set(s).add(paper.id));
      setProgressMap((prev) => new Map(prev).set(paper.id, { percentage: 0, statusText: "Preparing..." }));
      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paper, sessionId }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Failed to ingest paper.");
        }

        await readProgressStream<{ paper: StructuredPaper; claims: Claim[] }>(res, (progress) => {
          setProgressMap((prev) => new Map(prev).set(paper.id, progress));
        });

        await refreshPapers(sessionId);
        setSelected((s) => new Set(s).add(paper.id));
        setIsLibraryExpanded(true);
        focusStage(libraryRef);

        setTimeout(() => {
          setProgressMap((prev) => {
            const next = new Map(prev);
            next.delete(paper.id);
            return next;
          });
        }, 1500);
      } catch (err) {
        setProgressMap((prev) => {
          const next = new Map(prev);
          next.delete(paper.id);
          return next;
        });
        throw err;
      } finally {
        setIngestingIds((s) => {
          const n = new Set(s);
          n.delete(paper.id);
          return n;
        });
      }
    });

  const upload = (file: File) =>
    guard(async () => {
      setUploading(true);
      setUploadProgress({ percentage: 0, statusText: "Starting upload..." });
      try {
        const form = new FormData();
        form.append("file", file);
        if (sessionId) form.append("sessionId", sessionId);

        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Upload failed.");
        }

        const result = await readProgressStream<{ paper: StructuredPaper; claims: Claim[] }>(res, (progress) => {
          setUploadProgress(progress);
        });

        await refreshPapers(sessionId);
        setSelected((s) => new Set(s).add(result.paper.id));
        setIsLibraryExpanded(true);
        focusStage(libraryRef);
        showToast(`"${file.name}" uploaded and ingested successfully.`, "success");

        setTimeout(() => {
          setUploadProgress(null);
        }, 1500);
      } catch (err) {
        setUploadProgress(null);
        throw err;
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    });

  const deletePaper = async (paperId: string) => {
    try {
      const res = await fetch(`/api/papers?id=${encodeURIComponent(paperId)}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete paper");
      }

      setIngested((prev) => prev.filter((e) => e.paper.id !== paperId));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(paperId);
        return next;
      });
      setClaimsByPaper((prev) => {
        const next = new Map(prev);
        next.delete(paperId);
        return next;
      });
      setThemes((prev) => {
        return prev
          .map((t) => {
            const paperClaims = claimsByPaper.get(paperId) ?? [];
            const isPaperClaim = (cid: string) => paperClaims.some((c) => c.id === cid) || cid.startsWith(paperId);
            return {
              ...t,
              claimIds: t.claimIds.filter((cid) => !isPaperClaim(cid))
            };
          })
          .filter((t) => t.claimIds.length > 0);
      });
      setBrief((prev) => {
        if (!prev) return null;
        if (!prev.paperIds.includes(paperId)) return prev;
        return {
          ...prev,
          paperIds: prev.paperIds.filter((pid) => pid !== paperId),
          citedClaims: prev.citedClaims.filter((c) => c.paperId !== paperId)
        };
      });
      void refreshHistory(sessionId);
      showToast("Document deleted successfully.", "success");
    } catch (err) {
      showToast(getFriendlyErrorMessage(err), "error");
    }
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleClaims = (paperId: string) =>
    guard(async () => {
      setExpanded((s) => {
        const n = new Set(s);
        if (n.has(paperId)) n.delete(paperId);
        else n.add(paperId);
        return n;
      });
      if (!claimsByPaper.has(paperId)) {
        const res = await fetch(`/api/claims/${encodeURIComponent(paperId)}`);
        const data = (await res.json()) as { claims: Claim[] };
        setClaimsByPaper((m) => new Map(m).set(paperId, data.claims));
      }
    });

  // ── Step 3 ──
  const selectedIds = useMemo(() => [...selected], [selected]);
  const synthesize = () =>
    guard(async () => {
      if (selectedIds.length === 0) return;
      setSynthesizing(true);
      setThemes([]);
      try {
        const data = await postJson<{ themes: Theme[] }>("/api/synthesize", {
          paperIds: selectedIds,
        });
        setThemes(data.themes);
        setIsSynthesisExpanded(true);
        focusStage(synthesisRef);
      } finally {
        setSynthesizing(false);
      }
    });

  // ── Step 4 ──
  const generate = () =>
    guard(async () => {
      if (!question.trim() || selectedIds.length === 0) return;
      setGenerating(true);
      setBrief(null);
      try {
        const data = await postJson<{ brief: Brief; themes: Theme[] }>("/api/brief", {
          question,
          paperIds: selectedIds,
          sessionId,
        });
        setBrief(data.brief);
        setThemes(data.themes);
        setIsBriefExpanded(true);
        focusStage(briefRef);
        void refreshHistory(sessionId);
      } finally {
        setGenerating(false);
      }
    });

  const claimsById = useMemo(() => {
    const m = new Map<string, Claim>();
    brief?.citedClaims.forEach((c) => m.set(c.id, c));
    return m;
  }, [brief]);

  const ingestedIds = useMemo(() => new Set(ingested.map((e) => e.paper.id)), [ingested]);

  return (
    <div className={`workspace-layout ${hasSearched ? "has-sidebar" : "no-sidebar"}`}>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />

      {/* Premium Toast Notification */}
      {toast && (
        <div className={`toast-notification ${toast.type}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {toast.type === "error" ? "⚠️" : toast.type === "success" ? "✓" : "ℹ️"}
            </span>
            <span className="toast-message">{toast.message}</span>
          </div>
          <button className="toast-close" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {/* 1. Left Sidebar (Hidden until first search) */}
      {hasSearched && (
        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="sidebar-logo">
              <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "var(--primary)", color: "#FFFFFF", display: "grid", placeItems: "center", fontSize: "16px", fontWeight: "700", fontFamily: "Inter, sans-serif", flexShrink: 0 }}>
                G
              </div>
              <span className="sidebar-logo-text">
                Grasp
                <span className="sidebar-logo-subtitle" style={{ display: "block" }}>Find truth. Back it up.</span>
              </span>
            </div>

            <button
              className="small new-study-btn"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
              onClick={() => {
                setQuery("");
                setResults([]);
                setBrief(null);
                setThemes([]);
                setSelected(new Set());
                setIsLibraryExpanded(ingested.length > 0);
                setIsSynthesisExpanded(false);
                setIsBriefExpanded(false);
              }}
            >
              <span>＋</span> New Study
            </button>

            {/* Collapsible Study History */}
            {history.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <button
                  className="ghost small history-toggle-btn"
                  onClick={() => setHistoryExpanded(!historyExpanded)}
                  style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span>🕒 Studies History</span>
                  <span style={{ fontSize: "11px" }}>{historyExpanded ? "▲" : "▼"}</span>
                </button>

                {historyExpanded && (
                  <div className="sidebar-history-box">
                    {history.map((h) => (
                      <div
                        key={h.id}
                        className={`sidebar-history-item ${brief?.id === h.id ? "active" : ""}`}
                        onClick={() => {
                          setBrief(h);
                          setQuestion(h.question);
                          setSelected(new Set(h.paperIds));
                          setIsLibraryExpanded(true);
                          setIsSynthesisExpanded(true);
                          setIsBriefExpanded(true);
                          focusStage(briefRef);
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: "12.5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.question}
                        </span>
                        <span style={{ fontSize: "10.5px", color: "var(--light-muted)" }}>
                          {h.paperIds.length} papers · {isMounted ? new Date(h.generatedAt).toLocaleDateString() : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="sidebar-bottom">
            <div className="sidebar-link">
              <span>⚙</span> Settings
            </div>
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">RS</div>
              <div className="sidebar-user-info">
                <span className="sidebar-user-name">Researcher</span>
                <span className="sidebar-user-email">researcher@example.com</span>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Main Canvas */}
      <main style={{ flex: 1, overflowY: "auto" }}>
        <div className="main-canvas">

          {/* Sticky Header with Pinned Search Card */}
          {hasSearched && (
            <header className="sticky-header animate-fade-in">
              <div className="search-card compact">
                <div className="search-input-wrapper">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    placeholder="Search another topic or ask a question..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && discover()}
                  />
                </div>
                <div className="search-buttons-row">
                  <button className="upload-action-btn button-press" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? <span className="spinner" /> : "＋ Upload"}
                  </button>
                  <button className="search-action-btn button-press" onClick={discover} disabled={discovering || !query.trim()}>
                    {discovering ? <span className="spinner" /> : "Search"}
                  </button>
                </div>
              </div>
            </header>
          )}

          {/* Landing Search Area (Homepage) */}
          {!hasSearched && (
            <section className="landing-hero animate-fade-in">
              <div className="logo-container">
                <div className="logo-circle">G</div>
                <h1 className="logo-title">Grasp</h1>
                <p className="logo-tagline">Find truth. Back it up.</p>
              </div>

              <div className="search-card">
                <div className="search-input-wrapper">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    className={placeholderFade ? "placeholder-fade" : ""}
                    placeholder={PLACEHOLDERS[placeholderIndex]}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && discover()}
                  />
                </div>
                <div className="search-buttons-row">
                  <button className="upload-action-btn button-press" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? <span className="spinner" /> : "＋ Upload"}
                  </button>
                  <button className="search-action-btn button-press" onClick={discover} disabled={discovering || !query.trim()}>
                    {discovering ? <span className="spinner" /> : "Search"}
                  </button>
                </div>
              </div>

              <div className="suggestions-row">
                <span>Try:</span>
                <button className="suggestion-chip button-press" onClick={() => handleSuggestionClick("RAG in LLMs")}>
                  RAG in LLMs
                </button>
                <button className="suggestion-chip button-press" onClick={() => handleSuggestionClick("Hallucination in AI")}>
                  Hallucination in AI
                </button>
                <button className="suggestion-chip button-press" onClick={() => handleSuggestionClick("Retrieval Augmented Generation")}>
                  Retrieval Augmented Generation
                </button>
              </div>
            </section>
          )}

          {/* Progressive Workflow Sections */}
          {hasSearched && (
            <div className="progressive-workflow">
              
              {/* Step 1 — Discover Papers */}
              <section ref={discoverRef} className="step animate-fade-in">
                <div className="step-header">
                  <h2>
                    <span className="num">1</span> Discover papers
                  </h2>
                  {results.length > 0 && (
                    <span className="step-badge ready">{results.length} found</span>
                  )}
                </div>

                <div className="step-content" style={{ marginTop: "16px" }}>
                  {discovering && results.length === 0 && (
                    <div className="skeletons-list">
                      {[1, 2, 3].map((i) => (
                        <div className="skeleton-paper-card" key={i}>
                          <div className="skeleton-shimmer" />
                          <div className="skeleton-title" />
                          <div className="skeleton-authors" />
                          <div className="skeleton-meta" />
                          <div className="skeleton-button" />
                        </div>
                      ))}
                    </div>
                  )}

                  {results.length > 0 && (
                    <div className="papers-list">
                      {results.map((p) => {
                        const isIngested = ingestedIds.has(p.id);
                        const progress = progressMap.get(p.id);
                        const busy = ingestingIds.has(p.id) || !!progress || uploading;

                        return (
                          <div className="paper-card" key={p.id}>
                            <h3 className="paper-title">{p.title}</h3>

                            <div className="paper-authors">
                              {p.authors.length > 0 ? p.authors.join(", ") : "Unknown authors"}
                            </div>

                            <div className="paper-meta-row">
                              <span className={`badge ${p.source}`}>{p.source}</span>
                              {p.year && <span>Year: {p.year}</span>}
                              {p.citationCount != null && <span>Citations: {p.citationCount}</span>}
                              {p.url && (
                                <a href={p.url} target="_blank" rel="noreferrer" className="paper-link">
                                  source ↗
                                </a>
                              )}
                            </div>

                            {progress ? (
                              <div className="progress-container">
                                <div className="progress-header">
                                  <span className="progress-status">
                                    {progress.percentage < 100 ? (
                                      <span className="spinner small-spinner" />
                                    ) : (
                                      <span className="success-check-icon">✓ </span>
                                    )}
                                    {progress.statusText}
                                  </span>
                                  <span className="progress-percent">{progress.percentage}%</span>
                                </div>
                                <div className="progress-bar-track">
                                  <div className="progress-bar-fill" style={{ width: `${progress.percentage}%` }} />
                                </div>
                              </div>
                            ) : (
                              <button
                                className="paper-action-btn button-press"
                                onClick={() => ingest(p)}
                                disabled={busy || isIngested || !p.pdfUrl}
                                style={{
                                  background: isIngested ? "rgba(61, 139, 98, 0.05)" : "var(--primary)",
                                  color: isIngested ? "var(--success)" : "#FFFFFF",
                                  border: isIngested ? "1px solid rgba(61, 139, 98, 0.15)" : "none"
                                }}
                              >
                                {isIngested ? (
                                  <>
                                    <span className="success-check-icon">✓</span> Ingested
                                  </>
                                ) : !p.pdfUrl ? (
                                  "PDF unavailable"
                                ) : (
                                  "Ingest"
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!discovering && results.length === 0 && (
                    <div className="empty-step-placeholder">
                      <span className="icon">🔍</span>
                      <p>Use the search bar above to query research sources.</p>
                    </div>
                  )}
                </div>
              </section>

              {/* Step 2 — Ingested Library */}
              <section ref={libraryRef} className={`step ${isLibraryExpanded ? "expanded" : "collapsed"} animate-fade-in`}>
                <div
                  className="step-header clickable"
                  onClick={() => setIsLibraryExpanded(!isLibraryExpanded)}
                >
                  <h2>
                    <span className="num">2</span> Ingested library
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span className={`step-badge ${ingested.length > 0 ? "ready" : "locked"}`}>
                      {ingested.length > 0 ? `${ingested.length} papers` : "Empty"}
                    </span>
                    <span className="expand-indicator">{isLibraryExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {isLibraryExpanded && (
                  <div className="step-content" style={{ marginTop: "16px" }}>
                    {ingested.length > 0 && <p className="hint">Select papers to synthesize:</p>}

                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {uploadProgress && (
                        <div className="ingested-uploading-card">
                          <div className="progress-container">
                            <div className="progress-header">
                              <span className="progress-status">
                                {uploadProgress.percentage < 100 ? (
                                  <span className="spinner small-spinner" />
                                ) : (
                                  <span className="success-check-icon">✓ </span>
                                )}
                                {uploadProgress.statusText}
                              </span>
                              <span className="progress-percent">{uploadProgress.percentage}%</span>
                            </div>
                            <div className="progress-bar-track">
                              <div className="progress-bar-fill" style={{ width: `${uploadProgress.percentage}%` }} />
                            </div>
                          </div>
                        </div>
                      )}

                      {ingested.map(({ paper, claimCount }) => (
                        <div key={paper.id} className="ingested-wrapper animate-fade-in">
                          <div className="ingested">
                            <input
                              type="checkbox"
                              checked={selected.has(paper.id)}
                              onChange={() => toggleSelect(paper.id)}
                              disabled={uploading}
                            />
                            <span className="t" onClick={() => !uploading && toggleSelect(paper.id)} style={{ cursor: "pointer" }}>
                              {paper.title}
                            </span>
                            <span className="c">{claimCount} claims</span>
                            <button className="ghost small claims-toggle-btn button-press" onClick={() => toggleClaims(paper.id)}>
                              {expanded.has(paper.id) ? "Hide" : "Claims"}
                            </button>
                            <button
                              className="ghost delete-paper-btn button-press"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deletePaper(paper.id);
                              }}
                              disabled={uploading}
                              title="Delete paper"
                            >
                              🗑️
                            </button>
                          </div>
                          {expanded.has(paper.id) && (
                            <div className="claims-expanded-draw">
                              {(claimsByPaper.get(paper.id) ?? []).map((c) => (
                                <div className={`claim ${c.type}`} key={c.id}>
                                  <div className="ctype">
                                    {c.type} · {c.section} · p.{c.page}
                                  </div>
                                  <div style={{ fontWeight: "600", fontSize: "14px", marginTop: "2px" }}>{c.text}</div>
                                  <div className="quote">“{c.quote}”</div>
                                </div>
                              ))}
                              {(claimsByPaper.get(paper.id) ?? []).length === 0 && (
                                <p className="muted" style={{ paddingLeft: "8px", fontSize: "13px" }}>No grounded claims extracted.</p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Drag-and-drop upload zone */}
                    <div
                      className={`upload-dropzone ${dragActive ? "drag-active" : ""} ${uploading ? "uploading" : ""} button-press`}
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      onClick={() => !uploading && fileRef.current?.click()}
                      style={{ marginTop: "12px" }}
                    >
                      {uploading ? (
                        <div className="upload-progress-overlay">
                          <span className="spinner large-spinner" />
                          <span className="upload-status-text">{uploadProgress?.statusText || "Uploading PDF..."}</span>
                          <span className="upload-percent">{uploadProgress?.percentage || 0}%</span>
                        </div>
                      ) : (
                        <div className="dropzone-content">
                          <span className="upload-icon">📥</span>
                          <span className="dropzone-text">Drag & drop your research PDF here, or <strong>browse</strong></span>
                          <span className="dropzone-sub">Supports academic PDFs up to 50MB</span>
                        </div>
                      )}
                    </div>

                    {ingested.length > 0 && (
                      <div style={{ marginTop: "20px", paddingTop: "20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                        <button className="button-press primary-btn" onClick={synthesize} disabled={synthesizing || selected.size === 0 || uploading}>
                          {synthesizing ? <span className="spinner" /> : null}
                          {synthesizing ? "Synthesizing…" : "Synthesize Papers"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Step 3 — Cross-source Synthesis */}
              <section ref={synthesisRef} className={`step ${isSynthesisExpanded ? "expanded" : "collapsed"} animate-fade-in`}>
                <div
                  className="step-header clickable"
                  onClick={() => selected.size > 0 && setIsSynthesisExpanded(!isSynthesisExpanded)}
                >
                  <h2>
                    <span className="num">3</span> Cross-source synthesis
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span className={`step-badge ${selected.size > 0 ? "ready" : "locked"}`}>
                      {selected.size > 0 ? `${selected.size} selected` : "Locked"}
                    </span>
                    <span className="expand-indicator">{isSynthesisExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {isSynthesisExpanded && (
                  <div className="step-content" style={{ marginTop: "16px" }}>
                    {selected.size === 0 ? (
                      <div className="empty-step-placeholder">
                        <span className="icon">🔒</span>
                        <p>Select one or more papers in the library above to unlock synthesis.</p>
                      </div>
                    ) : (
                      <>
                        <div className="legend">
                          <span className="agree">🟢 Agree</span>
                          <span className="conflict">🔴 Conflict</span>
                          <span className="thin">🟠 Weak Evidence</span>
                        </div>
                        <p className="hint">
                          Groups related claims across selected papers and flags agreement/conflicts.
                        </p>

                        {synthesizing && themes.length === 0 && (
                          <div className="skeletons-list">
                            {[1, 2].map((i) => (
                              <div className="skeleton-theme-card" key={i}>
                                <div className="skeleton-shimmer" />
                                <div className="skeleton-line skeleton-theme-title" />
                                <div className="skeleton-line skeleton-theme-text" />
                              </div>
                            ))}
                          </div>
                        )}

                        {themes.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
                            {themes.map((t) => (
                              <div className="theme" key={t.id}>
                                <div className="head">
                                  <strong style={{ fontSize: "15px" }}>{t.title}</strong>
                                  <span className={`consensus ${t.consensus}`}>{t.consensus === "thin" ? "Weak Evidence" : t.consensus}</span>
                                  <span className="muted" style={{ fontSize: "12px", marginLeft: "auto" }}>
                                    {t.claimIds.length} claims
                                  </span>
                                </div>
                                <div className="muted" style={{ fontSize: "13.5px", lineHeight: "1.5" }}>
                                  {t.rationale}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "12px" }}>
                          <input
                            type="text"
                            placeholder="Research question to answer in the brief…"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && generate()}
                            disabled={generating || themes.length === 0}
                          />
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button className="button-press primary-btn" onClick={generate} disabled={generating || selected.size === 0 || !question.trim()}>
                              {generating ? <span className="spinner" /> : null}
                              {generating ? "Generating..." : "Generate Research Brief"}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>

              {/* Step 4 — Research Brief */}
              <section ref={briefRef} className={`step ${isBriefExpanded ? "expanded" : "collapsed"} animate-fade-in`}>
                <div
                  className="step-header clickable"
                  onClick={() => themes.length > 0 && setIsBriefExpanded(!isBriefExpanded)}
                >
                  <h2>
                    <span className="num">4</span> Research brief
                  </h2>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span className={`step-badge ${themes.length > 0 ? "ready" : "locked"}`}>
                      {themes.length > 0 ? (brief ? "Generated" : "Ready") : "Locked"}
                    </span>
                    <span className="expand-indicator">{isBriefExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {isBriefExpanded && (
                  <div className="step-content" style={{ marginTop: "16px" }}>
                    {themes.length === 0 ? (
                      <div className="empty-step-placeholder">
                        <span className="icon">🔒</span>
                        <p>Complete cross-source synthesis in Step 3 to unlock brief generation.</p>
                      </div>
                    ) : (
                      <>
                        {generating && !brief && (
                          <div className="skeleton-brief-card">
                            <div className="skeleton-shimmer" />
                            <div className="skeleton-line skeleton-brief-title" />
                            <div className="skeleton-line skeleton-brief-para" />
                            <div className="skeleton-line skeleton-brief-para" />
                          </div>
                        )}

                        {brief && (
                          <div className="brief">
                            <div className="row" style={{ justifyContent: "flex-end", marginBottom: 16, gap: "8px", display: "flex" }}>
                              <a className="badge button-press" href={`/api/brief/${brief.id}/export?format=md`} download style={{ height: "30px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                                ⬇ Markdown
                              </a>
                              <a className="badge button-press" href={`/api/export/${brief.id}?format=bibtex`} style={{ height: "30px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                                ⬇ BibTeX
                              </a>
                              <a className="badge button-press" href={`/api/export/${brief.id}?format=apa`} style={{ height: "30px", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                                ⬇ APA
                              </a>
                            </div>

                            <h3>Executive summary</h3>
                            <p>
                              <CitationText text={brief.executiveSummary} claimsById={claimsById} />
                            </p>

                            <h3>Key findings by theme</h3>
                            {brief.findingsByTheme.map((s, i) => (
                              <p key={i}>
                                <strong>{s.theme}</strong>{" "}
                                <span className={`consensus ${s.consensus}`} style={{ marginLeft: "6px" }}>{s.consensus === "thin" ? "Weak Evidence" : s.consensus}</span>
                                <br />
                                <span style={{ display: "block", marginTop: "4px" }}>
                                  <CitationText text={s.content} claimsById={claimsById} />
                                </span>
                              </p>
                            ))}

                            <h3>Areas of consensus</h3>
                            <p>
                              <CitationText text={brief.areasOfConsensus} claimsById={claimsById} />
                            </p>

                            <h3>Open questions</h3>
                            <p>
                              <CitationText text={brief.openQuestions} claimsById={claimsById} />
                            </p>

                            <h3>Recommended next papers</h3>
                            <ul className="next">
                              {brief.recommendedNextPapers.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </section>

            </div>
          )}

          {/* Bottom Static Trust Section */}
          <footer className="bottom-trust-badge">
            <span>
              Research across dozens of papers with complete citation traceability.
            </span>
          </footer>

        </div>
      </main>
    </div>
  );
}
