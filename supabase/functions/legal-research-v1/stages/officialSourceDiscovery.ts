// official_source_discovery — acquisition lane for nominated sources.
//
// Order of operations per identifier-bearing nomination:
//   1. verified-source cache lookup (a hit costs no fetch and no extraction
//      slot — the scarce resource that kills runs);
//   2. official URL already surfaced by retrieval for that identifier
//      (search-first: the nomination's own query ran through local + web
//      retrieval, so official hosts arrive as ordinary candidates);
//   3. deterministic court-file derivation as a last resort.
//
// Every acquired body must prove its identity *inside the text* before it is
// injected or cached. Block/WAF pages, listing pages and identity mismatches
// are recorded as negative cache rows with a cooldown, never as bodies.
//
// Acquisition only. Nothing here cites, drafts or relaxes a gate.

import type { Candidate } from "../lib/types.ts";
import type { IntegrityLogRow } from "./candidatePool.ts";
import {
  detectDockets,
  normalizedDocketId,
  textContainsExactDocket,
  type DocketRef,
} from "./docketDetection.ts";
import { classifySourceIntegrity, type SourceIntegrity } from "./sourceIntegrity.ts";
import {
  deriveSupremeCourtBinaryUrls,
  deriveSupremeCourtFileUrls,
  isSupremeCourtDocket,
  isTextEndpointUrl,
} from "./courtFileUrls.ts";
import { assessPdfExtraction } from "./pdfExtractionPreflight.ts";
import { HOLDING_TEXT_RE, isListingPage, tryDirectFile, withTimeout } from "./judgmentTextAcquisition.ts";
import {
  isIdentifierBearing,
  type NominatedSource,
  type SourceNominationResult,
} from "./sourceNomination.ts";
import {
  lookupVerifiedSource,
  recordSourceFailure,
  recordVerifiedSource,
  VERIFIED_SOURCE_CACHE_VERSION,
} from "./verifiedSourceCache.ts";

export const OFFICIAL_DISCOVERY_VERSION = "official_source_discovery_v1";

export const DISCOVERY_LIMITS = {
  MAX_TARGETS: 2,
  MAX_URLS_PER_TARGET: 3,
  PER_URL_MS: 12_000,
  TOTAL_MS: 45_000,
  MIN_BUDGET_MS: 6_000,
  MAX_PROBE_BYTES: 6_000_000,
  MIN_BODY_CHARS: 900,
  MAX_TEXT: 400_000,
  BLOCK_PAGE_MAX_CHARS: 4_000,
} as const;

const BLOCK_PAGE_SIGNATURES = [
  "חסימת בקשה לא מורשת",
  "Request Rejected",
  "Access Denied",
  "object not found",
  "השירות אינו זמין",
];

const OFFICIAL_HOST_RE =
  /(court\.gov\.il|supremedecisions\.court\.gov\.il|elyon1\.court\.gov\.il|gov\.il|knesset\.gov\.il|mevaker\.gov\.il|nevo\.co\.il\/psika)/i;

export interface DiscoveryAttempt {
  nomination_id: string;
  label: string;
  category: string;
  normalized_docket: string | null;
  cache_lookup: "hit" | "miss" | "cooldown" | "skipped";
  cache_status: string | null;
  urls_attempted: string[];
  acquisition_path: "cache" | "retrieved_official_url" | "derived_court_url" | "none";
  result:
    | "cache_hit"
    | "body_acquired"
    | "blocked_by_origin"
    | "identity_mismatch"
    | "below_threshold"
    | "fetch_failed"
    | "timeout"
    | "not_attempted";
  body_chars: number;
  injected_candidate_id: string | null;
  cache_written: boolean;
  cache_write_error: string | null;
  reason: string | null;
  ms: number;
}

export interface OfficialDiscoveryReport {
  version: typeof OFFICIAL_DISCOVERY_VERSION;
  cache_version: typeof VERIFIED_SOURCE_CACHE_VERSION;
  enabled: boolean;
  skip_reason: string | null;
  targets: number;
  attempts: DiscoveryAttempt[];
  cache_hits: number;
  cache_misses: number;
  cache_cooldowns: number;
  bodies_acquired: number;
  cache_writes: number;
  injected_candidate_ids: string[];
  ms: number;
}

