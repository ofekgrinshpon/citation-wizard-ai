/**
 * topic_aware_claim_source_alignment_v1
 *
 * Pre-draft half of the precision-of-use track. `topicAwareAlignment.ts` runs
 * AFTER the draft (role sanity, legal-area fit, block pruning, compound
 * guard, limitation notes). This module runs BEFORE the draft:
 *
 *   1. derives a claim-level source plan (claim type → allowed roles →
 *      preferred / disallowed source ids);
 *   2. renders that plan into the drafter prompt so the model is constrained
 *      instead of being corrected afterwards;
 *   3. measures drafter compliance per block (report-only — enforcement stays
 *      with the existing post-draft gates);
 *   4. produces the post-draft alignment filter telemetry.
 *
 * It never retrieves, admits, acquires or adds a source, and it never changes
 * pool size, footnote caps or Hebrew prose rules.
 */

import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredDraft } from "./structuredValidation.ts";
import {
  type ClaimType,
  classifySource,
  judgmentLegalAreaFit,
  type SourceClass,
  type TopicAwareAlignmentReport,
} from "./topicAwareAlignment.ts";
import { academicTopicalFit } from "./academicAuthorityAlignment.ts";
import {
  applyStatuteDominance,
  isStatutoryQuestion,
  type StatuteDominanceReport,
} from "./statuteDominance.ts";
import {
  applyAuthorityPriority,
  type AuthorityPriorityReport,
} from "./authoritySourcePriority.ts";

export const CLAIM_SOURCE_PLANNING_VERSION = "v1.0";

const STATUTORY_CUE = /(סעיף|חוק[- ]יסוד|תקנה\s+\d|לפי\s+חוק|נוסח\s+החוק|הוראת\s+החוק|מסגרת\s+חקיקתית)/;
const HOLDING_CUE = /(נפסק|נקבע\s+כי|בית\s+המשפט\s+קבע|הלכת|פסק\s+הדין)/;
const COMPARATIVE_CUE = /(משפט\s+משווה|קנדה|גרמניה|האמנה\s+האירופית|oakes)/i;
const CRITIQUE_CUE = /(ביקורת|בעייתי|כשל|מנוגד|הסתייגות|יש\s+לתהות)/;
const EXAMPLE_CUE = /(לדוגמה|כך\s+למשל|יישום|הלכה\s+למעשה|בפועל)/;
const REMEDY_CUE = /(סעד|תרופה|פיצוי|בטלות|צו\s+עשה|צו\s+מניעה)/;
const POLICY_CUE = /(מדיניות\s+ציבורית|דוח\s+ממשלתי|נתונים|היערכות\s+מוסדית)/;
const THEORY_CUE = /(רקע\s+תיאורטי|תיאורי|מושגי|ספרות|גישות\s+בספרות|רציונל)/;

/** Claim-type derivation from free Hebrew claim text (pre-draft, no blocks). */
export function deriveClaimTypeFromText(text: string, academicMode: boolean): ClaimType {
  const t = String(text ?? "");
  if (STATUTORY_CUE.test(t)) return "statutory_framework";
  if (HOLDING_CUE.test(t)) return "case_holding";
  if (COMPARATIVE_CUE.test(t)) return "comparative_context";
  if (CRITIQUE_CUE.test(t)) return "critique";
  if (EXAMPLE_CUE.test(t) || REMEDY_CUE.test(t) || POLICY_CUE.test(t)) {
    return "implementation_example";
  }
  if (THEORY_CUE.test(t)) return "theoretical_background";
  return academicMode ? "theoretical_background" : "doctrinal_rule";
}

const ACCEPTABLE_CLASSES: Record<ClaimType, SourceClass[]> = {
  statutory_framework: ["statute"],
  case_holding: ["judgment"],
  doctrinal_rule: ["judgment", "statute", "academic"],
  theoretical_background: ["academic", "institutional", "statute", "judgment"],
  comparative_context: ["academic", "judgment"],
  critique: ["academic", "judgment"],
  implementation_example: ["judgment", "institutional", "academic"],
  other: ["judgment", "statute", "academic", "institutional", "other"],
};

const ROLE_LABEL: Record<SourceClass, string> = {
  judgment: "פסיקה (עוגן הלכתי / יישום / דוגמה)",
  statute: "חקיקה (עוגן נורמטיבי ראשוני)",
  academic: "ספרות אקדמית (רקע דוקטרינרי / תיאוריה / ביקורת / השוואה)",
  institutional: "חומר מוסדי (הקשר מדיניות / דיווח עובדתי)",
  other: "אחר",
};

