// Wrapper around `buildClaimMap` that maps the snake_case tool output
// to the camelCase contract `LegalClaimMap`. Adds:
//   - `statementMode` derived from `support_strength` + `allowed_to_state`
//   - `claimId` running sequence
//   - `uncoveredSubIssues` computed against decomposition

import type { ClaimMap, ClaimMapEntry } from "./decomposition.ts";
import type {
  LegalClaimMap,
  LegalClaimMapItem,
  LegalResearchDecomposition,
  LegalStatementMode,
} from "./contracts.ts";

function deriveStatementMode(entry: ClaimMapEntry): {
  mode: LegalStatementMode;
  extraNote?: string;
} {
  if (!entry.allowed_to_state) return { mode: "omit" };
  switch (entry.support_strength) {
    case "strong":
      return { mode: "direct" };
    case "partial":
      return { mode: "qualified" };
    case "weak":
      return { mode: "qualified", extraNote: "תמיכה חלשה — נסחו כחוסר ודאות" };
    default:
      return { mode: "qualified" };
  }
}

function mapEntry(entry: ClaimMapEntry, index: number): LegalClaimMapItem {
  const { mode, extraNote } = deriveStatementMode(entry);
  const baseNote = entry.notes?.trim() || "";
  const note = [baseNote, extraNote].filter(Boolean).join(" — ");
  return {
    claimId: `c-${index + 1}`,
    claimText: entry.claim,
    subIssue: entry.sub_issue,
    sourceIds: (entry.source_ids ?? []).map((n) => `src-${n}`),
    authorityLevel: entry.authority_level,
    confidence: entry.confidence,
    needsPinpoint: !!entry.needs_pinpoint,
    allowedToState: !!entry.allowed_to_state,
    statementMode: mode,
    notes: note || undefined,
  };
}

/** Map the raw claim map (snake_case) to the formal contract. */
export function mapToClaimMapV2(
  raw: ClaimMap,
  decomposition: LegalResearchDecomposition,
): LegalClaimMap {
  const claims = raw.map(mapEntry);
  const covered = new Set(claims.filter((c) => c.statementMode !== "omit").map((c) => c.subIssue));
  const uncoveredSubIssues = decomposition.subIssues.filter((s) => !covered.has(s));
  return { claims, uncoveredSubIssues };
}

export interface ClaimMapSummary {
  total: number;
  direct: number;
  qualified: number;
  omit: number;
  uncovered_sub_issues: string[];
}

export function summarizeClaimMapV2(cm: LegalClaimMap): ClaimMapSummary {
  let direct = 0;
  let qualified = 0;
  let omit = 0;
  for (const c of cm.claims) {
    if (c.statementMode === "direct") direct++;
    else if (c.statementMode === "qualified") qualified++;
    else omit++;
  }
  return {
    total: cm.claims.length,
    direct,
    qualified,
    omit,
    uncovered_sub_issues: cm.uncoveredSubIssues,
  };
}
