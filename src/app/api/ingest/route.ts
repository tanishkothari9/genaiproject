/**
 * POST /api/ingest — Ingest a discovered paper by URL.
 * Body: { paper: Paper }  (a discovery result, must include a pdfUrl)
 * Returns: { paper: StructuredPaper, claims: Claim[] }
 *
 * Fetches the PDF, extracts structured fields + grounded claims, and persists.
 */

import { NextResponse } from "next/server";
import type { Paper } from "@/types";
import { fetchPdf, ingestPaper } from "@/lib/ingest";
import { extractClaims } from "@/lib/claims";
import { savePaper, saveClaims } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const { paper } = (await request.json()) as { paper?: Paper };
    if (!paper || !paper.id || !paper.title) {
      return NextResponse.json({ error: "A 'paper' object is required." }, { status: 400 });
    }
    if (!paper.pdfUrl) {
      return NextResponse.json(
        { error: "This paper has no open-access PDF to ingest. Try uploading the PDF instead." },
        { status: 400 }
      );
    }

    const pdf = await fetchPdf(paper.pdfUrl);
    const structured = await ingestPaper(paper, pdf);
    const claims = await extractClaims(structured);

    await savePaper(structured);
    await saveClaims(structured.id, claims);

    return NextResponse.json({ paper: structured, claims });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingestion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
