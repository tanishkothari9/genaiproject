/**
 * synthesis.test.ts — Cross-source synthesis.
 *
 * clusterClaims() is the deterministic core of contradiction detection: opposing
 * claims on the SAME topic must land in the SAME cluster so the LLM can compare
 * them and label the theme "conflict". These tests pin the clustering, plus a
 * live end-to-end check (skipped unless GOOGLE_API_KEY is set) asserting a
 * planted contradiction is actually labelled "conflict".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterClaims, synthesize } from "@/lib/synthesis";
import { CONTRADICTION_CLAIMS } from "./fixtures/claims";

/** A clustering result must be a partition of the input indices (each once). */
function assertPartition(clusters: number[][], n: number): void {
  const flat = clusters.flat().sort((a, b) => a - b);
  assert.deepEqual(flat, Array.from({ length: n }, (_, i) => i));
}

test("groups near-identical vectors into one cluster", () => {
  const clusters = clusterClaims([
    [1, 0, 0],
    [0.95, 0.05, 0],
  ]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].sort((a, b) => a - b), [0, 1]);
});

test("separates dissimilar (orthogonal) vectors into different clusters", () => {
  const clusters = clusterClaims([
    [1, 0, 0],
    [0, 0, 1],
  ]);
  assert.equal(clusters.length, 2);
});

test("co-clusters same-topic opposing claims, keeps an unrelated claim apart", () => {
  // Two same-topic vectors (the planted contradiction) + one unrelated vector.
  const contradictionA = [0.90, 0.10, 0.05];
  const contradictionB = [0.88, 0.12, 0.04];
  const unrelated = [0.02, 0.05, 0.99];

  const clusters = clusterClaims([contradictionA, contradictionB, unrelated]);
  assertPartition(clusters, 3);

  const topicCluster = clusters.find((c) => c.includes(0));
  assert.ok(topicCluster, "expected a cluster containing claim 0");
  assert.ok(
    topicCluster.includes(1),
    "opposing same-topic claims must co-cluster so the LLM can flag the conflict"
  );
  assert.ok(!topicCluster.includes(2), "the unrelated claim must not join the topic cluster");
});

test("clustering is a partition — every claim lands in exactly one cluster", () => {
  const vectors = [
    [1, 0, 0],
    [0.9, 0.1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 0.05, 0.99],
  ];
  assertPartition(clusterClaims(vectors), vectors.length);
});

// End-to-end: real embeddings + real LLM labelling. Skipped without an API key
// so `npm test` stays green offline; run with GOOGLE_API_KEY set to verify.
test(
  "planted contradiction is labelled 'conflict' (live, needs GOOGLE_API_KEY)",
  { skip: process.env.GOOGLE_API_KEY ? false : "GOOGLE_API_KEY not set" },
  async () => {
    const themes = await synthesize(CONTRADICTION_CLAIMS);
    assert.ok(themes.length >= 1, "expected at least one theme");

    const validIds = new Set(CONTRADICTION_CLAIMS.map((c) => c.id));
    for (const theme of themes) {
      for (const id of theme.claimIds) {
        assert.ok(validIds.has(id), `theme cited unknown claim id ${id}`);
      }
    }

    assert.ok(
      themes.some((t) => t.consensus === "conflict"),
      "the two opposing claims should produce a 'conflict' theme"
    );
  }
);
