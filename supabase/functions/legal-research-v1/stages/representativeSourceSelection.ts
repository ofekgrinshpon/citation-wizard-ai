/**
 * canonical_registry_discovery_and_representative_source_use_v1 — fixes 2 + 3.
 *
 * Even when many sources are admitted and permitted, the drafter emits 1–2 refs
 * per block and the answer stays thin. Permission is not guidance.
 *
 * This module runs BEFORE the draft, over sources that are already admitted,
 * body-checked and allowed by the claim-source plan, and picks at most ONE
 * strongest representative source per relevant role per claim. It then renders
 * that as an explicit Hebrew obligation for the drafter, and measures which
 * representatives actually survived into the draft.
 *
 * It never retrieves, admits, revives or re-classifies a source, never bypasses
 * CSM / topic-aware alignment, and never targets a footnote count: a role with
 * only weak or tangential material simply gets no representative.
 */

import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredDraft } from "./structuredValidation.ts";
import { classifySource, type SourceClass } from "./topicAwareAlignment.ts";
import { academicTopicalFit } from "./academicAuthorityAlignment.ts";
import type { ClaimSourcePlan } from "./claimSourcePlanning.ts";

export const REPRESENTATIVE_SOURCE_VERSION =
  "canonical_registry_discovery_and_representative_source_use_v1";

export type RepresentativeRole =
  | "primary_statute_or_text"
  | "canonical_case_law"
  | "direct_doctrinal_scholarship"
  | "theoretical_normative_scholarship"
  | "critique_or_counterposition"
  | "comparative_source"
  | "remedy_or_application_source"
  | "policy_or_institutional_context";

const ROLE_LABEL_HE: Record<RepresentativeRole, string> = {
  primary_statute_or_text: "נוסח חקיקה / מקור נורמטיבי ראשוני",
  canonical_case_law: "פסיקה מכוננת או ישירה",
  direct_doctrinal_scholarship: "ספרות דוקטרינרית ישירה לנושא",
  theoretical_normative_scholarship: "ספרות תיאורטית / נורמטיבית",
  critique_or_counterposition: "ביקורת או עמדה נגדית",
  comparative_source: "מקור משווה (כוח שכנוע בלבד)",
  remedy_or_application_source: "יישום / סעד",
  policy_or_institutional_context: "הקשר מוסדי או מדיניות",
};

/** Roles a claim type may anchor on (class-level, not doctrine-specific). */
const CLAIM_TYPE_ROLES: Record<string, RepresentativeRole[]> = {
  statutory_framework: ["primary_statute_or_text", "canonical_case_law", "direct_doctrinal_scholarship"],
  case_holding: ["canonical_case_law", "primary_statute_or_text", "direct_doctrinal_scholarship"],
  doctrinal_rule: [
    "canonical_case_law",
    "primary_statute_or_text",
    "direct_doctrinal_scholarship",
    "remedy_or_application_source",
  ],
  theoretical_background: [
    "direct_doctrinal_scholarship",
    "theoretical_normative_scholarship",
    "canonical_case_law",
    "primary_statute_or_text",
    "critique_or_counterposition",
    "comparative_source",
    "policy_or_institutional_context",
  ],
  comparative_context: ["comparative_source", "direct_doctrinal_scholarship", "canonical_case_law"],
  critique: ["critique_or_counterposition", "direct_doctrinal_scholarship", "canonical_case_law"],
  implementation_example: [
    "remedy_or_application_source",
    "canonical_case_law",
    "policy_or_institutional_context",
    "direct_doctrinal_scholarship",
  ],
  other: ["primary_statute_or_text", "canonical_case_law", "direct_doctrinal_scholarship"],
};

/** Max representative roles surfaced per claim — guidance, not a quota. */
const MAX_ROLES_PER_CLAIM = 4;

// "ביקורת חוקתית/שיפוטית/מנהלית" is the Hebrew term for judicial review, not a
// critical stance — it must not be read as a counter-position.
const REVIEW_TERM_RE = /ביקורת\s+(חוקתית|שיפוטית|מנהלית)/g;
const CRITIQUE_RE = /(ביקורת|critique|critical|בעייתי|כשל|הסתייגות|counter[- ]?argument|התנגדות)/i;
const THEORY_RE = /(תיאור|theor|philosoph|jurisprud|רציונל|normative|נורמטיב|מושגי)/i;
const COMPARATIVE_RE = /(comparative|משווה|oakes|canad|german|european court|echr|foreign)/i;
const APPLICATION_RE = /(יישום|סעד|remedy|application|צו|פיצוי)/i;

