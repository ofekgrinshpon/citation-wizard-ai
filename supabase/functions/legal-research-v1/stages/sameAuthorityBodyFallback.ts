/**
 * same_authority_body_fallback_v1
 *
 * Live evidence (run ccfe1fe5-4266-43f5-896a-be758b1e721c): בג"ץ 1000/92 בבלי
 * was found, survived into the pack and was verifier-usable, but the ONLY
 * representation that reached the pool was the official court PDF, and every
 * court-egress attempt failed. With no acquired body CSM correctly dropped it
 * (`no_acquired_body_or_weak_fit`), so a strongly identified authority was lost
 * purely because one representation was unreadable.
 *
 * This stage adds a narrowly bounded fallback: when a preferred representation
 * of an ALREADY identified authority has no usable body, look for another
 * representation of THE SAME authority —
 *
 *   1. inside the current run first (pool candidates, dropped candidates,
 *      duplicate groups, discovery results), matched by normalized docket
 *      identity only — never by topical similarity;
 *   2. and only if the run holds none, ONE bounded exact-authority recovery
 *      lookup built solely from the known docket / party label.
 *
 * Nothing is weakened: the recovered URL goes through the same bounded web
 * body fetch, must yield a substantive body, and must pass
 * `validateJudgmentIdentityStrict` (docket match + judgment-document identity)
 * before `applyAcquiredJudgmentBody` marks it as a primary mirror. On any
 * failure the candidate is left exactly as it was. Official/canonical bodies
 * keep their preference — this lane only runs where they produced nothing.
 */

import type { Candidate } from "../lib/types.ts";
import type { SourceIntegrity } from "./sourceIntegrity.ts";
import {
  detectDockets,
  type DocketRef,
  normalizedDocketId,
  textContainsExactDocket,
} from "./docketDetection.ts";
import { detectJudgmentEvidence } from "./documentEvidenceClassification.ts";
import { validateJudgmentIdentityStrict } from "./judgmentIdentity.ts";
import { applyAcquiredJudgmentBody } from "./judgmentTextAcquisition.ts";
import { fetchSecondaryBody } from "./secondaryBodyAcquisition.ts";
import {
  COURT_HOST_RE,
  isAccessControlledUrl,
  PAYWALLED_HOST_RE,
} from "./secondaryWebAcquisition.ts";
import { partyTokensFromTitle, repairDocketPrefixFinals } from "./webJudgmentBodyAcquisition.ts";

export const SAME_AUTHORITY_FALLBACK_VERSION = "same_authority_body_fallback_v1";

export const SAME_AUTHORITY_FALLBACK_LIMITS = {
  /** Authorities recovered per run. Hard ceiling. */
  MAX_AUTHORITIES: 2,
  /** Recovery lookups per authority. Hard ceiling. */
  MAX_LOOKUPS_PER_AUTHORITY: 1,
  /** Fetch attempts per authority (existing alternates + recovery results). */
  MAX_FETCHES_PER_AUTHORITY: 2,
  MIN_BODY_CHARS: 2_000,
  LOOKUP_MS: 12_000,
  TOTAL_MS: 30_000,
} as const;

/** A representation of an authority that could be fetched for its body. */
export interface AlternateRepresentation {
  origin: "pool_candidate" | "dropped_candidate" | "discovery_result" | "recovery_lookup";
  candidate_id: string | null;
  title: string;
  url: string;
  host: string;
  /** Ranking signals — used ONLY between representations of the same authority. */
  signals: string[];
  score: number;
}

export interface AuthorityFallbackRow {
  authority_id: string;
  normalized_docket: string;
  preferred_representation: string | null;
  preferred_body_status: string;
  existing_alternates_found: number;
  selected_existing_alternate: string | null;
  recovery_lookup_attempted: boolean;
  recovery_query: string | null;
  recovery_results_count: number;
  selected_recovery_url: string | null;
  body_attempted: boolean;
  body_acquired: boolean;
  body_chars: number;
  identity_validated: boolean;
  docket_match: boolean;
  final_representation: string | null;
  failure_reason: string | null;
  ms: number;
}

export interface SameAuthorityFallbackReport {
  version: typeof SAME_AUTHORITY_FALLBACK_VERSION;
  ran: boolean;
  skip_reason: string | null;
  eligible_authorities: number;
  attempted_authorities: number;
  recovered_authorities: number;
  recovery_lookups_used: number;
  authority_body_fallback: AuthorityFallbackRow[];
  stop_reason:
    | "completed"
    | "stage_not_run"
    | "no_eligible_authorities"
    | "budget_exceeded"
    | "stage_timeout";
  ms: number;
}

