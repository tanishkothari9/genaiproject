/**
 * GET /api/claims/[paperId] — Claims extracted from a single paper.
 * Returns: { claims: Claim[] }
 */

import { NextResponse } from "next/server";
import { getClaims } from "@/lib/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    const { paperId } = await params;
    const claims = await getClaims(decodeURIComponent(paperId));
    return NextResponse.json({ claims });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load claims.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
