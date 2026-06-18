/**
 * GET /api/export/[briefId]?format=bibtex|apa — Export a brief's citations.
 * Returns: text/plain citation export as a downloadable attachment.
 */

import { NextResponse } from "next/server";
import { exportBrief } from "@/lib/citations";
import { getBrief, listPapers } from "@/lib/store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ briefId: string }> }
) {
  try {
    const { briefId } = await params;
    const format = new URL(request.url).searchParams.get("format") === "apa" ? "apa" : "bibtex";

    const brief = await getBrief(decodeURIComponent(briefId));
    if (!brief) {
      return NextResponse.json({ error: "Brief not found." }, { status: 404 });
    }

    const papers = await listPapers();
    const body = exportBrief(brief, papers, format);
    const ext = format === "bibtex" ? "bib" : "txt";

    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${brief.id}.${ext}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
