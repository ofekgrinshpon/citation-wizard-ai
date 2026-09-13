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

export type CorroborationBasis =
  | "docket_present_in_body"
  | "docket_absent_from_body"
  | "docket_proceeding_type_mismatch"
  | "docket_court_level_mismatch"
  | "docket_mention_not_self_identifying"
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
}): CorroborationResult {
  const { expected, title, text, identity_fields, is_actual_document } = args;
  if (!is_actual_document) {
    return { corroborated: false, basis: "body_not_a_document", detail: "no readable document body" };
  }

  const docket = expected?.docket?.trim();
  if (docket) {
    return corroborateCaseIdentity({ docket, title, text, identity_fields });
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

/**
 * Structural markers of a judgment/decision BODY, as opposed to a page that
 * merely cites one. Broad web discovery surfaces many commentary pages that
 * quote a docket correctly; those must not be bound to the authority key.
 */
const JUDGMENT_STRUCTURE_GROUPS: string[][] = [
  ["בית המשפט", "בית הדין"],
  ["השופט", "השופטת", "בפני", "לפני כבוד", "כבוד הנשיא"],
  ["פסק דין", "פסק-דין", "החלטה", "ניתן היום"],
  ["המערער", "המשיב", "העותר", "התובע", "הנתבע", "ב\u05f4כ"],
];

/** Court-level markers that contradict an unqualified (higher-court) request. */
const LOWER_COURT_MARKERS = ["מחוזי", "השלום", "לעבודה", "לעניני משפחה", "לענייני משפחה"];

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
 * A judgment body carries its own docket in the caption and reads like a
 * judgment. A page that cites the docket once, deep inside an article, is
 * commentary about the authority, not the authority.
 */
function isSelfIdentifying(body: string, key: string, hits: number[]): boolean {
  const inCaption = hits.some((i) => i < 4_000);
  if (!inCaption && hits.length < 3) return false;
  void key;
  const groupsPresent = JUDGMENT_STRUCTURE_GROUPS.filter((g) =>
    g.some((m) => body.includes(normalizeAuthorityText(m)))
  );
  return groupsPresent.length >= 2;
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
}): CorroborationResult {
  const { docket, title, text, identity_fields } = args;
  const expectedCase = parseExpectedCase(docket);
  const num = expectedCase.number ?? docket;
  const body = normalizeAuthorityText(`${title}\n${text}`);
  const key = normalizeAuthorityText(num);
  const hits = occurrences(body, key);

  if (!hits.length && !identity_fields.dockets.includes(num)) {
    return { corroborated: false, basis: "docket_absent_from_body", detail: `docket ${num} not in body` };
  }
  // No proceeding type was requested: behaviour is unchanged.
  if (!expectedCase.proceeding) {
    return { corroborated: true, basis: "docket_present_in_body", detail: `docket ${num} found in body` };
  }

  let proceedingSeen = false;
  for (const idx of hits) {
    const pre = body.slice(Math.max(0, idx - 80), idx);
    const words = pre.trim().split(" ").filter(Boolean);
    const last = words[words.length - 1] ?? "";
    const proceedingOk = last === expectedCase.proceeding ||
      (expectedCase.court_qualified && words.includes(expectedCase.proceeding));
    if (!proceedingOk) continue;
    proceedingSeen = true;
    const lowerCourt = LOWER_COURT_MARKERS.some((m) => pre.includes(m));
    if (lowerCourt && !expectedCase.court_qualified) continue;
    if (expectedCase.court_qualified &&
      expectedCase.qualifiers.length &&
      !expectedCase.qualifiers.some((q) => pre.includes(q))
    ) continue;
    if (!isSelfIdentifying(body, key, hits)) {
      return {
        corroborated: false,
        basis: "docket_mention_not_self_identifying",
        detail: `body cites ${num} but does not present itself as that judgment`,
      };
    }
    return {
      corroborated: true,
      basis: "docket_present_in_body",
      detail: `docket ${num} found in body with proceeding type "${expectedCase.proceeding}"`,
    };
  }

  return proceedingSeen
    ? {
      corroborated: false,
      basis: "docket_court_level_mismatch",
      detail: `docket ${num} appears under a different court level than requested`,
    }
    : {
      corroborated: false,
      basis: "docket_proceeding_type_mismatch",
      detail: `docket ${num} appears in the body, but not as "${expectedCase.proceeding} ${num}"`,
    };
}