function isForeignOrComparative(s: DrafterInputSource): boolean {
  const flags = (s.integrity_flags ?? []).join(" ");
  return /comparative_only|foreign/i.test(flags) ||
    COMPARATIVE_RE.test(`${s.title} ${s.url ?? ""}`);
}

function hasRealText(s: DrafterInputSource): boolean {
  if (s.body_acquired === true) return true;
  return /full_text|substantive_excerpt/.test(String(s.text_usability ?? ""));
}

function isCanonicalJudgment(s: DrafterInputSource): boolean {
  const flags = (s.integrity_flags ?? []).join(" ");
  return /canonical_authority/i.test(flags) ||
    String(s.authority_tier ?? "") === "official_primary";
}

/** Strongest representative role this source can genuinely serve, if any. */
export function representativeRoleOf(s: DrafterInputSource): RepresentativeRole | null {
  const cls: SourceClass = classifySource(s);
  const hay = `${s.title} ${s.snippet ?? ""}`.replace(REVIEW_TERM_RE, " ");
  if (cls === "statute") return "primary_statute_or_text";
  if (cls === "judgment") {
    if (isForeignOrComparative(s)) return "comparative_source";
    if (s.support_subtype === "application" || APPLICATION_RE.test(hay)) {
      return isCanonicalJudgment(s) ? "canonical_case_law" : "remedy_or_application_source";
    }
    return "canonical_case_law";
  }
  if (cls === "academic") {
    if (isForeignOrComparative(s)) return "comparative_source";
    if (CRITIQUE_RE.test(hay)) return "critique_or_counterposition";
    if (s.best_support === "direct") return "direct_doctrinal_scholarship";
    if (THEORY_RE.test(hay)) return "theoretical_normative_scholarship";
    return "direct_doctrinal_scholarship";
  }
  if (cls === "institutional") return "policy_or_institutional_context";
  return null;
}

export interface RepresentativeSourceSelectionRow {
  run_id: string | null;
  claim_id: string;
  section_type: string;
  role: RepresentativeRole;
  candidate_source_ids: string[];
  selected_source_id: string | null;
  selected_title: string | null;
  directness: "direct" | "partial" | "unknown";
  authority_level: string;
  reason_selected: string | null;
  no_selection_reason: string | null;
}

export interface RepresentativeSourceUseRow {
  run_id: string | null;
  claim_id: string;
  section_type: string;
  representative_sources_available: string[];
  representative_sources_used: string[];
  omitted_representative_sources: string[];
  omission_reason: string | null;
}

export interface RepresentativeComplianceRow {
  run_id: string | null;
  claim_id: string;
  expected_representative_sources: string[];
  emitted_source_refs: string[];
  used_expected_sources: string[];
  missed_expected_sources: string[];
  compliant: boolean;
  reason: string;
}

export interface RepresentativeSourceReport {
  version: string;
  run_id: string | null;
  rows: RepresentativeSourceSelectionRow[];
  /** claim_id → ordered representative refs (anchor first). */
  by_claim: Record<string, string[]>;
  selected_count: number;
  claims_with_representative: number;
}

function scoreSource(question: string, claimText: string, s: DrafterInputSource): number {
  const lexical = academicTopicalFit(question, claimText, s, 2);
  return Math.min(lexical.score, 4) +
    (hasRealText(s) ? 2 : 0) +
    (s.best_support === "direct" ? 2 : 0) +
    (isCanonicalJudgment(s) ? 2 : 0);
}

/** Weak / generic material never becomes a representative source. */
function isRepresentativeEligible(
  question: string,
  claimText: string,
  s: DrafterInputSource,
): { ok: boolean; reason: string } {
  if (!hasRealText(s)) return { ok: false, reason: "no_acquired_body" };
  const lexical = academicTopicalFit(question, claimText, s, 2);
  if (!lexical.fit && s.best_support !== "direct" && classifySource(s) !== "statute") {
    return { ok: false, reason: "only_generic_or_tangential" };
  }
  return { ok: true, reason: "admitted_body_and_topical" };
}

