/**
 * POST /api/discover — Query-driven paper discovery.
 * Body: { query: string }
 * Returns: { papers: Paper[] }
 */

import { NextResponse } from "next/server";
import { discoverPapers } from "@/lib/discovery";

export async function POST(request: Request) {
  try {
    const { query } = (await request.json()) as { query?: string };
    if (!query || !query.trim()) {
      return NextResponse.json({ error: "A 'query' is required." }, { status: 400 });
    }

    const papers = await discoverPapers(query.trim());
    return NextResponse.json({ papers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
