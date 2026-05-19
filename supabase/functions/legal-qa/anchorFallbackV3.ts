// V3 Step 2.2 — Per-anchor local probe + Perplexity fallback.
//
// For each V3 expected_anchor we:
//   1. Probe the local DB (search_legal_chunks_text) with the shortened
//      queries built by researchV3Pipeline.buildAnchorQueries.
//   2. If local returns 0 hits → fire ONE sonar-pro call scoped to that
//      anchor, with TIER_A_DOMAIN_FILTER as search_domain_filter.
//   3. Validate Perplexity candidates: citation-shape regex + Tier A URL
//      allowlist. Tier B never becomes a citation candidate.
//   4. Return validated candidates pre-shaped as V2 ClaimCandidateSource
//      entries (synthetic chunkId/documentId — verifier still gates them).
//
// Telemetry per anchor (used to stamp qa_logs.metadata.v3_anchor_fallback):
//   { anchor_id, local_found, perplexity_called, approved_found,
//     candidate_added, verified, cited, not_found_reason }
// `verified` and `cited` are filled in by the V2 pipeline after the ledger
// runs (here we set them to null/false initially).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { ClaimCandidateSource } from "./claimRetrieval.ts";
import type { V3ExpectedAnchor } from "./legalResearchPlanV3.ts";
import { TIER_A_DOMAIN_FILTER, citationTier } from "./approvedDomains.ts";
import {
  lookupAnchorsExact,
  type AnchorExactMatch,
  type AnchorLookupDetail,
  type AnchorMatchBasis,
  type AnchorMatchConfidence,
} from "./anchorExactLookup.ts";

const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const PERPLEXITY_TIMEOUT_MS = 18_000;
const MAX_CANDIDATES_PER_ANCHOR = 2;

// Citation-shape guards (mirrors Stage E.5 in index.ts — kept local to avoid
// importing from the massive index.ts module).
const STATUTE_CITATION_RE =
  /(ס["״]ח|ק["״]ת)\s*(?:התש[א-ת"״'׳\-–]+|\d{4})?\s*\d+/;
const CASE_NUMBER_RE =
  /(?:בג["״]ץ|ע["״]א|ע["״]פ|רע["״]א|רע["״]פ|דנ["״]א|בש["״]פ|עע["״]מ|עע["״]א|ת["״]א|תפ["״]ח|ע["״]ע|בר["״]ם|דנ["״]פ|סע["״]ש|ע["״]ב)\s*\d+\/\d+/;

export interface AnchorFallbackPerAnchor {
  anchor_id: string;
  anchor_name: string;
  anchor_type: string;
  queries_tried: string[];
  local_found: number;
  /** Step 4 — exact local lookup result. */
  local_match_basis: AnchorMatchBasis;
  local_confidence: AnchorMatchConfidence;
  /** Step 4 (lookup fix) — per-anchor lookup telemetry. */
  exact_lookup_detail?: AnchorLookupDetail;
  perplexity_called: boolean;
  perplexity_returned: number;
  approved_found: number;
  candidate_added: number;
  verified: number | null; // filled by V2 post-ledger
  cited: number | null;    // filled by V2 post-drafter
  not_found_reason?:
    | "local_exact_hit"      // Step 4 — exact local match, Perplexity skipped
    | "no_perplexity_key"
    | "perplexity_error"
    | "perplexity_timeout"
    | "no_candidates_returned"
    | "all_dropped_citation_shape"
    | "all_dropped_not_tier_a"
    | "ok";
  duration_ms: number;
}

export interface AnchorFallbackResult {
  /** Map keyed by external anchor dedup key (type|name(lower)|docket|section). */
  candidatesByAnchorKey: Map<string, ClaimCandidateSource[]>;
  perAnchor: AnchorFallbackPerAnchor[];
  wall_ms: number;
}

function anchorKey(a: { type: string; name: string; docket?: string; section?: string }): string {
  return `${a.type}|${(a.name || "").trim().toLowerCase()}|${a.docket ?? ""}|${a.section ?? ""}`;
}

interface PerplexityRawCandidate {
  title?: string;
  citation?: string;
  url?: string;
  relevance_note?: string;
  type?: "statute" | "caselaw";
}

// Step 4 — Loose probeLocal short-circuit removed. Exact local lookup
// (anchorExactLookup.ts) now decides whether Perplexity is needed: a hit only
// counts if it matches the planned authority on a discriminating field
// (docket / title+section / title+author).

function buildAnchorPerplexityPrompt(a: V3ExpectedAnchor): string {
  const lines: string[] = [];
  if (a.type === "leading_case") {
    lines.push(`מצא את פסק הדין הישראלי הבא במאגרי פסיקה רשמיים בלבד (נבו, פדאור, תקדין, אתר בית המשפט העליון):`);
    if (a.docket) lines.push(`- מספר תיק: ${a.docket}`);
    lines.push(`- שם: ${a.name}`);
  } else if (a.type === "basic_law_section" || a.type === "statute_section" || a.type === "regulation") {
    lines.push(`מצא את החקיקה הישראלית הבאה במקור רשמי בלבד (knesset.gov.il, nevo.co.il, reshumot.gov.il, justice.gov.il):`);
    lines.push(`- שם: ${a.name}`);
    if (a.section) lines.push(`- סעיף: ${a.section}`);
  } else {
    lines.push(`מצא את המקור המשפטי הישראלי הבא במקור אקדמי או רשמי:`);
    lines.push(`- שם: ${a.name}`);
  }
  lines.push(
    "",
    "החזר עד 2 מקורות עם השדות: title, citation (ציטוט מלא בעברית), url, type (statute או caselaw), relevance_note (משפט קצר). אסור להחזיר בלוגים, פרסומי חדשות, או רשתות חברתיות.",
  );
  return lines.join("\n");
}

async function callPerplexityForAnchor(a: V3ExpectedAnchor): Promise<{
  status: "ok" | "no_key" | "timeout" | "error" | "parse_failed";
  candidates: PerplexityRawCandidate[];
}> {
  if (!PERPLEXITY_API_KEY) return { status: "no_key", candidates: [] };

  const schema = {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["statute", "caselaw"] },
            title: { type: "string" },
            citation: { type: "string" },
            url: { type: "string" },
            relevance_note: { type: "string" },
          },
          required: ["type", "title", "citation", "url"],
        },
      },
    },
    required: ["candidates"],
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PERPLEXITY_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "sonar-pro",
        search_domain_filter: TIER_A_DOMAIN_FILTER,
        response_format: { type: "json_schema", json_schema: { name: "anchor_source", schema } },
        messages: [
          {
            role: "system",
            content:
              "You are a precise Israeli-law research assistant. Return ONLY primary sources from official Israeli legal databases or government sites. Each candidate MUST have a full citation and a direct URL on the requested domain. If you cannot find the exact source, return an empty candidates array — never invent.",
          },
          { role: "user", content: buildAnchorPerplexityPrompt(a) },
        ],
      }),
    });
    clearTimeout(t);
    if (!res.ok) return { status: "error", candidates: [] };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(content);
      const arr = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
      return { status: "ok", candidates: arr.slice(0, MAX_CANDIDATES_PER_ANCHOR) };
    } catch {
      return { status: "parse_failed", candidates: [] };
    }
  } catch (err) {
    clearTimeout(t);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    return { status: isAbort ? "timeout" : "error", candidates: [] };
  }
}

