/**
 * brief.test.ts — Citation traceability enforcement.
 *
 * validateCitations() strips any [claimId] the model invented, so the brief
 * contains ONLY sourced assertions (the project's headline guarantee). These
 * tests pin that, then verify the end-to-end invariant: after the generate-brief
 * cleaning step, 100% of the citations in a brief resolve to a real claim.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCitations } from "@/lib/brief";
import type { Brief, Claim } from "@/types";
import { CONTRADICTION_CLAIMS } from "./fixtures/claims";

// Same inline-citation pattern brief.ts and CitationText.tsx render with.
const CITATION_RE = /\[([^\]\s]+#c\d+)\]/g;

/** Every [claimId] across a brief's prose that does NOT resolve to a cited claim. */
function unresolvedCitations(brief: Brief): string[] {
  const valid = new Set(brief.citedClaims.map((c) => c.id));
  const prose = [
    brief.executiveSummary,
    brief.areasOfConsensus,
    brief.openQuestions,
    ...brief.findingsByTheme.map((s) => s.content),
  ].join("\n");

  const unresolved: string[] = [];
  for (const m of prose.matchAll(CITATION_RE)) {
    if (!valid.has(m[1])) unresolved.push(m[1]);
  }
  return unresolved;
}

test("validateCitations keeps real claim ids and records what was cited", () => {
  const valid = new Set(["paper-a#c1", "paper-b#c1"]);
  const text = "Coffee helps memory [paper-a#c1] but another study disagrees [paper-b#c1].";
  const { text: cleaned, cited } = validateCitations(text, valid);

  assert.equal(cleaned, text);
  assert.deepEqual([...cited].sort(), ["paper-a#c1", "paper-b#c1"]);
});

test("validateCitations strips fabricated claim ids and their markers", () => {
  const valid = new Set(["paper-a#c1"]);
  const text = "Grounded fact [paper-a#c1]. Invented fact [paper-z#c9].";
  const { text: cleaned, cited } = validateCitations(text, valid);

  assert.ok(!cleaned.includes("paper-z#c9"), "fabricated id must be removed");
  assert.ok(cleaned.includes("paper-a#c1"), "valid id must be preserved");
  assert.deepEqual([...cited], ["paper-a#c1"]);
});

test("validateCitations dedupes repeated citations into the cited set", () => {
  const valid = new Set(["paper-a#c1"]);
  const { cited } = validateCitations("[paper-a#c1] and again [paper-a#c1]", valid);
  assert.deepEqual([...cited], ["paper-a#c1"]);
});

test("a cleaned brief has zero unsourced citations (end-to-end invariant)", () => {
  const claims = CONTRADICTION_CLAIMS;
  const validIds = new Set(claims.map((c) => c.id));

  // Raw model output: real citations mixed with one fabricated id.
  const rawSummary =
    "Coffee improves recall [paper-a#c1], though one trial found no effect [paper-b#c1]. " +
    "A third study claimed harm [paper-q#c7].";

  // Mirror generateBrief()'s cleaning step.
  const cited = new Set<string>();
  const clean = (t: string): string => {
    const r = validateCitations(t, validIds);
    r.cited.forEach((id) => cited.add(id));
    return r.text;
  };

  const brief: Brief = {
    id: "brief-test",
    question: "Does coffee improve short-term memory?",
    paperIds: [...new Set(claims.map((c) => c.paperId))],
    executiveSummary: clean(rawSummary),
    findingsByTheme: [
      { theme: "Memory effects", consensus: "conflict", content: clean("Mixed evidence [paper-a#c1][paper-b#c1].") },
    ],
    areasOfConsensus: clean("Both studies measured short-term recall [paper-a#c1]."),
    openQuestions: clean("Dose-response remains unclear [paper-x#c2]."),
    recommendedNextPapers: ["Dose-response trials of caffeine on memory"],
    citedClaims: claims.filter((c) => cited.has(c.id)),
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  assert.deepEqual(unresolvedCitations(brief), [], "every citation must resolve to a real claim");
  // The fabricated ids must not have leaked into the cited claim set.
  assert.deepEqual(brief.citedClaims.map((c) => c.id).sort(), ["paper-a#c1", "paper-b#c1"]);
});

test("the unsourced-citation scanner has teeth (negative control)", () => {
  // An UNCLEANED brief that cites a claim absent from citedClaims must be caught.
  const onlyRealClaim: Claim[] = [CONTRADICTION_CLAIMS[0]];
  const brief: Brief = {
    id: "brief-bad",
    question: "q",
    paperIds: ["paper-a"],
    executiveSummary: "Real [paper-a#c1] but fabricated [paper-z#c9].",
    findingsByTheme: [],
    areasOfConsensus: "",
    openQuestions: "",
    recommendedNextPapers: [],
    citedClaims: onlyRealClaim,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  assert.deepEqual(unresolvedCitations(brief), ["paper-z#c9"]);
});