// deno-lint-ignore no-explicit-any
type Admin = any;

interface ProbeBudget {
  exceeded(): boolean;
  remaining(): number;
  mark(name: string, detail?: Record<string, unknown>): void;
  allowExtraction?(bytes: number, opts?: { speculative?: boolean }): boolean;
  noteExtractionOutput?(chars: number, opts?: { speculative?: boolean }): void;
}

export interface OfficialDiscoveryInput {
  admin: Admin;
  nomination: SourceNominationResult;
  candidates: Candidate[];
  integrity: IntegrityLogRow[];
  budget?: ProbeBudget;
  /** Router-scoped ceiling; clamped to MAX_TARGETS. 0 disables the stage. */
  max_targets?: number;
  markDurable?: (name: string, detail?: Record<string, unknown>) => Promise<unknown> | unknown;
}

function emptyReport(skip_reason: string | null): OfficialDiscoveryReport {
  return {
    version: OFFICIAL_DISCOVERY_VERSION,
    cache_version: VERIFIED_SOURCE_CACHE_VERSION,
    enabled: skip_reason === null,
    skip_reason,
    targets: 0,
    attempts: [],
    cache_hits: 0,
    cache_misses: 0,
    cache_cooldowns: 0,
    bodies_acquired: 0,
    cache_writes: 0,
    injected_candidate_ids: [],
    ms: 0,
  };
}

function candidateText(c: Candidate): string {
  const md = (c.metadata ?? {}) as Record<string, unknown>;
  const ext = typeof md.extended_text === "string" ? md.extended_text : "";
  return `${ext}\n${c.snippet ?? ""}`;
}

/** True when retrieval already produced a usable body for this docket. */
function poolHasBody(candidates: Candidate[], d: DocketRef): boolean {
  for (const c of candidates) {
    const identity = textContainsExactDocket(c.title, d) ||
      textContainsExactDocket(String(c.source_url ?? ""), d);
    if (!identity) continue;
    const md = (c.metadata ?? {}) as Record<string, unknown>;
    const integ = md.source_integrity as SourceIntegrity | undefined;
    const usability = String(integ?.text_usability ?? md.text_usability ?? "");
    if (/listing|metadata|unusable|none/i.test(usability)) continue;
    if (/full_text|substantive_excerpt/.test(usability)) return true;
    if (candidateText(c).trim().length >= DISCOVERY_LIMITS.MIN_BODY_CHARS) return true;
  }
  return false;
}

