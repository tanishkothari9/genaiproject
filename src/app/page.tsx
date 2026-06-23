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

export default function Home() {
  const [error, setError] = useState<string | null>(null);
  // History State
  const [history, setHistory] = useState<Brief[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);

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
    const interval = setInterval(() => {
      setPlaceholderFade(true);
      setTimeout(() => {
        setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDERS.length);
        setPlaceholderFade(false);
      }, 200);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const refreshPapers = useCallback(async () => {
    try {
      const res = await fetch("/api/papers");
      const data = (await res.json()) as { papers?: IngestedEntry[]; error?: string };
      setIngested(Array.isArray(data.papers) ? data.papers : []);
      if (!res.ok) setError(data.error ?? "Failed to load ingested papers.");
    } catch {
      setIngested([]);
      setError("Failed to reach the server.");
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/briefs");
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (e) {
      console.error("Failed to fetch history");
    }
  }, []);

  useEffect(() => {
    void refreshPapers();
    void refreshHistory();
  }, [refreshPapers, refreshHistory]);

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  // ── Step 1 ──
  const discover = () =>
    guard(async () => {
      if (!query.trim()) return;
      setDiscovering(true);
      try {
        const data = await postJson<{ papers: Paper[] }>("/api/discover", { query });
        setResults(data.papers);
      } finally {
        setDiscovering(false);
      }
    });

  // Handle suggestion prompt clicks
  const handleSuggestionClick = (promptText: string) => {
    guard(async () => {
      setQuery(promptText);
      setDiscovering(true);
      try {
        const data = await postJson<{ papers: Paper[] }>("/api/discover", { query: promptText });
        setResults(data.papers);
      } finally {
        setDiscovering(false);
      }
    });
  };

  // ── Step 2 ──
  const ingest = (paper: Paper) =>
    guard(async () => {
      setIngestingIds((s) => new Set(s).add(paper.id));
      try {
        await postJson<{ paper: StructuredPaper; claims: Claim[] }>("/api/ingest", { paper });
        await refreshPapers();
        setSelected((s) => new Set(s).add(paper.id));
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
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        await refreshPapers();
        setSelected((s) => new Set(s).add(data.paper.id));
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    });

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
        });
        setBrief(data.brief);
        setThemes(data.themes);
        void refreshHistory();
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
    <div className="workspace-layout">
      
      {/* 1. Left Sidebar Redesign (Extremely Minimalist) */}
      <aside className="sidebar">
        <div className="sidebar-top">
          {/* Circular "G" logo mark placeholder only */}
          <div className="sidebar-logo">
            <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "var(--primary)", color: "#FFFFFF", display: "grid", placeItems: "center", fontSize: "16px", fontWeight: "700", fontFamily: "Inter, sans-serif", flexShrink: 0 }}>
              G
            </div>
            <span className="sidebar-logo-text">
              Grasp
              <span className="sidebar-logo-subtitle" style={{ display: "block" }}>Find truth. Back it up.</span>
            </span>
          </div>

          {/* New study action */}
          <button
            className="small"
            style={{ width: "100%", background: "var(--primary-dim)", border: "1px solid rgba(47, 111, 94, 0.15)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            onClick={() => {
              setQuery("");
              setResults([]);
              setBrief(null);
              setError(null);
            }}
          >
            <span>＋</span> New Study
          </button>

          {/* Collapsible Study History (Only visible if history exists) */}
          {history.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <button
                className="ghost small"
                onClick={() => setHistoryExpanded(!historyExpanded)}
                style={{ width: "100%", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px" }}
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
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: "12.5px", color: brief?.id === h.id ? "var(--primary)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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

        {/* Sidebar settings & user profile block */}
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

      {/* Main Canvas - right column */}
      <main style={{ flex: 1, overflowY: "auto" }}>
        <div className="main-canvas">
          
          {/* Actionable Dismissible Alert box */}
          {error && (
            <div className="dismissible-alert">
              <div className="alert-content">
                <span className="alert-icon">⚠</span>
                <span>{error}</span>
              </div>
              <button className="alert-close-btn" onClick={() => setError(null)}>✕</button>
            </div>
          )}

          {/* Landing Search Area (Only shows initially when no search run) */}
          {(!discovering && results.length === 0) && (
            <section className="landing-hero">
              {/* Geometric circular G mark */}
              <div className="logo-circle" style={{ width: "36px", height: "36px", fontSize: "16px" }}>
                G
              </div>

              {/* Perplexity-style search box (Height 60px) */}
              <div className="search-box">
                <span style={{ color: "var(--muted)" }}>🔍</span>
                <input
                  type="text"
                  className={placeholderFade ? "placeholder-fade" : ""}
                  placeholder={PLACEHOLDERS[placeholderIndex]}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && discover()}
                />
                <button onClick={discover} disabled={discovering || !query.trim()}>
                  {discovering ? <span className="spinner" /> : null}
                  {discovering ? "Searching…" : "Search"}
                </button>
              </div>

              {/* Suggested example tags */}
              <div className="suggestions-row">
                <span>Try:</span>
                <button className="suggestion-chip" onClick={() => handleSuggestionClick("RAG in LLMs")}>
                  RAG in LLMs
                </button>
                <button className="suggestion-chip" onClick={() => handleSuggestionClick("Hallucination in AI")}>
                  Hallucination in AI
                </button>
                <button className="suggestion-chip" onClick={() => handleSuggestionClick("Retrieval Augmented Generation")}>
                  Retrieval Augmented Generation
                </button>
              </div>
            </section>
          )}

          {/* Progressively Disclosed Workflow Sections */}

          {/* Step 1 — Discover Papers (appears after search initiated) */}
          {(discovering || results.length > 0) && (
            <section className="step">
              <h2>
                <span className="num">1</span> Discover papers
              </h2>

              {/* Inline query bar to refine searches */}
              {results.length > 0 && (
                <div className="search-box" style={{ marginBottom: "24px", maxWidth: "100%", height: "50px" }}>
                  <span style={{ color: "var(--muted)" }}>🔍</span>
                  <input
                    type="text"
                    placeholder="Search another topic..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && discover()}
                  />
                  <button onClick={discover} disabled={discovering || !query.trim()} style={{ height: "100%" }}>
                    {discovering ? <span className="spinner" /> : null}
                    {discovering ? "Searching…" : "Search"}
                  </button>
                </div>
              )}

              {/* Premium Research Cards list */}
              <div>
                {results.map((p) => {
                  const isIngested = ingestedIds.has(p.id);
                  const busy = ingestingIds.has(p.id);
                  return (
                    <div className="paper" key={p.id}>
                      {/* Large Title */}
                      <h3 className="paper-title">{p.title}</h3>
                      
                      {/* Authors secondary */}
                      <div className="paper-authors">
                        {p.authors.length > 0 ? p.authors.join(", ") : "Unknown authors"}
                      </div>
                      
                      {/* Metadata badges and year/citations */}
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

                      {/* PDF State Action button (loading spinner, disabled, success anims) */}
                      <button
                        className="paper-action-btn"
                        onClick={() => ingest(p)}
                        disabled={busy || isIngested || !p.pdfUrl}
                        style={{
                          background: isIngested ? "rgba(61, 139, 98, 0.05)" : "var(--primary)",
                          color: isIngested ? "var(--success)" : "#FFFFFF",
                          border: isIngested ? "1px solid rgba(61, 139, 98, 0.15)" : "none"
                        }}
                      >
                        {busy ? (
                          <>
                            <span className="spinner" />
                            Ingesting…
                          </>
                        ) : isIngested ? (
                          <>
                            <span className="success-check-icon">✓</span>
                            Ingested
                          </>
                        ) : !p.pdfUrl ? (
                          "PDF unavailable"
                        ) : (
                          "Ingest"
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Step 2 — Ingested Library (appears after ingesting papers) */}
          {ingested.length > 0 && (
            <section className="step">
              <h2>
                <span className="num">2</span> Ingested library
              </h2>
              <p className="hint">
                Select papers to synthesize or upload another PDF reference:
              </p>

              {/* Upload action selector */}
              <div style={{ marginBottom: "20px" }}>
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
                <button className="ghost small" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <span className="spinner" /> : "＋ "}
                  {uploading ? "Ingesting PDF..." : "Upload PDF"}
                </button>
              </div>

              {/* Library list check items */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {ingested.map(({ paper, claimCount }) => (
                  <div key={paper.id}>
                    <div className="ingested">
                      <input
                        type="checkbox"
                        checked={selected.has(paper.id)}
                        onChange={() => toggleSelect(paper.id)}
                      />
                      <span className="t">{paper.title}</span>
                      <span className="c">{claimCount} claims</span>
                      <button className="ghost small" onClick={() => toggleClaims(paper.id)}>
                        {expanded.has(paper.id) ? "Hide" : "Claims"}
                      </button>
                    </div>
                    {expanded.has(paper.id) && (
                      <div style={{ padding: "8px 0 12px 28px" }}>
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

              <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
                <button onClick={synthesize} disabled={synthesizing || selected.size === 0}>
                  {synthesizing ? <span className="spinner" /> : null}
                  {synthesizing ? "Synthesizing…" : "Synthesize Papers"}
                </button>
              </div>
            </section>
          )}

          {/* Step 3 — Cross-source Synthesis (appears after synthesis) */}
          {(synthesizing || themes.length > 0) && (
            <section className="step">
              <h2>
                <span className="num">3</span> Cross-source synthesis
              </h2>
              <div className="legend">
                <span className="agree">🟢 Agree</span>
                <span className="conflict">🔴 Conflict</span>
                <span className="thin">🟠 Weak Evidence</span>
              </div>
              <p className="hint">
                Groups related claims across selected papers and flags agreement/conflicts.
              </p>

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

              <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: "12px" }}>
                <input
                  type="text"
                  placeholder="Research question to answer in the brief…"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && generate()}
                />
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={generate} disabled={generating || selected.size === 0 || !question.trim()}>
                    {generating ? <span className="spinner" /> : null}
                    {generating ? "Generating..." : "Generate Research Brief"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Step 4 — Research Brief (appears finally) */}
          {(generating || brief !== null) && brief && (
            <section className="step">
              <h2>
                <span className="num">4</span> Research brief
              </h2>
              <div className="brief">
                <div className="row" style={{ justifyContent: "flex-end", marginBottom: 16, gap: "8px" }}>
                  <a className="badge" href={`/api/brief/${brief.id}/export?format=md`} download style={{ height: "30px", display: "inline-flex", alignItems: "center" }}>
                    ⬇ Markdown
                  </a>
                  <a className="badge" href={`/api/export/${brief.id}?format=bibtex`} style={{ height: "30px", display: "inline-flex", alignItems: "center" }}>
                    ⬇ BibTeX
                  </a>
                  <a className="badge" href={`/api/export/${brief.id}?format=apa`} style={{ height: "30px", display: "inline-flex", alignItems: "center" }}>
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
            </section>
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
