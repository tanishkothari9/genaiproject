"use client";

/**
 * CitationText — renders prose containing inline [claimId] markers, replacing
 * each with a hoverable chip that reveals the source paper, page, and verbatim
 * quote. This is what makes the brief's traceability visible to a reviewer.
 */

import type { Claim } from "@/types";
import { useState } from "react";
import CitationPanel from "./CitationPanel";

const CITATION_RE = /\[([^\]\s]+#c\d+)\]/g;

interface Props {
  text: string;
  claimsById: Map<string, Claim>;
}

export function CitationText({ text, claimsById }: Props) {
  const [selectedClaim, setSelectedClaim] =
  useState<Claim | null>(null);
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    const [full, id] = match;
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const claim = claimsById.get(id);
    if (claim) {
      
      parts.push(
        <sup
          key={`c${key++}`}
          className="cite"
          onClick={() => setSelectedClaim(claim)}
        >
          p.{claim.page}
        </sup>
      );
    } else {
      // Should not happen post-validation, but render harmlessly if it does.
      parts.push(full);
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return (
  <>
    <span>{parts}</span>

    <CitationPanel
      claim={selectedClaim}
      onClose={() =>
        setSelectedClaim(null)
      }
    />
  </>
);
}
