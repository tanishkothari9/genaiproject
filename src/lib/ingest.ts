/**
 * ingest.ts — Document ingestion.
 *
 *   1. extractPdfPages() — pull per-page text from a PDF (page numbers preserved
 *      so every downstream claim can cite an exact page).
 *   2. extractStructure() — use Gemini to fill the structured fields
 *      (abstract, methodology, key findings, limitations, conclusion).
 *   3. ingestPaper() — orchestrates fetch/parse/structure into a StructuredPaper.
 */

import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import type { Paper, PaperStructure, StructuredPaper } from "@/types";
import { generateJSON } from "@/lib/llm";

/** Cap how much text we send to the model (keeps latency/cost sane on long PDFs). */
const MAX_STRUCTURE_CHARS = 40_000;

/**
 * Extract text from a PDF, one string per page (index 0 === page 1).
 */
export async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  // unpdf returns string[] when mergePages is false.
  return Array.isArray(text) ? text : [text];
}

/** Fetch a PDF by URL and return its bytes. */
export async function fetchPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status}) from ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

const structureSchema = z.object({
  abstract: z.string(),
  methodology: z.string(),
  keyFindings: z.string(),
  limitations: z.string(),
  conclusion: z.string(),
});

/**
 * Extract structured fields from the paper's full text using Gemini.
 * Stays grounded: the model is told to summarize only what's present and to say
 * "Not stated" when a field is absent, rather than inventing content.
 */
export async function extractStructure(
  title: string,
  fullText: string
): Promise<PaperStructure> {
  const text = fullText.slice(0, MAX_STRUCTURE_CHARS);
  const prompt = `You are a research librarian extracting structured fields from an academic paper.

Paper title: ${title}

Summarize ONLY information present in the text below. If a field is not discussed, write "Not stated". Do not invent content.

Return JSON with exactly these string fields:
- "abstract": the paper's abstract or a 2-3 sentence summary of its aim
- "methodology": the methods/approach/experimental setup
- "keyFindings": the main results and findings
- "limitations": stated limitations, threats to validity, or caveats
- "conclusion": the authors' conclusions and implications

PAPER TEXT:
"""
${text}
"""`;

  return generateJSON(prompt, structureSchema);
}

/**
 * Full ingestion: parse PDF → structure → StructuredPaper.
 *
 * @param paper  Discovery/upload metadata for the paper.
 * @param pdf    The PDF bytes (already fetched or uploaded).
 */
export async function ingestPaper(paper: Paper, pdf: Uint8Array): Promise<StructuredPaper> {
  const pages = await extractPdfPages(pdf);
  const fullText = pages.join("\n\n");
  if (fullText.trim().length < 200) {
    throw new Error(
      "Could not extract readable text — this PDF looks scanned or image-only (OCR is out of scope)."
    );
  }

  const structure = await extractStructure(paper.title, fullText);

  return {
    ...paper,
    abstract: paper.abstract || structure.abstract,
    pages,
    structure,
    ingestedAt: new Date().toISOString(),
  };
}
