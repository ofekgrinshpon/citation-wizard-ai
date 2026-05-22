// Research Core v1 — Deliverable 4: Ledger.
//
// Distills the verifier's per-claim verdicts into a clean, drafter-ready
// evidence ledger. Rules:
//   * Keep only direct + partial verdicts. Drop tangential/unrelated.
//   * Status: ≥1 direct → supported; 0 direct + ≥1 partial → hedged;
//             else → unsupported (dropped from entries).
//   * Dedup within a claim by document_id or normalized URL.
//   * On duplicate keys, prefer primary legal sources over secondary
//     commentary, then exact_authority > approved_web > local_text >
//     local_vector, then direct > partial, then longer snippet.
//   * Unresolved authorities are REPORTED only and never materialize as
//     ledger sources (sources come from verified candidates only).
//   * Origin is preserved verbatim on every source.

import type {
  AuthorityId,
  CandidateOrigin,
  ClaimId,
  Ledger,
  LedgerEntry,
  LedgerInvariants,
  LedgerResult,
  LedgerSource,
  LedgerSourceId,
  LedgerStatus,
  LedgerTotals,
  PlanV1,
  Support,
} from "./types.ts";
import type { AnnotatedVerdict, VerifyResult } from "./verifier.ts";
import type { AuthorityResolution } from "./retrieval.ts";

// ─── Constants ────────────────────────────────────────────────────────────

const ORIGIN_RANK: Record<CandidateOrigin, number> = {
  exact_authority: 0,
  approved_web: 1,
  local_text: 2,
  local_vector: 3,
};

const SUPPORT_RANK: Record<"direct" | "partial", number> = {
  direct: 0,
  partial: 1,
};

// Hosts that host primary legal materials (caselaw/legislation/regulations).
const PRIMARY_HOSTS = [
  "nevo.co.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
  "reshumot.gov.il",
  "fs.knesset.gov.il",
  "main.knesset.gov.il",
  "knesset.gov.il",
  "justice.gov.il",
];

