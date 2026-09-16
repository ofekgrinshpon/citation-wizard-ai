/**
 * legal-research-v2 — positive authority corroboration at acquisition time.
 *
 * One job: decide whether a FETCHED BODY may be bound to the authority key the
 * agent REQUESTED. A requested label is not proof; a readable body is not
 * proof. Only the body's own text may corroborate its identity.
 *
 * This is an acquisition-caching safeguard only. It never makes a source
 * citable and never touches verifier semantics (identity/span/support/temporal
 * remain exactly as they are).
 */

import type { IdentityFields } from "../types.ts";
import {
  assessCaptionStructure,
  assessHeadStructure,
  classifyLocalCaselawBody,
} from "../vendor/judgmentBodyForm.ts";
import { PROCEEDING_TOKENS } from "../vendor/docketDetection.ts";

export type CorroborationBasis =
  | "docket_present_in_body"
  | "structured_docket_metadata_corroborated"
  | "docket_absent_from_body"
  | "docket_proceeding_type_mismatch"
  | "docket_court_level_mismatch"
  | "docket_mention_not_self_identifying"
  | "judgment_body_form_absent"
  | "statute_title_present_in_body"
  | "statute_title_absent_from_body"
  | "statute_section_absent_from_body"
  | "no_expected_identity"
  | "body_not_a_document";

export interface CorroborationResult {
  corroborated: boolean;
  basis: CorroborationBasis;
  detail: string;
}

