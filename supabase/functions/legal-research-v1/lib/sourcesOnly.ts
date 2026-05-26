// =========================================================================
// sourcesOnly.ts — build the response payload for the "חיפוש מקורות" mode.
//
// Reuses the candidate pool + verifier output from legal-research-v1.
// Skips the drafter entirely. Produces a grouped + ranked source list
// suitable for the LegalSourceSearchPanel UI.
// =========================================================================

import type {
  Candidate,
  SourceRole,
  SupportLevel,
  UsableCandidate,
  Verdict,
} from "./types.ts";

export type SourcesOnlyOrigin = "local_db" | "perplexity";
export type SourcesOnlySupport = "direct" | "partial";

export interface SourceResult {
  rank: number;
  title: string;
  url: string | null;
  source_type: string;
  role: SourceRole;
  origin: SourcesOnlyOrigin;
  support: SourcesOnlySupport;
  role_match: boolean;
  reason: string;
  supported_claim_ids: string[];
  snippet: string | null;
  display_citation: string | null;
}

export type SourceGroupKey =
  | "primary_statute"
  | "binding_case_law"
  | "persuasive_case_law"
  | "scholarship"
  | "legislative_history"
  | "government_report"
  | "other";

export const SOURCE_GROUP_ORDER: SourceGroupKey[] = [
  "primary_statute",
  "binding_case_law",
  "persuasive_case_law",
  "scholarship",
  "legislative_history",
  "government_report",
  "other",
];

export interface SourcesOnlySummary {
  total_candidates: number;
  verified: number;
  usable: number;
  dropped: number;
  local_count: number;
  perplexity_count: number;
}

export interface SourcesOnlyPayload {
  mode: "sources_only";
  question: string;
  run_id: string;
  sources: SourceResult[];
  groups: Record<SourceGroupKey, SourceResult[]>;
  summary: SourcesOnlySummary;
}

function roleToGroup(role: SourceRole): SourceGroupKey {
  switch (role) {
    case "primary_statute":
    case "regulation":
      return "primary_statute";
    case "binding_case_law":
      return "binding_case_law";
    case "persuasive_case_law":
      return "persuasive_case_law";
    case "scholarship":
      return "scholarship";
    case "government_report":
      return "government_report";
    // Future / non-canonical fall through to "other".
    default:
      return "other";
  }
}

const SUPPORT_RANK: Record<SourcesOnlySupport, number> = { direct: 0, partial: 1 };

function pickBestVerdict(
  candidateId: string,
  verdicts: Verdict[],
): Verdict | null {
  const mine = verdicts.filter((v) => v.candidate_id === candidateId);
  if (mine.length === 0) return null;
  // Prefer direct, then partial; among equal-support prefer role_match=true
  // then longest reason.
  const order = { direct: 0, partial: 1, tangential: 2, unrelated: 3 } as Record<SupportLevel, number>;
  mine.sort((a, b) => {
    if (order[a.support] !== order[b.support]) return order[a.support] - order[b.support];
    if (a.role_match !== b.role_match) return a.role_match ? -1 : 1;
    return (b.reason?.length ?? 0) - (a.reason?.length ?? 0);
  });
  return mine[0] ?? null;
}

export interface BuildSourcesOnlyInput {
  question: string;
  run_id: string;
  candidates: Candidate[];
  usable: UsableCandidate[];
  verdicts: Verdict[];
  candidates_verified: number;
  candidates_usable: number;
  candidates_dropped: number;
}

export function buildSourcesOnlyPayload(input: BuildSourcesOnlyInput): SourcesOnlyPayload {
  const candById = new Map(input.candidates.map((c) => [c.candidate_id, c] as const));

  const all: SourceResult[] = [];
  for (const u of input.usable) {
    const cand = candById.get(u.candidate_id);
    if (!cand) continue;
    const support: SourcesOnlySupport =
      u.best_support === "direct" || u.best_support === "partial" ? u.best_support : "partial";

    const verdict = pickBestVerdict(u.candidate_id, input.verdicts);
    const reason = verdict?.reason?.trim() || "";

    const origin: SourcesOnlyOrigin = cand.origin === "perplexity" ? "perplexity" : "local_db";

    all.push({
      rank: 0,
      title: cand.title,
      url: cand.source_url ?? null,
      source_type: cand.source_type,
      role: cand.role,
      origin,
      support,
      role_match: u.role_match,
      reason,
      supported_claim_ids: u.verdict_claim_ids,
      snippet: cand.snippet ?? null,
      display_citation:
        (cand.metadata && typeof cand.metadata === "object"
          ? (cand.metadata as Record<string, unknown>).citation as string | undefined
          : undefined) ?? null,
    });
  }

  // Group, sort within group, then flatten in the canonical group order
  // assigning the global rank.
  const groups: Record<SourceGroupKey, SourceResult[]> = {
    primary_statute: [],
    binding_case_law: [],
    persuasive_case_law: [],
    scholarship: [],
    legislative_history: [],
    government_report: [],
    other: [],
  };

  for (const s of all) groups[roleToGroup(s.role)].push(s);

  const ORIGIN_RANK: Record<SourcesOnlyOrigin, number> = { local_db: 0, perplexity: 1 };
  for (const k of SOURCE_GROUP_ORDER) {
    groups[k].sort((a, b) => {
      if (SUPPORT_RANK[a.support] !== SUPPORT_RANK[b.support]) {
        return SUPPORT_RANK[a.support] - SUPPORT_RANK[b.support];
      }
      if (a.role_match !== b.role_match) return a.role_match ? -1 : 1;
      if (ORIGIN_RANK[a.origin] !== ORIGIN_RANK[b.origin]) {
        return ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
      }
      return 0;
    });
  }

  const sources: SourceResult[] = [];
  let r = 1;
  for (const k of SOURCE_GROUP_ORDER) {
    for (const s of groups[k]) {
      s.rank = r++;
      sources.push(s);
    }
  }

  let local_count = 0;
  let perplexity_count = 0;
  for (const s of sources) {
    if (s.origin === "local_db") local_count++;
    else perplexity_count++;
  }

  return {
    mode: "sources_only",
    question: input.question,
    run_id: input.run_id,
    sources,
    groups,
    summary: {
      total_candidates: input.candidates.length,
      verified: input.candidates_verified,
      usable: input.candidates_usable,
      dropped: input.candidates_dropped,
      local_count,
      perplexity_count,
    },
  };
}