export function buildRepresentativeSourceSelection(
  question: string,
  claims: Array<{ claim_id: string; text_he: string }>,
  sources: DrafterInputSource[],
  plan: ClaimSourcePlan,
  opts?: { run_id?: string | null },
): RepresentativeSourceReport {
  const run_id = opts?.run_id ?? null;
  const byRef = new Map(sources.map((s) => [s.ref, s]));
  const planByClaim = new Map(plan.rows.map((r) => [r.claim_id, r]));
  const rows: RepresentativeSourceSelectionRow[] = [];
  const by_claim: Record<string, string[]> = {};

  for (const c of claims) {
    const planRow = planByClaim.get(c.claim_id);
    if (!planRow) continue;
    const allowed = planRow.preferred_source_ids
      .map((ref) => byRef.get(ref))
      .filter((s): s is DrafterInputSource => !!s);
    const roles = CLAIM_TYPE_ROLES[planRow.claim_type] ?? CLAIM_TYPE_ROLES.other;
    const taken = new Set<string>();
    const selectedRefs: string[] = [];

    for (const role of roles) {
      if (selectedRefs.length >= MAX_ROLES_PER_CLAIM) break;
      const candidates = allowed.filter((s) => representativeRoleOf(s) === role);
      const row: RepresentativeSourceSelectionRow = {
        run_id,
        claim_id: c.claim_id,
        section_type: planRow.claim_type,
        role,
        candidate_source_ids: candidates.map((s) => s.ref),
        selected_source_id: null,
        selected_title: null,
        directness: "unknown",
        authority_level: "unknown",
        reason_selected: null,
        no_selection_reason: candidates.length === 0 ? "no_candidate_for_role" : null,
      };
      if (candidates.length === 0) {
        rows.push(row);
        continue;
      }
      const eligible = candidates
        .filter((s) => !taken.has(s.ref))
        .map((s) => ({ s, e: isRepresentativeEligible(question, c.text_he, s) }))
        .filter((x) => x.e.ok)
        .map((x) => ({ s: x.s, score: scoreSource(question, c.text_he, x.s) }))
        .sort((a, b) => b.score - a.score);
      if (eligible.length === 0) {
        row.no_selection_reason = candidates.every((s) => taken.has(s.ref))
          ? "already_representative_for_another_role"
          : "only_weak_or_generic_sources";
        rows.push(row);
        continue;
      }
      const winner = eligible[0].s;
      taken.add(winner.ref);
      selectedRefs.push(winner.ref);
      row.selected_source_id = winner.ref;
      row.selected_title = winner.title;
      row.directness = winner.best_support === "direct"
        ? "direct"
        : winner.best_support === "partial"
        ? "partial"
        : "unknown";
      row.authority_level = String(winner.authority_tier ?? "unknown");
      row.reason_selected = `strongest_${role}_score_${eligible[0].score}`;
      rows.push(row);
    }
    if (selectedRefs.length) by_claim[c.claim_id] = selectedRefs;
  }

  return {
    version: REPRESENTATIVE_SOURCE_VERSION,
    run_id,
    rows,
    by_claim,
    selected_count: Object.values(by_claim).reduce((n, a) => n + a.length, 0),
    claims_with_representative: Object.keys(by_claim).length,
  };
}