function validatePerplexityCandidate(c: PerplexityRawCandidate): {
  ok: boolean;
  reason?: "missing_url" | "not_tier_a" | "citation_shape_fail";
} {
  const url = (c.url || "").trim();
  const citation = (c.citation || "").trim();
  if (!url || !citation) return { ok: false, reason: "missing_url" };
  // Tier A only — Tier B is orientation, not citation.
  if (citationTier(url) !== "A") return { ok: false, reason: "not_tier_a" };
  // Citation-shape guard.
  const looksLikeStatute = STATUTE_CITATION_RE.test(citation);
  const looksLikeCase = CASE_NUMBER_RE.test(citation);
  if (!looksLikeStatute && !looksLikeCase) return { ok: false, reason: "citation_shape_fail" };
  return { ok: true };
}

function shapeAsCandidate(
  c: PerplexityRawCandidate,
  anchorId: string,
  anchorIdx: number,
  candIdx: number,
): ClaimCandidateSource {
  // Synthetic chunk/document IDs — these never need to resolve to a real DB
  // row. The ledger verifier will see `excerpt` (the Perplexity
  // relevance_note + citation) and decide whether it supports the claim.
  const synthId = `v3fb-${anchorId}-${candIdx}`;
  return {
    id: `EA${anchorIdx}-${candIdx}`,
    chunkId: synthId,
    documentId: synthId,
    title: (c.title || "").trim() || (c.citation || "").trim(),
    citation: (c.citation || "").trim(),
    sourceType: c.type === "caselaw" ? "case_law" : "legislation_primary",
    sourceUrl: (c.url || "").trim(),
    excerpt:
      ((c.relevance_note || "").trim() + "\n" + (c.citation || "").trim()).trim().slice(0, 600),
    // High score so it lands in the top-K candidate slice that V2 sends to
    // the verifier. The verifier still has full veto power.
    score: 0.92,
    origin: "anchor",
    anchorId,
  };
}

