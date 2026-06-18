"use client";

import type { Claim } from "@/types";

interface Props {
  claim: Claim | null;
  onClose: () => void;
}

export default function CitationPanel({
  claim,
  onClose,
}: Props) {
  if (!claim) return null;

  return (
    <div className="citation-overlay">
      <div className="citation-panel">
        <button
          className="ghost small"
          onClick={onClose}
          style={{ float: "right" }}
        >
          ✕
        </button>

        <h3>{claim.paperTitle}</h3>

        <p>
          <strong>Section:</strong> {claim.section}
        </p>

        <p>
          <strong>Page:</strong> {claim.page}
        </p>

        <div className="quote-box">
           &ldquo;{claim.quote}&rdquo;
        </div>
      </div>
    </div>
  );
}