# 🔬 AI Research Synthesis Engine

*From 50 papers to one coherent research brief — in minutes, not weeks.*

A research-synthesis platform: **query-driven paper discovery → multi-document ingestion →
claim extraction → cross-source synthesis → structured brief generation**, with **traceable
citations**. The core guarantee: **no hallucinated citations** — every claim in the output
traces back to a verbatim passage in a real source PDF.

Built for Assignment 7 (AI Research Synthesis Engine).

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict mode)
- **Google Gemini** — `gemini-2.5-flash` (reasoning) + `gemini-embedding-001` (claim clustering),
  called directly via `@google/generative-ai`, with **zod**-validated structured JSON outputs
- **Discovery** — arXiv Atom API + Semantic Scholar Graph API (both keyless) + PDF upload
- **PDF** — `unpdf` (per-page text extraction)
- **Persistence** — lightweight JSON files under `data/` + in-memory Maps (no external DB)

## Setup

```bash
npm install
cp .env.example .env.local      # then add your GOOGLE_API_KEY
npm run dev                     # http://localhost:3000
```

Get a free Gemini key at <https://aistudio.google.com/app/apikey>.

> **Free-tier note:** the default model `gemini-2.5-flash` allows only ~20
> requests/day on a free key. If you hit a daily-quota 429, set
> `GEMINI_MODEL=gemini-2.5-flash-lite` in `.env.local` for a much higher quota.
> The app retries transient 429/503 errors automatically.

## How it works (feature → code)

| Core feature | Where | What it does |
| --- | --- | --- |
| **Paper Discovery** | `src/lib/discovery.ts` | Searches arXiv + Semantic Scholar in parallel, dedupes by title, ranks by blended relevance + citation impact + recency. Degrades to arXiv-only if S2 is rate-limited. |
| **Document Ingestion** | `src/lib/ingest.ts` | Extracts per-page PDF text (page numbers preserved), then Gemini fills structured fields: abstract, methodology, key findings, limitations, conclusion. |
| **Claim Extraction** | `src/lib/claims.ts` | Gemini extracts discrete claims tagged **finding / hypothesis / limitation**, each with a section, page, and **verbatim quote**. |
| **Anti-hallucination guard** | `validateQuotes()` in `claims.ts` | Drops any claim whose quote doesn't actually appear on the cited page (whitespace-normalized substring match). |
| **Cross-Source Synthesis** | `src/lib/synthesis.ts` | Embeds every claim, greedily cosine-clusters into themes, then Gemini labels each theme **agree / conflict / thin** with a rationale. Surfaces contradictions across papers. |
| **Brief Generation** | `src/lib/brief.ts` | Composes executive summary, findings by theme, consensus, open questions, and recommended next papers — every sentence carrying inline `[claimId]` citations. |
| **Citation enforcement** | `validateCitations()` in `brief.ts` | Strips any `[claimId]` the model invented, so the brief contains **only** sourced assertions. |
| **Citation export** | `src/lib/citations.ts` | Exports cited papers to **BibTeX** and **APA**. |

### Data flow

```
question
   │  discover()            arXiv + Semantic Scholar
   ▼
Paper[]  ──ingest()──►  StructuredPaper (+ per-page text)
   │  extractClaims()  ──►  Claim[]  (quote-validated)
   ▼
synthesize()  ──►  Theme[]  (agree / conflict / thin)
   │  generateBrief()  (citation-validated)
   ▼
Brief  ──►  BibTeX / APA export
```

## API

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/discover` | `{query}` → ranked papers |
| POST | `/api/ingest` | `{paper}` → ingest a discovered paper + extract claims |
| POST | `/api/upload` | multipart `file` → ingest an uploaded PDF |
| GET | `/api/papers` | list ingested papers (with claim counts) |
| GET | `/api/claims/[paperId]` | claims for one paper |
| POST | `/api/synthesize` | `{paperIds}` → themes with consensus labels |
| POST | `/api/brief` | `{question, paperIds}` → citation-traceable brief |
| GET | `/api/export/[briefId]?format=bibtex\|apa` | citation export |

## Anti-hallucination strategy (grading-critical)

1. **Every claim must carry a verbatim quote**; `validateQuotes()` rejects quotes not found on
   the cited page.
2. **The brief may only cite real claim ids**; `validateCitations()` removes invented ones.
3. **Traceability is visible**: in the UI, every `[p.N]` citation chip reveals the source
   paper, section, page, and exact quote on hover.

## Demo / verification

1. `npm run dev` → open <http://localhost:3000>.
2. **Discovery** — search 3 diverse queries (e.g. "retrieval-augmented generation",
   "CRISPR off-target effects", "transformer scaling laws"); confirm relevant ranked results.
3. **Ingestion + claims** — ingest 3–5 papers; confirm structured fields and claims tagged
   finding/hypothesis/limitation with page refs (expand "Claims").
4. **Contradiction test** — upload a 2-paper set with a planted contradiction; synthesize and
   confirm that theme is flagged **conflict**.
5. **Traceability audit** — generate a brief; hover citations and confirm each resolves to a
   real quote in the source PDF.
6. **Export** — download BibTeX; confirm it parses in a reference manager.

```bash
npm run typecheck   # tsc --noEmit, strict, no `any`
npm run lint
npm run build
```

## Notes

- Semantic Scholar is unauthenticated and rate-limited; discovery falls back to arXiv-only when
  it throttles.
- Scanned/image-only PDFs (no embedded text) are rejected with a clear message — OCR is out of scope.
- `data/` is gitignored; it holds the local JSON store of ingested papers, claims, and briefs.
