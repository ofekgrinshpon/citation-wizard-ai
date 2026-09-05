// canonical_judgment_text_acquisition_v1 — Option B only.
//
// Problem: the deterministic exact-body lane (`specificCaseResolution`) only
// runs when the user *typed* a docket and the run is `specific_case`. When
// `core_authority_registry_v1` seeds a canonical judgment docket (בנק המזרחי,
// דפי זהב, פנידר…), that docket lives in the seeded query, never in the
// question, so the lane is never entered and the authority stays missing,
// listing-only or body-less.
//
// This stage reuses the *same* deterministic machinery — docket → derived
// Supreme Court archive URLs (text endpoints first), byte-capped fetch,
// PDF preflight, extraction ledger, docket validated inside the body — for at
// most 1–2 registry-seeded dockets per run, and only when the normal
// retrieval pass produced no body-acquired judgment for that authority.
//
// Acquisition only. Nothing here cites, drafts, or relaxes a gate: the
// injected candidate goes through source_integrity classification and every
// downstream gate (verifier, claim_source_match, sufficiency, metadata-only
// holding gate) exactly like any other candidate. If acquisition fails, the
// authority is left absent — never asserted as read.

import type { Candidate } from "../lib/types.ts";
import type { IntegrityLogRow } from "./candidatePool.ts";
import {
  detectDockets,
  normalizedDocketId,
  textContainsExactDocket,
  type DocketRef,
} from "./docketDetection.ts";
import { classifySourceIntegrity, type SourceIntegrity } from "./sourceIntegrity.ts";
import { isGuessedCourtUrl, registerJudgmentUrl } from "../lib/judgmentUrlEligibility.ts";
import { collectDiscoveryUrlsFor } from "../lib/canonicalDiscoveryUrls.ts";
import {
  deriveSupremeCourtBinaryUrls,
  deriveSupremeCourtFileUrls,
  isSupremeCourtDocket,
  isTextEndpointUrl,
} from "./courtFileUrls.ts";
import { assessPdfExtraction } from "./pdfExtractionPreflight.ts";
import { HOLDING_TEXT_RE, tryDirectFile, withTimeout } from "./judgmentTextAcquisition.ts";
import {
  DOCTRINE_REGISTRY,
  type CanonicalAuthority,
  type CoreAuthorityRegistryResult,
} from "./coreAuthorityRegistry.ts";
import type { ProbeBudget } from "./specificCaseResolution.ts";

export const CANONICAL_ACQUISITION_VERSION = "canonical_judgment_text_acquisition_v1";

export const CANONICAL_ACQUISITION_LIMITS = {
  /** Max seeded dockets probed per run. */
  MAX_DOCKETS: 2,
  /** Max derived *text* URLs probed per docket (always first). */
  MAX_URLS_PER_DOCKET: 3,
  /**
   * type4_last_resort_probe_v1 — max derived binary (`type=4` corpus) URLs
   * probed per docket, only after every text endpoint has failed.
   */
  MAX_BINARY_URLS_PER_DOCKET: 1,
  /** Per-URL network + decode box. */
  PER_URL_MS: 10_000,
  /** Whole-stage box. */
  TOTAL_MS: 24_000,
  /** Below this, the stage does not start. */
  MIN_BUDGET_MS: 8_000,
  /** Minimum characters that count as an acquired body. */
  MIN_BODY_CHARS: 400,
  /** Never store more than this. */
  MAX_TEXT: 6_000,
  /** Largest body buffered/decoded per probe. */
  MAX_PROBE_BYTES: 4 * 1024 * 1024,
  /** A short HTML body at/below this size is a block/stub page, not a judgment. */
  BLOCK_PAGE_MAX_CHARS: 4_000,
} as const;

/** Signatures of the origin's "unauthorised request" interstitial (HTTP 200). */
const BLOCK_PAGE_SIGNATURES = [
  "חסימת בקשה לא מורשת",
  "בקשה לא מורשת",
  "access denied",
  "request blocked",
];

export type CanonicalAcquisitionResult =
  | "body_acquired"
  | "blocked_by_origin"
  | "below_threshold"
  | "identity_mismatch"
  | "timeout"
  | "fetch_failed"
  | "extraction_failed"
  | "not_found";

