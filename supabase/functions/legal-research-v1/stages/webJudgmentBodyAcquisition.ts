/**
 * web_judgment_body_wiring_v1
 *
 * The Bavli probe (`reports/bavli-web-body-acquisition-probe-v1`) proved that
 * admitted *web* judgment candidates (class `court_case`, discovered on a
 * non-court host such as daat.ac.il or judgments.org.il) were never handed to
 * any body-acquisition lane:
 *
 *   - `secondaryBodyAcquisition` refuses them by design (primary law is out of
 *     its scope),
 *   - `canonicalAuthorityAcquisition` only fetches court-host URLs it derived
 *     itself.
 *
 * So a directly fetchable, identity-confirmable judgment stayed snippet-only.
 *
 * This stage closes exactly that gap and nothing else:
 *   - no new fetcher — it calls the existing `fetchSecondaryBody` web lane,
 *   - no new discovery, search, or model call,
 *   - court hosts, paywalled and access-controlled URLs are refused (relay /
 *     canonical lane keeps its monopoly on them),
 *   - the body must be substantive AND pass `validateJudgmentIdentityStrict`
 *     against the candidate's own docket before anything is marked,
 *   - on any failure the candidate is left byte-for-byte as it was.
 *
 * Marking is done through the shared `applyAcquiredJudgmentBody`, so a web
 * judgment body carries exactly the same flags as a court-host one and every
 * downstream gate (verifier, CSM, alignment, pack thresholds) is untouched.
 */

import type { Candidate } from "../lib/types.ts";
import type { SourceIntegrity } from "./sourceIntegrity.ts";
import { detectDockets, type DocketRef, textContainsExactDocket } from "./docketDetection.ts";
import { validateJudgmentIdentityStrict } from "./judgmentIdentity.ts";
import { applyAcquiredJudgmentBody } from "./judgmentTextAcquisition.ts";
import { fetchSecondaryBody } from "./secondaryBodyAcquisition.ts";
import {
  COURT_HOST_RE,
  isAccessControlledUrl,
  PAYWALLED_HOST_RE,
} from "./secondaryWebAcquisition.ts";

export const WEB_JUDGMENT_BODY_LIMITS = {
  /** Candidates given a fetch attempt per run. */
  MAX_CANDIDATES: 3,
  /** Whole-stage wall clock. */
  TOTAL_MS: 24_000,
  /** Minimum usable body length. */
  MIN_BODY_CHARS: 2_000,
} as const;

export interface WebJudgmentCandidateReport {
  candidate_id: string;
  title: string;
  url: string | null;
  host: string;
  docket: string | null;
  selected: boolean;
  skip_reason: string | null;
  body_attempted: boolean;
  body_acquired: boolean;
  chars: number;
  identity_confirmed: boolean;
  identity_reason: string | null;
  identity_evidence: string[];
  failure_reason: string | null;
  ms: number;
}

export interface WebJudgmentBodyReport {
  ran: boolean;
  reason: string;
  considered: number;
  attempted: number;
  acquired: number;
  identity_confirmed: number;
  per_candidate: WebJudgmentCandidateReport[];
  stop_reason: "completed" | "stage_not_run" | "no_eligible_candidates" | "budget_exceeded" |
    "stage_timeout";
  ms: number;
}

function hostOf(url: string | null | undefined): string {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return "";
  }
}

function isJudgmentClass(c: Candidate, integ: SourceIntegrity | undefined): boolean {
  const type = String(c.source_type ?? "").toLowerCase();
  if (type === "court_case" || type === "judgment" || type === "official_primary") return true;
  return String(integ?.citable_as ?? "") === "judgment";
}

function hasBody(c: Candidate): boolean {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  if (meta.judgment_text_acquired === true) return true;
  const ext = typeof meta.extended_text === "string" ? meta.extended_text.length : 0;
  return ext >= WEB_JUDGMENT_BODY_LIMITS.MIN_BODY_CHARS;
}

const FINALS: Record<string, string> = { "כ": "ך", "מ": "ם", "נ": "ן", "פ": "ף", "צ": "ץ" };

/**
 * Court prefixes are often typed with a non-final letter (`בג"צ` instead of
 * `בג"ץ`). Restore the final form only in the letter that immediately precedes
 * a docket number, so shared docket detection can recognise it. Text is never
 * altered anywhere else.
 */
