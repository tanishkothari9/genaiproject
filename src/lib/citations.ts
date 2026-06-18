/**
 * citations.ts — Citation export.
 *
 * Exports the papers backing a brief to standard citation formats (BibTeX, APA)
 * so the synthesis output can flow into a reference manager or paper.
 */

import type { Brief, Claim, StructuredPaper } from "@/types";

function bibKey(paper: StructuredPaper): string {
  const firstAuthor = (paper.authors[0] ?? "anon").split(/\s+/).pop() ?? "anon";
  const surname = firstAuthor.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${surname}${paper.year ?? "nd"}`;
}

/** Escape the few characters that are special in BibTeX field values. */
function bibEscape(text: string): string {
  return text.replace(/[{}]/g, "").replace(/&/g, "\\&");
}

export function toBibtex(papers: StructuredPaper[]): string {
  return papers
    .map((paper) => {
      const fields: string[] = [
        `  title = {${bibEscape(paper.title)}}`,
        `  author = {${paper.authors.map(bibEscape).join(" and ")}}`,
      ];
      if (paper.year) fields.push(`  year = {${paper.year}}`);
      if (paper.doi) fields.push(`  doi = {${paper.doi}}`);
      if (paper.url) fields.push(`  url = {${paper.url}}`);
      if (paper.source === "arxiv") {
        fields.push(`  archivePrefix = {arXiv}`);
        fields.push(`  eprint = {${paper.id.replace(/^arxiv:/, "")}}`);
      }
      const type = paper.source === "arxiv" ? "misc" : "article";
      return `@${type}{${bibKey(paper)},\n${fields.join(",\n")}\n}`;
    })
    .join("\n\n");
}

export function toApa(papers: StructuredPaper[]): string {
  return papers
    .map((paper) => {
      const authors = paper.authors.length
        ? paper.authors.join(", ")
        : "Unknown author";
      const year = paper.year ? `(${paper.year})` : "(n.d.)";
      const source =
        paper.source === "arxiv"
          ? `arXiv:${paper.id.replace(/^arxiv:/, "")}`
          : paper.doi
            ? `https://doi.org/${paper.doi}`
            : paper.url ?? "";
      return `${authors} ${year}. ${paper.title}. ${source}`.trim();
    })
    .join("\n\n");
}

/**
 * Build the citation export for a brief in the requested format. Only papers
 * actually cited by the brief are included.
 */
export function exportBrief(
  brief: Brief,
  papers: StructuredPaper[],
  format: "bibtex" | "apa"
): string {
  const citedPaperIds = new Set(brief.citedClaims.map((c: Claim) => c.paperId));
  const citedPapers = papers.filter((p) => citedPaperIds.has(p.id));
  const list = citedPapers.length > 0 ? citedPapers : papers;
  return format === "bibtex" ? toBibtex(list) : toApa(list);
}