/** Minimal view of a dropped candidate (PoolDrop) this stage can use. */
export interface DroppedRepresentation {
  candidate_id?: string | null;
  title: string;
  url: string | null;
  source_type?: string | null;
}

/** Minimal view of a discovery result (URL + label) this stage can use. */
export interface DiscoveryRepresentation {
  url: string;
  title?: string | null;
}

export interface RecoveryLookupResult {
  query: string;
  urls: Array<{ url: string; title?: string | null }>;
}

export interface SameAuthorityFallbackInput {
  candidates: Candidate[];
  dropped?: DroppedRepresentation[];
  discovery_urls?: DiscoveryRepresentation[];
  /**
   * Normalized dockets whose preferred (official/canonical/web) body attempt
   * already ran and produced nothing usable. Only these become eligible.
   */
  failed_body_dockets?: Array<{ normalized_docket: string; status: string }>;
  enabled?: boolean;
  run_id?: string;
  retrieval_budget?: { exceeded: () => boolean; allowExtraction?: (bytes: number) => boolean };
  markDurable?: (name: string, detail?: Record<string, unknown>) => void | Promise<void>;
  /** Bounded exact-authority lookup. Injected so tests never hit the network. */
  recoveryLookup?: (a: {
    label: string;
    docket_display: string;
    party_names: string[];
  }) => Promise<RecoveryLookupResult>;
  /** Injectable for tests; defaults to the shared bounded web body fetcher. */
  fetchBody?: (url: string) => Promise<{ text: string; final_url?: string | null }>;
}

function hostOf(url: string | null | undefined): string {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function docketOfText(...parts: Array<string | null | undefined>): DocketRef | null {
  for (const p of parts) {
    if (!p) continue;
    let s = String(p);
    try {
      s = decodeURIComponent(s);
    } catch { /* keep raw */ }
    const found = detectDockets(repairDocketPrefixFinals(s).replace(/[-_]/g, " "));
    if (found.length > 0) return found[0];
  }
  return null;
}

function bodyChars(c: Candidate): number {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  return typeof meta.extended_text === "string" ? meta.extended_text.length : 0;
}

function isJudgmentCandidate(c: Candidate): boolean {
  const integ = ((c.metadata ?? {}) as Record<string, unknown>).source_integrity as
    | SourceIntegrity
    | undefined;
  const type = String(c.source_type ?? "").toLowerCase();
  if (type === "court_case" || type === "judgment" || type === "official_primary") return true;
  if (String(integ?.citable_as ?? "") === "judgment") return true;
  if (integ?.is_judgment_document === true) return true;
  const role = String(c.role ?? "");
  return role === "binding_case_law" || role === "persuasive_case_law";
}

/** A URL this stage is allowed to fetch through the web body lane. */
export function isFetchableAlternateUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  const host = hostOf(url);
  if (!host) return false;
  if (COURT_HOST_RE.test(host)) return false; // canonical / relay lane owns these
  if (PAYWALLED_HOST_RE.test(url) || isAccessControlledUrl(url)) return false;
  return true;
}

/** Judgment-document identity markers that must appear in the fetched body. */
const JUDGMENT_BODY_MARKER_RE =
  /(פסק[\s-]?דין|פסק['׳]?\s*הדין|החלטה|כב['׳]?\s*השופט|כבוד\s*השופט|השופטת|הנשיא|לפני:|בפני\s*הרכב|העתירה\s*(נדחית|מתקבלת)|הערעור\s*(נדחה|מתקבל))/;

const LISTING_URL_RE = /(search|results|list|index|category|tags?|archive|rss)(\/|\?|$)/i;

/**
 * Score one representation of an authority. Signals are the existing ones:
 * exact docket identity in title/URL, judgment-document evidence, fetchable
 * concrete URL, source integrity, substantive text potential. This ranking is
 * only ever applied WITHIN one authority — never between authorities.
 */