export interface ClaimSourcePlanRow {
  claim_id: string;
  block_topic: string;
  claim_type: ClaimType;
  allowed_roles: string[];
  preferred_source_ids: string[];
  disallowed_source_ids: string[];
  /** research_richness_execution_unblock_v1 — plan-ceiling telemetry. */
  preferred_ceiling?: number;
  preferred_per_role?: Record<string, number>;
  eligible_count?: number;
  unsupported_or_cautious: boolean;
  reason: string;
}

export interface ClaimSourcePlan {
  version: string;
  academic_mode: boolean;
  rows: ClaimSourcePlanRow[];
  /** web_source_usability_and_authority_selection_v1 telemetry. */
  statute_dominance?: StatuteDominanceReport;
  authority_priority?: AuthorityPriorityReport;
}

const MAX_PREFERRED = 4;
/** research_richness_execution_unblock_v1 — academic deep answers may cite a
 *  wider, role-diverse set of already-admitted sources. No new sources are
 *  admitted here: this only raises the ceiling on what the drafter may cite. */
const MAX_PREFERRED_ACADEMIC = 8;
const MIN_PREFERRED_ACADEMIC = 6;
/** Per-class ceiling inside one academic claim, so one class cannot fill it. */
const ACADEMIC_PER_CLASS_CAP = 3;

/** Diversity-aware top-N selection: round-robin across source classes by score. */
function selectRoleDiverse(
  ranked: Array<{ ref: string; score: number; cls: string }>,
  limit: number,
  perClassCap: number,
): { ids: string[]; per_role: Record<string, number> } {
  const byClass = new Map<string, Array<{ ref: string; score: number }>>();
  for (const r of ranked) {
    const arr = byClass.get(r.cls) ?? [];
    arr.push({ ref: r.ref, score: r.score });
    byClass.set(r.cls, arr);
  }
  const order = [...byClass.keys()].sort((a, b) =>
    (byClass.get(b)![0]?.score ?? 0) - (byClass.get(a)![0]?.score ?? 0)
  );
  const ids: string[] = [];
  const per_role: Record<string, number> = {};
  let round = 0;
  while (ids.length < limit && round < perClassCap) {
    let progressed = false;
    for (const cls of order) {
      if (ids.length >= limit) break;
      const item = byClass.get(cls)![round];
      if (!item) continue;
      ids.push(item.ref);
      per_role[cls] = (per_role[cls] ?? 0) + 1;
      progressed = true;
    }
    if (!progressed) break;
    round++;
  }
  return { ids, per_role };
}

