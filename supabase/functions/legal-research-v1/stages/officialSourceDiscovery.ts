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
  isDiscoveryEligible,
  isIdentifierBearing,
  type NominatedSource,
  type SourceNominationResult,
} from "./sourceNomination.ts";

import {
  acquireStatuteTextFromUrl,
  STATUTE_HOST_RE,
} from "./statuteTextAcquisition.ts";
import { normalizeStatuteTitleText } from "./coreAuthorityRegistry.ts";
import {
  buildSectionVariants,
  detectStatuteSections,
  getStatuteSectionCanonicalEntry,
  normalizeSectionMarker,
} from "./statuteSectionDetection.ts";

import {
  lookupVerifiedSource,
  recordSourceFailure,
  recordVerifiedSource,
  VERIFIED_SOURCE_CACHE_VERSION,
} from "./verifiedSourceCache.ts";
import {
  JUDGMENT_SEARCH_FIRST_VERSION,
  type JudgmentSearchFirstResult,
  searchOfficialJudgmentUrls,
  validateJudgmentIdentity,
} from "./judgmentSearchFirst.ts";

export const OFFICIAL_DISCOVERY_VERSION = "official_source_discovery_v1";

export const DISCOVERY_LIMITS = {
  MAX_TARGETS: 2,
  MAX_URLS_PER_TARGET: 3,
  /** judgment_search_first_discovery_v1: one extra slot for searched URLs. */
  MAX_URLS_PER_JUDGMENT: 4,
  SEARCH_FIRST_MS: 12_000,
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
  acquisition_path:
    | "cache"
    | "retrieved_official_url"
    | "search_first_official"
    | "search_first_mirror"
    | "derived_court_url"
    | "statute_official_url"
    | "none";
  result:
    | "cache_hit"
    | "body_acquired"
    | "blocked_by_origin"
    | "identity_mismatch"
    | "below_threshold"
    | "fetch_failed"
    | "timeout"
    | "statute_not_found"
    | "section_not_found"
    | "unsupported_statute_source"
    | "not_attempted";
  body_chars: number;
  injected_candidate_id: string | null;
  cache_written: boolean;
  cache_write_error: string | null;
  reason: string | null;
  /** Cooldown scoping trace (verified_source_cache_v2). */
  cooldown_strategy?: string | null;
  cooldown_strategy_scoped?: boolean;
  ignored_other_strategy_failures?: number;
  /** judgment_search_first_discovery_v1 trace. */
  search_first?: {
    ran: boolean;
    skip_reason: string | null;
    queries: string[];
    official_urls: number;
    mirror_urls: number;
    ms: number;
  };
  /** Identity proof inside the acquired body. */
  identity?: {
    validated: boolean;
    docket_match: boolean;
    name_hits: number;
    name_required: number;
    year_match: boolean;
    court_match: boolean;
    reason: string;
  };
  /** statute lane only — normalization / validation trace. */
  statute?: {
    title_raw: string | null;
    title_normalized: string | null;
    title_normalization_changed: boolean;
    section: string | null;
    section_found: boolean | null;
    identity_tokens_matched: number;
    lane: "statute";
  };
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

// ── known_name_no_docket: search-first identity by party/case name ─────────
const NAME_STOPWORDS = new Set([
  "בגץ", "בגצ", "עא", "עפ", "בשא", "רעא", "דנא", "עהס", "תא", "נגד", "נ",
  "פסק", "דין", "פרשת", "עניין", "ענין", "בית", "המשפט", "העליון", "של", "על",
  "מדינת", "ישראל", "כנסת", "היועץ", "המשפטי", "לממשלה", "ואח",
]);

function nameTokens(label: string): string[] {
  return String(label ?? "")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/["'`׳״]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !NAME_STOPWORDS.has(t));
}

function nameMatchCount(text: string, toks: string[]): number {
  const t = String(text ?? "").replace(/["'`׳״]/g, "");
  let n = 0;
  for (const tok of toks) if (t.includes(tok)) n++;
  return n;
}

/** Minimum distinctive name tokens required to accept identity. */
function requiredNameHits(toks: string[]): number {
  return toks.length >= 2 ? 2 : 1;
}

/** Official URLs retrieval already found for a named (docket-less) case. */
function retrievedOfficialUrlsByName(candidates: Candidate[], toks: string[]): string[] {
  if (toks.length === 0) return [];
  const need = requiredNameHits(toks);
  const urls: string[] = [];
  for (const c of candidates) {
    const url = String(c.source_url ?? "");
    if (!url || !OFFICIAL_HOST_RE.test(url)) continue;
    if (isListingPage(url)) continue;
    if (nameMatchCount(`${c.title ?? ""} ${c.snippet ?? ""}`, toks) < need) continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** True when retrieval already produced a usable body for this named case. */
function poolHasBodyByName(candidates: Candidate[], toks: string[]): boolean {
  if (toks.length === 0) return false;
  const need = requiredNameHits(toks);
  for (const c of candidates) {
    if (nameMatchCount(`${c.title ?? ""}`, toks) < need) continue;
    const md = (c.metadata ?? {}) as Record<string, unknown>;
    const integ = md.source_integrity as SourceIntegrity | undefined;
    const usability = String(integ?.text_usability ?? md.text_usability ?? "");
    if (/listing|metadata|unusable|none/i.test(usability)) continue;
    if (/full_text|substantive_excerpt/.test(usability)) return true;
    if (candidateText(c).trim().length >= DISCOVERY_LIMITS.MIN_BODY_CHARS) return true;
  }
  return false;
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
    // A parse / tool-call failure upstream is not a valid "no nominations"
    // result — keep the two apart so acceptance runs are auditable.
    return emptyReport(
      !nom?.enabled
        ? "nomination_skipped"
        : nom.stage_failed
        ? "nomination_parse_failure"
        : "valid_no_nominations",
    );
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

  // v2: actionable nominations only. `known_identifier` may use the full
  // ladder (cache → retrieved official URL → deterministic derivation);
  // `known_name_no_docket` is search-first ONLY — it never reaches
  // deterministic docket derivation, because identity cannot be proven from a
  // derived URL without a docket. Exploratory topic searches never get here.
  const targets = nom.candidates
    .filter((n) => isDiscoveryEligible(n))
    .filter((n) => isIdentifierBearing(n) || n.actionability === "known_name_no_docket")
    .filter((n) => n.category === "judgment" ? (!!n.docket || !!n.label_he) : true)
    .slice(0, cap);
  report.targets = targets.length;
  if (targets.length === 0) {
    report.skip_reason = "no_actionable_nominations";
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
  // Cooldowns are scoped to the strategy this run will actually use, so an old
  // derivation failure can never suppress the new search-first lane.
  const strategy = category === "judgment" ? "search_first_judgment" : "statute_official_url";
  const discovery_version = category === "judgment"
    ? JUDGMENT_SEARCH_FIRST_VERSION
    : OFFICIAL_DISCOVERY_VERSION;
  const lookup = await lookupVerifiedSource(input.admin, {
    category,
    normalized_docket: attempt.normalized_docket,
    statute_title: n.statute_title,
    statute_section: n.statute_section,
    canonical_title: n.docket ? null : n.label_he,
    authors: n.authors,
    institution: n.institution,
    year: n.year,
    strategy,
    discovery_version,
  });
  attempt.cache_status = lookup.status;
  attempt.cooldown_strategy = lookup.cooldown_strategy;
  attempt.cooldown_strategy_scoped = lookup.cooldown_strategy_scoped;
  attempt.ignored_other_strategy_failures = lookup.ignored_other_strategy_failures;
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


  // Judgments with a docket get the full ladder (identity provable inside the
  // body). v2 adds a search-first-only lane for `known_name_no_docket`
  // judgments: official URLs retrieval already surfaced, identity proven by
  // distinctive name tokens. Deterministic derivation is never used there.
  if (!docket) {
    // statute_nomination_to_text_acquisition_v1 — statutes never have a
    // docket; route them to the official statute acquisition path instead of
    // dropping them as `no_docket_no_live_lane`.
    if (isStatuteNomination(n)) {
      const out = await handleStatuteNomination(n, input, attempt, remainingMs);
      out.ms = Date.now() - tA;
      return out;
    }
    if (n.category === "judgment" && n.actionability === "known_name_no_docket") {
      const out = await handleNamedJudgment(n, input, attempt, remainingMs);
      out.ms = Date.now() - tA;
      return out;
    }
    attempt.reason = "no_docket_no_live_lane";
    attempt.ms = Date.now() - tA;
    return attempt;
  }

  if (poolHasBody(input.candidates, docket)) {
    attempt.reason = "retrieval_already_has_body";
    attempt.ms = Date.now() - tA;
    return attempt;
  }

  // ── 2. Retrieved official URLs → searched official URLs → mirrors →
  //      deterministic derivation (last resort; the derived object code is a
  //      guess and is exactly what fails on older judgments).
  const retrieved = retrievedOfficialUrls(input.candidates, docket);
  let searched: JudgmentSearchFirstResult | null = null;
  if (remainingMs() > DISCOVERY_LIMITS.MIN_BUDGET_MS && !input.budget?.exceeded()) {
    input.budget?.mark("judgment_search_first", { nomination: n.nomination_id });
    searched = await searchOfficialJudgmentUrls({
      docket_display: n.docket ?? null,
      label: n.label_he,
      court: null,
      year: n.year ?? null,
      timeout_ms: Math.min(DISCOVERY_LIMITS.SEARCH_FIRST_MS, Math.max(2000, remainingMs() - 4000)),
    });
    attempt.search_first = {
      ran: searched.ran,
      skip_reason: searched.skip_reason,
      queries: searched.queries,
      official_urls: searched.official_urls.length,
      mirror_urls: searched.mirror_urls.length,
      ms: searched.ms,
    };
  }
  const searchOfficial = (searched?.official_urls ?? []).map((u) => u.url);
  const searchMirror = (searched?.mirror_urls ?? []).map((u) => u.url);
  const derived = isSupremeCourtDocket(docket)
    ? [
      ...deriveSupremeCourtFileUrls(docket, { maxUrls: 3 })
        .filter((u) => isTextEndpointUrl(u) || /\.html?($|[?#])/i.test(u)),
      ...deriveSupremeCourtBinaryUrls(docket, { maxUrls: 1 }),
    ]
    : [];
  const urls = [...new Set([...retrieved, ...searchOfficial, ...searchMirror, ...derived])]
    .slice(0, DISCOVERY_LIMITS.MAX_URLS_PER_JUDGMENT);
  attempt.urls_attempted = urls;
  if (urls.length === 0) {
    attempt.reason = "no_official_url_available";
    attempt.ms = Date.now() - tA;
    return attempt;
  }
  const toks = nameTokens(n.label_he);


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
          // The nominated docket can be wrong (a model guess); accept the body
          // when either the docket OR enough distinctive name tokens appear,
          // then prove identity properly below.
          validateText: (text: string) => {
            const head = text.slice(0, 20_000);
            return textContainsExactDocket(head, docket) ||
              (toks.length > 0 && nameMatchCount(head, toks) >= requiredNameHits(toks));
          },

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
        const identity = validateJudgmentIdentity({
          text: got,
          docket_present: true,
          docket_in_text: textContainsExactDocket(got.slice(0, 40_000), docket),
          name_tokens: toks,
          year: n.year ?? null,
          court: null,
        });
        attempt.identity = identity;
        if (!identity.validated) {
          attempt.result = "identity_mismatch";
          lastFailure = `identity_unproven:${identity.reason}`;
          continue;
        }
        attempt.result = "body_acquired";
        attempt.body_chars = got.length;
        attempt.acquisition_path = retrieved.includes(url)
          ? "retrieved_official_url"
          : searchOfficial.includes(url)
          ? "search_first_official"
          : searchMirror.includes(url)
          ? "search_first_mirror"
          : "derived_court_url";
        attempt.injected_candidate_id = injectBody(input, n, docket, {
          url,
          text: got,
          from_cache: false,
          acquisition_path: attempt.acquisition_path,
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
          identity_terms_matched: identity.docket_match ? [normalizedDocketId(docket)] : toks,
          identity_validated: true,
          acquisition_method: attempt.acquisition_path,
          strategy: attempt.acquisition_path === "derived_court_url"
            ? "derived_court_url"
            : attempt.acquisition_path === "retrieved_official_url"
            ? "retrieved_official_url"
            : "search_first_judgment",
          discovery_version: JUDGMENT_SEARCH_FIRST_VERSION,
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
    strategy: "search_first_judgment",
    discovery_version: JUDGMENT_SEARCH_FIRST_VERSION,
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
  src: {
    url: string;
    text: string;
    from_cache: boolean;
    kind?: "judgment" | "statute";
    acquisition_path?: string;
    statute_title?: string | null;
    statute_section?: string | null;
    statute_section_found?: boolean;
  },
): string {
  const isStatute = src.kind === "statute";
  const stored = src.text.slice(0, DISCOVERY_LIMITS.MAX_TEXT);
  const candidate_id = `nominated-source:${n.nomination_id}`;
  const base = input.candidates[0];
  const injected: Candidate = {
    candidate_id,
    claim_id: base?.claim_id ?? "C1",
    role: isStatute ? "primary_statute" : "binding_case_law",
    origin: "perplexity",
    retrieval_method: "perplexity",
    title: n.label_he,
    source_type: isStatute ? "israeli_law" : "caselaw",
    source_url: src.url || null,
    snippet: stored.slice(0, 800),
    query_he: n.topic_query ?? n.label_he,
    score: 1,
    expected_source_type: isStatute ? "statute" : "case",
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
  integ.has_holding_text = isStatute
    ? integ.has_holding_text
    : (integ.has_holding_text || HOLDING_TEXT_RE.test(stored));
  integ.citable_as = isStatute ? "statute" : "judgment";
  integ.is_judgment_document = !isStatute;
  integ.authority_tier = "official_primary";
  integ.reject = false;
  delete integ.reject_reason;
  integ.integrity_flags = [
    ...(integ.integrity_flags ?? []),
    src.from_cache ? "verified_source_cache_hit" : "official_discovery_body_acquired",
    ...(isStatute ? ["statute_text_acquired", "body_acquired"] : []),
  ];

  injected.metadata = {
    source_integrity: integ,
    extended_text: stored,
    exact_docket_match: !!docket,
    docket_match: !!docket,
    body_acquired: true,
    text_usability: integ.text_usability,
    final_text_usability: integ.text_usability,
    usable_for_holding: !isStatute,
    ...(isStatute
      ? {
        statute_text_acquired: true,
        statute_title: src.statute_title ?? null,
        statute_section: src.statute_section ?? null,
        statute_section_text_located: !!src.statute_section_found,
      }
      : {}),
    actionability: n.actionability,
    acquisition_path: src.acquisition_path ?? (src.from_cache ? "cache" : "official_discovery"),
    source_kind: "official",
    body_chars: stored.length,
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
    is_judgment_document: !isStatute,
    has_holding_text: !!integ.has_holding_text,
    synthesis_role: "leading_candidate",
    synthesis_role_seeded_from: src.from_cache
      ? "verified_source_cache"
      : "official_source_discovery",
    synthesis_role_overridden: false,
  } as IntegrityLogRow);
  return candidate_id;
}

/**
 * Search-first-only acquisition for a `known_name_no_docket` judgment.
 *
 * No docket exists, so deterministic court-file derivation is out of reach by
 * construction: identity is proven only by distinctive name tokens found
 * inside the fetched body of an official-host URL that ordinary retrieval
 * already surfaced. Everything else (budget, byte caps, PDF preflight, block
 * detection, negative caching, downstream gates) is unchanged.
 */
async function handleNamedJudgment(
  n: NominatedSource,
  input: OfficialDiscoveryInput,
  attempt: DiscoveryAttempt,
  remainingMs: () => number,
): Promise<DiscoveryAttempt> {
  const toks = nameTokens(n.label_he);
  const need = requiredNameHits(toks);
  if (toks.length === 0) {
    attempt.reason = "no_distinctive_name_tokens";
    return attempt;
  }
  if (poolHasBodyByName(input.candidates, toks)) {
    attempt.reason = "retrieval_already_has_body";
    return attempt;
  }

  // Retrieval-surfaced official URLs first, then an explicit name-based search
  // for the official document (judgment_search_first_discovery_v1).
  let searched: JudgmentSearchFirstResult | null = null;
  if (remainingMs() > DISCOVERY_LIMITS.MIN_BUDGET_MS && !input.budget?.exceeded()) {
    input.budget?.mark("judgment_search_first_named", { nomination: n.nomination_id });
    searched = await searchOfficialJudgmentUrls({
      docket_display: null,
      label: n.label_he,
      court: null,
      year: n.year ?? null,
      timeout_ms: Math.min(DISCOVERY_LIMITS.SEARCH_FIRST_MS, Math.max(2000, remainingMs() - 4000)),
    });
    attempt.search_first = {
      ran: searched.ran,
      skip_reason: searched.skip_reason,
      queries: searched.queries,
      official_urls: searched.official_urls.length,
      mirror_urls: searched.mirror_urls.length,
      ms: searched.ms,
    };
  }
  const searchOfficial = (searched?.official_urls ?? []).map((u) => u.url);
  const searchMirror = (searched?.mirror_urls ?? []).map((u) => u.url);
  const urls = [...new Set([
    ...retrievedOfficialUrlsByName(input.candidates, toks),
    ...searchOfficial,
    ...searchMirror,
  ])].slice(0, DISCOVERY_LIMITS.MAX_URLS_PER_JUDGMENT);
  attempt.urls_attempted = urls;
  if (urls.length === 0) {
    attempt.reason = "no_official_url_from_search";
    return attempt;
  }


  let lastFailure = "no_body_acquired";
  for (const url of urls) {
    if (input.budget?.exceeded() || remainingMs() < 2000) {
      attempt.result = "timeout";
      lastFailure = "budget_exhausted";
      break;
    }
    const perUrlMs = Math.max(2000, Math.min(DISCOVERY_LIMITS.PER_URL_MS, remainingMs()));
    input.budget?.mark("official_discovery_probe_named", { url, nomination: n.nomination_id });
    try {
      const got = await withTimeout(
        tryDirectFile(url, {
          allowPlainText: true,
          validateText: (text: string) =>
            nameMatchCount(text.slice(0, 20_000), toks) >= need,
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
        "official_source_discovery_named",
      );
      if (got.length >= DISCOVERY_LIMITS.MIN_BODY_CHARS) {
        const identity = validateJudgmentIdentity({
          text: got,
          docket_present: false,
          docket_in_text: false,
          name_tokens: toks,
          year: n.year ?? null,
          court: null,
        });
        attempt.identity = identity;
        if (!identity.validated) {
          attempt.result = "identity_mismatch";
          lastFailure = `identity_unproven:${identity.reason}`;
          continue;
        }
        attempt.result = "body_acquired";
        attempt.body_chars = got.length;
        attempt.acquisition_path = searchOfficial.includes(url)
          ? "search_first_official"
          : searchMirror.includes(url)
          ? "search_first_mirror"
          : "retrieved_official_url";
        attempt.injected_candidate_id = injectBody(input, n, null, {
          url,
          text: got,
          from_cache: false,
          acquisition_path: attempt.acquisition_path,
        });
        const write = await recordVerifiedSource(input.admin, {
          category: "judgment",
          source_type: "caselaw",
          authority_type: "judgment",
          normalized_docket: null,
          canonical_title: n.label_he,
          official_url: url,
          court: /elyon|supremedecisions/i.test(url) ? "בית המשפט העליון" : null,
          year: n.year,
          identity_terms_matched: toks,
          identity_validated: true,
          acquisition_method: `${attempt.acquisition_path}_by_name`,
          strategy: "search_first_judgment",
          discovery_version: JUDGMENT_SEARCH_FIRST_VERSION,
          text: got,
        });
        attempt.cache_written = write.ok;
        attempt.cache_write_error = write.error;
        return attempt;
      }

      lastFailure = "below_threshold";
      attempt.result = "below_threshold";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/mismatch|validate/i.test(msg)) {
        attempt.result = "identity_mismatch";
        lastFailure = "name_identity_mismatch";
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
  await recordSourceFailure(input.admin, {
    category: "judgment",
    source_type: "caselaw",
    normalized_docket: null,
    canonical_title: n.label_he,
    official_url: attempt.urls_attempted[0] ?? null,
    status: attempt.result === "identity_mismatch" ? "identity_mismatch" : "failed",
    reason: lastFailure,
    strategy: "search_first_judgment",
    discovery_version: JUDGMENT_SEARCH_FIRST_VERSION,

  });
  return attempt;
}


// ── statute_nomination_to_text_acquisition_v1 ──────────────────────────────
//
// A nominated statute has no docket, so the judgment ladder cannot serve it.
// This lane routes statute / statutory-section nominations to the official
// statute acquisition path (the same bounded fetch/extract used by
// `statuteTextAcquisition`), validates statute identity (and the section when
// one was nominated) inside the acquired text, and only then injects a
// candidate. Nothing downstream is relaxed: the injected row runs through
// source integrity, verifier, claim-source-match, sufficiency and the
// footnote invariant like any retrieved row.

const STATUTE_TOKEN_STOP = new Set([
  "חוק", "חוקי", "יסוד", "פקודת", "פקודה", "תקנות", "סעיף", "של", "בין", "על",
  "לחוק", "כללי", "חלק", "נוסח", "חדש", "התשי", "תשי", "תשל", "תשנ", "תשע",
]);

export function isStatuteNomination(n: NominatedSource): boolean {
  if (n.category !== "statute") return false;
  return !!(n.statute_title || n.label_he);
}

function statuteTitleTokens(title: string): string[] {
  return String(title ?? "")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/["'`׳״]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STATUTE_TOKEN_STOP.has(t));
}

function statuteHost(url: string): boolean {
  try {
    return STATUTE_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function cleanSection(raw: string | null): string | null {
  if (!raw) return null;
  const m = String(raw).match(/\d+[א-ת]?(?:\s*\([^)]{1,10}\))*/);
  return m ? normalizeSectionMarker(m[0]) : null;
}

/** Official statute URLs retrieval already surfaced for this statute title. */
function retrievedStatuteUrls(candidates: Candidate[], toks: string[]): string[] {
  if (toks.length === 0) return [];
  const need = toks.length >= 2 ? 2 : 1;
  const urls: string[] = [];
  for (const c of candidates) {
    const url = String(c.source_url ?? "");
    if (!url || !statuteHost(url)) continue;
    if (isListingPage(url)) continue;
    if (nameMatchCount(`${c.title ?? ""} ${c.snippet ?? ""}`, toks) < need) continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** True when retrieval already produced usable statutory body text. */
function poolHasStatuteBody(candidates: Candidate[], toks: string[], variants: string[]): boolean {
  if (toks.length === 0) return false;
  const need = toks.length >= 2 ? 2 : 1;
  for (const c of candidates) {
    if (nameMatchCount(`${c.title ?? ""}`, toks) < need) continue;
    const md = (c.metadata ?? {}) as Record<string, unknown>;
    const integ = md.source_integrity as SourceIntegrity | undefined;
    const usability = String(integ?.text_usability ?? md.text_usability ?? "");
    if (/listing|metadata|unusable|none/i.test(usability)) continue;
    const text = candidateText(c);
    if (text.trim().length < DISCOVERY_LIMITS.MIN_BODY_CHARS) continue;
    if (variants.length > 0 && !variants.some((v) => v.length >= 2 && text.includes(v))) continue;
    return true;
  }
  return false;
}

async function handleStatuteNomination(
  n: NominatedSource,
  input: OfficialDiscoveryInput,
  attempt: DiscoveryAttempt,
  remainingMs: () => number,
): Promise<DiscoveryAttempt> {
  const rawTitle = n.statute_title ?? n.label_he ?? null;
  const norm = normalizeStatuteTitleText(rawTitle);
  const title = norm.normalized || String(rawTitle ?? "");
  const section = cleanSection(n.statute_section);
  const variants = section ? buildSectionVariants(section) : [];
  const toks = statuteTitleTokens(title);
  attempt.statute = {
    title_raw: rawTitle,
    title_normalized: title || null,
    title_normalization_changed: norm.changed,
    section,
    section_found: null,
    identity_tokens_matched: 0,
    lane: "statute",
  };

  if (!title || toks.length === 0) {
    attempt.result = "statute_not_found";
    attempt.reason = "statute_not_found:no_normalizable_title";
    return attempt;
  }

  // A section already covered by the canonical-quote registry is served by the
  // deterministic quote path; probing it here would duplicate a verbatim
  // source without adding anything.
  if (section) {
    const ref = detectStatuteSections(`${title} סעיף ${section}`)[0];
    if (ref && getStatuteSectionCanonicalEntry(ref)) {
      attempt.reason = "canonical_quote_registry_covers_section";
      return attempt;
    }
  }

  if (poolHasStatuteBody(input.candidates, toks, variants)) {
    attempt.reason = "retrieval_already_has_body";
    return attempt;
  }

  const urls = retrievedStatuteUrls(input.candidates, toks)
    .slice(0, DISCOVERY_LIMITS.MAX_URLS_PER_TARGET);
  attempt.urls_attempted = urls;
  if (urls.length === 0) {
    attempt.result = "unsupported_statute_source";
    attempt.reason = "unsupported_statute_source:no_official_statute_url";
    return attempt;
  }

  const need = toks.length >= 2 ? 2 : 1;
  let lastFailure = "acquisition_failed";
  let lastResult: DiscoveryAttempt["result"] = "fetch_failed";
  for (const url of urls) {
    if (input.budget?.exceeded() || remainingMs() < 2000) {
      lastResult = "timeout";
      lastFailure = "acquisition_failed:budget_exhausted";
      break;
    }
    input.budget?.mark("statute_nomination_probe", { url, nomination: n.nomination_id });
    try {
      const text = await withTimeout(
        acquireStatuteTextFromUrl(
          url,
          () => (input.budget?.exceeded() ?? false) || remainingMs() < 1000,
          (name: string, detail?: Record<string, unknown>) =>
            input.budget?.mark(name, detail),
          (bytes: number) => input.budget?.allowExtraction?.(bytes) ?? true,
        ),
        Math.max(2000, Math.min(DISCOVERY_LIMITS.PER_URL_MS, remainingMs())),
        "statute_nomination_acquisition",
      );
      input.budget?.noteExtractionOutput?.(text.length);
      if (text.length < DISCOVERY_LIMITS.MIN_BODY_CHARS) {
        lastResult = "below_threshold";
        lastFailure = "acquisition_failed:below_threshold";
        continue;
      }
      const matched = nameMatchCount(text.slice(0, 60_000), toks);
      attempt.statute.identity_tokens_matched = Math.max(
        attempt.statute.identity_tokens_matched,
        matched,
      );
      if (matched < need) {
        lastResult = "identity_mismatch";
        lastFailure = "identity_mismatch:statute_title_not_in_text";
        continue;
      }
      let stored = text;
      let sectionFound: boolean | null = null;
      if (variants.length > 0) {
        const hit = variants.find((v) => v.length >= 2 && text.includes(v));
        sectionFound = !!hit;
        attempt.statute.section_found = sectionFound;
        if (!hit) {
          lastResult = "section_not_found";
          lastFailure = `section_not_found:${section}`;
          continue;
        }
        const i = text.indexOf(hit);
        stored = text.slice(Math.max(0, i - 400), Math.max(0, i - 400) + 12_000);
      }

      attempt.result = "body_acquired";
      attempt.body_chars = stored.length;
      attempt.acquisition_path = "statute_official_url";
      attempt.injected_candidate_id = injectBody(input, n, null, {
        url,
        text: stored,
        from_cache: false,
        kind: "statute",
        acquisition_path: "statute_official_url",
        statute_title: title,
        statute_section: section,
        statute_section_found: !!sectionFound,
      });
      const write = await recordVerifiedSource(input.admin, {
        category: "statute",
        source_type: "israeli_law",
        authority_type: "statute",
        normalized_docket: null,
        canonical_title: title,
        statute_title: title,
        statute_section: section,
        official_url: url,
        year: n.year,
        identity_terms_matched: toks.slice(0, 8),
        identity_validated: true,
        acquisition_method: "statute_official_url",
        strategy: "statute_official_url",
        discovery_version: OFFICIAL_DISCOVERY_VERSION,
        text: stored,

      });
      attempt.cache_written = write.ok;
      attempt.cache_write_error = write.error;
      return attempt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout|abort/i.test(msg)) {
        lastResult = "timeout";
        lastFailure = "acquisition_failed:timeout";
      } else {
        lastResult = "fetch_failed";
        lastFailure = `acquisition_failed:${msg.slice(0, 160)}`;
      }
    }
  }

  attempt.result = lastResult;
  attempt.reason = lastFailure;
  await recordSourceFailure(input.admin, {
    category: "statute",
    source_type: "israeli_law",
    normalized_docket: null,
    statute_title: title,
    statute_section: section,
    canonical_title: title,
    official_url: attempt.urls_attempted[0] ?? null,
    status: lastResult === "identity_mismatch" ? "identity_mismatch" : "failed",
    reason: lastFailure,
    strategy: "statute_official_url",
    discovery_version: OFFICIAL_DISCOVERY_VERSION,

  });
  return attempt;
}
