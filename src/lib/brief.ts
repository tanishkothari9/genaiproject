/**
 * brief.ts — Research brief generation with enforced citation traceability.
 *
 * generateBrief() composes the structured brief from the synthesized themes and
 * their underlying claims, requiring every assertion to carry an inline
 * [claimId] citation. validateCitations() then strips any [claimId] the model
 * invented, guaranteeing the project's core promise: no unsourced assertions.
 */

import { z } from "zod";
import type { Brief, BriefSection, Claim, ConsensusLabel, Theme } from "@/types";
import { generateJSON } from "@/lib/llm";

/** Match inline citations like [arxiv:2401.01234#c3]. */
const CITATION_RE = /\[([^\]\s]+#c\d+)\]/g;

/**
 * Remove citations referencing claim ids that don't exist. Returns the cleaned
 * text and the set of valid claim ids it actually cited.
 */
export function validateCitations(
  text: string,
  validIds: Set<string>
): { text: string; cited: Set<string> } {
  const cited = new Set<string>();
  const cleaned = text.replace(CITATION_RE, (match, id: string) => {
    if (validIds.has(id)) {
      cited.add(id);
      return match;
    }
    // Drop fabricated citation markers entirely.
    return "";
  });
  return { text: cleaned.replace(/\s{2,}/g, " ").trim(), cited };
}

// Models occasionally return an array of sentences where we asked for a string;
// coerce array → joined paragraph so the brief is robust across models.
// Accept a string or an array of sentences; asText() normalizes to a paragraph.
const flexText = z.union([z.string(), z.array(z.string())]);
const asText = (v: string | string[]): string => (Array.isArray(v) ? v.join(" ") : v);

const briefSchema = z.object({
  executiveSummary: flexText,
  findingsByTheme: z.array(
    z.object({
      theme: z.string(),
      consensus: z.enum(["agree", "conflict", "thin"]),
      content: flexText,
    })
  ),
  areasOfConsensus: flexText,
  openQuestions: flexText,
  recommendedNextPapers: z.array(z.string()),
});

/**
 * Generate a structured, citation-traceable brief.
 *
 * @param question  The research question driving the brief.
 * @param themes    Synthesized themes (with consensus labels).
 * @param claims    All claims across the selected papers (the citation pool).
 */
export async function generateBrief(
  question: string,
  themes: Theme[],
  claims: Claim[]
): Promise<Brief> {
  const validIds = new Set(claims.map((c) => c.id));

  const claimCatalog = claims
    .map((c) => `[${c.id}] (${c.paperTitle}, p.${c.page}, ${c.type}): ${c.text}`)
    .join("\n");

  const themeSummary = themes
    .map((t) => `- ${t.title} [consensus: ${t.consensus}] — claims: ${t.claimIds.join(", ")}`)
    .join("\n");

  const prompt = `You are writing a research brief answering this question:
"${question}"

You MUST ground every assertion in the claims below by appending the relevant claim id(s) in square brackets, e.g. "Transformers outperform RNNs on long sequences [arxiv:1706.03762#c2]." NEVER write a factual sentence without at least one [claimId]. NEVER invent a claim id that is not in the catalog. Do not use your own outside knowledge.

THEMES (from cross-source synthesis):
${themeSummary}

CLAIM CATALOG (the only facts you may cite):
${claimCatalog}

Return JSON with:
- "executiveSummary": 3-5 sentence overview, each claim-backed with [claimId]
- "findingsByTheme": array of { "theme": name, "consensus": "agree"|"conflict"|"thin", "content": 2-4 sentences with [claimId] citations }
- "areasOfConsensus": where sources agree, with [claimId] citations
- "openQuestions": unresolved questions / thin-evidence areas, citing [claimId] where relevant
- "recommendedNextPapers": array of 2-4 specific topics or directions to read next (strings, no citations needed)`;

  const draft = await generateJSON(prompt, briefSchema);

  // Enforce traceability across every prose field.
  const cited = new Set<string>();
  const clean = (text: string): string => {
    const result = validateCitations(text, validIds);
    result.cited.forEach((id) => cited.add(id));
    return result.text;
  };

  const findingsByTheme: BriefSection[] = draft.findingsByTheme.map((s) => ({
    theme: s.theme,
    consensus: s.consensus as ConsensusLabel,
    content: clean(asText(s.content)),
  }));

  const brief: Brief = {
    id: `brief-${Date.now()}`,
    question,
    paperIds: [...new Set(claims.map((c) => c.paperId))],
    executiveSummary: clean(asText(draft.executiveSummary)),
    findingsByTheme,
    areasOfConsensus: clean(asText(draft.areasOfConsensus)),
    openQuestions: clean(asText(draft.openQuestions)),
    recommendedNextPapers: draft.recommendedNextPapers,
    citedClaims: claims.filter((c) => cited.has(c.id)),
    generatedAt: new Date().toISOString(),
  };

  return brief;
}