export function buildClaimSourcePlan(
  question: string,
  claims: Array<{ claim_id: string; text_he: string }>,
  sources: DrafterInputSource[],
  opts: { academicMode: boolean },
): ClaimSourcePlan {
  const rows: ClaimSourcePlanRow[] = [];
  const statutoryQuestion = isStatutoryQuestion(question).hit;
  for (const c of claims) {
    const text = String(c.text_he ?? "");
    const claimType = deriveClaimTypeFromText(text, opts.academicMode);
    const acceptable = ACCEPTABLE_CLASSES[claimType];
    const preferred: Array<{ ref: string; score: number; cls: string }> = [];
    const disallowed: string[] = [];

    for (const s of sources) {
      const cls = classifySource(s);
      if (!acceptable.includes(cls)) {
        disallowed.push(s.ref);
        continue;
      }
      const lexical = academicTopicalFit(question, text, s, 2);
      if (cls === "judgment") {
        const fit = judgmentLegalAreaFit(question, text, s, c.claim_id, opts.academicMode);
        if (fit.blocked) {
          disallowed.push(s.ref);
          continue;
        }
      } else if (
        !lexical.fit && claimType !== "other" &&
        // statute dominance: a statute source is never lexically demoted on a
        // statutory claim / statutory question — it IS the primary authority.
        !(cls === "statute" && (claimType === "statutory_framework" || statutoryQuestion))
      ) {
        // Generic scholarship with no shared vocabulary is demoted, not banned:
        // the post-draft gates own removal. Keep it out of the preferred list.
        continue;
      }
      const score = Math.min(lexical.score, 4) +
        (s.body_acquired === true ? 2 : 0) +
        (s.best_support === "direct" ? 1 : 0) +
        (cls === "judgment" || cls === "statute" ? 1 : 0);
      preferred.push({ ref: s.ref, score, cls });
    }
    preferred.sort((a, b) => b.score - a.score);
    let preferredIds: string[];
    let perRole: Record<string, number> = {};
    let ceiling = MAX_PREFERRED;
    if (opts.academicMode) {
      ceiling = Math.max(
        MIN_PREFERRED_ACADEMIC,
        Math.min(MAX_PREFERRED_ACADEMIC, preferred.length),
      );
      const sel = selectRoleDiverse(preferred, ceiling, ACADEMIC_PER_CLASS_CAP);
      preferredIds = sel.ids;
      perRole = sel.per_role;
    } else {
      preferredIds = preferred.slice(0, MAX_PREFERRED).map((p) => p.ref);
      for (const p of preferred.slice(0, MAX_PREFERRED)) {
        perRole[p.cls] = (perRole[p.cls] ?? 0) + 1;
      }
    }
    rows.push({
      claim_id: c.claim_id,
      block_topic: text.slice(0, 80),
      claim_type: claimType,
      allowed_roles: acceptable.map((cl) => ROLE_LABEL[cl]),
      preferred_source_ids: preferredIds,
      disallowed_source_ids: disallowed,
      preferred_ceiling: ceiling,
      preferred_per_role: perRole,
      eligible_count: preferred.length,
      unsupported_or_cautious: preferredIds.length === 0,
      reason: preferredIds.length === 0
        ? `no_source_matches_${claimType}`
        : `matched_${preferredIds.length}_sources_for_${claimType}`,
    });
  }
  // fix 3 + fix 4 — statute dominance, then deterministic authority priority.
  const preferredByClaim = new Map(rows.map((r) => [r.claim_id, [...r.preferred_source_ids]]));
  const statute_dominance = applyStatuteDominance({
    question,
    claims,
    sources,
    preferredByClaim,
  });
  const authority_priority = applyAuthorityPriority({ claims, sources, preferredByClaim });
  for (const r of rows) {
    const next = preferredByClaim.get(r.claim_id);
    if (next) {
      r.preferred_source_ids = next;
      r.unsupported_or_cautious = next.length === 0;
    }
  }
  return {
    version: CLAIM_SOURCE_PLANNING_VERSION,
    academic_mode: opts.academicMode,
    rows,
    statute_dominance,
    authority_priority,
  };
}

/** Hebrew prompt block constraining source use per claim. Empty when no rows. */
export function renderClaimSourcePlanBlock(plan: ClaimSourcePlan): string {
  if (plan.rows.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    "תכנון מקורות לפי טענה (מחייב): לכל טענה נקבעו מראש סוגי המקורות המותרים והמזהים המותרים. " +
      "מותר לצרף ל-source_refs של בלוק רק מזהים המופיעים ברשימת המותרים של הטענה שהבלוק מבסס. " +
      "מקור המופיע כאסור לאותה טענה לא ייכלל בה בשום מקרה, גם אם הוא נראה מתאים.",
  );
  for (const r of plan.rows) {
    lines.push(
      `- (${r.claim_id}) סוג טענה: ${r.claim_type}; מקורות מותרים: ${
        r.preferred_source_ids.length ? r.preferred_source_ids.join(", ") : "אין"
      }; אסורים: ${
        r.disallowed_source_ids.length ? r.disallowed_source_ids.slice(0, 12).join(", ") : "—"
      }`,
    );
    if (r.unsupported_or_cautious) {
      lines.push(
        `  • לטענה זו לא אותר מקור מתאים — נסח אותה בלשון זהירה או כמגבלה, ואל תצרף לה הפניה.`,
      );
    }
  }
  lines.push(
    "אין להשלים חוסר בהפניה באמצעות מקור מתחום סמוך: עדיף בלוק ללא הערת שוליים על פני הפניה שאינה תומכת בטענה.",
  );
  return lines.join("\n");
}

// ── drafter compliance (report-only) ────────────────────────────────────────

export interface DrafterBlockComplianceRow {
  block_id: string;
  claim_id: string;
  emitted_source_refs: string[];
  allowed_source_refs: string[];
  disallowed_emitted_refs: string[];
  compliant: boolean;
  reason: string;
}

export interface DrafterBlockComplianceReport {
  version: string;
  blocks_checked: number;
  blocks_compliant: number;
  violations: number;
  rows: DrafterBlockComplianceRow[];
}