/** Hebrew drafter obligation block. Empty when nothing was selected. */
export function renderRepresentativeSourceBlock(
  report: RepresentativeSourceReport,
  plan: ClaimSourcePlan,
): string {
  const claimIds = Object.keys(report.by_claim);
  if (claimIds.length === 0) return "";
  const planByClaim = new Map(plan.rows.map((r) => [r.claim_id, r]));
  const roleByRef = new Map(
    report.rows.filter((r) => r.selected_source_id).map((r) => [
      `${r.claim_id}:${r.selected_source_id}`,
      r,
    ]),
  );
  const lines: string[] = [];
  lines.push(
    "מקורות מייצגים (חובה מעשית): לכל טענה נבחרו מראש המקורות החזקים ביותר הזמינים, לפי תפקיד. " +
      "אם קיים מקור מייצג לתפקיד שהטענה נשענת עליו — יש לצרף אותו ל-source_refs של הבלוק המבסס את הטענה, " +
      "אלא אם הבלוק הושמט או שונה מהותית. אין להעדיף מקור חלש כשקיים מקור מייצג ישיר לאותה טענה.",
  );
  for (const claimId of claimIds) {
    const refs = report.by_claim[claimId];
    const planRow = planByClaim.get(claimId);
    const parts = refs.map((ref) => {
      const r = roleByRef.get(`${claimId}:${ref}`);
      return `${ref} (${r ? ROLE_LABEL_HE[r.role] : "מקור מייצג"})`;
    });
    lines.push(
      `- (${claimId}) עוגן מועדף: ${refs[0]}; מקורות מייצגים: ${parts.join("; ")}` +
        (planRow?.unsupported_or_cautious ? " — נסח בזהירות" : ""),
    );
  }
  for (const r of report.rows) {
    if (r.selected_source_id || r.no_selection_reason !== "only_weak_or_generic_sources") continue;
    lines.push(
      `  • (${r.claim_id}) לא נבחר מקור מייצג ל"${ROLE_LABEL_HE[r.role]}" — אין מקור ישיר מספיק; אל תמציא עושר ואל תצרף מקור כללי במקומו.`,
    );
  }
  lines.push(
    "אין לצרף הפניות לשם צפיפות בלבד, ואין לחזור על אותו מקור בכמה תפקידים אלא אם הוא באמת תומך בכל אחד מהם.",
  );
  return lines.join("\n");
}

function emittedRefsByClaim(draft: StructuredDraft | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const b of draft?.blocks ?? []) {
    if (b.kind === "heading") continue;
    const claimId = String(b.claim_id ?? "");
    if (!claimId) continue;
    const arr = out.get(claimId) ?? [];
    for (const ref of b.source_refs ?? []) if (!arr.includes(ref)) arr.push(ref);
    out.set(claimId, arr);
  }
  return out;
}

export function assessRepresentativeSourceUse(
  draft: StructuredDraft | null,
  report: RepresentativeSourceReport,
): { rows: RepresentativeSourceUseRow[]; used: number; omitted: number } {
  const emitted = emittedRefsByClaim(draft);
  const sectionByClaim = new Map(report.rows.map((r) => [r.claim_id, r.section_type]));
  const rows: RepresentativeSourceUseRow[] = [];
  for (const [claim_id, available] of Object.entries(report.by_claim)) {
    const got = emitted.get(claim_id) ?? [];
    const used = available.filter((r) => got.includes(r));
    const omitted = available.filter((r) => !got.includes(r));
    rows.push({
      run_id: report.run_id,
      claim_id,
      section_type: sectionByClaim.get(claim_id) ?? "unknown",
      representative_sources_available: available,
      representative_sources_used: used,
      omitted_representative_sources: omitted,
      omission_reason: omitted.length === 0
        ? null
        : got.length === 0
        ? "block_emitted_no_source_refs"
        : "drafter_chose_other_admitted_sources",
    });
  }
  return {
    rows,
    used: rows.reduce((n, r) => n + r.representative_sources_used.length, 0),
    omitted: rows.reduce((n, r) => n + r.omitted_representative_sources.length, 0),
  };
}

export function assessDrafterRepresentativeCompliance(
  draft: StructuredDraft | null,
  report: RepresentativeSourceReport,
): {
  version: string;
  rows: RepresentativeComplianceRow[];
  claims_checked: number;
  claims_compliant: number;
} {
  const emitted = emittedRefsByClaim(draft);
  const rows: RepresentativeComplianceRow[] = [];
  for (const [claim_id, expected] of Object.entries(report.by_claim)) {
    const got = emitted.get(claim_id) ?? [];
    const used = expected.filter((r) => got.includes(r));
    const missed = expected.filter((r) => !got.includes(r));
    const compliant = used.length > 0;
    rows.push({
      run_id: report.run_id,
      claim_id,
      expected_representative_sources: expected,
      emitted_source_refs: got,
      used_expected_sources: used,
      missed_expected_sources: missed,
      compliant,
      reason: compliant
        ? missed.length === 0 ? "all_representatives_used" : "anchor_used_some_omitted"
        : got.length === 0
        ? "no_source_refs_emitted_for_claim"
        : "only_non_representative_sources_emitted",
    });
  }
  return {
    version: REPRESENTATIVE_SOURCE_VERSION,
    rows,
    claims_checked: rows.length,
    claims_compliant: rows.filter((r) => r.compliant).length,
  };
}
