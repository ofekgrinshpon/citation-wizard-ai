// P3 — Candidate pool: merge local + Perplexity, dedupe, cap.

import { CAPS, Candidate } from "../lib/types.ts";
import {
  canSatisfyRole,
  classifySourceIntegrity,
  type SourceIntegrity,
} from "./sourceIntegrity.ts";
import { assignSynthesisRole } from "./synthesisRole.ts";


function normTitle(t: string): string {
  return (t || "")
    .toLowerCase()
    .replace(/[\u0590-\u05FF]/g, (ch) => ch) // keep Hebrew
    .replace(/["׳'`״]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normUrl(u: string | null | undefined): string {
  if (!u) return "";
  try {
    const x = new URL(u);
    return (x.hostname + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return (u || "").toLowerCase().trim();
  }
}

// Extract a statute "title§section" key when discoverable.
const STATUTE_SECTION_RE = /סעיף\s*(\d+[א-ת]?)/;
function statuteKey(c: Candidate): string {
  if (c.role !== "primary_statute" && c.role !== "regulation") return "";
  const m = c.title.match(STATUTE_SECTION_RE) || (c.snippet || "").match(STATUTE_SECTION_RE);
  if (!m) return "";
  const titleBase = normTitle(c.title).replace(/סעיף\s*\d+[א-ת]?/g, "").trim();
  return `${titleBase}§${m[1]}`;
}

// Extract a docket number from title/snippet for case dedup.
const DOCKET_RE = /\b(בג"?ץ|ע"?א|רע"?א|ע"?פ|בש"?א|ב"?ש|תא|תפ|תק|רעא|עפ)\s*\d{1,5}\/\d{2,4}\b/;
function docketKey(c: Candidate): string {
  if (c.role !== "binding_case_law" && c.role !== "persuasive_case_law") return "";
  const hay = `${c.title} ${c.snippet || ""}`;
  const m = hay.match(DOCKET_RE);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}

export interface PoolDrop {
  candidate_id: string;
  title: string;
  url: string | null;
  source_type: string;
  origin: string;
  retrieval_method: string;
  role: string;
  claim_id: string;
  rank_before_drop: number;
  drop_reason:
    | "vector_quota_per_claim"
    | "dup_document_id"
    | "dup_url"
    | "dup_statute_section"
    | "dup_docket"
    | "dup_role_title"
    | "max_candidates_cap"
    | "source_integrity_reject";
  drop_key: string;
  score: number;
}

/** Per-admitted-candidate source-integrity telemetry row. */
export interface IntegrityLogRow {
  candidate_id: string;
  title: string;
  url: string | null;
  role: string;
  original_source_type: string;
  authority_tier: string;
  text_usability: string;
  citable_as: string;
  integrity_flags: string[];
  can_satisfy_role: boolean;
  is_judgment_document: boolean;
  has_holding_text: boolean;
  synthesis_role: string;
  synthesis_role_seeded_from: string;
  synthesis_role_overridden: boolean;
  downgrade_reason?: string;
}

export interface PoolResult {
  candidates: Candidate[];
  found: number;
  after_dedup: number;
  dedup_drops: number;
  drops: PoolDrop[];
  integrity: IntegrityLogRow[];
  integrity_rejects: number;
  counts: {
    by_origin: Record<string, number>;
    by_role: Record<string, number>;
    by_claim: Record<string, number>;
  };
}



const MAX_VECTOR_PER_CLAIM = 2;
const MIN_TRUSTED_PERPLEXITY = 10;

// Trusted-Perplexity predicate.
//
// Per the approved Phase-1 plan:
// - classified_source_class alone must NOT qualify a candidate for trusted
//   reservation.
// - Trusted reservation requires good hygiene (action=keep), a valid/specific
//   URL shape, and meaningful body/snippet.
// - Bad hygiene either excludes (handled upstream) or caps the score to 0.5
//   (handled upstream); here we simply refuse to reserve such candidates.
function isTrustedPerplexity(c: Candidate): boolean {
  if (c.retrieval_method !== "perplexity") return false;
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  // Listing / pagination / non-authority pages never earn a reserved slot.
  const integ = meta.source_integrity as SourceIntegrity | undefined;
  if (integ && (integ.citable_as === "not_citable" || integ.authority_tier === "index_or_listing")) {
    return false;
  }

  const hygiene = meta.pplx_hygiene as
    | {
        hygiene_action?: string;
        body_status?: string;
        landing_page_status?: string;
        title_status?: string;
        url_status?: string;
      }
    | undefined;
  // Without explicit hygiene metadata we cannot trust the candidate — refuse.
  if (!hygiene) return false;
  if (hygiene.hygiene_action !== "keep") return false;
  if (hygiene.body_status !== "has_body") return false;
  if (hygiene.title_status !== "valid") return false;
  if (hygiene.url_status !== "valid" && hygiene.url_status !== "fixed") return false;
  if (hygiene.landing_page_status === "generic_index") return false;
  // Within trusted-hygiene candidates, require either a high score OR a
  // recognised authoritative class (so we still favour primary law/case
  // pages, but never on the class signal alone).
  if (typeof c.score === "number" && c.score >= 0.9) return true;
  const cls = (meta.classified_source_class as string | undefined) ?? "";
  return TRUSTED_PPLX_CLASSES.has(cls);
}

const TRUSTED_PPLX_CLASSES = new Set([
  "official_primary",
  "legislation",
  "court_case",
  "government_report",
  "scholarship",
]);

export function buildCandidatePool(allRaw: Candidate[]): PoolResult {
  // ── Source-integrity classification (deterministic, pre-verifier) ────────
  const integrityById = new Map<string, SourceIntegrity>();
  const rejected: Candidate[] = [];
  const all: Candidate[] = [];
  for (const c of allRaw) {
    const integ = classifySourceIntegrity({
      url: c.source_url,
      title: c.title,
      snippet: c.snippet,
      source_type: c.source_type,
      role: c.role,
    });
    integrityById.set(c.candidate_id, integ);
    c.metadata = { ...(c.metadata ?? {}), source_integrity: integ };
    if (integ.reject) rejected.push(c);
    else all.push(c);
  }

  const seenDoc = new Set<string>();
  const seenUrl = new Set<string>();
  const seenStatute = new Set<string>();
  const seenDocket = new Set<string>();
  const seenTitle = new Map<string, Candidate>(); // role+normTitle → kept
  const vectorPerClaim = new Map<string, number>();


  // P3.2 #3: priority — exact_authority > text > perplexity > vector.
  // Score still tie-breaks within a tier.
  const tierOf = (c: Candidate): number => {
    if (c.retrieval_method === "exact_authority") return 0;
    if (c.retrieval_method === "text") return 1;
    if (c.retrieval_method === "perplexity") return 2;
    return 3; // vector
  };
  const sorted = [...all].sort((a, b) => {
    const t = tierOf(a) - tierOf(b);
    if (t !== 0) return t;
    return b.score - a.score;
  });
  const out: Candidate[] = [];
  let dedup_drops = 0;
  const rankOf = new Map<string, number>();
  sorted.forEach((c, i) => rankOf.set(c.candidate_id, i));
  const dropLog: PoolDrop[] = [];
  const logDrop = (c: Candidate, reason: PoolDrop["drop_reason"], key: string) => {
    dropLog.push({
      candidate_id: c.candidate_id,
      title: c.title,
      url: c.source_url ?? null,
      source_type: c.source_type,
      origin: c.origin,
      retrieval_method: c.retrieval_method,
      role: c.role,
      claim_id: c.claim_id,
      rank_before_drop: rankOf.get(c.candidate_id) ?? -1,
      drop_reason: reason,
      drop_key: key,
      score: c.score,
    });
  };

  // Shared admission routine — runs the existing dedup/vector-cap checks and pushes into `out`.
  // Returns true if admitted.
  const tryAdmit = (c: Candidate): boolean => {
    if (out.length >= CAPS.MAX_CANDIDATES) {
      logDrop(c, "max_candidates_cap", `cap:${CAPS.MAX_CANDIDATES}`);
      return false;
    }
    if (c.retrieval_method === "vector") {
      const n = vectorPerClaim.get(c.claim_id) ?? 0;
      if (n >= MAX_VECTOR_PER_CLAIM) {
        dedup_drops++;
        logDrop(c, "vector_quota_per_claim", `vector:${c.claim_id}:${MAX_VECTOR_PER_CLAIM}`);
        return false;
      }
    }
    const docId = c.document_id ? `doc:${c.document_id}` : "";
    const url = normUrl(c.source_url);
    const urlKey = url ? `url:${url}` : "";
    const stKey = statuteKey(c);
    const stK = stKey ? `st:${stKey}` : "";
    const dkKey = docketKey(c);
    const dk = dkKey ? `dk:${dkKey}` : "";
    const ttKey = `tt:${c.role}:${normTitle(c.title)}`;

    if (docId && seenDoc.has(docId)) { dedup_drops++; logDrop(c, "dup_document_id", docId); return false; }
    if (urlKey && seenUrl.has(urlKey)) { dedup_drops++; logDrop(c, "dup_url", urlKey); return false; }
    if (stK && seenStatute.has(stK)) { dedup_drops++; logDrop(c, "dup_statute_section", stK); return false; }
    if (dk && seenDocket.has(dk)) { dedup_drops++; logDrop(c, "dup_docket", dk); return false; }
    if (seenTitle.has(ttKey)) { dedup_drops++; logDrop(c, "dup_role_title", ttKey); return false; }

    if (docId) seenDoc.add(docId);
    if (urlKey) seenUrl.add(urlKey);
    if (stK) seenStatute.add(stK);
    if (dk) seenDocket.add(dk);
    seenTitle.set(ttKey, c);
    if (c.retrieval_method === "vector") {
      vectorPerClaim.set(c.claim_id, (vectorPerClaim.get(c.claim_id) ?? 0) + 1);
    }
    out.push(c);
    return true;
  };

  // Pass A: reserve up to MIN_TRUSTED_PERPLEXITY slots for trusted Perplexity candidates,
  // walked in the same global score-sorted order. Quality-gated only — no blind top-N.
  let reserved = 0;
  const reservedIds = new Set<string>();
  for (const c of sorted) {
    if (reserved >= MIN_TRUSTED_PERPLEXITY) break;
    if (!isTrustedPerplexity(c)) continue;
    if (tryAdmit(c)) {
      reservedIds.add(c.candidate_id);
      reserved++;
    }
  }

  // Pass B: existing tier-priority fill. Already-admitted candidates fall out via dedup sets
  // (by document_id / url / title). Track candidate_id explicitly for items without those keys.
  for (const c of sorted) {
    if (reservedIds.has(c.candidate_id)) continue;
    tryAdmit(c);
    if (out.length >= CAPS.MAX_CANDIDATES) break;
  }


  const counts = {
    by_origin: {} as Record<string, number>,
    by_role: {} as Record<string, number>,
    by_claim: {} as Record<string, number>,
  };
  for (const c of out) {
    counts.by_origin[c.origin] = (counts.by_origin[c.origin] ?? 0) + 1;
    counts.by_role[c.role] = (counts.by_role[c.role] ?? 0) + 1;
    counts.by_claim[c.claim_id] = (counts.by_claim[c.claim_id] ?? 0) + 1;
  }

  // A candidate can be provisionally rejected in pass A (trusted reservation)
  // and admitted later in pass B; keep only drops for candidates that never
  // made it into the final pool, deduped by candidate_id (first reason wins).
  const admittedIds = new Set(out.map((c) => c.candidate_id));
  const seenDropIds = new Set<string>();
  const drops = dropLog.filter((d) => {
    if (admittedIds.has(d.candidate_id)) return false;
    if (seenDropIds.has(d.candidate_id)) return false;
    seenDropIds.add(d.candidate_id);
    return true;
  });

  // Integrity rejects (placeholder / malformed / search pages) never reach the
  // verifier; log them alongside the dedup drops.
  for (const c of rejected) {
    const integ = integrityById.get(c.candidate_id)!;
    drops.push({
      candidate_id: c.candidate_id,
      title: c.title,
      url: c.source_url ?? null,
      source_type: c.source_type,
      origin: c.origin,
      retrieval_method: c.retrieval_method,
      role: c.role,
      claim_id: c.claim_id,
      rank_before_drop: -1,
      drop_reason: "source_integrity_reject",
      drop_key: integ.reject_reason ?? "integrity",
      score: c.score,
    });
  }

  const integrity: IntegrityLogRow[] = out.map((c) => {
    const integ = integrityById.get(c.candidate_id)!;
    const sr = assignSynthesisRole({
      role: c.role,
      integrity: integ,
      title: c.title,
      snippet: c.snippet,
    });
    return {
      candidate_id: c.candidate_id,
      title: c.title,
      url: c.source_url ?? null,
      role: c.role,
      original_source_type: c.source_type,
      authority_tier: integ.authority_tier,
      text_usability: integ.text_usability,
      citable_as: integ.citable_as,
      integrity_flags: integ.integrity_flags,
      can_satisfy_role: canSatisfyRole(integ, c.role),
      is_judgment_document: integ.is_judgment_document ?? false,
      has_holding_text: integ.has_holding_text ?? false,
      synthesis_role: sr.synthesis_role,
      synthesis_role_seeded_from: sr.seeded_from,
      synthesis_role_overridden: sr.overridden,
      downgrade_reason: integ.downgrade_reason,
    };
  });

  return {
    candidates: out,
    found: allRaw.length,
    after_dedup: out.length,
    dedup_drops,
    drops,
    integrity,
    integrity_rejects: rejected.length,
    counts,
  };
}


