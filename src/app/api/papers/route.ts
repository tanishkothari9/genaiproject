/**
 * GET /api/papers — List ingested papers (with claim counts).
 * Returns: { papers: Array<{ paper, claimCount }> }
 */

import { NextResponse } from "next/server";
import { listPapers, getClaims } from "@/lib/store";

export async function GET() {
  try {
    const papers = await listPapers();
    const enriched = await Promise.all(
      papers.map(async (paper) => ({
        paper,
        claimCount: (await getClaims(paper.id)).length,
      }))
    );
    return NextResponse.json({ papers: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list papers.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
