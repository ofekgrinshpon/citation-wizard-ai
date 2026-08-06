// Specific-case authority resolution.
//
// Scope: `specific_case` research mode only. Two jobs, both deterministic:
//
//   1. Exact-docket guard hardening — a specific-case answer may only be
//      drafted when an ADMITTED source carries the exact requested docket in
//      its title / url / citation AND has usable text. Near-name commentary,
//      listing pages, blogs, and topic-adjacent judgments are ignored, no
//      matter how many of them the candidate pool holds.
//
//   2. Bounded text acquisition — before refusing, make a real attempt to
//      obtain the judgment text (court-hosted file, local DB by normalized
//      docket variants / title, wrapper page).
//
// Fail closed: if usable text is not obtained, the caller fires
// `docket_limitation`. This module never edits the drafter prompt, verifier,
// sufficiency thresholds, or general retrieval.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { Candidate } from "../lib/types.ts";
import {
  detectDockets,
  normalizedDocketId,
  normalizedDocketVariants,
  textContainsExactDocket,
  type DocketRef,
} from "./docketDetection.ts";
import { classifySourceIntegrity, type SourceIntegrity } from "./sourceIntegrity.ts";
import { deriveSupremeCourtFileUrls } from "./courtFileUrls.ts";
import {
  HOLDING_TEXT_RE,
  isDirectFileUrl,
  normText,
  tryDirectFile,
  tryWrapperResolve,
  WRAPPER_HOST_RE,
  withTimeout,
} from "./judgmentTextAcquisition.ts";

const SPECIFIC_CASE_MODE = "specific_case";

export const SPECIFIC_CASE_LIMITS = {
  /** Minimum characters that count as real judgment text. */
  MIN_USABLE_TEXT: 400,
  /** Per-method time box. */
  PER_METHOD_MS: 8000,
  /** Per derived-URL probe time box. */
  PER_DERIVED_URL_MS: 6000,
  /** Whole-stage time box. */
  TOTAL_MS: 32000,
  /** Never store more than this. */
  MAX_TEXT: 6000,
  /** Max exact-docket candidates we try to resolve. */
  MAX_TARGETS: 2,
  /** Max derived court URLs probed per run. */
  MAX_DERIVED_URLS: 4,
} as const;

const CASE_LIKE_TYPES = new Set([
  "caselaw",
  "case",
  "court_case",
  "supreme_court_il",
  "judgment",
]);

export type SpecificCaseAcquisitionMethod =
  | "direct_file_fetch"
  | "local_db_docket_lookup"
  | "wrapper_file_resolve"
  | "court_url_derivation"
  | "pool_exact_docket_text";


export interface SpecificCaseResolution {
  enabled: boolean;
  mode: string | null;
  /** Canonical normalized docket, e.g. `bagatz:6698/95`. */
  requested_docket_normalized: string | null;
  requested_dockets_normalized: string[];
  requested_docket_display: string | null;
  exact_docket_source_found: boolean;
  exact_docket_source_title: string | null;
  exact_docket_source_url: string | null;
  exact_docket_source_usable: boolean;
  text_acquisition_attempted: boolean;
  acquisition_method: SpecificCaseAcquisitionMethod | null;
  /** Set only on success (mirrors `acquisition_method`). */
  acquisition_method_successful: SpecificCaseAcquisitionMethod | null;
  acquisition_methods_attempted: SpecificCaseAcquisitionMethod[];
  acquisition_success: boolean;
  acquisition_failure_reason: string | null;
  /** Every failure reason observed, in attempt order. */
  acquisition_failure_reasons: string[];
  last_acquisition_failure_reason: string | null;
  acquired_text_length: number;
  /** Derived official court URLs probed (deterministic, docket-validated). */
  derived_urls_probed: string[];
  derived_url_resolved: string | null;


  /** Why the caller will (or will not) fire `docket_limitation`. */
  final_docket_branch_reason:
    | "not_specific_case_mode"
    | "no_docket_in_question"
    | "exact_docket_usable_text"
    | "exact_docket_text_acquired"
    | "exact_docket_no_usable_text"
    | "no_exact_docket_source";
  /** True only when a normal case_holding answer is permitted. */
  allow_case_holding_answer: boolean;
  near_match_sources_ignored_count: number;
  near_match_sources_ignored: Array<{ title: string; url: string | null; reason: string }>;
  /** Candidate injected from the local DB, if any. */
  injected_candidate_id: string | null;
  /**
   * Candidate that actually carries the exact-docket judgment body — whether
   * it was injected by acquisition or was already in the pool with usable
   * text. Downstream gates key on this, never on `acquisition_success` alone.
   */
  exact_docket_candidate_id: string | null;
  ms: number;
}

