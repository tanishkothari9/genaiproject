/**
 * claims.test.ts — validateQuotes() is the project's anti-hallucination guard:
 * it keeps only claims whose verbatim quote actually appears on the cited page.
 * These tests pin that behaviour (Success Metric: every claim traces to a real
 * source passage).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateQuotes } from "@/lib/claims";
import { makeClaim, SOURCE_PAGES } from "./fixtures/claims";

test("keeps a claim whose quote is verbatim on the cited page", () => {
  const claim = makeClaim({
    id: "p#c1",
    page: 1,
    quote: "Coffee consumption significantly improved short-term memory recall",
  });
  const kept = validateQuotes([claim], SOURCE_PAGES);
  assert.deepEqual(kept.map((c) => c.id), ["p#c1"]);
});

test("drops a claim whose quote is absent from the cited page (hallucinated)", () => {
  const claim = makeClaim({
    id: "p#c1",
    page: 1,
    quote: "Tea consumption tripled the lifespan of every participant",
  });
  assert.equal(validateQuotes([claim], SOURCE_PAGES).length, 0);
});

test("drops a claim citing a page that does not exist", () => {
  const claim = makeClaim({
    id: "p#c1",
    page: 99,
    quote: "Coffee consumption significantly improved short-term memory recall",
  });
  assert.equal(validateQuotes([claim], SOURCE_PAGES).length, 0);
});

test("drops a quote too short to be a meaningful anchor (< 8 chars)", () => {
  // "memory" does appear on page 1, but it is too short to anchor a citation.
  const claim = makeClaim({ id: "p#c1", page: 1, quote: "memory" });
  assert.equal(validateQuotes([claim], SOURCE_PAGES).length, 0);
});

test("matches tolerantly across whitespace/case differences", () => {
  const claim = makeClaim({
    id: "p#c1",
    page: 1,
    quote: "coffee   CONSUMPTION\n  significantly improved short-term memory recall",
  });
  assert.equal(validateQuotes([claim], SOURCE_PAGES).length, 1);
});

test("filters a mixed batch down to only the grounded claims", () => {
  const claims = [
    makeClaim({ id: "p#c1", page: 1, quote: "enrolled 120 participants over six weeks" }),
    makeClaim({ id: "p#c2", page: 1, quote: "this sentence is not anywhere in the source text" }),
    makeClaim({ id: "p#c3", page: 2, quote: "lack of a placebo control group" }),
  ];
  const kept = validateQuotes(claims, SOURCE_PAGES);
  assert.deepEqual(kept.map((c) => c.id), ["p#c1", "p#c3"]);
});
