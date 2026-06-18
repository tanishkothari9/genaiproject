/**
 * POST /api/synthesize — Cross-source synthesis over selected papers.
 * Body: { paperIds: string[] }
 * Returns: { themes: Theme[], claims: Claim[] }
 */

import { NextResponse } from "next/server";
import { synthesize } from "@/lib/synthesis";
import { getClaimsForPapers } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const { paperIds } = (await request.json()) as { paperIds?: string[] };
    if (!Array.isArray(paperIds) || paperIds.length === 0) {
      return NextResponse.json({ error: "A non-empty 'paperIds' array is required." }, { status: 400 });
    }

    const claims = await getClaimsForPapers(paperIds);
    if (claims.length === 0) {
      return NextResponse.json(
        { error: "No claims found for the selected papers. Ingest them first." },
        { status: 400 }
      );
    }

    const themes = await synthesize(claims);
    return NextResponse.json({ themes, claims });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Synthesis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