export function repairDocketPrefixFinals(s: string): string {
  return String(s ?? "").replace(
    /([א-ת]["'׳״]?)([כמנפצ])(?=\s*\d{1,6}[\/-]\d{2,4})/g,
    (_m, pre: string, letter: string) => pre + (FINALS[letter] ?? letter),
  );
}

function candidateDocket(c: Candidate): DocketRef | null {
  const title = repairDocketPrefixFinals(String(c.title ?? ""));
  const fromTitle = detectDockets(title);
  if (fromTitle.length > 0) return fromTitle[0];
  let url = String(c.source_url ?? "");
  try {
    url = decodeURIComponent(url);
  } catch { /* keep raw */ }
  const fromUrl = detectDockets(repairDocketPrefixFinals(url).replace(/[-_]/g, " ").replace(/\//g, "/"));
  if (fromUrl.length > 0) return fromUrl[0];
  const fromSnippet = detectDockets(repairDocketPrefixFinals(String(c.snippet ?? "").slice(0, 600)));
  return fromSnippet.length > 0 ? fromSnippet[0] : null;
}

/** Party tokens from a `X נ' Y` style title, used only as corroboration. */
export function partyTokensFromTitle(title: string): string[] {
  const t = String(title ?? "").replace(/["'`׳״]/g, "");
  const m = t.split(/\s+(?:נ'|נ׳|נגד|נ\s)\s*/);
  const parts = m.length >= 2 ? m : [t];
  const toks: string[] = [];
  for (const part of parts) {
    for (const w of part.split(/[\s,–—\-()[\]|]+/)) {
      if (w.length >= 3 && /[\u0590-\u05FF]/.test(w) && !/^\d+$/.test(w)) toks.push(w);
    }
  }
  return [...new Set(toks)].slice(0, 6);
}

/** Deterministic eligibility: admitted web judgment with a fetchable URL. */
export function selectWebJudgmentCandidate(
  c: Candidate,
): { eligible: boolean; reason: string; docket: DocketRef | null } {
  const integ = ((c.metadata ?? {}) as Record<string, unknown>).source_integrity as
    | SourceIntegrity
    | undefined;
  const docket = candidateDocket(c);
  if (!isJudgmentClass(c, integ)) return { eligible: false, reason: "not_judgment_class", docket };
  if (integ?.reject === true && !/metadata_only|no_text|snippet_only/i.test(String(integ.reject_reason ?? ""))) {
    return { eligible: false, reason: "integrity_rejected", docket };
  }
  const url = String(c.source_url ?? "");
  if (!/^https?:\/\//i.test(url)) return { eligible: false, reason: "no_concrete_url", docket };
  const host = hostOf(url);
  if (COURT_HOST_RE.test(host)) return { eligible: false, reason: "court_host_out_of_scope", docket };
  if (PAYWALLED_HOST_RE.test(url) || isAccessControlledUrl(url)) {
    return { eligible: false, reason: "paywalled_or_access_controlled", docket };
  }
  if (hasBody(c)) return { eligible: false, reason: "body_already_acquired", docket };
  if (!docket) return { eligible: false, reason: "no_docket_identity", docket };
  return { eligible: true, reason: "web_judgment_with_fetchable_url", docket };
}

export interface WebJudgmentBodyInput {
  candidates: Candidate[];
  enabled?: boolean;
  retrieval_budget?: { exceeded: () => boolean; allowExtraction?: (bytes: number) => boolean };
  markDurable?: (name: string, detail?: Record<string, unknown>) => void | Promise<void>;
  run_id?: string;
  max_candidates?: number;
}

export async function runWebJudgmentBodyAcquisition(
  input: WebJudgmentBodyInput,
): Promise<WebJudgmentBodyReport> {
  const t0 = Date.now();
  const onStage = (name: string, detail?: Record<string, unknown>) => {
    void input.markDurable?.(name, detail);
  };
  const per: WebJudgmentCandidateReport[] = [];
  const done = (
    reason: string,
    stop: WebJudgmentBodyReport["stop_reason"],
    ran: boolean,
    considered = 0,
  ): WebJudgmentBodyReport => ({
    ran,
    reason,
    considered,
    attempted: per.filter((p) => p.body_attempted).length,
    acquired: per.filter((p) => p.body_acquired).length,
    identity_confirmed: per.filter((p) => p.identity_confirmed).length,
    per_candidate: per,
    stop_reason: stop,
    ms: Date.now() - t0,
  });

  if (input.enabled === false) return done("disabled", "stage_not_run", false);
  if (input.retrieval_budget?.exceeded()) return done("budget_exceeded", "budget_exceeded", false);

  const selected: { c: Candidate; docket: DocketRef }[] = [];
  for (const c of input.candidates) {
    const s = selectWebJudgmentCandidate(c);
    if (s.eligible && s.docket) {
      selected.push({ c, docket: s.docket });
    } else if (s.docket || isJudgmentClass(c, undefined)) {
      per.push({
        candidate_id: c.candidate_id,
        title: String(c.title ?? ""),
        url: c.source_url ?? null,
        host: hostOf(c.source_url),
        docket: s.docket?.raw ?? null,
        selected: false,
        skip_reason: s.reason,
        body_attempted: false,
        body_acquired: false,
        chars: 0,
        identity_confirmed: false,
        identity_reason: null,
        identity_evidence: [],
        failure_reason: null,
        ms: 0,
      });
    }
  }
  const considered = selected.length;
  if (considered === 0) return done("no_eligible_candidates", "no_eligible_candidates", true);

  const cap = Math.min(
    input.max_candidates ?? WEB_JUDGMENT_BODY_LIMITS.MAX_CANDIDATES,
    WEB_JUDGMENT_BODY_LIMITS.MAX_CANDIDATES,
  );
  const queue = selected.slice(0, cap);
  await input.markDurable?.("web_judgment_body_acquisition_start", {
    run_id: input.run_id ?? null,
    considered,
    attempting: queue.length,
    targets: queue.map((q) => ({ id: q.c.candidate_id, url: q.c.source_url, docket: q.docket.raw })),
  });

  let stop: WebJudgmentBodyReport["stop_reason"] = "completed";
  for (const { c, docket } of queue) {
    const c0 = Date.now();
    const url = String(c.source_url);
    const row: WebJudgmentCandidateReport = {
      candidate_id: c.candidate_id,
      title: String(c.title ?? ""),
      url,
      host: hostOf(url),
      docket: docket.raw,
      selected: true,
      skip_reason: null,
      body_attempted: false,
      body_acquired: false,
      chars: 0,
      identity_confirmed: false,
      identity_reason: null,
      identity_evidence: [],
      failure_reason: null,
      ms: 0,
    };
    if (Date.now() - t0 > WEB_JUDGMENT_BODY_LIMITS.TOTAL_MS) {
      row.failure_reason = "stage_timeout";
      stop = "stage_timeout";
      per.push(row);
      break;
    }
    if (input.retrieval_budget?.exceeded()) {
      row.failure_reason = "retrieval_budget_exceeded";
      stop = "budget_exceeded";
      per.push(row);
      break;
    }

    try {
      row.body_attempted = true;
      onStage("web_judgment_body_fetch_start", { candidate_id: c.candidate_id, url });
      const res = await fetchSecondaryBody(
        url,
        () => input.retrieval_budget?.exceeded() === true,
        (name, detail) => onStage(name, detail),
        input.retrieval_budget?.allowExtraction,
        { run_id: input.run_id, source_id: c.candidate_id, stage: "web_judgment_body_acquisition" },
      );
      const text = String(res.text ?? "");
      row.chars = text.length;
      if (text.length < WEB_JUDGMENT_BODY_LIMITS.MIN_BODY_CHARS) {
        row.failure_reason = "body_below_min_chars";
        per.push(row);
        onStage("web_judgment_body_fetch_done", { candidate_id: c.candidate_id, ...row });
        continue;
      }

      const identity = validateJudgmentIdentityStrict({
        text,
        docket,
        label: String(c.title ?? ""),
        url: res.final_url ?? url,
        name_tokens: partyTokensFromTitle(String(c.title ?? "")),
      });
      row.identity_confirmed = identity.validated && identity.docket_match;
      row.identity_reason = identity.reason;
      row.identity_evidence = identity.evidence;
      if (!row.identity_confirmed) {
        row.failure_reason = `identity_not_confirmed:${identity.reason}`;
        per.push(row);
        onStage("web_judgment_body_fetch_done", { candidate_id: c.candidate_id, ...row });
        continue;
      }

      const integ = ((c.metadata ?? {}) as Record<string, unknown>).source_integrity as
        | SourceIntegrity
        | undefined;
      if (!integ) {
        row.failure_reason = "no_integrity_record";
        per.push(row);
        continue;
      }
      const applied = applyAcquiredJudgmentBody(
        { c, integ, dockets: [docket] },
        text,
        "web_document_fetch",
        { url: res.final_url ?? url, docketGate: (t) => textContainsExactDocket(t, docket) },
      );
      row.body_acquired = true;
      row.chars = applied.stored.length;
      (c.metadata as Record<string, unknown>).web_judgment_body_acquired = true;
      (c.metadata as Record<string, unknown>).web_judgment_body_source_url = res.final_url ?? url;
      (c.metadata as Record<string, unknown>).web_judgment_identity = {
        validated: identity.validated,
        docket_match: identity.docket_match,
        confidence: identity.confidence,
        evidence: identity.evidence,
      };
    } catch (e) {
      row.failure_reason = String((e as Error)?.message ?? e).slice(0, 160);
    }
    row.ms = Date.now() - c0;
    per.push(row);
    onStage("web_judgment_body_fetch_done", { candidate_id: c.candidate_id, ...row });
  }

  const report = done("completed", stop, true, considered);
  await input.markDurable?.("web_judgment_body_acquisition_done", {
    run_id: input.run_id ?? null,
    considered: report.considered,
    attempted: report.attempted,
    acquired: report.acquired,
    identity_confirmed: report.identity_confirmed,
    stop_reason: report.stop_reason,
    ms: report.ms,
  });
  return report;
}
