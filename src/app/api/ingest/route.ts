/**
 * POST /api/ingest — Ingest a discovered paper by URL.
 * Body: { paper: Paper }  (a discovery result, must include a pdfUrl)
 * Returns: { paper: StructuredPaper, claims: Claim[] }
 *
 * Fetches the PDF, extracts structured fields + grounded claims, and persists.
 */

import { NextResponse } from "next/server";
import type { Paper, StructuredPaper } from "@/types";
import { fetchPdf, extractPdfPages, extractStructure, createProgressStream } from "@/lib/ingest";
import { extractClaims } from "@/lib/claims";
import { savePaper, saveClaims } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const { paper, sessionId } = (await request.json()) as { paper?: Paper; sessionId?: string };
    if (!paper || !paper.id || !paper.title) {
      return NextResponse.json({ error: "A 'paper' object is required." }, { status: 400 });
    }
    if (!paper.pdfUrl) {
      return NextResponse.json(
        { error: "This paper has no open-access PDF to ingest. Try uploading the PDF instead." },
        { status: 400 }
      );
    }

    return createProgressStream(async (sendUpdate) => {
      await sendUpdate("fetching", "Fetching PDF from URL...", 10);
      const pdf = await fetchPdf(paper.pdfUrl!);

      await sendUpdate("parsing", "Extracting text from pages...", 30);
      const pages = await extractPdfPages(pdf);
      const fullText = pages.join("\n\n");
      if (fullText.trim().length < 200) {
        throw new Error(
          "Could not extract readable text — this PDF looks scanned or image-only (OCR is out of scope)."
        );
      }

      await sendUpdate("structuring", "Analyzing paper structure using Gemini...", 55);
      const structure = await extractStructure(paper.title, fullText);
      const structured: StructuredPaper = {
        ...paper,
        abstract: paper.abstract || structure.abstract,
        pages,
        structure,
        ingestedAt: new Date().toISOString(),
      };
      if (sessionId) {
        structured.sessionId = sessionId;
      }

      await sendUpdate("claims", "Extracting grounded claims using Gemini...", 75);
      const claims = await extractClaims(structured);

      await sendUpdate("saving", "Saving paper and claims...", 95);
      await savePaper(structured);
      await saveClaims(structured.id, claims);

      return { paper: structured, claims };
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : "Ingestion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