const DOCKET_RE = /(?:ע["״]?א|רע["״]?א|בג["״]?ץ|בש["״]?א|דנ["״]?א|דנג["״]?ץ|ע["״]?פ|רע["״]?פ|עע["״]?מ|עפ["״]?א|תפ|פ|ה?פ)\s*\d{1,5}[\/-]\d{2,4}/;
const LEGISLATION_RE = /(?:^|\s)(?:חוק|פקודה|תקנות|חוק-יסוד|חוק יסוד|צו|הוראת|כללי)\b/;
const PRIMARY_SOURCE_TYPES = new Set([
  "caselaw",
  "statute",
  "legislation",
  "regulation",
  "treaty",
  "case_law_database",
  "published_caselaw",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────

function hostOf(url?: string): string {
  if (!url) return "";
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function isPrimaryHost(host: string): boolean {
  if (!host) return false;
  for (const h of PRIMARY_HOSTS) {
    if (host === h || host.endsWith("." + h)) return true;
  }
  return false;
}

function normalizeUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    u.hash = "";
    // Drop tracking query params.
    const drop: string[] = [];
    u.searchParams.forEach((_v, k) => {
      if (/^utm_/i.test(k) || k.toLowerCase() === "ref" || k.toLowerCase() === "fbclid") drop.push(k);
    });
    drop.forEach((k) => u.searchParams.delete(k));
    let s = `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname}`;
    if ([...u.searchParams].length > 0) s += `?${u.searchParams.toString()}`;
    if (s.endsWith("/") && s.length > `${u.protocol}//${u.hostname.toLowerCase()}/`.length) {
      s = s.slice(0, -1);
    }
    return s;
  } catch {
    return url;
  }
}

function isPrimary(v: AnnotatedVerdict, sourceTypeFromCandidate?: string): boolean {
  const st = (sourceTypeFromCandidate || "").toLowerCase().trim();
  if (st && PRIMARY_SOURCE_TYPES.has(st)) return true;
  const hay = `${v.title || ""} ${v.citation || ""}`;
  if (DOCKET_RE.test(hay)) return true;
  if (LEGISLATION_RE.test(hay)) return true;
  if (isPrimaryHost(v.domain || hostOf(v.url))) return true;
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface BuildLedgerArgs {
  plan: PlanV1;
  verification: VerifyResult;
  authorityResolutions: AuthorityResolution[];
  /**
   * Optional map of candidate_id → { source_type, document_id, metadata }. The verifier
   * does not carry these forward, so if the runner has them on hand we use
   * them for richer primary detection + dedup + anchor rescue. Safe to omit.
   */
  candidateMeta?: Map<string, { source_type?: string; document_id?: string; metadata?: Record<string, unknown> }>;
}

export function buildLedger(args: BuildLedgerArgs): LedgerResult {
  const t0 = Date.now();
  const { plan, verification, authorityResolutions, candidateMeta } = args;

  const verdictsByClaim = new Map<ClaimId, AnnotatedVerdict[]>();
  for (const cv of verification.per_claim) {
    verdictsByClaim.set(cv.claim_id, cv.verdicts);
  }

  const unsupported_claim_ids: ClaimId[] = [];
  const entries: LedgerEntry[] = [];
  const invariants: LedgerInvariants = {
    unresolved_authorities_in_ledger: 0,
    tangential_or_unrelated_in_ledger: 0,
    duplicates_dropped: 0,
  };

  let lsCounter = 0;
  const mintId = (): LedgerSourceId => `LS${++lsCounter}` as LedgerSourceId;

  for (const claim of plan.claims) {
    const verdicts = verdictsByClaim.get(claim.id) ?? [];

    // Filter: only direct + partial survive.
    const kept = verdicts.filter((v) => v.support === "direct" || v.support === "partial");

    // Hydrate provisional sources.
    type Provisional = {
      v: AnnotatedVerdict;
      meta?: { source_type?: string; document_id?: string; metadata?: Record<string, unknown> };
      key: string;
      primary: boolean;
    };
    const provisional: Provisional[] = kept.map((v) => {
      const meta = candidateMeta?.get(v.candidate_id);
      const normUrl = normalizeUrl(v.url);
      const key = meta?.document_id ?? normUrl ?? `${v.origin}:${v.candidate_id}`;
      return {
        v, meta, key,
        primary: isPrimary(v, meta?.source_type),
      };
    });
        v,
        meta,
        key,
        primary: isPrimary(v, meta?.source_type),
      };
    });

    // Group by key, pick survivor per group.
    const groups = new Map<string, Provisional[]>();
    for (const p of provisional) {
      const arr = groups.get(p.key) ?? [];
      arr.push(p);
      groups.set(p.key, arr);
    }

    const survivors: Provisional[] = [];
    for (const [, members] of groups) {
      if (members.length === 1) {
        survivors.push(members[0]);
        continue;
      }
      members.sort((a, b) => {
        if (a.primary !== b.primary) return a.primary ? -1 : 1;
        const oa = ORIGIN_RANK[a.v.origin] ?? 9;
        const ob = ORIGIN_RANK[b.v.origin] ?? 9;
        if (oa !== ob) return oa - ob;
        const sa = SUPPORT_RANK[a.v.support as "direct" | "partial"];
        const sb = SUPPORT_RANK[b.v.support as "direct" | "partial"];
        if (sa !== sb) return sa - sb;
        return (b.v.snippet?.length || 0) - (a.v.snippet?.length || 0);
      });
      survivors.push(members[0]);
      invariants.duplicates_dropped += members.length - 1;
    }

    // Build LedgerSource[].
    const sources: LedgerSource[] = survivors.map((p) => ({
      ls_id: mintId(),
      candidate_id: p.v.candidate_id,
      claim_id: claim.id,
      origin: p.v.origin,
      support: p.v.support as "direct" | "partial",
      pinpoint: p.v.pinpoint,
      title: p.v.title,
      citation: p.v.citation,
      url: p.v.url,
      domain: p.v.domain ?? hostOf(p.v.url),
      snippet: p.v.snippet,
      source_type: p.meta?.source_type ?? "",
      document_id: p.meta?.document_id,
      normalized_key: p.key,
      is_primary: p.primary,
    }));

    // Sort within claim: primary first, then origin rank, then direct > partial.
    sources.sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      const oa = ORIGIN_RANK[a.origin] ?? 9;
      const ob = ORIGIN_RANK[b.origin] ?? 9;
      if (oa !== ob) return oa - ob;
      return SUPPORT_RANK[a.support] - SUPPORT_RANK[b.support];
    });

    const direct_count = sources.filter((s) => s.support === "direct").length;
    const partial_count = sources.filter((s) => s.support === "partial").length;

    let status: LedgerStatus;
    if (direct_count >= 1) status = "supported";
    else if (partial_count >= 1) status = "hedged";
    else status = "unsupported";

    if (status === "unsupported") {
      unsupported_claim_ids.push(claim.id);
      continue;
    }

    entries.push({
      claim_id: claim.id,
      text: claim.text,
      status,
      direct_count,
      partial_count,
      sources,
    });
  }

  // Unresolved authorities — report only, never enter the ledger.
  const unresolved_authority_ids = authorityResolutions
    .filter((a) => !a.resolved)
    .map((a) => a.authority_id);

  // Defensive invariant 1: ledger sources are minted from verifier verdicts,
  // not from authority hypotheses, so this is structurally guaranteed 0.
  invariants.unresolved_authorities_in_ledger = 0;

  // Defensive invariant 2: re-scan in case future refactors slip a wrong
  // support label through.
  for (const e of entries) {
    for (const s of e.sources) {
      // @ts-expect-error — narrowing past the type for the defensive check
      if (s.support !== "direct" && s.support !== "partial") {
        invariants.tangential_or_unrelated_in_ledger++;
      }
    }
  }

  // Totals.
  const allSources = entries.flatMap((e) => e.sources);
  const by_origin: Record<CandidateOrigin, number> = {
    local_text: 0, local_vector: 0, exact_authority: 0, approved_web: 0,
  };
  for (const s of allSources) by_origin[s.origin]++;

  const totals: LedgerTotals = {
    supported: entries.filter((e) => e.status === "supported").length,
    hedged: entries.filter((e) => e.status === "hedged").length,
    unsupported: unsupported_claim_ids.length,
    sources: allSources.length,
    primary_sources: allSources.filter((s) => s.is_primary).length,
    secondary_sources: allSources.filter((s) => !s.is_primary).length,
    by_origin,
  };

  if (invariants.tangential_or_unrelated_in_ledger > 0) {
    console.error(`[ledger] INVARIANT BREACH: ${invariants.tangential_or_unrelated_in_ledger} tangential/unrelated sources leaked into ledger`);
  }

  return {
    entries,
    unsupported_claim_ids,
    unresolved_authority_ids,
    totals,
    invariants,
    duration_ms: Date.now() - t0,
  };
}

/** Convenience: drop to bare Ledger view (claim_id + status + sources). */
export function toLedger(result: LedgerResult): Ledger {
  return result.entries;
}