export interface CanonicalProbeRecord {
  probe_index: number;
  url: string;
  url_kind: "text" | "html" | "doc" | "pdf";
  url_type: string | null;
  last_resort: boolean;
  http_status: number | null;
  content_type: string | null;
  byte_length: number | null;
  body_chars: number | null;
  body_title_or_signature: string | null;
  result: CanonicalAcquisitionResult | "skipped_cap";
  detail: string | null;
  skipped_due_to_cap: boolean;
  ms: number;
}

export interface CanonicalAcquisitionAttempt {
  canonical_acquisition_attempted: true;
  authority_id: string;
  authority_name: string;
  docket: string | null;
  docket_normalized: string | null;
  source: "registry_seed";
  doctrine_id: string | null;
  query_id: string | null;
  attempted_urls_count: number;
  attempted_urls: string[];
  /** fix 2 telemetry */
  discovery_candidate_urls: string[];
  discovery_candidate_count: number;
  url_source: "discovery" | "derived" | "none";
  endpoint_type: "text" | "html" | "doc" | "pdf" | null;
  acquisition_result: CanonicalAcquisitionResult;
  body_identity_validated: boolean;
  body_chars: number;
  injected_candidate_id: string | null;
  /** Filled post-draft by `annotateCanonicalUsage`. */
  used_in_answer: boolean;
  cited: boolean;
  rejection_reason: string | null;
  /** type4_last_resort_probe_v1 */
  probes: CanonicalProbeRecord[];
  type4_derived: boolean;
  type4_probe_reached: boolean;
  type4_body_acquired: boolean;
  blocked_by_origin_count: number;
  ms: number;
}

export interface CanonicalAuthorityAcquisitionReport {
  version: typeof CANONICAL_ACQUISITION_VERSION;
  enabled: boolean;
  skip_reason: string | null;
  doctrine_id: string | null;
  eligible_authorities: string[];
  skipped_already_body_acquired: string[];
  skipped_not_derivable: string[];
  attempts: CanonicalAcquisitionAttempt[];
  attempted_count: number;
  body_acquired_count: number;
  /** type4_last_resort_probe_v1 aggregates */
  type4_derived_count: number;
  type4_probe_reached_count: number;
  type4_body_acquired_count: number;
  blocked_by_origin_count: number;
  injected_candidate_ids: string[];
  /** fix 2 — authorities that stayed unacquired, and why. */
  canonical_authority_gaps: Array<{
    authority_id: string;
    authority_name: string;
    docket: string | null;
    discovery_candidate_count: number;
    reason: string;
  }>;
  discovery_fed_attempts: number;
  ms: number;
}


function emptyReport(
  skip_reason: string | null,
  doctrine_id: string | null = null,
): CanonicalAuthorityAcquisitionReport {
  return {
    version: CANONICAL_ACQUISITION_VERSION,
    enabled: skip_reason === null,
    skip_reason,
    doctrine_id,
    eligible_authorities: [],
    skipped_already_body_acquired: [],
    skipped_not_derivable: [],
    attempts: [],
    attempted_count: 0,
    body_acquired_count: 0,
    type4_derived_count: 0,
    type4_probe_reached_count: 0,
    type4_body_acquired_count: 0,
    blocked_by_origin_count: 0,
    injected_candidate_ids: [],
    canonical_authority_gaps: [],
    discovery_fed_attempts: 0,
    ms: 0,
  };
}

/** Judgment-bearing roles the activation rule allows. */
const JUDGMENT_ROLES = new Set(["binding_case_law", "persuasive_case_law", "applying_case_law"]);

