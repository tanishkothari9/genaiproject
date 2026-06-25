/**
 * POST /api/upload — Ingest a locally uploaded PDF.
 * Body: multipart/form-data with field "file" (a PDF)
 * Returns: { paper: StructuredPaper, claims: Claim[] }
 */

import { NextResponse } from "next/server";
import type { Paper, StructuredPaper } from "@/types";
import { extractPdfPages, extractStructure, createProgressStream } from "@/lib/ingest";
import { extractClaims } from "@/lib/claims";
import { savePaper, saveClaims } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const sessionId = form.get("sessionId") as string | null;
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded under field 'file'." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
    }

    const title = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
    const paper: Paper = {
      id: `upload:${Date.now()}-${title.slice(0, 40).replace(/\s+/g, "_")}`,
      title: title || "Uploaded paper",
      authors: [],
      year: null,
      abstract: "",
      pdfUrl: null,
      url: null,
      doi: null,
      citationCount: null,
      source: "upload",
    };

    return createProgressStream(async (sendUpdate) => {
      await sendUpdate("reading", "Reading uploaded file bytes...", 15);
      const bytes = new Uint8Array(await file.arrayBuffer());

      await sendUpdate("parsing", "Extracting text from pages...", 30);
      const pages = await extractPdfPages(bytes);
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
    const message = err instanceof Error ? err.message : "Upload ingestion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
