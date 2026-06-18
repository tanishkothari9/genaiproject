/**
 * discovery.ts — Query-driven paper discovery.
 *
 * Searches arXiv (Atom API) and Semantic Scholar (Graph API) in parallel for a
 * research question, merges + de-duplicates the results, and ranks them with a
 * blended score (lexical relevance + citation impact + recency).
 *
 * Both APIs are keyless. Semantic Scholar is aggressively rate-limited, so a
 * failure there degrades gracefully to arXiv-only results.
 */

import type { Paper } from "@/types";

const ARXIV_ENDPOINT = "https://export.arxiv.org/api/query";
const S2_ENDPOINT = "https://api.semanticscholar.org/graph/v1/paper/search";
const REQUEST_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── arXiv ───────────────────────────────────────────────────────────────────

/** Decode the handful of XML entities that appear in arXiv Atom feeds. */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function matchAll(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out.push(m[1]);
  return out;
}

function matchOne(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? m[1] : null;
}

/**
 * Search arXiv. Returns papers in arXiv's native relevance order (we add our
 * own score later). Lightweight regex parsing of the Atom feed keeps deps zero.
 */
export async function searchArxiv(query: string, limit: number): Promise<Paper[]> {
  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: "0",
    max_results: String(limit),
    sortBy: "relevance",
    sortOrder: "descending",
  });

  const res = await fetchWithTimeout(`${ARXIV_ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`arXiv search failed: ${res.status}`);
  const xml = await res.text();

  const entries = matchAll(xml, "entry");
  return entries.map((entry): Paper => {
    const idUrl = decodeXml(matchOne(entry, "id") ?? "");
    // e.g. http://arxiv.org/abs/2401.01234v1 → 2401.01234
    const arxivId = idUrl.replace(/^.*\/abs\//, "").replace(/v\d+$/, "");
    const published = matchOne(entry, "published") ?? "";
    const year = published ? Number(published.slice(0, 4)) : null;

    const pdfMatch = /<link[^>]*title="pdf"[^>]*href="([^"]+)"/.exec(entry);

    return {
      id: `arxiv:${arxivId}`,
      title: decodeXml(matchOne(entry, "title") ?? "Untitled"),
      authors: matchAll(entry, "author").map((a) => decodeXml(matchOne(a, "name") ?? "")),
      year: Number.isFinite(year) ? year : null,
      abstract: decodeXml(matchOne(entry, "summary") ?? ""),
      pdfUrl: pdfMatch ? pdfMatch[1] : `https://arxiv.org/pdf/${arxivId}`,
      url: idUrl || `https://arxiv.org/abs/${arxivId}`,
      doi: null,
      citationCount: null,
      source: "arxiv",
    };
  });
}

// ─── Semantic Scholar ────────────────────────────────────────────────────────

interface S2Author {
  name?: string;
}
interface S2Paper {
  paperId: string;
  title?: string;
  abstract?: string | null;
  year?: number | null;
  authors?: S2Author[];
  citationCount?: number | null;
  externalIds?: { DOI?: string } | null;
  openAccessPdf?: { url?: string } | null;
  url?: string | null;
}

export async function searchSemanticScholar(query: string, limit: number): Promise<Paper[]> {
  const fields = "title,abstract,year,authors,citationCount,externalIds,openAccessPdf,url";
  const params = new URLSearchParams({ query, limit: String(limit), fields });

  const res = await fetchWithTimeout(`${S2_ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`Semantic Scholar search failed: ${res.status}`);
  const data = (await res.json()) as { data?: S2Paper[] };

  return (data.data ?? []).map((p): Paper => ({
    id: `s2:${p.paperId}`,
    title: p.title ?? "Untitled",
    authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    year: p.year ?? null,
    abstract: p.abstract ?? "",
    pdfUrl: p.openAccessPdf?.url ?? null,
    url: p.url ?? (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null),
    doi: p.externalIds?.DOI ?? null,
    citationCount: p.citationCount ?? null,
    source: "semantic-scholar",
  }));
}

// ─── Merge + Rank ────────────────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function lexicalRelevance(query: string, paper: Paper): number {
  const terms = new Set(
    query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  );
  if (terms.size === 0) return 0;
  const haystack = `${paper.title} ${paper.abstract}`.toLowerCase();
  let hits = 0;
  for (const term of terms) if (haystack.includes(term)) hits += 1;
  return hits / terms.size;
}

/**
 * Blended ranking score (0–1):
 *   60% lexical relevance + 25% citation impact (log-scaled) + 15% recency.
 * Papers with rich metadata (S2 citation counts, recent years) float up, but a
 * highly relevant arXiv preprint with no citation data still ranks well.
 */
function scorePaper(query: string, paper: Paper): number {
  const relevance = lexicalRelevance(query, paper);
  const citations = paper.citationCount ?? 0;
  const impact = Math.min(1, Math.log10(citations + 1) / 4); // ~10k cites → 1.0
  const currentYear = new Date().getFullYear();
  const recency = paper.year ? Math.max(0, 1 - (currentYear - paper.year) / 25) : 0.3;
  return 0.6 * relevance + 0.25 * impact + 0.15 * recency;
}

/**
 * Discover and rank papers for a research question across all sources.
 */
export async function discoverPapers(query: string, limit = 12): Promise<Paper[]> {
  const [arxivResult, s2Result] = await Promise.allSettled([
    searchArxiv(query, limit),
    searchSemanticScholar(query, limit),
  ]);

  const collected: Paper[] = [];
  if (arxivResult.status === "fulfilled") collected.push(...arxivResult.value);
  if (s2Result.status === "fulfilled") collected.push(...s2Result.value);

  // De-duplicate by normalized title, preferring the entry with citation data.
  const byTitle = new Map<string, Paper>();
  for (const paper of collected) {
    const key = normalizeTitle(paper.title);
    if (!key) continue;
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, paper);
    } else if ((paper.citationCount ?? -1) > (existing.citationCount ?? -1)) {
      // Keep richer metadata but preserve a usable PDF url from either source.
      byTitle.set(key, { ...paper, pdfUrl: paper.pdfUrl ?? existing.pdfUrl });
    }
  }

  return [...byTitle.values()]
    .map((paper) => ({ ...paper, score: scorePaper(query, paper) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}
