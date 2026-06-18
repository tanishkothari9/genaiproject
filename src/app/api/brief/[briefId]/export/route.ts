import { NextResponse } from "next/server";
import { getBrief } from "@/lib/store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ briefId: string }> }
) {
  try {
    // Next.js 15 requires us to await the params first
    const resolvedParams = await params;
    const brief = await getBrief(resolvedParams.briefId);
    
    if (!brief) {
      return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    if (url.searchParams.get("format") !== "md") {
      return NextResponse.json({ error: "Use ?format=md" }, { status: 400 });
    }

    const renderCitations = (text: string) => {
      return text.replace(/\[([^\]]+)\]/g, (match, claimId) => {
        const claim = brief.citedClaims.find(c => c.id === claimId);
        return claim ? `(${claim.paperTitle}, p. ${claim.page})` : match;
      });
    };

    let md = `# Research Brief: ${brief.question}\n\n`;
    md += `*Generated at: ${new Date(brief.generatedAt).toLocaleString()}*\n\n`;
    
    md += `## Executive Summary\n${renderCitations(brief.executiveSummary)}\n\n`;
    
    md += `## Findings by Theme\n`;
    brief.findingsByTheme.forEach(section => {
      md += `### ${section.theme} (Consensus: ${section.consensus})\n`;
      md += `${renderCitations(section.content)}\n\n`;
    });

    md += `## Areas of Consensus\n${renderCitations(brief.areasOfConsensus)}\n\n`;
    md += `## Open Questions\n${renderCitations(brief.openQuestions)}\n\n`;

    if (brief.recommendedNextPapers.length > 0) {
       md += `## Recommended Next Papers\n`;
       brief.recommendedNextPapers.forEach(p => md += `- ${p}\n`);
    }

    return new NextResponse(md, {
      headers: {
        "Content-Type": "text/markdown",
        "Content-Disposition": `attachment; filename="brief-${brief.id}.md"`,
      },
    });

  } catch (error) {
     return NextResponse.json({ error: "Failed to export brief" }, { status: 500 });
  }
}