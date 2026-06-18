/**
 * claims.ts — Claim extraction with citation traceability.
 *
 * For each paper, Gemini extracts discrete factual claims, each anchored to a
 * verbatim quote + page. validateQuotes() then enforces the project's core
 * guarantee — no hallucinated citations — by dropping any claim whose quote
 * does not actually appear on the cited page of the source PDF.
 */

import { z } from "zod";
import type { Claim, ClaimType, StructuredPaper } from "@/types";
import { generateJSON } from "@/lib/gemini";

/** How many leading characters of each page we expose to the model. */
const MAX_CHARS_PER_PAGE = 6_000;
/** Cap total pages sent (front matter + body usually holds the claims). */
const MAX_PAGES = 20;

const rawClaimSchema = z.object({
  text: z.string(),
  type: z.enum(["finding", "hypothesis", "limitation"]),
  section: z.string(),
  page: z.number().int().positive(),
  quote: z.string(),
});
const rawClaimsSchema = z.object({ claims: z.array(rawClaimSchema) });

/** Collapse whitespace + lowercase for tolerant substring matching. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Keep only claims whose verbatim quote is actually present on the cited page
 * (whitespace-normalized). This is the anti-hallucination guard: a claim the
 * model can't ground in real source text is discarded.
 */
export function validateQuotes(claims: Claim[], pages: string[]): Claim[] {
  const normalizedPages = pages.map(normalize);
  return claims.filter((claim) => {
    const pageText = normalizedPages[claim.page - 1];
    if (!pageText) return false;
    const quote = normalize(claim.quote);
    if (quote.length < 8) return false; // too short to be a meaningful anchor
    return pageText.includes(quote);
  });
}

/**
 * Extract grounded claims from an ingested paper.
 *
 * The model receives page-tagged text and must return a verbatim `quote` for
 * each claim; validateQuotes() removes anything it can't ground.
 */
export async function extractClaims(paper: StructuredPaper): Promise<Claim[]> {
  const pagesForPrompt = paper.pages
    .slice(0, MAX_PAGES)
    .map((text, i) => `--- PAGE ${i + 1} ---\n${text.slice(0, MAX_CHARS_PER_PAGE)}`)
    .join("\n\n");

  const prompt = `You are extracting factual claims from an academic paper for a citation-traceable research brief.

Paper title: ${paper.title}

Extract the most important discrete claims. For EACH claim provide:
- "text": a concise one-sentence restatement of the claim
- "type": one of "finding" (an empirical result/observation the paper reports), "hypothesis" (a proposed/expected relationship not yet proven), or "limitation" (a stated weakness, caveat, or threat to validity)
- "section": the section it appears in (e.g. "Abstract", "Results", "Discussion", "Limitations")
- "page": the integer page number where the supporting quote appears (use the PAGE markers below)
- "quote": a VERBATIM span (10-40 words) copied EXACTLY from that page that supports the claim

CRITICAL RULES:
- The "quote" MUST be copied word-for-word from the page text. Do not paraphrase, summarize, or fix typos in the quote.
- Only the "page" you assign must contain the exact "quote".
- Extract 6-15 claims covering findings, any hypotheses, and limitations.

Return JSON: { "claims": [ { "text", "type", "section", "page", "quote" }, ... ] }

PAGE-TAGGED PAPER TEXT:
"""
${pagesForPrompt}
"""`;

  const { claims: raw } = await generateJSON(prompt, rawClaimsSchema);

  const claims: Claim[] = raw.map((c, i) => ({
    id: `${paper.id}#c${i + 1}`,
    paperId: paper.id,
    paperTitle: paper.title,
    text: c.text,
    type: c.type as ClaimType,
    section: c.section,
    page: c.page,
    quote: c.quote,
  }));

  // Anti-hallucination guard, then re-id so ids stay contiguous after filtering.
  const validated = validateQuotes(claims, paper.pages);
  return validated.map((c, i) => ({ ...c, id: `${paper.id}#c${i + 1}` }));
}
