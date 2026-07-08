// Required legal anchors — Phase 2.
//
// A small, registry-based mechanism: when the claim analyzer identifies a
// disambiguation context (e.g. "מנדטורי" = Mandate-era ordinance), we
// deterministically inject one or more primary-source queries that the
// planner alone is not reliable enough to produce. These queries flow
// through retrieval and verifier like any other query, and we track each
// anchor's status through the pipeline so the drafter can caveat when an
// anchor is missing.

import type { AnalyzerOutput, Candidate, Query, SourceRole } from "../lib/types.ts";
import { detectDockets, type DocketRef } from "./docketDetection.ts";

export interface RequiredAnchor {
  anchor_id: string;
  trigger:
    | { kind: "interpretation_note"; pattern: RegExp }
    | { kind: "docket"; docket: DocketRef };
  anchor_type: SourceRole;
  description: string;          // short description for drafter caveat.
  suggested_queries: string[];  // Hebrew (+ optional English) — one Query per item.
  target: "local_db" | "perplexity" | "both";
  /**
   * Docket anchors have a much stricter satisfaction rule: only a candidate
   * whose title/snippet/url contains the exact docket (metadata.docket_match
   * === true) may satisfy the anchor. Adjacent / same-doctrine cases do not.
   */
  is_docket_anchor?: boolean;
  /** Full docket variants (for retrieval-side string matching). */
  docket_variants?: string[];
}

export interface RequiredAnchorStatus {
  anchor_id: string;
  description: string;
  anchor_type: SourceRole;
  is_docket_anchor: boolean;
  emitted: boolean;
  queries: string[];
  candidate_ids: string[];
  reached_verifier: boolean;
  verified_support: "direct" | "partial" | "tangential" | "unrelated" | "none";
  cited: boolean;
  status: "missing" | "retrieved_unverified" | "verified_unused" | "cited";
}

// Registry — single entry today. Add new entries freely.
const REGISTRY: RequiredAnchor[] = [
  {
    anchor_id: "mandate_continuity_s11",
    trigger: { kind: "interpretation_note", pattern: /מנדט|mandate|המנדט הבריטי/i },
    anchor_type: "primary_statute",
    description: 'סעיף 11 לפקודת סדרי השלטון והמשפט, תש"ח-1948 (נורמת ההמשכיות של חקיקה מתקופת המנדט)',
    suggested_queries: [
      'פקודת סדרי השלטון והמשפט, תש"ח-1948, סעיף 11',
      'סעיף 11 לפקודת סדרי השלטון והמשפט',
      "Law and Administration Ordinance 1948 section 11",
    ],
    target: "both",
  },
];

export function resolveRequiredAnchors(analyzer: AnalyzerOutput): RequiredAnchor[] {
  const note = (analyzer.interpretation_note ?? "").trim();
  if (!note) return [];
  const out: RequiredAnchor[] = [];
  for (const a of REGISTRY) {
    if (a.trigger.kind === "interpretation_note" && a.trigger.pattern.test(note)) {
      out.push(a);
    }
  }
  return out;
}

/**
 * Build docket-anchored-judgment anchors from a free-text source (the user's
 * question, typically). One anchor per unique docket. These flow through
 * exactly the same anchor plumbing as interpretation-note anchors.
 */
export function buildDocketAnchors(text: string): RequiredAnchor[] {
  const dockets = detectDockets(text);
  return dockets.map<RequiredAnchor>((d) => ({
    anchor_id: `docket:${d.docket_id}`,
    trigger: { kind: "docket", docket: d },
    anchor_type: "binding_case_law",
    description: `פסק הדין בעניין ${d.prefix_he} ${d.number} עצמו`,
    // Prefer Hebrew canonical + gershayim variants; append English + number-only for breadth.
    suggested_queries: uniqueOrdered([
      `${d.prefix_he} ${d.number}`,
      `${d.prefix_he.replace(/"/g, "״")} ${d.number}`,
      ...(d.prefix_en ? [`${d.prefix_en} ${d.number}`] : []),
      `${d.prefix_he} ${d.number.replace(/\//g, "-")}`,
    ]),
    target: "both",
    is_docket_anchor: true,
    docket_variants: d.variants,
  }));
}

function uniqueOrdered<T>(xs: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of xs) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