export function scoreAlternate(
  rep: Omit<AlternateRepresentation, "score" | "signals">,
  docket: DocketRef,
  opts: { snippet?: string | null; integrity?: SourceIntegrity } = {},
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;
  const title = String(rep.title ?? "");
  let decodedUrl = rep.url;
  try {
    decodedUrl = decodeURIComponent(rep.url);
  } catch { /* keep raw */ }

  if (textContainsExactDocket(repairDocketPrefixFinals(title), docket)) {
    score += 3;
    signals.push("exact_docket_in_title");
  }
  if (textContainsExactDocket(repairDocketPrefixFinals(decodedUrl.replace(/[-_]/g, " ")), docket)) {
    score += 2;
    signals.push("exact_docket_in_url");
  }
  const ev = detectJudgmentEvidence({ url: rep.url, title, snippet: opts.snippet ?? "" });
  if (ev) {
    score += 2;
    signals.push(`judgment_document_evidence:${ev.signals.join("|")}`);
  }
  if (opts.integrity?.is_judgment_document === true) {
    score += 1;
    signals.push("integrity_judgment_document");
  }
  if (opts.integrity?.reject === true) {
    score -= 3;
    signals.push("integrity_reject");
  }
  if ((opts.snippet ?? "").length >= 400) {
    score += 1;
    signals.push("substantive_snippet");
  }
  if (/\.(pdf|doc|docx|rtf|txt)$/i.test(new URL(rep.url, "https://x.invalid").pathname)) {
    score += 1;
    signals.push("document_file");
  }
  if (LISTING_URL_RE.test(rep.url)) {
    score -= 3;
    signals.push("listing_like");
  }
  if (rep.origin === "pool_candidate") {
    score += 0.5;
    signals.push("already_in_pool");
  }
  return { score, signals };
}

/**
 * Collect every representation of `docket` that ALREADY exists in this run,
 * matched by normalized docket identity only.
 */
