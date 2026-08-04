// Specific-case judgment identity + title recovery.
//
// Scope: `specific_case` mode only. Deterministic, no model calls, no network.
//
// Two jobs:
//   1. Identity validation — a case-holding answer may only be drafted when the
//      pool holds a usable judgment source that is provably the requested case:
//      citable_as=judgment, usable body text, and the body itself carries the
//      requested docket or a strong match to the requested case title.
//      Scholarship/commentary about the case can never satisfy this.
//   2. Title recovery — official court/gov documents that arrive with a generic
//      or empty title ("מסמך מאתר ...", "supreme_court_il document", ...) get a
//      recovered title built from the body heading / docket / party names /
//      download path, so a case holding is never footnoted as a nameless
//      government document.
//
// This module never touches retrieval, verifier, sufficiency or drafter prompts.

import type { Candidate } from "../lib/types.ts";
import {
  detectDockets,
  textContainsExactDocket,
  type DocketRef,
} from "./docketDetection.ts";
import type { SourceIntegrity } from "./sourceIntegrity.ts";

const SPECIFIC_CASE_MODE = "specific_case";

/** Minimum characters that count as a real judgment body. */
const MIN_BODY = 400;

export type IdentityMatchedBy = "docket" | "title" | "body" | "none";

export interface SpecificCaseIdentity {
  specific_case_identity_required: boolean;
  requested_docket: string | null;
  requested_case_title: string | null;
  matched_judgment_ref: string | null;
  matched_by: IdentityMatchedBy;
  title_recovery_attempted: boolean;
  title_recovery_success: boolean;
  recovered_title: string | null;
  generic_title_detected: boolean;
  generic_titles_detected_count: number;
  title_recoveries: Array<{ candidate_id: string; from: string; to: string; via: string }>;
  specific_case_identity_passed: boolean;
  specific_case_identity_failure_reason:
    | null
    | "not_specific_case_mode"
    | "no_usable_judgment_body"
    | "judgment_body_missing_identity"
    | "only_scholarship_or_commentary"
    | "no_judgment_candidate";
  scholarship_only_candidates_count: number;
  ms: number;
}

function empty(
  reason: SpecificCaseIdentity["specific_case_identity_failure_reason"],
): SpecificCaseIdentity {
  return {
    specific_case_identity_required: false,
    requested_docket: null,
    requested_case_title: null,
    matched_judgment_ref: null,
    matched_by: "none",
    title_recovery_attempted: false,
    title_recovery_success: false,
    recovered_title: null,
    generic_title_detected: false,
    generic_titles_detected_count: 0,
    title_recoveries: [],
    specific_case_identity_passed: true,
    specific_case_identity_failure_reason: reason,
    scholarship_only_candidates_count: 0,
    ms: 0,
  };
}

// ── Generic / unusable title detection ─────────────────────────────────────

const GENERIC_TITLE_PATTERNS: RegExp[] = [
  /^מסמך\s+מאתר(\s|$)/,
  /^פסק\s*דין\s+מתוך\s+אתר(\s|$)/,
  /^מסמך\s+ממשלתי/,
  /^אתר\s+ממשלתי/,
  /^supreme[\s_-]*court[\s_-]*il(\s+document)?$/i,
  /^gov(\.il)?(\s+document)?$/i,
  /^(pdf|doc|docx|document|untitled|ללא כותרת|מסמך)$/i,
  /^https?:\/\//i,
  /^\s*$/,
];

export function isGenericTitle(title: string | null | undefined): boolean {
  const t = String(title ?? "").trim();
  if (!t) return true;
  return GENERIC_TITLE_PATTERNS.some((re) => re.test(t));
}

// ── Requested case title extraction ────────────────────────────────────────

const PARTY_SEP_RE = /\s(?:נ'|נ׳|נגד|נ")\s/;

/**
 * Pull the party-name string out of the question, e.g.
 * `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` →
 * `בנק המזרחי המאוחד נ' מגדל כפר שיתופי`.
 */
export function extractRequestedCaseTitle(question: string): string | null {
  const q = String(question ?? "").replace(/[?!.]+\s*$/, "").trim();
  if (!PARTY_SEP_RE.test(q)) return null;
  // Cut everything up to and including the last docket number before the parties.
  const numMatch = [...q.matchAll(/\d{1,6}(?:[\/\-]\d{1,4}){1,2}/g)].pop();
  let tail = numMatch ? q.slice((numMatch.index ?? 0) + numMatch[0].length) : q;
  // Trim trailing date/paren annotations.
  tail = tail.replace(/\([^)]*\)\s*$/, "").trim();
  // Drop leading connectors.
  tail = tail.replace(/^[\s,،\-–—]+/, "");
  if (!PARTY_SEP_RE.test(tail)) return null;
  return tail.length >= 5 ? tail : null;
}