function disabled(
  mode: string | null,
  reason: SpecificCaseResolution["final_docket_branch_reason"],
): SpecificCaseResolution {
  return {
    enabled: false,
    mode,
    requested_docket_normalized: null,
    requested_dockets_normalized: [],
    requested_docket_display: null,
    exact_docket_source_found: false,
    exact_docket_source_title: null,
    exact_docket_source_url: null,
    exact_docket_source_usable: false,
    text_acquisition_attempted: false,
    acquisition_method: null,
    acquisition_method_successful: null,
    acquisition_methods_attempted: [],
    acquisition_success: false,
    acquisition_failure_reason: null,
    acquisition_failure_reasons: [],
    last_acquisition_failure_reason: null,
    acquired_text_length: 0,
    derived_urls_probed: [],
    derived_url_resolved: null,

    final_docket_branch_reason: reason,
    allow_case_holding_answer: true,
    near_match_sources_ignored_count: 0,
    near_match_sources_ignored: [],
    injected_candidate_id: null,
    exact_docket_candidate_id: null,
    ms: 0,
  };
}

/** Record a failure reason without losing earlier ones. */
function recordFailure(res: SpecificCaseResolution, reason: string): void {
  res.acquisition_failure_reasons.push(reason);
  res.last_acquisition_failure_reason = reason;
  res.acquisition_failure_reason = reason;
}


function availableText(c: Candidate): string {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const ext = typeof meta.extended_text === "string" ? meta.extended_text : "";
  return ext.length > (c.snippet || "").length ? ext : (c.snippet || "");
}

function integrityOf(c: Candidate): SourceIntegrity | undefined {
  return ((c.metadata ?? {}) as Record<string, unknown>).source_integrity as
    | SourceIntegrity
    | undefined;
}

function citationOf(c: Candidate): string {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  return [meta.citation, meta.case_number].filter((x) => typeof x === "string").join(" ");
}

/** Exact-docket predicate: title / url / citation only — never a snippet. */
function isExactDocketSource(c: Candidate, dockets: DocketRef[]): boolean {
  const fields = [c.title, c.source_url, citationOf(c)];
  return dockets.some((d) => fields.some((f) => textContainsExactDocket(f, d)));
}

function isUsableJudgmentText(c: Candidate): boolean {
  const integ = integrityOf(c);
  const usability = String(integ?.text_usability ?? "unknown");
  if (usability === "metadata_only" || usability === "unusable") return false;
  return availableText(c).length >= SPECIFIC_CASE_LIMITS.MIN_USABLE_TEXT;
}

