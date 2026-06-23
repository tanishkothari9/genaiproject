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
    <div className="citation-overlay" onClick={onClose}>
      <div className="citation-panel" onClick={(e) => e.stopPropagation()}>
        <button
          className="ghost small"
          onClick={onClose}
          style={{ float: "right", border: "1px solid var(--border)", background: "transparent", borderRadius: "50%", width: "28px", height: "28px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", cursor: "pointer" }}
        >
          ✕
        </button>

        <h3 style={{ fontSize: "15px", marginTop: 0, marginBottom: "16px", color: "var(--text)", fontWeight: "700" }}>
          {claim.paperTitle}
        </h3>

        <div style={{ display: "flex", gap: "10px", fontSize: "12.5px", color: "var(--muted)", marginBottom: "16px", flexWrap: "wrap" }}>
          <span className="badge" style={{ borderColor: "var(--border)" }}>
            Section: {claim.section}
          </span>
          <span className="badge" style={{ color: "var(--primary)", borderColor: "rgba(47, 111, 94, 0.2)", background: "var(--primary-dim)" }}>
            Page {claim.page}
          </span>
        </div>

        <div className="quote-box">
          &ldquo;{claim.quote}&rdquo;
        </div>
      </div>
    </div>
  );
}