const GERSH = /["'\u05f3\u05f4\u2018\u2019\u201c\u201d]/g;

/** Deterministic, language-agnostic normalization for containment tests. */
export function normalizeAuthorityText(input: string): string {
  return (input ?? "")
    .replace(GERSH, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[.,;:()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The stable core of a statute label: the name without its Hebrew-year /
 * gregorian-year suffix and without a leading definite article on the year
 * form. Generic string surgery — no statute is named or special-cased.
 */
export function statuteCoreName(statute: string): string {
  let s = (statute ?? "").trim();
  // drop everything from the first year-ish suffix onwards
  s = s.replace(/[,\u060c]\s*(ה?ת[\u0590-\u05ff"'\u05f3\u05f4-]*\s*[-–]?\s*)?\d{4}.*$/u, "");
  s = s.replace(/[,\u060c]\s*ה?ת[\u0590-\u05ff"'\u05f3\u05f4]{2,6}\s*[-–].*$/u, "");
  s = s.replace(/\s*[-–]\s*\d{4}\s*$/u, "");
  return normalizeAuthorityText(s);
}

function sectionVariants(section: string): string[] {
  const s = section.trim();
  return [`סעיף ${s}`, `סעיף ${s}.`, `${s}.`, ` ${s} `].map(normalizeAuthorityText);
}

/**
 * Positive corroboration of a fetched body against the REQUESTED authority.
 *
 * Cases: existing docket protection (docket must appear in the body).
 * Statutes: the statute's core name must appear in the body itself, and when a
 * section was requested it must be locatable too — otherwise the body cannot
 * stand in for that authority key.
 */
export function corroborateAuthority(args: {
  expected: { docket?: string; statute?: string; section?: string } | undefined;
  title: string;
  text: string;
  identity_fields: IdentityFields;
  is_actual_document: boolean;
  /** Exact docket of the stored row this body came from, when it has one. */
  structured_docket?: string | null;
}): CorroborationResult {
  const { expected, title, text, identity_fields, is_actual_document } = args;
  if (!is_actual_document) {
    return { corroborated: false, basis: "body_not_a_document", detail: "no readable document body" };
  }

  const docket = expected?.docket?.trim();
  if (docket) {
    return corroborateCaseIdentity({
      docket,
      title,
      text,
      identity_fields,
      structured_docket: args.structured_docket,
    });
  }

  const statute = expected?.statute?.trim();
  if (statute) {
    const core = statuteCoreName(statute);
    const body = normalizeAuthorityText(`${title}\n${text.slice(0, 40_000)}`);
    const nameHit = core.length >= 6 &&
      (body.includes(core) ||
        identity_fields.statutes.some((s) => {
          const n = normalizeAuthorityText(s);
          return n.includes(core) || core.includes(n) && n.length >= 6;
        }));
    if (!nameHit) {
      return {
        corroborated: false,
        basis: "statute_title_absent_from_body",
        detail: `body does not present itself as "${statute}"`,
      };
    }
    const section = expected?.section?.trim();
    if (section) {
      const hasSection = identity_fields.sections.includes(section) ||
        sectionVariants(section).some((v) => body.includes(v));
      if (!hasSection) {
        return {
          corroborated: false,
          basis: "statute_section_absent_from_body",
          detail: `statute matched but section ${section} not located in body`,
        };
      }
    }
    return {
      corroborated: true,
      basis: "statute_title_present_in_body",
      detail: `statute "${statute}" corroborated by the body`,
    };
  }

  return { corroborated: false, basis: "no_expected_identity", detail: "no requested authority to corroborate" };
}

// ─── Case identity (docket + proceeding type + court level) ────────────────
//
// Digits alone are not an identity: the same digits routinely identify a
// different case in a different court or a different proceeding type
// (Supreme ע"א 2553/01 vs district ע"א (חיפה) 2553/01). Where the requested
// authority carries a proceeding type, the body's own occurrence of the
// docket must carry the same one, and must not sit under a lower-court
// heading. This only NARROWS binding; nothing is bound that was not bound
// before.

/** Court-level markers that contradict an unqualified (higher-court) request. */
const LOWER_COURT_MARKERS = ["מחוזי", "השלום", "לעבודה", "לעניני משפחה", "לענייני משפחה"];

/**
 * "לעבודה" alone cannot mean "lower court": the National Labour Court is the
 * apex labour instance and is written "בית הדין הארצי לעבודה". Only this one
 * word cancels the marker, and only for the labour courts.
 */
const NATIONAL_INSTANCE_MARKERS = ["ארצי"];

function isLowerCourtContext(pre: string): boolean {
  if (!LOWER_COURT_MARKERS.some((m) => pre.includes(m))) return false;
  const labourOnly = !["מחוזי", "השלום", "לעניני משפחה", "לענייני משפחה"]
    .some((m) => pre.includes(m));
  if (labourOnly && NATIONAL_INSTANCE_MARKERS.some((m) => pre.includes(m))) return false;
  return true;
}

export interface ExpectedCase {
  /** Normalized docket number, e.g. "2553/01". */
  number: string | null;
  /** Normalized proceeding-type token, e.g. "עא", "עפ", "בגץ". */
  proceeding: string | null;
  /** The request itself names a lower/qualified court (e.g. "ע\"א (חיפה)"). */
  court_qualified: boolean;
  /** Normalized qualifier words from the request, if any. */
  qualifiers: string[];
}

export function parseExpectedCase(docket: string): ExpectedCase {
  const number = docket.match(/\d{1,6}\s*\/\s*\d{2,4}/)?.[0]?.replace(/\s+/g, "") ?? null;
  const norm = normalizeAuthorityText(docket);
  const head = number ? norm.split(normalizeAuthorityText(number))[0] : norm;
  const words = head.split(" ").map((w) => w.trim()).filter(Boolean);
  const proceeding = words[0] && !/\d/.test(words[0]) ? words[0] : null;
  const qualifiers = words.slice(1);
  const court_qualified = qualifiers.length > 0 ||
    LOWER_COURT_MARKERS.some((m) => norm.includes(m));
  return { number, proceeding, court_qualified, qualifiers };
}

/**
 * Does the FETCHED BODY represent the judgment itself?
 *
 * Two independent, deterministic conditions — neither depends on the host:
 *  (B) the text has the form of a substantive judgment body (V1 classifier,
 *      audited on 534 real judgment bodies); summaries, metadata stubs and
 *      listing pages are not the judgment;
 *  (C) the body identifies ITSELF as this docket: an early docket occurrence
 *      with at least two distinct structural judgment signals co-located in a
 *      bounded window around it. Vocabulary scattered over the page, or the
 *      docket repeated in an article, never satisfies this.
 *
 * Terminal disposition / numbered reasoning / judicial voice are recorded for
 * diagnostics only and never gate acceptance.
 */
function judgmentSelfIdentity(args: {
  title: string;
  text: string;
  docketKey: string;
}): { ok: boolean; basis?: CorroborationBasis; detail: string } {
  const form = classifyLocalCaselawBody({
    title: args.title ?? "",
    text: args.text ?? "",
    case_number: null,
    body_chars: (args.text ?? "").trim().length,
  });
  if (form.classification !== "substantive_judgment_body") {
    return {
      ok: false,
      basis: "judgment_body_form_absent",
      detail: `body form is ${form.classification} (${form.reason})`,
    };
  }
  const structure = assessCaptionStructure(args.title, args.text, args.docketKey);
  if (!structure.self_identifying) {
    return {
      ok: false,
      basis: "docket_mention_not_self_identifying",
      detail: `no caption-local judgment structure around the docket (signals: ${
        structure.signals.join(",") || "none"
      })`,
    };
  }
  return {
    ok: true,
    detail: `caption signals: ${structure.signals.join(",")}${
      structure.supporting.length ? `; supporting: ${structure.supporting.join(",")}` : ""
    }`,
  };
}

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i !== -1 && out.length < 200) {
    out.push(i);
    i = haystack.indexOf(needle, i + needle.length);
  }
  return out;
}

/**
 * Corroborate a fetched body against a requested CASE authority.
 *
 * Party names are never required: when they are unknown (the normal case) an
 * otherwise-corroborated body is accepted on docket + proceeding type +
 * court level alone.
 */
export function corroborateCaseIdentity(args: {
  docket: string;
  title: string;
  text: string;
  identity_fields: IdentityFields;
  /**
   * Exact docket recorded in the stored row this body came from (local corpus
   * `case_number`). Never sufficient on its own — see `structuredIdentity`.
   */
  structured_docket?: string | null;
}): CorroborationResult {
  const { docket, title, text, identity_fields, structured_docket } = args;
  const expectedCase = parseExpectedCase(docket);
  const num = expectedCase.number ?? docket;
  const body = normalizeAuthorityText(`${title}\n${text}`);
  const key = normalizeAuthorityText(num);
  const hits = occurrences(body, key);

  if (!hits.length && !identity_fields.dockets.includes(num)) {
    return structuredIdentity({ num, title, text, structured_docket }) ??
      { corroborated: false, basis: "docket_absent_from_body", detail: `docket ${num} not in body` };
  }
  const selfIdentity = judgmentSelfIdentity({ title, text, docketKey: key });
  const selfFailure = (prefix: string): CorroborationResult => ({
    corroborated: false,
    basis: selfIdentity.basis ?? "docket_mention_not_self_identifying",
    detail: `${prefix}${selfIdentity.detail}`,
  });

  // No proceeding type was requested: docket + judgment self-identity only.
  if (!expectedCase.proceeding) {
    if (!selfIdentity.ok) return selfFailure("");
    return {
      corroborated: true,
      basis: "docket_present_in_body",
      detail: `docket ${num} found in body (${selfIdentity.detail})`,
    };
  }

  // Per-occurrence reading of the requested proceeding type and court level.
  let proceedingSeen = false;
  let conflictingProceeding: string | null = null;
  let neutralHit = false;
  let neutralLowerCourtOnly = false;
  for (const idx of hits) {
    const pre = body.slice(Math.max(0, idx - 80), idx);
    const words = pre.trim().split(" ").filter(Boolean);
    // The prefix may be separated from the number by a court descriptor
    // ("ע\"ע (ארצי) 478/09") or by extraction noise, so the last few tokens
    // count — not only the immediately preceding word.
    const tail = words.slice(-3);
    const proceedingOk = tail.includes(expectedCase.proceeding) ||
      (expectedCase.court_qualified && words.includes(expectedCase.proceeding));
    const lowerCourt = isLowerCourtContext(pre);
    if (!proceedingOk) {
      // A DIFFERENT known proceeding type glued to the same number is a
      // contradiction (ת"א 8704/09 is not ע"פ 8704/09). No proceeding token at
      // all is merely silence — common in extracted text — and is handled
      // below by the judgment-form and court-level gates.
      const other = tail.find((w) => w !== expectedCase.proceeding && PROCEEDING_TOKENS.has(w));
      if (other) conflictingProceeding = other;
      else if (lowerCourt && !expectedCase.court_qualified) neutralLowerCourtOnly = true;
      else neutralHit = true;
      continue;
    }
    proceedingSeen = true;
    if (lowerCourt && !expectedCase.court_qualified) continue;
    if (expectedCase.court_qualified &&
      expectedCase.qualifiers.length &&
      !expectedCase.qualifiers.some((q) => pre.includes(q))
    ) continue;
    if (!selfIdentity.ok) {
      return selfFailure(`body cites ${num} but does not present itself as that judgment — `);
    }
    return {
      corroborated: true,
      basis: "docket_present_in_body",
      detail:
        `docket ${num} found in body with proceeding type "${expectedCase.proceeding}" (${selfIdentity.detail})`,
    };
  }

  if (proceedingSeen) {
    return {
      corroborated: false,
      basis: "docket_court_level_mismatch",
      detail: `docket ${num} appears under a different court level than requested`,
    };
  }
  if (conflictingProceeding) {
    return {
      corroborated: false,
      basis: "docket_proceeding_type_mismatch",
      detail:
        `docket ${num} appears as "${conflictingProceeding} ${num}", not as "${expectedCase.proceeding} ${num}"`,
    };
  }
  if (!neutralHit) {
    return {
      corroborated: false,
      basis: neutralLowerCourtOnly ? "docket_court_level_mismatch" : "docket_proceeding_type_mismatch",
      detail: neutralLowerCourtOnly
        ? `docket ${num} appears only under a lower-court heading`
        : `docket ${num} appears in the body, but not as "${expectedCase.proceeding} ${num}"`,
    };
  }
  // The number appears without any proceeding token and without a conflicting
  // one. The judgment-form + caption gates still have to carry the identity.
  if (!selfIdentity.ok) {
    return selfFailure(`body mentions ${num} without a proceeding type — `);
  }
  return {
    corroborated: true,
    basis: "docket_present_in_body",
    detail:
      `docket ${num} found in a judgment caption with no conflicting proceeding type (${selfIdentity.detail})`,
  };
}

/**
 * Controlled structured-metadata identity (local corpus only).
 *
 * PDF extraction sometimes drops the caption line that carries the docket. The
 * stored row's exact `case_number` may then supply the missing identity — but
 * only alongside several independent positive signals, and never on its own:
 *
 *   • the stored docket matches the requested one exactly (normalized);
 *   • the body is a substantive judgment body (V1 classifier);
 *   • the document head has judicial caption structure including a
 *     party-bearing signal;
 *   • the head carries no OTHER docket number that would identify it as a
 *     different case.
 *
 * An article, summary, listing or header card fails the second and third
 * conditions, so metadata can never promote one into an authority.
 */
function structuredIdentity(args: {
  num: string;
  title: string;
  text: string;
  structured_docket?: string | null;
}): CorroborationResult | null {
  const stored = (args.structured_docket ?? "").trim();
  if (!stored) return null;
  const want = normalizeAuthorityText(args.num).replace(/-/g, "/").replace(/\s/g, "");
  const have = normalizeAuthorityText(stored).replace(/-/g, "/").replace(/\s/g, "");
  if (!want || have !== want) return null;

  const form = classifyLocalCaselawBody({
    title: args.title ?? "",
    text: args.text ?? "",
    case_number: null,
    body_chars: (args.text ?? "").trim().length,
  });
  if (form.classification !== "substantive_judgment_body") return null;

  const head = assessHeadStructure(args.title, args.text);
  if (!head.judicial_head) return null;
  const foreign = head.dockets.filter((d) => d !== want);
  if (foreign.length) return null;

  return {
    corroborated: true,
    basis: "structured_docket_metadata_corroborated",
    detail:
      `stored case_number ${stored} matches exactly; body is a substantive judgment with caption structure (${
        head.signals.join(",")
      }) and no competing docket`,
  };
}
