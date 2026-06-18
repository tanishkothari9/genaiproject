/**
 * POST /api/upload — Ingest a locally uploaded PDF.
 * Body: multipart/form-data with field "file" (a PDF)
 * Returns: { paper: StructuredPaper, claims: Claim[] }
 */

import { NextResponse } from "next/server";
import type { Paper } from "@/types";
import { ingestPaper } from "@/lib/ingest";
import { extractClaims } from "@/lib/claims";
import { savePaper, saveClaims } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded under field 'file'." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // Seed metadata from the filename; the model fills the rest from the text.
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

    // Parse once: pdf.js transfers (neuters) the underlying ArrayBuffer on use,
    // so ingestPaper does the single PDF parse and raises a clear error for
    // scanned/image-only PDFs.
    const structured = await ingestPaper(paper, bytes);
    const claims = await extractClaims(structured);

    await savePaper(structured);
    await saveClaims(structured.id, claims);

    return NextResponse.json({ paper: structured, claims });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload ingestion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