export function assessDrafterBlockCompliance(
  draft: StructuredDraft | null,
  plan: ClaimSourcePlan,
): DrafterBlockComplianceReport {
  const rows: DrafterBlockComplianceRow[] = [];
  let compliant = 0;
  let violations = 0;
  const byClaim = new Map(plan.rows.map((r) => [r.claim_id, r]));
  let idx = 0;
  for (const b of draft?.blocks ?? []) {
    if (b.kind === "heading") continue;
    idx++;
    const claimId = String(b.claim_id ?? "");
    const row = byClaim.get(claimId);
    const emitted = [...(b.source_refs ?? [])];
    if (!row) {
      rows.push({
        block_id: `b${idx}`,
        claim_id: claimId || "unmapped",
        emitted_source_refs: emitted,
        allowed_source_refs: [],
        disallowed_emitted_refs: [],
        compliant: true,
        reason: "no_plan_row_for_claim",
      });
      compliant++;
      continue;
    }
    const disallowedSet = new Set(row.disallowed_source_ids);
    const bad = emitted.filter((r) => disallowedSet.has(r));
    if (bad.length > 0) violations++;
    else compliant++;
    rows.push({
      block_id: `b${idx}`,
      claim_id: claimId,
      emitted_source_refs: emitted,
      allowed_source_refs: row.preferred_source_ids,
      disallowed_emitted_refs: bad,
      compliant: bad.length === 0,
      reason: bad.length === 0 ? "within_plan" : "emitted_disallowed_source",
    });
  }
  return {
    version: CLAIM_SOURCE_PLANNING_VERSION,
    blocks_checked: idx,
    blocks_compliant: compliant,
    violations,
    rows,
  };
}

// ── post-draft alignment filter telemetry ───────────────────────────────────

export interface PostDraftAlignmentFilterRow {
  citation_id: string;
  source_id: string;
  claim_id: string;
  csm_result: "kept" | "dropped";
  role_fit: boolean;
  legal_area_fit: boolean;
  kept: boolean;
  dropped: boolean;
  reason: string;
}

export interface PostDraftAlignmentFilterReport {
  version: string;
  checked: number;
  kept: number;
  dropped: number;
  rows: PostDraftAlignmentFilterRow[];
}

/**
 * Derives the citation-level kept/dropped view from the post-draft alignment
 * report. Every ref the alignment stage removed is reported as dropped with
 * its reason; every surviving ref is reported with its role/area fit.
 */
export function buildPostDraftAlignmentFilter(
  report: TopicAwareAlignmentReport,
): PostDraftAlignmentFilterReport {
  const rows: PostDraftAlignmentFilterRow[] = [];
  const fitByRef = new Map(report.judgment_legal_area_fit.map((f) => [f.source_id, f]));
  for (const plan of report.block_source_plan) {
    for (const ref of plan.selected_sources) {
      const rank = report.block_source_ranking.find((r) =>
        r.block_id === plan.block_id && r.source_id === ref
      );
      rows.push({
        citation_id: `${plan.block_id}:${ref}`,
        source_id: ref,
        claim_id: plan.block_id,
        csm_result: "kept",
        role_fit: rank?.role_match ?? true,
        legal_area_fit: rank?.legal_area_match ?? (fitByRef.get(ref)?.direct_doctrine_match ?? true),
        kept: true,
        dropped: false,
        reason: "role_and_area_compatible",
      });
    }
    for (let i = 0; i < plan.rejected_sources.length; i++) {
      const ref = plan.rejected_sources[i];
      const reason = plan.rejection_reasons.find((r) => r.startsWith(`${ref}:`)) ??
        `${ref}:removed_by_alignment`;
      rows.push({
        citation_id: `${plan.block_id}:${ref}`,
        source_id: ref,
        claim_id: plan.block_id,
        csm_result: "kept",
        role_fit: !reason.includes("not_acceptable_for"),
        legal_area_fit: !reason.includes("legal_area") && !reason.includes("overlap"),
        kept: false,
        dropped: true,
        reason: reason.slice(reason.indexOf(":") + 1),
      });
    }
  }
  return {
    version: CLAIM_SOURCE_PLANNING_VERSION,
    checked: rows.length,
    kept: rows.filter((r) => r.kept).length,
    dropped: rows.filter((r) => r.dropped).length,
    rows,
  };
}
