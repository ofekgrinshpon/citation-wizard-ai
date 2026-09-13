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
    const num = docket.match(/\d{1,6}\/\d{2,4}/)?.[0] ?? docket;
    const hit = identity_fields.dockets.includes(num) ||
      normalizeAuthorityText(text).includes(normalizeAuthorityText(num));
    return hit
      ? { corroborated: true, basis: "docket_present_in_body", detail: `docket ${num} found in body` }
      : { corroborated: false, basis: "docket_absent_from_body", detail: `docket ${num} not in body` };
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