export async function runAnchorFallback(args: {
  anchors: V3ExpectedAnchor[];
  queriesByAnchorId: Map<string, string[]>;
  adminClient: SupabaseClient;
}): Promise<AnchorFallbackResult> {
  const t0 = Date.now();
  const perAnchor: AnchorFallbackPerAnchor[] = [];
  const candidatesByAnchorKey = new Map<string, ClaimCandidateSource[]>();

  // Step 4 — batch exact local lookup up-front (parallel, bounded per anchor).
  // This replaces the loose FTS probe: an "exact hit" requires a matching
  // docket / title+section / title+author, not just any token overlap.
  let exactByAnchorId: Map<string, AnchorExactMatch>;
  try {
    exactByAnchorId = await lookupAnchorsExact(args.adminClient, args.anchors);
  } catch (e) {
    console.warn("[anchor_fallback] exact_lookup_error:", (e as Error).message);
    exactByAnchorId = new Map();
  }

  const tasks = args.anchors.map(async (a, anchorIdx) => {
    const aT0 = Date.now();
    const queries = args.queriesByAnchorId.get(a.id) ?? [];
    const exact = exactByAnchorId.get(a.id);
    const tele: AnchorFallbackPerAnchor = {
      anchor_id: a.id,
      anchor_name: a.name,
      anchor_type: a.type,
      queries_tried: queries,
      local_found: exact?.docs_found ?? 0,
      local_match_basis: exact?.match_basis ?? "none",
      local_confidence: exact?.confidence ?? "none",
      perplexity_called: false,
      perplexity_returned: 0,
      approved_found: 0,
      candidate_added: 0,
      verified: null,
      cited: null,
      duration_ms: 0,
    };

    // 1. Exact local lookup hit → materialize as anchor-origin candidates,
    //    skip Perplexity. Verifier remains the gate on the ledger side.
    if (exact && exact.candidates.length > 0) {
      candidatesByAnchorKey.set(anchorKey(a), exact.candidates);
      tele.candidate_added = exact.candidates.length;
      tele.not_found_reason = "local_exact_hit";
      tele.duration_ms = Date.now() - aT0;
      return tele;
    }

    // 2. Perplexity fallback (Deep-only — caller already gates this).
    tele.perplexity_called = true;
    const pr = await callPerplexityForAnchor(a);
    tele.perplexity_returned = pr.candidates.length;
    if (pr.status === "no_key") { tele.not_found_reason = "no_perplexity_key"; tele.duration_ms = Date.now() - aT0; return tele; }
    if (pr.status === "timeout") { tele.not_found_reason = "perplexity_timeout"; tele.duration_ms = Date.now() - aT0; return tele; }
    if (pr.status === "error" || pr.status === "parse_failed") { tele.not_found_reason = "perplexity_error"; tele.duration_ms = Date.now() - aT0; return tele; }
    if (pr.candidates.length === 0) { tele.not_found_reason = "no_candidates_returned"; tele.duration_ms = Date.now() - aT0; return tele; }

    // 3. Validate (Tier A + citation-shape).
    const kept: PerplexityRawCandidate[] = [];
    let droppedNotTierA = 0;
    let droppedShape = 0;
    for (const c of pr.candidates) {
      const v = validatePerplexityCandidate(c);
      if (v.ok) { kept.push(c); continue; }
      if (v.reason === "not_tier_a") droppedNotTierA++;
      else if (v.reason === "citation_shape_fail") droppedShape++;
    }
    tele.approved_found = kept.length;

    if (kept.length === 0) {
      tele.not_found_reason = droppedNotTierA > droppedShape
        ? "all_dropped_not_tier_a"
        : "all_dropped_citation_shape";
      tele.duration_ms = Date.now() - aT0;
      return tele;
    }

    // 4. Shape as ClaimCandidateSource. V2 will inject into the matching
    // claim pack pre-verification.
    const shaped = kept.map((c, i) => shapeAsCandidate(c, a.id, anchorIdx, i));
    candidatesByAnchorKey.set(anchorKey(a), shaped);
    tele.candidate_added = shaped.length;
    tele.not_found_reason = "ok";
    tele.duration_ms = Date.now() - aT0;
    return tele;
  });

  const settled = await Promise.allSettled(tasks);
  for (const s of settled) {
    if (s.status === "fulfilled") perAnchor.push(s.value);
  }

  return {
    candidatesByAnchorKey,
    perAnchor,
    wall_ms: Date.now() - t0,
  };
}

export { anchorKey };
