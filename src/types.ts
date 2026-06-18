/**
 * Shared domain types for the Research Synthesis Engine.
 *
 * The data flows: Paper (discovered) → StructuredPaper (ingested) → Claim[]
 * (extracted) → Theme[] (synthesized) → Brief (generated). Every Claim carries
 * a verbatim source quote so the final Brief stays fully traceable.
 */

/** A paper as returned by discovery (arXiv / Semantic Scholar) or registered from an upload. */
export interface Paper {
  /** Stable internal id (arXiv id, S2 id, or a generated upload id). */
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
  /** Direct PDF URL when known (arXiv); null for some sources / uploads. */
  pdfUrl: string | null;
  /** Canonical landing URL (arXiv abs page, DOI link, etc.). */
  url: string | null;
  doi: string | null;
  citationCount: number | null;
  source: "arxiv" | "semantic-scholar" | "upload";
  /** Relevance score assigned during ranking (0–1). Absent for uploads. */
  score?: number;
}

/** Structured fields extracted from a paper's full text during ingestion. */
export interface PaperStructure {
  abstract: string;
  methodology: string;
  keyFindings: string;
  limitations: string;
  conclusion: string;
}

/** A paper that has been ingested: metadata + per-page text + structured fields. */
export interface StructuredPaper extends Paper {
  /** Full text split per page; index 0 === page 1. */
  pages: string[];
  structure: PaperStructure;
  ingestedAt: string;
}

export type ClaimType = "finding" | "hypothesis" | "limitation";

/** A single factual claim extracted from a paper, anchored to a source passage. */
export interface Claim {
  id: string;
  paperId: string;
  /** The paper title, denormalized for convenient citation rendering. */
  paperTitle: string;
  /** A concise restatement of the claim. */
  text: string;
  type: ClaimType;
  /** Section the claim came from (e.g. "Results", "Discussion"). */
  section: string;
  /** 1-based page number the quote appears on. */
  page: number;
  /** Verbatim span from the source page that supports the claim. */
  quote: string;
}

export type ConsensusLabel = "agree" | "conflict" | "thin";

/** A cluster of related claims across papers with a consensus assessment. */
export interface Theme {
  id: string;
  title: string;
  consensus: ConsensusLabel;
  /** One-line rationale for the consensus label. */
  rationale: string;
  /** Member claim ids (each resolvable to a real source quote). */
  claimIds: string[];
}

/** One thematic section of the research brief. */
export interface BriefSection {
  theme: string;
  consensus: ConsensusLabel;
  /** Prose with inline [claimId] citations. */
  content: string;
}

/** The final structured research brief. */
export interface Brief {
  id: string;
  question: string;
  paperIds: string[];
  executiveSummary: string;
  findingsByTheme: BriefSection[];
  areasOfConsensus: string;
  openQuestions: string;
  recommendedNextPapers: string[];
  /** Claims referenced by the brief, kept for traceability + export. */
  citedClaims: Claim[];
  generatedAt: string;
}
