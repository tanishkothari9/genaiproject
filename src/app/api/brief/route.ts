/**
 * POST /api/brief — Generate a citation-traceable research brief.
 * Body: { question: string, paperIds: string[] }
 * Returns: { brief: Brief }
 *
 * Runs synthesis (if not provided) then composes the brief, validating that
 * every citation resolves to a real claim.
 */

import { NextResponse } from "next/server";
import { synthesize } from "@/lib/synthesis";
import { generateBrief } from "@/lib/brief";
import { getClaimsForPapers, saveBrief } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const { question, paperIds, sessionId } = (await request.json()) as {
      question?: string;
      paperIds?: string[];
      sessionId?: string;
    };
    if (!question || !question.trim()) {
      return NextResponse.json({ error: "A 'question' is required." }, { status: 400 });
    }
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
    const brief = await generateBrief(question.trim(), themes, claims);
    if (sessionId) {
      brief.sessionId = sessionId;
    }

    await saveBrief(brief);
    return NextResponse.json({ brief, themes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Brief generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
