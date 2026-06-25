/**
 * GET /api/papers — List ingested papers (with claim counts).
 * Returns: { papers: Array<{ paper, claimCount }> }
 */

import { NextResponse } from "next/server";
import { listPapers, getClaims, deletePaper } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId") || undefined;
    const papers = await listPapers(sessionId);
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

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "A paper 'id' is required to delete." }, { status: 400 });
    }
    await deletePaper(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete paper.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
