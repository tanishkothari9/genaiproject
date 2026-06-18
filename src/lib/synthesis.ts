/**
 * synthesis.ts — Cross-source synthesis.
 *
 *   1. embedClaims()   — vectorize every claim's text
 *   2. clusterClaims() — greedy cosine clustering into thematic groups
 *   3. labelConsensus()— Gemini labels each cluster agree / conflict / thin and
 *                        names the theme, referencing member claim ids
 *
 * Grouping related claims across papers is what surfaces agreement, planted
 * contradictions, and thin evidence.
 */

import { z } from "zod";
import type { Claim, ConsensusLabel, Theme } from "@/types";
import { embed, generateJSON } from "@/lib/llm";

/**
 * Cosine-similarity threshold for adding a claim to an existing cluster.
 * Gemini `gemini-embedding-001` vectors sit at a high baseline similarity
 * (empirically: median ~0.69, p90 ~0.79 across distinct claims), so the
 * threshold is set near p90 to actually separate themes rather than collapse
 * everything into one cluster.
 */
const SIMILARITY_THRESHOLD = 0.8;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Embed claim texts; returns vectors aligned to the input order. */
export async function embedClaims(claims: Claim[]): Promise<number[][]> {
  return embed(claims.map((c) => c.text));
}

/**
 * Greedy single-pass clustering: each claim joins the existing cluster whose
 * centroid it is most similar to (above threshold), else it seeds a new one.
 * Returns clusters as arrays of claim indices.
 */
export function clusterClaims(vectors: number[][]): number[][] {
  const clusters: { centroid: number[]; members: number[] }[] = [];

  vectors.forEach((vec, idx) => {
    let best = -1;
    let bestSim = SIMILARITY_THRESHOLD;
    clusters.forEach((cluster, ci) => {
      const sim = cosine(vec, cluster.centroid);
      if (sim >= bestSim) {
        bestSim = sim;
        best = ci;
      }
    });

    if (best === -1) {
      clusters.push({ centroid: [...vec], members: [idx] });
    } else {
      const cluster = clusters[best];
      cluster.members.push(idx);
      // Update centroid as running mean.
      const n = cluster.members.length;
      cluster.centroid = cluster.centroid.map((v, i) => (v * (n - 1) + vec[i]) / n);
    }
  });

  return clusters.map((c) => c.members);
}

const labelsSchema = z.object({
  themes: z.array(
    z.object({
      index: z.number().int(),
      title: z.string(),
      consensus: z.enum(["agree", "conflict", "thin"]),
      rationale: z.string(),
    })
  ),
});

/**
 * Label every cluster in a single Gemini call. Each cluster's claims are listed
 * with their paper + id so the model can judge agreement vs. conflict and flag
 * single-paper / hypothesis-only groups as "thin". Batching keeps the whole
 * synthesis to one LLM request (important under free-tier rate limits).
 */
async function labelClusters(
  clusters: number[][],
  claims: Claim[]
): Promise<Map<number, Omit<Theme, "id" | "claimIds">>> {
  const blocks = clusters
    .map((memberIdxs, i) => {
      const members = memberIdxs.map((idx) => claims[idx]);
      const distinctPapers = new Set(members.map((c) => c.paperId)).size;
      const lines = members
        .map((c) => `  - [${c.id}] (${c.paperTitle} · ${c.type}): ${c.text}`)
        .join("\n");
      return `CLUSTER ${i} (${distinctPapers} distinct paper(s)):\n${lines}`;
    })
    .join("\n\n");

  const prompt = `You are synthesizing groups of related claims drawn from multiple research papers.

For EACH cluster below, assess the consensus among its claims:
- "agree": multiple papers report mutually consistent results
- "conflict": claims contradict or report opposing results
- "thin": evidence is weak — only one paper/source supports it, or the claims are merely hypotheses

Return JSON: { "themes": [ { "index": <cluster number>, "title": short theme name (3-7 words), "consensus": "agree"|"conflict"|"thin", "rationale": one sentence referencing claim ids in [brackets] } ] }
Include exactly one object per cluster, using its CLUSTER number as "index".

${blocks}`;

  const { themes } = await generateJSON(prompt, labelsSchema);
  return new Map(themes.map((t) => [t.index, t]));
}

/**
 * Full synthesis pipeline over a set of claims (typically from multiple papers).
 */
export async function synthesize(claims: Claim[]): Promise<Theme[]> {
  if (claims.length === 0) return [];

  const vectors = await embedClaims(claims);
  const clusters = clusterClaims(vectors);
  const labels = await labelClusters(clusters, claims);

  const themes: Theme[] = clusters.map((memberIdxs, i): Theme => {
    const members = memberIdxs.map((idx) => claims[idx]);
    const label = labels.get(i);
    return {
      id: `theme-${i + 1}`,
      title: label?.title ?? `Theme ${i + 1}`,
      consensus: (label?.consensus ?? "thin") as ConsensusLabel,
      rationale: label?.rationale ?? "Single-source or unlabeled group.",
      claimIds: members.map((c) => c.id),
    };
  });

  // Surface conflicts first, then agreements, then thin evidence.
  const order: Record<ConsensusLabel, number> = { conflict: 0, agree: 1, thin: 2 };
  return themes.sort((a, b) => order[a.consensus] - order[b.consensus]);
}