export function collectExistingAlternates(
  docket: DocketRef,
  preferredId: string | null,
  input: SameAuthorityFallbackInput,
): AlternateRepresentation[] {
  const want = normalizedDocketId(docket);
  const out: AlternateRepresentation[] = [];
  const seen = new Set<string>();

  const add = (rep: Omit<AlternateRepresentation, "score" | "signals">, extra: {
    snippet?: string | null;
    integrity?: SourceIntegrity;
  }) => {
    const key = rep.url.replace(/[#?].*$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const { score, signals } = scoreAlternate(rep, docket, extra);
    out.push({ ...rep, score, signals });
  };

  for (const c of input.candidates ?? []) {
    if (preferredId && c.candidate_id === preferredId) continue;
    const url = String(c.source_url ?? "");
    if (!isFetchableAlternateUrl(url)) continue;
    const d = docketOfText(c.title, c.source_url);
    if (!d || normalizedDocketId(d) !== want) continue;
    const integ = ((c.metadata ?? {}) as Record<string, unknown>).source_integrity as
      | SourceIntegrity
      | undefined;
    add({
      origin: "pool_candidate",
      candidate_id: c.candidate_id,
      title: String(c.title ?? ""),
      url,
      host: hostOf(url),
    }, { snippet: c.snippet ?? "", integrity: integ });
  }

  for (const d0 of input.dropped ?? []) {
    const url = String(d0.url ?? "");
    if (!isFetchableAlternateUrl(url)) continue;
    const d = docketOfText(d0.title, d0.url);
    if (!d || normalizedDocketId(d) !== want) continue;
    add({
      origin: "dropped_candidate",
      candidate_id: d0.candidate_id ?? null,
      title: String(d0.title ?? ""),
      url,
      host: hostOf(url),
    }, {});
  }

  for (const d0 of input.discovery_urls ?? []) {
    const url = String(d0.url ?? "");
    if (!isFetchableAlternateUrl(url)) continue;
    const d = docketOfText(d0.title, d0.url);
    if (!d || normalizedDocketId(d) !== want) continue;
    add({
      origin: "discovery_result",
      candidate_id: null,
      title: String(d0.title ?? ""),
      url,
      host: hostOf(url),
    }, {});
  }

  return out.sort((a, b) => b.score - a.score);
}

interface EligibleAuthority {
  candidate: Candidate;
  docket: DocketRef;
  normalized_docket: string;
  preferred_body_status: string;
}

/** Requirement 1: the narrow fallback condition. */
export function selectEligibleAuthorities(
  input: SameAuthorityFallbackInput,
): EligibleAuthority[] {
  const failed = new Map(
    (input.failed_body_dockets ?? []).map((f) => [f.normalized_docket, f.status]),
  );
  const out: EligibleAuthority[] = [];
  const seen = new Set<string>();
  for (const c of input.candidates ?? []) {
    if (!isJudgmentCandidate(c)) continue;
    if (bodyChars(c) >= SAME_AUTHORITY_FALLBACK_LIMITS.MIN_BODY_CHARS) continue;
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    if (meta.judgment_text_acquired === true) continue;
    const docket = docketOfText(c.title, c.source_url);
    if (!docket) continue;
    const nd = normalizedDocketId(docket);
    if (seen.has(nd)) continue;
    const status = failed.get(nd);
    if (!status) continue; // preferred acquisition must have already failed
    seen.add(nd);
    out.push({ candidate: c, docket, normalized_docket: nd, preferred_body_status: status });
  }
  return out;
}

export async function runSameAuthorityBodyFallback(
  input: SameAuthorityFallbackInput,
): Promise<SameAuthorityFallbackReport> {
  const t0 = Date.now();
  const rows: AuthorityFallbackRow[] = [];
  let lookupsUsed = 0;
  const done = (
    skip: string | null,
    stop: SameAuthorityFallbackReport["stop_reason"],
    ran: boolean,
    eligible = 0,
  ): SameAuthorityFallbackReport => ({
    version: SAME_AUTHORITY_FALLBACK_VERSION,
    ran,
    skip_reason: skip,
    eligible_authorities: eligible,
    attempted_authorities: rows.length,
    recovered_authorities: rows.filter((r) => r.identity_validated && r.body_acquired).length,
    recovery_lookups_used: lookupsUsed,
    authority_body_fallback: rows,
    stop_reason: stop,
    ms: Date.now() - t0,
  });

  if (input.enabled === false) return done("disabled", "stage_not_run", false);
  if (input.retrieval_budget?.exceeded()) return done("budget_exceeded", "budget_exceeded", false);

  const eligible = selectEligibleAuthorities(input);
  if (eligible.length === 0) {
    return done("no_eligible_authorities", "no_eligible_authorities", true, 0);
  }
  const queue = eligible.slice(0, SAME_AUTHORITY_FALLBACK_LIMITS.MAX_AUTHORITIES);

  await input.markDurable?.("same_authority_body_fallback_start", {
    run_id: input.run_id ?? null,
    eligible: eligible.length,
    attempting: queue.length,
    authorities: queue.map((q) => ({ docket: q.normalized_docket, status: q.preferred_body_status })),
  });

  const fetchBody = input.fetchBody ??
    ((url: string) =>
      fetchSecondaryBody(
        url,
        () => input.retrieval_budget?.exceeded() === true,
        (name, detail) => void input.markDurable?.(name, detail),
        input.retrieval_budget?.allowExtraction,
        { run_id: input.run_id, stage: "same_authority_body_fallback" },
      ).then((r) => ({ text: String(r.text ?? ""), final_url: r.final_url ?? url })));

  let stop: SameAuthorityFallbackReport["stop_reason"] = "completed";

  for (const auth of queue) {
    const a0 = Date.now();
    const row: AuthorityFallbackRow = {
      authority_id: auth.candidate.candidate_id,
      normalized_docket: auth.normalized_docket,
      preferred_representation: auth.candidate.source_url ?? null,
      preferred_body_status: auth.preferred_body_status,
      existing_alternates_found: 0,
      selected_existing_alternate: null,
      recovery_lookup_attempted: false,
      recovery_query: null,
      recovery_results_count: 0,
      selected_recovery_url: null,
      body_attempted: false,
      body_acquired: false,
      body_chars: 0,
      identity_validated: false,
      docket_match: false,
      final_representation: null,
      failure_reason: null,
      ms: 0,
    };

    if (Date.now() - t0 > SAME_AUTHORITY_FALLBACK_LIMITS.TOTAL_MS) {
      row.failure_reason = "stage_timeout";
      stop = "stage_timeout";
      rows.push(row);
      break;
    }
    if (input.retrieval_budget?.exceeded()) {
      row.failure_reason = "retrieval_budget_exceeded";
      stop = "budget_exceeded";
      rows.push(row);
      break;
    }

    // Step 2 — existing run data first, no external call.
    const alternates = collectExistingAlternates(
      auth.docket,
      auth.candidate.candidate_id,
      input,
    ).filter((a) => a.score > 0);
    row.existing_alternates_found = alternates.length;

    // Step 4 — at most ONE bounded exact-authority recovery lookup.
    if (alternates.length === 0 && input.recoveryLookup) {
      row.recovery_lookup_attempted = true;
      lookupsUsed++;
      try {
        const label = String(auth.candidate.title ?? "").trim();
        const res = await input.recoveryLookup({
          label,
          docket_display: `${auth.docket.prefix_he} ${auth.docket.number}`,
          party_names: partyTokensFromTitle(label),
        });
        row.recovery_query = res.query ?? null;
        const urls = (res.urls ?? []).filter((u) => isFetchableAlternateUrl(String(u.url)));
        row.recovery_results_count = urls.length;
        for (const u of urls) {
          const rep = {
            origin: "recovery_lookup" as const,
            candidate_id: null,
            title: String(u.title ?? label),
            url: String(u.url),
            host: hostOf(u.url),
          };
          const { score, signals } = scoreAlternate(rep, auth.docket, {});
          if (score <= 0) continue;
          alternates.push({ ...rep, score, signals });
        }
        alternates.sort((a, b) => b.score - a.score);
      } catch (e) {
        row.failure_reason = `recovery_lookup_failed:${String((e as Error)?.message ?? e).slice(0, 120)}`;
      }
    }

    if (alternates.length === 0) {
      row.failure_reason = row.failure_reason ?? "no_same_authority_alternate";
      row.ms = Date.now() - a0;
      rows.push(row);
      continue;
    }

    const integ = ((auth.candidate.metadata ?? {}) as Record<string, unknown>)
      .source_integrity as SourceIntegrity | undefined;

    for (const alt of alternates.slice(0, SAME_AUTHORITY_FALLBACK_LIMITS.MAX_FETCHES_PER_AUTHORITY)) {
      if (alt.origin === "recovery_lookup") row.selected_recovery_url = alt.url;
      else row.selected_existing_alternate = alt.url;
      row.body_attempted = true;
      try {
        const res = await fetchBody(alt.url);
        const text = String(res.text ?? "");
        row.body_chars = text.length;
        if (text.length < SAME_AUTHORITY_FALLBACK_LIMITS.MIN_BODY_CHARS) {
          row.failure_reason = "body_below_min_chars";
          continue;
        }
        const identity = validateJudgmentIdentityStrict({
          text,
          docket: auth.docket,
          label: String(auth.candidate.title ?? alt.title),
          url: res.final_url ?? alt.url,
          name_tokens: partyTokensFromTitle(String(auth.candidate.title ?? alt.title)),
        });
        // A mirror is never trusted on a URL/snippet docket alone: the docket
        // and judgment-document identity must be inside the fetched body.
        const docketInBody = textContainsExactDocket(text.slice(0, 20_000), auth.docket);
        const judgmentInBody = JUDGMENT_BODY_MARKER_RE.test(text.slice(0, 20_000));
        row.docket_match = identity.docket_match === true && docketInBody;
        row.identity_validated = identity.validated === true && row.docket_match && judgmentInBody;
        if (!row.identity_validated) {
          row.failure_reason = !docketInBody
            ? "identity_not_confirmed:docket_not_in_body"
            : !judgmentInBody
            ? "identity_not_confirmed:not_a_judgment_document"
            : `identity_not_confirmed:${identity.reason}`;
          continue;
        }
        if (!integ) {
          row.failure_reason = "no_integrity_record";
          continue;
        }
        const applied = applyAcquiredJudgmentBody(
          { c: auth.candidate, integ, dockets: [auth.docket] },
          text,
          "web_document_fetch",
          {
            url: res.final_url ?? alt.url,
            docketGate: (t) => textContainsExactDocket(t, auth.docket),
          },
        );
        row.body_acquired = true;
        row.body_chars = applied.stored.length;
        row.final_representation = "judgment/primary_mirror";
        row.failure_reason = null;
        const meta = auth.candidate.metadata as Record<string, unknown>;
        meta.same_authority_body_fallback = {
          used: true,
          alternate_origin: alt.origin,
          alternate_url: res.final_url ?? alt.url,
          signals: alt.signals,
        };
        break;
      } catch (e) {
        row.failure_reason = String((e as Error)?.message ?? e).slice(0, 160);
      }
    }

    row.ms = Date.now() - a0;
    rows.push(row);
    await input.markDurable?.("authority_body_fallback", { run_id: input.run_id ?? null, ...row });
  }

  const report = done(null, stop, true, eligible.length);
  await input.markDurable?.("same_authority_body_fallback_done", {
    run_id: input.run_id ?? null,
    eligible_authorities: report.eligible_authorities,
    attempted_authorities: report.attempted_authorities,
    recovered_authorities: report.recovered_authorities,
    recovery_lookups_used: report.recovery_lookups_used,
    stop_reason: report.stop_reason,
    ms: report.ms,
  });
  return report;
}

/** Normalized docket identity for an arbitrary label / docket string. */
export function normalizeDocketString(s: string | null | undefined): string | null {
  const d = docketOfText(s);
  return d ? normalizedDocketId(d) : null;
}