const STOP_TOKENS = new Set([
  "בע", "בעמ", "נ", "נגד", "מ", "של", "את", "בע\"מ", "ואח", "ואחרים", "בית", "המשפט",
]);

function titleTokens(s: string): string[] {
  return String(s ?? "")
    .replace(/[\u0022\u05F4\u05F3'()\[\],.:;־–—-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
}

/** Strong title match: at least two significant requested tokens present. */
export function strongTitleMatch(requestedTitle: string, hay: string): boolean {
  const want = titleTokens(requestedTitle);
  if (want.length === 0) return false;
  const h = String(hay ?? "");
  const hits = want.filter((t) => h.includes(t)).length;
  if (want.length === 1) return hits === 1;
  return hits >= Math.min(2, want.length);
}

// ── Title recovery ─────────────────────────────────────────────────────────

function bodyOf(c: Candidate): string {
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  const ext = typeof meta.extended_text === "string" ? meta.extended_text : "";
  return ext.length > (c.snippet || "").length ? ext : (c.snippet || "");
}

function integrityOf(c: Candidate): SourceIntegrity | undefined {
  return ((c.metadata ?? {}) as Record<string, unknown>).source_integrity as
    | SourceIntegrity
    | undefined;
}

const DOCKET_IN_BODY_RE =
  /(?:בג["״]?ץ|דנג["״]?ץ|ע["״]?א|ע["״]?פ|רע["״]?א|רע["״]?פ|עע["״]?מ|עה["״]?ס|דנ["״]?א|דנ["״]?פ|בש["״]?פ|בע["״]?מ|בר["״]?ם)\s*\d{1,6}(?:[\/\-]\d{1,4}){1,2}/;

/**
 * Recover a case-like title for a document with a generic/empty title.
 * Order: body heading with docket+parties → docket + parties → docket only →
 * download filename.
 */
export function recoverJudgmentTitle(
  c: Candidate,
  dockets: DocketRef[],
  requestedTitle: string | null,
): { title: string; via: string } | null {
  const body = bodyOf(c);
  const head = body.slice(0, 4000);

  // 1. A line that carries both the docket and party names.
  for (const rawLine of head.split(/\n|(?<=\.)\s{2,}/).slice(0, 60)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < 8 || line.length > 200) continue;
    if (DOCKET_IN_BODY_RE.test(line) && PARTY_SEP_RE.test(line)) {
      return { title: line, via: "body_heading" };
    }
  }

  const docketDisplay = dockets.length > 0
    ? `${dockets[0].prefix_he} ${dockets[0].number}`
    : (head.match(DOCKET_IN_BODY_RE)?.[0] ?? null);

  // 2. Docket + party names found near the start of the body.
  const partyLine = head
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .find((l) => l.length >= 8 && l.length <= 160 && PARTY_SEP_RE.test(l));
  if (docketDisplay && partyLine) {
    return { title: `${docketDisplay} ${partyLine}`, via: "docket_and_parties" };
  }

  // 3. Docket + requested title from the question.
  if (docketDisplay && requestedTitle) {
    return { title: `${docketDisplay} ${requestedTitle}`, via: "docket_and_requested_title" };
  }

  // 4. Docket alone.
  if (docketDisplay) return { title: docketDisplay, via: "docket_only" };

  // 5. Filename / download path.
  const url = c.source_url ?? "";
  const file = decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "")
    .replace(/\.(pdf|docx?|txt|rtf)$/i, "")
    .replace(/[_+]/g, " ")
    .trim();
  if (file.length >= 6 && /[\u0590-\u05FF]/.test(file)) {
    return { title: file, via: "filename" };
  }
  return null;
}

// ── Main stage ─────────────────────────────────────────────────────────────

export interface SpecificCaseIdentityInput {
  research_mode: string | null;
  question: string;
  candidates: Candidate[];
}

export function runSpecificCaseIdentity(
  input: SpecificCaseIdentityInput,
): SpecificCaseIdentity {
  const t0 = Date.now();
  if ((input.research_mode ?? null) !== SPECIFIC_CASE_MODE) {
    return empty("not_specific_case_mode");
  }

  const dockets = detectDockets(input.question);
  const requestedTitle = extractRequestedCaseTitle(input.question);
  const res: SpecificCaseIdentity = {
    ...empty(null),
    specific_case_identity_required: true,
    requested_docket: dockets.length > 0 ? `${dockets[0].prefix_he} ${dockets[0].number}` : null,
    requested_case_title: requestedTitle,
    specific_case_identity_passed: false,
  };

  if (dockets.length === 0 && !requestedTitle) {
    // Nothing to validate against — leave the existing gates in charge.
    res.specific_case_identity_required = false;
    res.specific_case_identity_passed = true;
    res.specific_case_identity_failure_reason = null;
    res.ms = Date.now() - t0;
    return res;
  }

  let judgmentSeen = false;
  let usableBodySeen = false;
  let match: { c: Candidate; by: IdentityMatchedBy } | null = null;

  for (const c of input.candidates) {
    const integ = integrityOf(c);
    const citable = String(integ?.citable_as ?? "");
    const usability = String(integ?.text_usability ?? "unknown");
    const isScholarship = citable === "scholarship" || citable === "commentary";
    if (isScholarship) res.scholarship_only_candidates_count++;

    const isJudgment = citable === "judgment" ||
      Boolean(integ?.is_judgment_document) ||
      ["caselaw", "case", "court_case", "supreme_court_il", "judgment"].includes(
        String(c.source_type ?? "").toLowerCase(),
      );
    if (!isJudgment || isScholarship) continue;
    judgmentSeen = true;

    const body = bodyOf(c);
    const hasUsableBody = body.length >= MIN_BODY &&
      usability !== "metadata_only" && usability !== "unusable";
    if (!hasUsableBody) continue;
    usableBodySeen = true;

    // Title recovery for official documents with generic titles — done before
    // the identity decision so recovered titles reach footnotes either way.
    if (isGenericTitle(c.title)) {
      res.generic_titles_detected_count++;
      res.generic_title_detected = true;
      res.title_recovery_attempted = true;
      const rec = recoverJudgmentTitle(c, dockets, requestedTitle);
      if (rec) {
        res.title_recoveries.push({
          candidate_id: c.candidate_id,
          from: c.title,
          to: rec.title,
          via: rec.via,
        });
        c.title = rec.title;
        c.metadata = {
          ...(c.metadata ?? {}),
          recovered_title: rec.title,
          title_recovery_via: rec.via,
        };
        res.title_recovery_success = true;
        res.recovered_title = res.recovered_title ?? rec.title;
      }
    }

    if (match) continue;

    // Identity must be provable from the BODY (a matching web title is not
    // enough — titles are frequently wrong or generic).
    const bodyHasDocket = dockets.some((d) => textContainsExactDocket(body.slice(0, 20000), d));
    const bodyHasTitle = !!requestedTitle && strongTitleMatch(requestedTitle, body.slice(0, 20000));
    if (!bodyHasDocket && !bodyHasTitle) continue;

    const identityFields = [c.title, c.source_url ?? "", String(
      ((c.metadata ?? {}) as Record<string, unknown>).citation ?? "",
    )].join("\n");
    const refHasDocket = dockets.some((d) => textContainsExactDocket(identityFields, d));
    const refHasTitle = !!requestedTitle && strongTitleMatch(requestedTitle, identityFields);

    const by: IdentityMatchedBy = refHasDocket
      ? "docket"
      : refHasTitle
      ? "title"
      : bodyHasDocket
      ? "body"
      : "body";
    match = { c, by };
  }

  if (match) {
    res.matched_judgment_ref = match.c.title || match.c.source_url || match.c.candidate_id;
    res.matched_by = match.by;
    res.specific_case_identity_passed = true;
    res.specific_case_identity_failure_reason = null;
  } else {
    res.matched_by = "none";
    res.specific_case_identity_passed = false;
    res.specific_case_identity_failure_reason = !judgmentSeen
      ? (res.scholarship_only_candidates_count > 0
        ? "only_scholarship_or_commentary"
        : "no_judgment_candidate")
      : !usableBodySeen
      ? "no_usable_judgment_body"
      : "judgment_body_missing_identity";
  }

  res.ms = Date.now() - t0;
  return res;
}