// Pick the original claim most appropriate to attach the anchor to, instead of
// inventing claim_id="REQ" which downstream stages don't expect.
function pickHostClaim(analyzer: AnalyzerOutput, anchor: RequiredAnchor): string {
  const claims = analyzer.claims || [];
  if (claims.length === 0) return "C1";
  // Prefer a claim that lists the anchor_type as a required_role.
  const exact = claims.find((c) => c.required_roles.includes(anchor.anchor_type));
  if (exact) return exact.claim_id;
  return claims[0].claim_id;
}

// Build queries to append to the planner output. Each query carries
// metadata.required_anchor_id so retrieval/verifier/drafter can identify
// anchor-originated candidates.
export function buildRequiredAnchorQueries(
  analyzer: AnalyzerOutput,
  anchors: RequiredAnchor[],
): Query[] {
  const out: Query[] = [];
  for (const a of anchors) {
    const claim_id = pickHostClaim(analyzer, a);
    for (const q of a.suggested_queries) {
      const targets: Query["targets"] = a.target === "both"
        ? ["local_db", "perplexity"]
        : [a.target];
      const expectedFromRole = a.anchor_type === "regulation"
        ? "regulation"
        : a.anchor_type === "primary_statute"
          ? "statute"
          : a.anchor_type === "binding_case_law" || a.anchor_type === "persuasive_case_law"
            ? "case"
            : a.anchor_type === "scholarship"
              ? "academic"
              : "report";
      out.push({
        claim_id,
        role: a.anchor_type,
        query_he: q,
        targets,
        expected_source_type: expectedFromRole,
        reason: `required_anchor:${a.anchor_id}`,
        // Non-schema metadata; downstream stages that propagate Query
        // unchanged (retrieval) preserve it for tracing.
        metadata: { required_anchor_id: a.anchor_id },
      } as Query & { metadata: Record<string, unknown> });
    }
  }
  return out;
}

// After retrieval/verifier/drafter, compute the status of each required anchor
// by inspecting candidates (tagged via metadata.required_anchor_id from the
// originating Query), verifier verdicts/usable, and the drafter's used set.
export function computeRequiredAnchorStatuses(args: {
  anchors: RequiredAnchor[];
  candidates: Candidate[];
  usableIds: Set<string>;
  verdicts: Array<{ candidate_id: string; support: string }>;
  usedCandidateIds: Set<string>;
}): RequiredAnchorStatus[] {
  const { anchors, candidates, usableIds, verdicts, usedCandidateIds } = args;
  const supportRank: Record<string, number> = {
    direct: 4, partial: 3, tangential: 2, unrelated: 1, none: 0,
  };
  return anchors.map((a) => {
    const anchorCands = candidates.filter((c) =>
      ((c.metadata as Record<string, unknown> | undefined)?.required_anchor_id as string | undefined)
        === a.anchor_id ||
      // Backup: anchor queries we appended have a recognizable reason via query_he matches.
      a.suggested_queries.includes(c.query_he)
    );
    const candidate_ids = anchorCands.map((c) => c.candidate_id);
    const reached_verifier = anchorCands.some((c) => usableIds.has(c.candidate_id));
    let verified_support: RequiredAnchorStatus["verified_support"] = "none";
    for (const c of anchorCands) {
      const v = verdicts.filter((v) => v.candidate_id === c.candidate_id);
      for (const verdict of v) {
        if ((supportRank[verdict.support] ?? 0) > (supportRank[verified_support] ?? 0)) {
          verified_support = verdict.support as RequiredAnchorStatus["verified_support"];
        }
      }
    }
    const cited = anchorCands.some((c) => usedCandidateIds.has(c.candidate_id));
    let status: RequiredAnchorStatus["status"];
    if (cited) status = "cited";
    else if (reached_verifier) status = "verified_unused";
    else if (anchorCands.length > 0) status = "retrieved_unverified";
    else status = "missing";

    return {
      anchor_id: a.anchor_id,
      description: a.description,
      anchor_type: a.anchor_type,
      emitted: true,
      queries: a.suggested_queries,
      candidate_ids,
      reached_verifier,
      verified_support,
      cited,
      status,
    };
  });
}

// Returns the subset of anchors that did not reach the verifier or were
// otherwise not effectively supported — for the drafter caveat.
export function pickMissingAnchors(statuses: RequiredAnchorStatus[]): RequiredAnchorStatus[] {
  return statuses.filter((s) => s.status === "missing" || s.status === "retrieved_unverified");
}