/** Official URLs retrieval already found for this docket — search-first. */
function retrievedOfficialUrls(candidates: Candidate[], d: DocketRef): string[] {
  const urls: string[] = [];
  for (const c of candidates) {
    const url = String(c.source_url ?? "");
    if (!url || !OFFICIAL_HOST_RE.test(url)) continue;
    if (isListingPage(url)) continue;
    const identity = textContainsExactDocket(c.title, d) || textContainsExactDocket(url, d) ||
      textContainsExactDocket(c.snippet ?? "", d);
    if (!identity) continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

function blockPageSignature(prefix: string, d: DocketRef): string | null {
  const t = prefix.trim();
  if (t.length > DISCOVERY_LIMITS.BLOCK_PAGE_MAX_CHARS) return null;
  for (const sig of BLOCK_PAGE_SIGNATURES) {
    if (t.toLowerCase().includes(sig.toLowerCase())) return sig;
  }
  if (t.length > 0 && !textContainsExactDocket(t, d)) return "short_page_without_docket";
  return null;
}

export async function runOfficialSourceDiscovery(
  input: OfficialDiscoveryInput,
): Promise<OfficialDiscoveryReport> {
  const t0 = Date.now();
  const nom = input.nomination;
  if (!nom?.enabled || nom.candidates.length === 0) {
    return emptyReport("no_nominations");
  }
  const cap = Math.max(0, Math.min(input.max_targets ?? DISCOVERY_LIMITS.MAX_TARGETS, DISCOVERY_LIMITS.MAX_TARGETS));
  if (cap === 0) return emptyReport("target_cap_zero");

  const report = emptyReport(null);
  const remainingMs = (): number => {
    const stage = DISCOVERY_LIMITS.TOTAL_MS - (Date.now() - t0);
    const outer = input.budget ? input.budget.remaining() : Number.POSITIVE_INFINITY;
    return Math.min(stage, outer);
  };
  if (input.budget?.exceeded() || remainingMs() < DISCOVERY_LIMITS.MIN_BUDGET_MS) {
    report.enabled = false;
    report.skip_reason = "retrieval_budget_low";
    report.ms = Date.now() - t0;
    return report;
  }

  const targets = nom.candidates
    .filter((n) => isIdentifierBearing(n))
    .filter((n) => n.category === "judgment" ? !!n.docket : true)
    .slice(0, cap);
  report.targets = targets.length;
  if (targets.length === 0) {
    report.skip_reason = "no_identifier_bearing_nominations";
    report.ms = Date.now() - t0;
    return report;
  }

  await input.markDurable?.("official_source_discovery_start", {
    targets: targets.map((t) => t.nomination_id),
  });

  for (const target of targets) {
    if (input.budget?.exceeded() || remainingMs() < DISCOVERY_LIMITS.MIN_BUDGET_MS) break;
    const attempt = await handleTarget(target, input, remainingMs);
    report.attempts.push(attempt);
    if (attempt.cache_lookup === "hit") report.cache_hits++;
    else if (attempt.cache_lookup === "cooldown") report.cache_cooldowns++;
    else if (attempt.cache_lookup === "miss") report.cache_misses++;
    if (attempt.result === "body_acquired") report.bodies_acquired++;
    if (attempt.cache_written) report.cache_writes++;
    if (attempt.injected_candidate_id) {
      report.injected_candidate_ids.push(attempt.injected_candidate_id);
    }
  }

  report.ms = Date.now() - t0;
  await input.markDurable?.("official_source_discovery_done", {
    cache_hits: report.cache_hits,
    bodies_acquired: report.bodies_acquired,
    cache_writes: report.cache_writes,
  });
  return report;
}

async function handleTarget(
  n: NominatedSource,
  input: OfficialDiscoveryInput,
  remainingMs: () => number,
): Promise<DiscoveryAttempt> {
  const tA = Date.now();
  const docket = n.docket ? detectDockets(`${n.label_he} ${n.docket}`)[0] ?? null : null;
  const attempt: DiscoveryAttempt = {
    nomination_id: n.nomination_id,
    label: n.label_he,
    category: n.category,
    normalized_docket: docket ? normalizedDocketId(docket) : null,
    cache_lookup: "skipped",
    cache_status: null,
    urls_attempted: [],
    acquisition_path: "none",
    result: "not_attempted",
    body_chars: 0,
    injected_candidate_id: null,
    cache_written: false,
    cache_write_error: null,
    reason: null,
    ms: 0,
  };

  const category = n.category === "judgment"
    ? "judgment"
    : n.category === "statute" || n.category === "bill"
    ? "statute"
    : n.category === "regulation" || n.category === "regulator_guidance"
    ? "regulation"
    : n.category === "scholarship"
    ? "scholarship"
    : n.category === "government_report" || n.category === "knesset_report"
    ? "report"
    : "other";

  // ── 1. Cache lookup ────────────────────────────────────────────────────
  const lookup = await lookupVerifiedSource(input.admin, {
    category,
    normalized_docket: attempt.normalized_docket,
    statute_title: n.statute_title,
    statute_section: n.statute_section,
    canonical_title: n.docket ? null : n.label_he,
    authors: n.authors,
    institution: n.institution,
    year: n.year,
  });
  attempt.cache_status = lookup.status;
  if (lookup.hit && lookup.source) {
    attempt.cache_lookup = "hit";
    attempt.acquisition_path = "cache";
    attempt.result = "cache_hit";
    attempt.body_chars = lookup.source.text.length;
    attempt.injected_candidate_id = injectBody(input, n, docket, {
      url: lookup.source.official_url ?? "",
      text: lookup.source.text,
      from_cache: true,
    });
    attempt.ms = Date.now() - tA;
    return attempt;
  }
  attempt.cache_lookup = lookup.cooldown_active ? "cooldown" : "miss";
  if (lookup.cooldown_active) {
    attempt.reason = `cooldown_until:${lookup.cooldown_until}`;
    attempt.ms = Date.now() - tA;
    return attempt;
  }

  // Only judgments with a docket get a live acquisition lane in v1: identity
  // can be proven deterministically inside the body. Everything else relies
  // on ordinary retrieval and its existing gates.
  if (!docket) {
    attempt.reason = "no_docket_no_live_lane";
    attempt.ms = Date.now() - tA;
    return attempt;
  }
  if (poolHasBody(input.candidates, docket)) {
    attempt.reason = "retrieval_already_has_body";
    attempt.ms = Date.now() - tA;
    return attempt;
  }

  // ── 2/3. Official URLs from retrieval, then derived court-file URLs ─────
  const retrieved = retrievedOfficialUrls(input.candidates, docket);
  const derived = isSupremeCourtDocket(docket)
    ? [
      ...deriveSupremeCourtFileUrls(docket, { maxUrls: 3 })
        .filter((u) => isTextEndpointUrl(u) || /\.html?($|[?#])/i.test(u)),
      ...deriveSupremeCourtBinaryUrls(docket, { maxUrls: 1 }),
    ]
    : [];
  const urls = [...retrieved, ...derived].slice(0, DISCOVERY_LIMITS.MAX_URLS_PER_TARGET);
  attempt.urls_attempted = urls;
  if (urls.length === 0) {
    attempt.reason = "no_official_url_available";
    attempt.ms = Date.now() - tA;
    return attempt;
  }

  let lastFailure = "no_body_acquired";
  let blockedByOrigin = false;
  for (const url of urls) {
    if (input.budget?.exceeded() || remainingMs() < 2000) {
      attempt.result = "timeout";
      lastFailure = "budget_exhausted";
      break;
    }
    const perUrlMs = Math.max(2000, Math.min(DISCOVERY_LIMITS.PER_URL_MS, remainingMs()));
    const blockState: { sig: string | null } = { sig: null };
    input.budget?.mark("official_discovery_probe", { url, nomination: n.nomination_id });
    try {
      const got = await withTimeout(
        tryDirectFile(url, {
          allowPlainText: true,
          inspectText: (prefix: string) => {
            blockState.sig = blockPageSignature(prefix, docket);
          },
          validateText: (text: string) => textContainsExactDocket(text.slice(0, 20_000), docket),
          signal: AbortSignal.timeout(perUrlMs),
          maxBytes: DISCOVERY_LIMITS.MAX_PROBE_BYTES,
          budgetExceeded: () => input.budget?.exceeded() ?? false,
          allowExtraction: (bytes: number) =>
            input.budget?.allowExtraction?.(bytes, { speculative: true }) ?? true,
          noteExtractionOutput: (chars: number) =>
            input.budget?.noteExtractionOutput?.(chars, { speculative: true }),
          preflight: (info: { bytes: number; contentType: string; url: string; kind: "pdf" | "docx" }) => {
            const verdict = assessPdfExtraction({
              bytes: info.bytes,
              contentType: info.contentType,
              url: info.url,
              exactCase: false,
              remainingMs: remainingMs(),
            });
            return { allow: verdict.allow, reason: verdict.reason };
          },
        }),
        perUrlMs,
        "official_source_discovery",
      );
      if (got.length >= DISCOVERY_LIMITS.MIN_BODY_CHARS) {
        attempt.result = "body_acquired";
        attempt.body_chars = got.length;
        attempt.acquisition_path = retrieved.includes(url)
          ? "retrieved_official_url"
          : "derived_court_url";
        attempt.injected_candidate_id = injectBody(input, n, docket, {
          url,
          text: got,
          from_cache: false,
        });
        const write = await recordVerifiedSource(input.admin, {
          category: "judgment",
          source_type: "caselaw",
          authority_type: "judgment",
          normalized_docket: normalizedDocketId(docket),
          canonical_title: n.label_he,
          official_url: url,
          court: /elyon|supremedecisions/i.test(url) ? "בית המשפט העליון" : null,
          year: n.year,
          identity_terms_matched: [normalizedDocketId(docket)],
          identity_validated: true,
          acquisition_method: attempt.acquisition_path,
          text: got,
        });
        attempt.cache_written = write.ok;
        attempt.cache_write_error = write.error;
        attempt.ms = Date.now() - tA;
        return attempt;
      }
      lastFailure = "below_threshold";
      attempt.result = "below_threshold";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (blockState.sig) {
        blockedByOrigin = true;
        attempt.result = "blocked_by_origin";
        lastFailure = `blocked_by_origin:${blockState.sig}`;
      } else if (/docket_mismatch/i.test(msg)) {
        attempt.result = "identity_mismatch";
        lastFailure = "identity_mismatch";
      } else if (/timeout|abort/i.test(msg)) {
        attempt.result = "timeout";
        lastFailure = "timeout";
      } else {
        attempt.result = "fetch_failed";
        lastFailure = msg.slice(0, 200);
      }
    }
  }

  attempt.reason = lastFailure;
  // Negative cache row with a cooldown — never permanent, never citable.
  await recordSourceFailure(input.admin, {
    category: "judgment",
    source_type: "caselaw",
    normalized_docket: normalizedDocketId(docket),
    canonical_title: n.label_he,
    official_url: attempt.urls_attempted[0] ?? null,
    status: blockedByOrigin
      ? "blocked"
      : attempt.result === "identity_mismatch"
      ? "identity_mismatch"
      : "failed",
    reason: lastFailure,
  });
  attempt.ms = Date.now() - tA;
  return attempt;
}

/**
 * Inject an acquired (or cached) body as an ordinary candidate. The only
 * asserted facts are the ones proven: official host, docket validated inside
 * the body, real text length. Classification and every downstream gate run
 * exactly as they do for a retrieved row.
 */
function injectBody(
  input: OfficialDiscoveryInput,
  n: NominatedSource,
  docket: DocketRef | null,
  src: { url: string; text: string; from_cache: boolean },
): string {
  const stored = src.text.slice(0, DISCOVERY_LIMITS.MAX_TEXT);
  const candidate_id = `nominated-source:${n.nomination_id}`;
  const base = input.candidates[0];
  const injected: Candidate = {
    candidate_id,
    claim_id: base?.claim_id ?? "C1",
    role: "binding_case_law",
    origin: "perplexity",
    retrieval_method: "perplexity",
    title: n.label_he,
    source_type: "caselaw",
    source_url: src.url || null,
    snippet: stored.slice(0, 800),
    query_he: n.topic_query ?? n.label_he,
    score: 1,
    expected_source_type: "case",
    metadata: {},
  } as Candidate;

  const integ = classifySourceIntegrity({
    title: injected.title,
    url: injected.source_url,
    snippet: injected.snippet,
    source_type: injected.source_type,
    role: injected.role,
  });
  integ.text_usability = (stored.length >= 1200
    ? "full_text"
    : "substantive_excerpt") as SourceIntegrity["text_usability"];
  integ.has_holding_text = integ.has_holding_text || HOLDING_TEXT_RE.test(stored);
  integ.citable_as = "judgment";
  integ.is_judgment_document = true;
  integ.authority_tier = "official_primary";
  integ.reject = false;
  delete integ.reject_reason;
  integ.integrity_flags = [
    ...(integ.integrity_flags ?? []),
    src.from_cache ? "verified_source_cache_hit" : "official_discovery_body_acquired",
  ];

  injected.metadata = {
    source_integrity: integ,
    extended_text: stored,
    exact_docket_match: !!docket,
    docket_match: !!docket,
    body_acquired: true,
    text_usability: integ.text_usability,
    usable_for_holding: true,
    nominated_by: n.nominated_by,
    nomination_id: n.nomination_id,
    nomination_role_in_answer: n.role_in_answer,
    from_verified_cache: src.from_cache,
    official_source_discovery: OFFICIAL_DISCOVERY_VERSION,
    ...(docket ? { canonical_authority_docket: normalizedDocketId(docket) } : {}),
  };

  input.candidates.unshift(injected);
  input.integrity.push({
    candidate_id,
    title: injected.title,
    url: injected.source_url ?? null,
    role: String(injected.role),
    original_source_type: String(injected.source_type),
    authority_tier: integ.authority_tier,
    text_usability: String(integ.text_usability),
    citable_as: String(integ.citable_as),
    integrity_flags: integ.integrity_flags ?? [],
    can_satisfy_role: true,
    is_judgment_document: true,
    has_holding_text: !!integ.has_holding_text,
    synthesis_role: "leading_candidate",
    synthesis_role_seeded_from: src.from_cache
      ? "verified_source_cache"
      : "official_source_discovery",
    synthesis_role_overridden: false,
  } as IntegrityLogRow);
  return candidate_id;
}
