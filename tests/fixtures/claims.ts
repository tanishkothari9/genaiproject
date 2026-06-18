/**
 * Test fixtures — typed Claim builders and a planted-contradiction set.
 *
 * Kept under tests/fixtures/ (not *.test.ts) so the node:test runner does not
 * execute this module directly; it is imported by the test files.
 */

import type { Claim } from "@/types";

/** Build a Claim with sensible defaults; override any field per test. */
export function makeClaim(overrides: Partial<Claim> & Pick<Claim, "id">): Claim {
  return {
    paperId: "paper-x",
    paperTitle: "An Example Paper",
    text: "An example claim.",
    type: "finding",
    section: "Results",
    page: 1,
    quote: "an example claim verbatim quote",
    ...overrides,
  };
}

/**
 * Two source pages used to exercise validateQuotes. The grounded quotes below
 * appear verbatim on the cited page; the ungrounded ones do not.
 */
export const SOURCE_PAGES: string[] = [
  "Page one. The study enrolled 120 participants over six weeks. " +
    "Coffee consumption significantly improved short-term memory recall in the treatment group.",
  "Page two. A key limitation is the small sample size and the lack of a placebo control group.",
];

/**
 * A planted contradiction: two findings on the SAME topic that report opposing
 * results. Cross-source synthesis must (a) group them together and (b) label
 * the resulting theme "conflict".
 */
export const CONTRADICTION_CLAIMS: Claim[] = [
  makeClaim({
    id: "paper-a#c1",
    paperId: "paper-a",
    paperTitle: "Coffee and Memory: A Randomized Trial",
    text: "Coffee consumption significantly improves short-term memory recall.",
    quote: "Coffee consumption significantly improved short-term memory recall in the treatment group.",
  }),
  makeClaim({
    id: "paper-b#c1",
    paperId: "paper-b",
    paperTitle: "Caffeine and Cognition: A Null Result",
    text: "Coffee consumption has no measurable effect on short-term memory recall.",
    quote: "we found no measurable effect of coffee consumption on short-term memory recall.",
  }),
];