/** Local DB lookup by normalized docket variants (and, last, by party title). */
async function lookupLocalJudgment(
  admin: SupabaseClient,
  dockets: DocketRef[],
): Promise<{ title: string; url: string | null; text: string } | null> {
  const numbers = new Set<string>();
  for (const d of dockets) {
    const bare = d.number;
    numbers.add(bare);
    numbers.add(bare.replace(/\//g, "-"));
    for (const v of normalizedDocketVariants(d)) numbers.add(v);
  }
  const filters: string[] = [];
  for (const n of numbers) {
    const safe = n.replace(/[,%()]/g, " ").trim();
    if (safe.length < 4) continue;
    filters.push(`case_number.ilike.%${safe}%`, `citation.ilike.%${safe}%`, `title.ilike.%${safe}%`);
  }
  if (filters.length === 0) return null;

  const { data: docs, error } = await admin
    .from("legal_documents")
    .select("id,title,source_url,citation,case_number")
    .or(filters.slice(0, 40).join(","))
    .limit(5);
  if (error || !docs || docs.length === 0) return null;

  // Keep only rows that really carry the exact docket.
  const hit = docs.find((d) =>
    dockets.some((dk) =>
      textContainsExactDocket(String(d.case_number ?? ""), dk) ||
      textContainsExactDocket(String(d.citation ?? ""), dk) ||
      textContainsExactDocket(String(d.title ?? ""), dk)
    )
  );
  if (!hit) return null;

  const { data: chunks } = await admin
    .from("legal_document_chunks")
    .select("content")
    .eq("document_id", hit.id)
    .order("chunk_index", { ascending: true })
    .limit(8);
  const text = normText((chunks ?? []).map((c) => String(c.content ?? "")).join("\n"));
  if (text.length < SPECIFIC_CASE_LIMITS.MIN_USABLE_TEXT) return null;
  return { title: String(hit.title ?? ""), url: (hit.source_url as string | null) ?? null, text };
}

export interface SpecificCaseInput {
  admin: SupabaseClient;
  research_mode: string | null;
  question: string;
  candidates: Candidate[];
  /**
   * Fast lane already probed the derived court URLs for this run — do not
   * spend the CPU/network budget probing them a second time.
   */
  skip_derived_urls?: boolean;
  /** Carried over for telemetry when `skip_derived_urls` is set. */
  prior_derived_urls?: string[];
}


export async function runSpecificCaseResolution(
  input: SpecificCaseInput,
): Promise<SpecificCaseResolution> {
  const t0 = Date.now();
  const mode = input.research_mode ?? null;
  if (mode !== SPECIFIC_CASE_MODE) return disabled(mode, "not_specific_case_mode");

  const dockets = detectDockets(input.question);
  if (dockets.length === 0) return disabled(mode, "no_docket_in_question");

  const res: SpecificCaseResolution = {
    ...disabled(mode, "no_exact_docket_source"),
    enabled: true,
    requested_docket_normalized: normalizedDocketId(dockets[0]),
    requested_dockets_normalized: dockets.map(normalizedDocketId),
    requested_docket_display: `${dockets[0].prefix_he} ${dockets[0].number}`,
    allow_case_holding_answer: false,
  };

  // ── Partition the admitted pool ────────────────────────────────────────
  const exact: Candidate[] = [];
  for (const c of input.candidates) {
    if (isExactDocketSource(c, dockets)) {
      exact.push(c);
      continue;
    }
    // Everything else is near-match noise for this mode. Count only the ones
    // that could plausibly have fooled the drafter (case-like, or mentioning
    // the docket in a snippet only).
    const snippetMention = dockets.some((d) => textContainsExactDocket(c.snippet, d));
    const caseLike = CASE_LIKE_TYPES.has(String(c.source_type ?? "").toLowerCase());
    if (snippetMention || caseLike) {
      res.near_match_sources_ignored.push({
        title: c.title,
        url: c.source_url ?? null,
        reason: snippetMention ? "docket_in_snippet_only" : "adjacent_case_like_source",
      });
    }
  }
  res.near_match_sources_ignored_count = res.near_match_sources_ignored.length;

  if (exact.length > 0) {
    res.exact_docket_source_found = true;
    res.exact_docket_source_title = exact[0].title;
    res.exact_docket_source_url = exact[0].source_url ?? null;
  }

  /**
   * Stamp an exact-docket judgment body onto a candidate so every downstream
   * gate (identity, sufficiency, drafter input-source builder) can see that
   * this candidate *is* the requested judgment with real text. Used both for
   * acquired bodies and for pool candidates that already carried usable text.
   */
  const stampBody = (c: Candidate, text: string, method: SpecificCaseAcquisitionMethod) => {
    const stored = text.slice(0, SPECIFIC_CASE_LIMITS.MAX_TEXT);
    const integ = integrityOf(c);
    const usability = stored.length >= 1200 ? "full_text" : "substantive_excerpt";
    if (integ) {
      integ.text_usability = usability as SourceIntegrity["text_usability"];
      integ.has_holding_text = integ.has_holding_text || HOLDING_TEXT_RE.test(stored);
      integ.citable_as = "judgment";
      integ.is_judgment_document = true;
      integ.reject = false;
      delete integ.reject_reason;
      if (OFFICIAL_HOST_RE.test(String(c.source_url ?? ""))) {
        integ.authority_tier = "official_primary";
      }
      integ.integrity_flags = [
        ...(integ.integrity_flags ?? []),
        "specific_case_text_acquired",
      ];
    }
    c.metadata = {
      ...(c.metadata ?? {}),
      ...(integ ? { source_integrity: integ } : {}),
      extended_text: stored,
      exact_docket_match: true,
      docket_match: true,
      text_usability: usability,
      usable_for_holding: true,
      specific_case_text_acquired: true,
      specific_case_acquisition_method: method,
    };
    if ((c.snippet || "").length < 300) c.snippet = stored.slice(0, 800);
    res.acquired_text_length = stored.length;
    res.exact_docket_source_title = c.title;
    res.exact_docket_source_url = c.source_url ?? null;
    res.exact_docket_source_usable = true;
    res.allow_case_holding_answer = true;
    res.exact_docket_candidate_id = c.candidate_id;
  };

  const alreadyUsable = exact.find(isUsableJudgmentText);
  if (alreadyUsable) {
    // The body is already in hand: stamp it so it survives to the drafter.
    // `acquisition_success` stays false (nothing was fetched) — the refusal
    // decision keys on `exact_docket_source_usable` / the branch reason.
    stampBody(alreadyUsable, availableText(alreadyUsable), "pool_exact_docket_text");
    res.final_docket_branch_reason = "exact_docket_usable_text";
    res.ms = Date.now() - t0;
    return res;
  }

  // ── Bounded acquisition ────────────────────────────────────────────────
  res.text_acquisition_attempted = true;
  const targets = exact.slice(0, SPECIFIC_CASE_LIMITS.MAX_TARGETS);

  const applyText = (c: Candidate, text: string, method: SpecificCaseAcquisitionMethod) => {
    stampBody(c, text, method);
    res.acquisition_method = method;
    res.acquisition_method_successful = method;
    res.acquisition_success = true;
    res.final_docket_branch_reason = "exact_docket_text_acquired";
  };


  for (const c of targets) {
    if (res.acquisition_success) break;
    const url = c.source_url ?? null;
    // Identity already carries the exact docket (that is why `c` is a target),
    // so plain-text court downloads are permitted for it; the text itself must
    // still look like a judgment body (enforced inside tryDirectFile).
    // The downloaded body itself must carry the exact requested docket —
    // a matching title/url alone is not enough (web titles can be wrong).
    const fileOpts = {
      allowPlainText: true,
      validateText: (text: string) =>
        dockets.some((d) => textContainsExactDocket(text.slice(0, 20000), d)),
    };
    const plan: SpecificCaseAcquisitionMethod[] = [];
    if (url && isDirectFileUrl(url)) plan.push("direct_file_fetch");
    if (url && WRAPPER_HOST_RE.test(url) && !isDirectFileUrl(url)) plan.push("wrapper_file_resolve");
    for (const method of plan) {
      if (Date.now() - t0 > SPECIFIC_CASE_LIMITS.TOTAL_MS) {
        recordFailure(res, "stage_time_budget_exhausted");
        break;
      }
      res.acquisition_methods_attempted.push(method);
      try {
        const got = await withTimeout(
          method === "direct_file_fetch"
            ? tryDirectFile(url!, fileOpts)
            : tryWrapperResolve(url!, fileOpts),
          SPECIFIC_CASE_LIMITS.PER_METHOD_MS,
          method,
        );
        if (got.length >= SPECIFIC_CASE_LIMITS.MIN_USABLE_TEXT) {
          applyText(c, normText(got), method);
          break;
        }
        recordFailure(res, "extracted_text_below_threshold");
      } catch (err) {
        recordFailure(res, err instanceof Error ? err.message : String(err));
      }
    }
  }

  /**
   * Inject an acquired judgment body as a first-class candidate (used when the
   * pool held no exact-docket source at all).
   */
  const injectFromText = (
    title: string,
    url: string,
    text: string,
    method: SpecificCaseAcquisitionMethod,
  ) => {
    const base = input.candidates[0];
    const stored = text.slice(0, SPECIFIC_CASE_LIMITS.MAX_TEXT);
    const injected: Candidate = {
      candidate_id: `specific-case:${res.requested_docket_normalized}`,
      claim_id: base?.claim_id ?? "C1",
      role: "binding_case_law",
      origin: method === "local_db_docket_lookup" ? "local_db" : "web",
      retrieval_method: "text",
      title: title || (res.requested_docket_display ?? "פסק דין"),
      source_type: "caselaw",
      source_url: url,
      snippet: stored.slice(0, 800),
      query_he: res.requested_docket_display ?? input.question.slice(0, 80),
      score: 1,
      expected_source_type: "case",
      metadata: {},
    };
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
    injected.metadata = {
      source_integrity: integ,
      extended_text: stored,
      exact_docket_match: true,
      docket_match: true,
      specific_case_text_acquired: true,
      specific_case_acquisition_method: method,
    };
    input.candidates.unshift(injected);
    res.injected_candidate_id = injected.candidate_id;
    res.exact_docket_source_found = true;
    applyText(injected, text, method);
  };

  // ── Derived official court file URLs ───────────────────────────────────
  // The Supreme Court archive path is fully derivable from the docket, so a
  // landmark judgment can be acquired even when no search result exposes its
  // download URL. Every body is validated against the requested docket, so a
  // wrong guess can never be adopted.
  if (input.skip_derived_urls) {
    // Fast lane already probed these; carry the telemetry, spend nothing.
    res.derived_urls_probed = input.prior_derived_urls ?? [];
    recordFailure(res, "derived_urls_already_probed_in_fast_lane");
  } else if (!res.acquisition_success && Date.now() - t0 <= SPECIFIC_CASE_LIMITS.TOTAL_MS) {

    const derived: string[] = [];
    for (const d of dockets) {
      for (const u of deriveSupremeCourtFileUrls(d)) {
        if (!derived.includes(u)) derived.push(u);
      }
    }
    res.derived_urls_probed = derived.slice(0, SPECIFIC_CASE_LIMITS.MAX_DERIVED_URLS);
    if (res.derived_urls_probed.length > 0) {
      res.acquisition_methods_attempted.push("court_url_derivation");
    }
    for (const url of res.derived_urls_probed) {
      if (res.acquisition_success) break;
      if (Date.now() - t0 > SPECIFIC_CASE_LIMITS.TOTAL_MS) {
        recordFailure(res, "stage_time_budget_exhausted");
        break;
      }
      try {
        const got = await withTimeout(
          tryDirectFile(url, {
            allowPlainText: true,
            validateText: (text: string) =>
              dockets.some((d) => textContainsExactDocket(text.slice(0, 20000), d)),
          }),
          SPECIFIC_CASE_LIMITS.PER_DERIVED_URL_MS,
          "court_url_derivation",
        );
        if (got.length >= SPECIFIC_CASE_LIMITS.MIN_USABLE_TEXT) {
          res.derived_url_resolved = url;
          const target = targets[0];
          if (target) applyText(target, normText(got), "court_url_derivation");
          else {
            injectFromText(
              res.requested_docket_display ?? "פסק דין",
              url,
              normText(got),
              "court_url_derivation",
            );
          }
          break;
        }
        recordFailure(res, "derived_url_text_below_threshold");
      } catch (err) {
        recordFailure(res, `derived_url:${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Local DB by normalized docket variants — also the only path when the pool
  // contains no exact-docket source at all.
  if (!res.acquisition_success && Date.now() - t0 <= SPECIFIC_CASE_LIMITS.TOTAL_MS) {
    res.acquisition_methods_attempted.push("local_db_docket_lookup");
    try {
      const local = await withTimeout(
        lookupLocalJudgment(input.admin, dockets),
        SPECIFIC_CASE_LIMITS.PER_METHOD_MS,
        "local_db_docket_lookup",
      );
      if (local) {
        const target = targets[0];
        if (target) {
          applyText(target, local.text, "local_db_docket_lookup");
        } else {
          injectFromText(local.title, local.url, local.text, "local_db_docket_lookup");
        }
      } else {
        recordFailure(res, "no_local_document_match");
      }
    } catch (err) {
      recordFailure(res, err instanceof Error ? err.message : String(err));
    }
  }


  if (!res.acquisition_success) {
    res.allow_case_holding_answer = false;
    res.acquisition_method = null;
    res.acquisition_method_successful = null;
    res.final_docket_branch_reason = res.exact_docket_source_found
      ? "exact_docket_no_usable_text"
      : "no_exact_docket_source";
    if (!res.acquisition_failure_reason) recordFailure(res, "no_method_available");
  }


  res.ms = Date.now() - t0;
  return res;
}