function endpointType(url: string): CanonicalAcquisitionAttempt["endpoint_type"] {
  if (/\.html?($|[?#])/i.test(url)) return "html";
  if (isTextEndpointUrl(url)) return "text";
  if (/\.docx?($|[?#])/i.test(url)) return "doc";
  return "pdf";
}

function candidateText(c: Candidate): string {
  const md = (c.metadata ?? {}) as Record<string, unknown>;
  const ext = typeof md.extended_text === "string" ? md.extended_text : "";
  return `${ext}\n${c.snippet ?? ""}`;
}

/**
 * True when the pool already holds a *body-acquired* judgment for this docket.
 * Listing pages, metadata-only rows and body-less references do not count —
 * those are exactly the states this stage exists to repair.
 */
function poolHasBody(candidates: Candidate[], d: DocketRef): boolean {
  for (const c of candidates) {
    const identity = textContainsExactDocket(c.title, d) ||
      textContainsExactDocket(String(c.source_url ?? ""), d) ||
      textContainsExactDocket(c.snippet ?? "", d);
    if (!identity) continue;
    const md = (c.metadata ?? {}) as Record<string, unknown>;
    const integ = md.source_integrity as SourceIntegrity | undefined;
    const usability = String(integ?.text_usability ?? md.text_usability ?? "");
    const body = candidateText(c).trim();
    const usable = /full_text|substantive_excerpt/.test(usability) ||
      body.length >= CANONICAL_ACQUISITION_LIMITS.MIN_BODY_CHARS;
    if (usable && !/listing|metadata|unusable|none/i.test(usability)) return true;
  }
  return false;
}

export interface DiscoveredJudgmentUrl {
  url: string;
  title?: string | null;
  /** Where the URL came from (official discovery, perplexity, pool). */
  discovery_source: string;
}

export interface CanonicalAcquisitionInput {
  registry: CoreAuthorityRegistryResult;
  candidates: Candidate[];
  /**
   * web_source_usability_and_authority_selection_v1 (fix 2) — official URLs
   * that DISCOVERY actually returned. They are preferred over derived guesses;
   * every downstream gate (eligibility, identity, body, listing, integrity)
   * is unchanged.
   */
  discovered_urls?: DiscoveredJudgmentUrl[];
  integrity: IntegrityLogRow[];
  budget?: ProbeBudget;
  /** Router-scoped ceiling; clamped to MAX_DOCKETS. */
  max_dockets?: number;
  markDurable?: (name: string, detail?: Record<string, unknown>) => Promise<unknown> | unknown;
}

export async function runCanonicalAuthorityAcquisition(
  input: CanonicalAcquisitionInput,
): Promise<CanonicalAuthorityAcquisitionReport> {
  const t0 = Date.now();
  const reg = input.registry;
  if (!reg?.triggered) return emptyReport("registry_not_triggered");

  const doctrine = DOCTRINE_REGISTRY.find((d) => d.doctrine_id === reg.doctrine_id);
  const byId = new Map<string, CanonicalAuthority>(
    (doctrine?.canonical_authorities ?? []).map((a) => [a.authority_id, a]),
  );

  const report = emptyReport(null, reg.doctrine_id);

  const remainingMs = (): number => {
    const stage = CANONICAL_ACQUISITION_LIMITS.TOTAL_MS - (Date.now() - t0);
    const outer = input.budget ? input.budget.remaining() : Number.POSITIVE_INFINITY;
    return Math.min(stage, outer);
  };
  if (input.budget?.exceeded() || remainingMs() < CANONICAL_ACQUISITION_LIMITS.MIN_BUDGET_MS) {
    report.enabled = false;
    report.skip_reason = "retrieval_budget_low";
    report.ms = Date.now() - t0;
    return report;
  }

  // ── Activation rule ─────────────────────────────────────────────────────
  interface Target {
    auth: CanonicalAuthority;
    tel: (typeof reg.authorities)[number];
    docket: DocketRef;
  }
  const targets: Target[] = [];
  for (const tel of reg.authorities) {
    const auth = byId.get(tel.authority_id);
    if (!auth) continue;
    // (2) judgment / binding / applying case law only
    if (auth.kind !== "case" || auth.expected_source_type !== "case") continue;
    if (!JUDGMENT_ROLES.has(String(auth.role))) continue;
    // (1) clear Israeli docket + prefix
    const d = detectDockets(`${auth.label} ${auth.docket ?? ""}`)[0];
    if (!d) continue;
    report.eligible_authorities.push(auth.authority_id);
    // (3) normal retrieval produced no body-acquired judgment for it
    if (poolHasBody(input.candidates, d)) {
      report.skipped_already_body_acquired.push(auth.authority_id);
      continue;
    }
    if (!isSupremeCourtDocket(d)) {
      report.skipped_not_derivable.push(auth.authority_id);
      continue;
    }
    targets.push({ auth, tel, docket: d });
  }

  const cap = Math.max(
    0,
    Math.min(input.max_dockets ?? CANONICAL_ACQUISITION_LIMITS.MAX_DOCKETS,
      CANONICAL_ACQUISITION_LIMITS.MAX_DOCKETS),
  );
  const queue = targets.slice(0, cap);
  if (queue.length === 0) {
    report.skip_reason = targets.length === 0 ? "no_eligible_seeded_docket" : "docket_cap_zero";
    report.ms = Date.now() - t0;
    return report;
  }

  await input.markDurable?.("canonical_authority_acquisition_start", {
    dockets: queue.map((q) => normalizedDocketId(q.docket)),
  });

  for (const target of queue) {
    if (input.budget?.exceeded()) break;
    if (remainingMs() < CANONICAL_ACQUISITION_LIMITS.MIN_BUDGET_MS) break;
    const attempt = await probeAuthority(target, input, remainingMs, reg.doctrine_id ?? null);
    report.attempts.push(attempt);
    if (attempt.injected_candidate_id) {
      report.injected_candidate_ids.push(attempt.injected_candidate_id);
    }
  }

  report.attempted_count = report.attempts.length;
  report.body_acquired_count = report.attempts
    .filter((a) => a.acquisition_result === "body_acquired").length;
  report.type4_derived_count = report.attempts.filter((a) => a.type4_derived).length;
  report.type4_probe_reached_count = report.attempts.filter((a) => a.type4_probe_reached).length;
  report.type4_body_acquired_count = report.attempts.filter((a) => a.type4_body_acquired).length;
  report.blocked_by_origin_count = report.attempts
    .reduce((n, a) => n + a.blocked_by_origin_count, 0);
  report.discovery_fed_attempts = report.attempts.filter((a) => a.url_source === "discovery").length;
  report.canonical_authority_gaps = report.attempts
    .filter((a) => a.acquisition_result !== "body_acquired")
    .map((a) => ({
      authority_id: a.authority_id,
      authority_name: a.authority_name,
      docket: a.docket,
      discovery_candidate_count: a.discovery_candidate_count,
      reason: a.rejection_reason ?? a.acquisition_result,
    }));
  report.ms = Date.now() - t0;
  await input.markDurable?.("canonical_authority_acquisition_done", {
    attempted: report.attempted_count,
    body_acquired: report.body_acquired_count,
    type4_reached: report.type4_probe_reached_count,
    type4_body_acquired: report.type4_body_acquired_count,
    blocked_by_origin: report.blocked_by_origin_count,
  });
  return report;
}

function urlTypeParam(url: string): string | null {
  const m = String(url).match(/[?&]type=(\d+)/);
  return m ? m[1] : null;
}

function isType4Url(url: string): boolean {
  return urlTypeParam(url) === "4";
}

/** Detects the origin's short block/stub page (HTTP 200, no judgment body). */
function blockPageSignature(textPrefix: string, docket: DocketRef): string | null {
  const t = textPrefix.trim();
  if (t.length > CANONICAL_ACQUISITION_LIMITS.BLOCK_PAGE_MAX_CHARS) return null;
  for (const sig of BLOCK_PAGE_SIGNATURES) {
    if (t.toLowerCase().includes(sig.toLowerCase())) return sig;
  }
  if (t.length > 0 && !textContainsExactDocket(t, docket)) return "short_page_without_docket";
  return null;
}

async function probeAuthority(
  target: { auth: CanonicalAuthority; docket: DocketRef },
  input: CanonicalAcquisitionInput,
  remainingMs: () => number,
  doctrineId: string | null,
): Promise<CanonicalAcquisitionAttempt> {
  const tA = Date.now();
  const { auth, docket } = target;
  // fix 2 — discovered official URLs for this exact docket come FIRST.
  const discoveryUrls = collectDiscoveryUrlsFor(
    input.discovered_urls ?? [],
    input.candidates.map((c) => ({ url: String(c.source_url ?? ""), title: c.title ?? "" })),
    docket,
  );
  const textUrls = deriveSupremeCourtFileUrls(docket, {
    maxUrls: CANONICAL_ACQUISITION_LIMITS.MAX_URLS_PER_DOCKET,
  }).filter((u) => isTextEndpointUrl(u) || /\.html?($|[?#])/i.test(u));
  // type4_last_resort_probe_v1: the corpus endpoint proven to serve bodies,
  // probed only after every text endpoint has failed.
  const binaryUrls = deriveSupremeCourtBinaryUrls(docket, {
    maxUrls: CANONICAL_ACQUISITION_LIMITS.MAX_BINARY_URLS_PER_DOCKET,
  });
  // judgment_url_guess_suppression_v1 — derived guesses are not fetched.
  // canonical_body_acquisition_and_csm_survival_v1 — URLs that targeted
  // discovery actually returned carry search-first provenance, so the relay
  // gate treats them as trusted (guessed derivations stay suppressed).
  for (const u of discoveryUrls) registerJudgmentUrl(u, "search_first");
  const urls = [
    ...discoveryUrls,
    ...[...textUrls, ...binaryUrls].filter((u) => !isGuessedCourtUrl(u)),
  ].filter((u, i, arr) => arr.indexOf(u) === i);
  const attempt: CanonicalAcquisitionAttempt = {
    canonical_acquisition_attempted: true,
    authority_id: auth.authority_id,
    authority_name: auth.label,
    docket: auth.docket ?? null,
    docket_normalized: normalizedDocketId(docket),
    source: "registry_seed",
    doctrine_id: doctrineId,
    query_id: `core_authority_registry:${doctrineId ?? "?"}:${auth.authority_id}`,
    attempted_urls_count: urls.length,
    attempted_urls: urls,
    discovery_candidate_urls: discoveryUrls,
    discovery_candidate_count: discoveryUrls.length,
    url_source: urls.length === 0 ? "none" : (discoveryUrls.includes(urls[0]) ? "discovery" : "derived"),
    endpoint_type: urls.length ? endpointType(urls[0]) : null,
    acquisition_result: "not_found",
    body_identity_validated: false,
    body_chars: 0,
    injected_candidate_id: null,
    used_in_answer: false,
    cited: false,
    rejection_reason: null,
    probes: [],
    type4_derived: binaryUrls.some(isType4Url),
    type4_probe_reached: false,
    type4_body_acquired: false,
    blocked_by_origin_count: 0,
    ms: 0,
  };
  if (urls.length === 0) {
    attempt.rejection_reason = "no_derivable_url";
    attempt.ms = Date.now() - tA;
    return attempt;
  }

  let identitySeen = false;
  let stopped = false;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const lastResort = isType4Url(url);
    const probe: CanonicalProbeRecord = {
      probe_index: i,
      url,
      url_kind: endpointType(url) ?? "text",
      url_type: urlTypeParam(url),
      last_resort: lastResort,
      http_status: null,
      content_type: null,
      byte_length: null,
      body_chars: null,
      body_title_or_signature: null,
      result: "skipped_cap",
      detail: null,
      skipped_due_to_cap: false,
      ms: 0,
    };
    if (stopped) {
      probe.skipped_due_to_cap = true;
      probe.detail = "budget_or_earlier_success";
      attempt.probes.push(probe);
      continue;
    }
    if (input.budget?.exceeded()) {
      attempt.acquisition_result = "timeout";
      attempt.rejection_reason = "retrieval_budget_exceeded";
      probe.result = "timeout";
      probe.detail = "retrieval_budget_exceeded";
      attempt.probes.push(probe);
      stopped = true;
      continue;
    }
    const perUrlMs = Math.max(
      1000,
      Math.min(CANONICAL_ACQUISITION_LIMITS.PER_URL_MS, remainingMs()),
    );
    if (perUrlMs <= 1000 && remainingMs() < 1000) {
      attempt.acquisition_result = "timeout";
      attempt.rejection_reason = "stage_budget_exhausted";
      probe.result = "timeout";
      probe.detail = "stage_budget_exhausted";
      attempt.probes.push(probe);
      stopped = true;
      continue;
    }
    attempt.endpoint_type = endpointType(url);
    if (lastResort) attempt.type4_probe_reached = true;
    const tP = Date.now();
    input.budget?.mark("canonical_probe_start", {
      url,
      authority: auth.authority_id,
      probe_index: i,
      last_resort: lastResort,
    });
    const blockState: { sig: string | null } = { sig: null };
    try {
      const got = await withTimeout(
        tryDirectFile(url, {
          allowPlainText: true,
          onStage: (name: string, detail?: Record<string, unknown>) => {
            if (name === "response_headers" && detail) {
              probe.http_status = Number(detail.status ?? 0) || null;
              probe.content_type = detail.contentType ? String(detail.contentType) : null;
              const declared = Number(detail.declaredLength ?? 0) || 0;
              if (declared) probe.byte_length = declared;
            }
            if (detail && typeof detail.bytes === "number" && detail.bytes > 0) {
              probe.byte_length = detail.bytes;
            }
            if (name === "clean_done" && detail && typeof detail.chars === "number") {
              probe.body_chars = detail.chars;
            }
          },
          inspectText: (prefix: string) => {
            blockState.sig = blockPageSignature(prefix, docket);
            if (blockState.sig) probe.body_title_or_signature = blockState.sig;
          },
          // Identity must be proven *inside* the body before it is treated as
          // this authority — a derived path alone is never enough.
          validateText: (text: string) => {
            // canonical_body_acquisition_and_csm_survival_v1 — a judgment that
            // merely CITES this docket is not this judgment. The docket must
            // appear in the document header, and a distinctive party name from
            // the canonical label must appear too.
            const head = text.slice(0, 3_000);
            const inHeader = textContainsExactDocket(head, docket);
            const parties = String(auth.label ?? "")
              .replace(/[\u05d0-\u05ea]{2,4}["'\u05f3\u05f4]?\s*\d{1,6}\s*\/\s*\d{2,4}/g, " ")
              .split(/\s+\u05e0['\u05f3"\u05f4]?\s+|\s+\u05e0\u05d2\u05d3\s+/)
              .flatMap((p) => p.split(/[\s,\.\(\)"'\u05f3\u05f4]+/))
              .filter((w) => w.length >= 4 && /[\u0590-\u05ff]/.test(w));
            const partyHit = parties.length === 0 ||
              parties.some((w) => text.slice(0, 20_000).includes(w));
            const ok = inHeader && partyHit;
            if (ok) identitySeen = true;
            return ok;
          },
          signal: AbortSignal.timeout(perUrlMs),
          maxBytes: CANONICAL_ACQUISITION_LIMITS.MAX_PROBE_BYTES,
          budgetExceeded: () => input.budget?.exceeded() ?? false,
          // Speculative: charged to the run-level extraction ledger, so a
          // heavy PDF here can never starve the rest of the pipeline.
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
        "canonical_court_url_derivation",
      );
      if (got.length >= CANONICAL_ACQUISITION_LIMITS.MIN_BODY_CHARS) {
        attempt.acquisition_result = "body_acquired";
        attempt.body_identity_validated = true;
        attempt.body_chars = Math.min(got.length, CANONICAL_ACQUISITION_LIMITS.MAX_TEXT);
        attempt.injected_candidate_id = injectAuthorityBody(input, auth, docket, url, got);
        if (lastResort) attempt.type4_body_acquired = true;
        probe.result = "body_acquired";
        probe.body_chars = got.length;
        probe.ms = Date.now() - tP;
        attempt.probes.push(probe);
        stopped = true;
        continue;
      }
      attempt.acquisition_result = "below_threshold";
      attempt.rejection_reason = "body_below_threshold";
      probe.result = "below_threshold";
      probe.body_chars = got.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const name = (err as { name?: string } | null)?.name ?? "";
      let result: CanonicalAcquisitionResult;
      if (blockState.sig) {
        // A short WAF/stub page is an origin block, not an empty archive slot.
        result = "blocked_by_origin";
      } else if (/docket_mismatch/i.test(msg)) {
        result = "identity_mismatch";
      } else if (/below_threshold/i.test(msg)) {
        result = "below_threshold";
      } else if (
        msg === "retrieval_timeout" || name === "TimeoutError" || /timeout|abort/i.test(msg)
      ) {
        result = "timeout";
      } else if (/extraction|pdf/i.test(msg)) {
        result = "extraction_failed";
      } else {
        result = "fetch_failed";
      }
      attempt.acquisition_result = result;
      attempt.rejection_reason = blockState.sig
        ? `blocked_by_origin:${blockState.sig}`
        : msg.slice(0, 200);
      probe.result = result;
      probe.detail = msg.slice(0, 200);
      if (result === "blocked_by_origin") attempt.blocked_by_origin_count++;
    }
    probe.ms = Date.now() - tP;
    attempt.probes.push(probe);
  }

  if (attempt.acquisition_result !== "body_acquired") {
    if (identitySeen && attempt.acquisition_result === "not_found") {
      attempt.acquisition_result = "extraction_failed";
    }
    attempt.rejection_reason ??= "no_body_acquired";
  }
  attempt.ms = Date.now() - tA;
  return attempt;
}

/**
 * Inject the acquired body as an ordinary candidate. Classification runs
 * through `classifySourceIntegrity` exactly like a retrieved row; the only
 * asserted facts are the ones proven by the probe (official archive host,
 * docket validated inside the body, real text length).
 */
function injectAuthorityBody(
  input: CanonicalAcquisitionInput,
  auth: CanonicalAuthority,
  docket: DocketRef,
  url: string,
  text: string,
): string {
  const stored = text.slice(0, CANONICAL_ACQUISITION_LIMITS.MAX_TEXT);
  const candidate_id = `canonical-authority:${auth.authority_id}`;
  const base = input.candidates[0];
  const injected: Candidate = {
    candidate_id,
    claim_id: base?.claim_id ?? "C1",
    role: auth.role,
    origin: "perplexity",
    retrieval_method: "perplexity",
    title: auth.label,
    source_type: "caselaw",
    source_url: url,
    snippet: stored.slice(0, 800),
    query_he: auth.query_he,
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
    "canonical_authority_body_acquired",
  ];

  injected.metadata = {
    source_integrity: integ,
    extended_text: stored,
    exact_docket_match: true,
    docket_match: true,
    body_acquired: true,
    text_usability: integ.text_usability,
    usable_for_holding: true,
    canonical_authority_id: auth.authority_id,
    canonical_authority_docket: normalizedDocketId(docket),
    canonical_authority_acquisition: CANONICAL_ACQUISITION_VERSION,
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
    synthesis_role_seeded_from: "canonical_authority_acquisition",
    synthesis_role_overridden: false,
  } as IntegrityLogRow);
  return candidate_id;
}

/**
 * Post-draft measurement only: mark which acquired authorities actually
 * reached the answer, plus the body-grounding counters required by
 * canonical_judgment_text_acquisition_v1 reporting.
 */
export function annotateCanonicalUsage(
  report: CanonicalAuthorityAcquisitionReport,
  input: {
    usedCandidateIds: Set<string>;
    citedCandidateIds: Set<string>;
    citedSources: Array<{ candidate_id: string; citable_as?: string | null; body_acquired: boolean; metadata_only: boolean }>;
  },
): CanonicalAuthorityAcquisitionReport & {
  citations_without_body_acquired: number;
  bodyless_judgment_citations: number;
  metadata_only_holdings: number;
} {
  const attempts = report.attempts.map((a) => ({
    ...a,
    used_in_answer: a.injected_candidate_id
      ? input.usedCandidateIds.has(a.injected_candidate_id)
      : false,
    cited: a.injected_candidate_id ? input.citedCandidateIds.has(a.injected_candidate_id) : false,
  }));
  return {
    ...report,
    attempts,
    citations_without_body_acquired: input.citedSources.filter((s) => !s.body_acquired).length,
    bodyless_judgment_citations: input.citedSources.filter(
      (s) => !s.body_acquired && String(s.citable_as ?? "") === "judgment",
    ).length,
    metadata_only_holdings: input.citedSources.filter((s) => s.metadata_only).length,
  };
}
