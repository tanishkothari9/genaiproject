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

  const refreshPapers = useCallback(async () => {
    const res = await fetch("/api/papers");
    const data = (await res.json()) as { papers: IngestedEntry[] };
    setIngested(data.papers);
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
    <div className="app">
      <header className="masthead">
        <h1>🔬 Research Synthesis Engine</h1>
        <p>
          From a research question to a citation-traceable brief — every claim
          links back to a real source passage.
        </p>
      </header>

      {error && <div className="step error">⚠ {error}</div>}

      {/* History View */}
      {history.length > 0 && (
        <section className="step">
          <h2>🕒 Past Briefs</h2>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: "10px" }}>
            {history.map((h) => (
              <div className="paper" key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="title">{h.question}</div>
                  <div className="meta">
                    <span>{new Date(h.generatedAt).toLocaleString()}</span>
                    <span>{h.paperIds.length} papers</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    className="small ghost"
                    onClick={() => {
                      setBrief(h);
                      setQuestion(h.question);
                    }}
                  >
                    Open
                  </button>
                  <a className="badge" href={`/api/brief/${h.id}/export?format=md`} download>
                    ⬇ Markdown
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}


      {/* Step 1 — Discover */}
      <section className="step">
        <h2>
          <span className="num">1</span> Discover papers
        </h2>
        <div className="row">
          <input
            type="text"
            placeholder="e.g. retrieval-augmented generation for factual accuracy"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && discover()}
          />
          <button onClick={discover} disabled={discovering || !query.trim()}>
            {discovering ? <span className="spinner" /> : null}
            {discovering ? "Searching…" : "Search"}
          </button>
        </div>

        {!discovering && query && results.length === 0 && (
          <p className="muted" style={{ marginTop: 12 }}>
            No papers found. Try another search query.
          </p>
        )}

        {results.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {results.map((p) => {
              const isIngested = ingestedIds.has(p.id);
              const busy = ingestingIds.has(p.id);
              return (
                <div className="paper" key={p.id}>
                  <div className="title">{p.title}</div>
                  <div className="meta">
                    <span className={`badge ${p.source}`}>{p.source}</span>
                    {p.year && <span>{p.year}</span>}
                    {p.citationCount != null && <span>{p.citationCount} citations</span>}
                    {p.authors.length > 0 && <span>{p.authors.slice(0, 3).join(", ")}</span>}
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noreferrer">
                        source ↗
                      </a>
                    )}
                  </div>
                  <button
                    className="small"
                    onClick={() => ingest(p)}
                    disabled={busy || isIngested || !p.pdfUrl}
                  >
                    {busy ? (
                      <>
                        <span className="spinner" />
                        Ingesting…
                      </>
                    ) : isIngested ? (
                      "✓ Ingested"
                    ) : !p.pdfUrl ? (
                      "No open PDF"
                    ) : (
                      "Ingest"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Step 2 — Ingested library */}
      <section className="step">
        <h2>
          <span className="num">2</span> Ingested library
        </h2>
        <p className="hint">
          Upload a PDF, or ingest from search above. Select papers to synthesize.
        </p>
        <div className="row" style={{ marginBottom: 14 }}>
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
            {uploading ? "Ingesting PDF…" : "Upload PDF"}
          </button>
        </div>

        {ingested.length === 0 ? (
          <p className="muted">No papers ingested yet.</p>
        ) : (
          ingested.map(({ paper, claimCount }) => (
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
                <div style={{ padding: "4px 0 10px 28px" }}>
                  {(claimsByPaper.get(paper.id) ?? []).map((c) => (
                    <div className={`claim ${c.type}`} key={c.id}>
                      <span className="ctype">
                        {c.type} · {c.section} · p.{c.page}
                      </span>
                      <div>{c.text}</div>
                      <div className="quote">“{c.quote}”</div>
                    </div>
                  ))}
                  {(claimsByPaper.get(paper.id) ?? []).length === 0 && (
                    <p className="muted">No grounded claims extracted.</p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {/* Step 3 — Synthesis */}
      <section className="step">
        <h2>
          <span className="num">3</span> Cross-source synthesis
        </h2>
        <div className="legend">
          <span className="agree">🟢 Agree</span>
          <span className="conflict">🔴 Conflict</span>
          <span className="thin">🟠 Thin Evidence</span>
       </div>
        <p className="hint">
          Groups related claims across the {selected.size} selected paper(s) and flags where they
          agree, conflict, or rest on thin evidence.
        </p>
        <button onClick={synthesize} disabled={synthesizing || selected.size === 0}>
          {synthesizing ? <span className="spinner" /> : null}
          {synthesizing ? "Synthesizing…" : "Synthesize"}
        </button>

        {!synthesizing && themes.length === 0 && (
          <p className="muted" style={{ marginTop: 12 }}>
            No synthesis generated yet.
         </p>
        )}

        {themes.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {themes.map((t) => (
              <div className="theme" key={t.id}>
                <div className="head">
                  <strong>{t.title}</strong>
                  <span className={`consensus ${t.consensus}`}>{t.consensus}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {t.claimIds.length} claims
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 13.5 }}>
                  {t.rationale}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Step 4 — Brief */}
      <section className="step">
        <h2>
          <span className="num">4</span> Research brief
        </h2>
        <div className="row">
          <input
            type="text"
            placeholder="Research question to answer in the brief…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
          />
          <button onClick={generate} disabled={generating || selected.size === 0 || !question.trim()}>
            {generating ? <span className="spinner" /> : null}
            {generating ? "Generating…" : "Generate brief"}
          </button>
        </div>

        {!generating && !brief && (
          <p className="muted" style={{ marginTop: 12 }}>
             No research brief generated yet.
          </p>
        )}
 
        {brief && (
          <div className="brief" style={{ marginTop: 18 }}>
            <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
              {/* Add this new Markdown link here: */}
              <a className="badge" href={`/api/brief/${brief.id}/export?format=md`} download>
                ⬇ Markdown
              </a>
              {/* Keep your existing links below: */}
              <a className="badge" href={`/api/export/${brief.id}?format=bibtex`}>
                ⬇ BibTeX
              </a>
              <a className="badge" href={`/api/export/${brief.id}?format=apa`}>
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
                <span className={`consensus ${s.consensus}`}>{s.consensus}</span>
                <br />
                <CitationText text={s.content} claimsById={claimsById} />
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

            <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
              Every citation above resolves to a verbatim quote from a source PDF. Hover a{" "}
              <span className="cite">[p.N]</span> marker to see the paper, section, page, and exact
              passage.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
