// Phase 6.5 — Source Pack Gate V2 (role-based).
//
// Replaces the count-based gate logic with a role-coverage check:
//   for each requiredRole in plan:
//     count cards in pack whose role === requiredRole AND quality !== placeholder
//     AND (priority === "must" → confidence !== "low")
//   if count < minCount → gap
//
// Soft mode: never blocks. Returns a structured result for telemetry +
// a banner for the drafter.

import type {
  LegalResearchPlan,
  LegalSourcePack,
  LegalSourcePackItem,
  RoleCoverageGap,
  SourcePackGateV2Result,
  SourceRole,
} from "./contracts.ts";

export interface GateV2Options {
  /** Mode flag from modeProfile.roleBasedRetrieval. */
  mode: "off" | "shadow" | "on";
  /** When true, attach a banner to the drafter task instructions. */
  attachBanner?: boolean;
}

export function evaluateSourcePackGateV2(
  plan: LegalResearchPlan | null,
  pack: LegalSourcePack | null,
  opts: GateV2Options,
): SourcePackGateV2Result {
  if (opts.mode === "off" || !plan || !pack) {
    return {
      mode: opts.mode,
      satisfied: true,
      coverage: {},
      gaps: [],
      blockingGaps: [],
      bannerAttached: false,
    };
  }

  const all = collectAll(pack);
  const coverage = countByRole(all);

  const gaps: RoleCoverageGap[] = [];
  for (const req of plan.requiredRoles) {
    const matched = countMatching(all, req.role, req.priority);
    if (matched < req.minCount) {
      gaps.push({
        role: req.role,
        required: req.minCount,
        found: matched,
        priority: req.priority,
      });
    }
  }

  const blocking = gaps.filter((g) => g.priority === "must");
  const satisfied = blocking.length === 0;

  return {
    mode: opts.mode,
    satisfied,
    coverage,
    gaps,
    blockingGaps: blocking,
    bannerAttached: !!opts.attachBanner && !satisfied && opts.mode === "on",
  };
}

function collectAll(pack: LegalSourcePack): LegalSourcePackItem[] {
  return [
    ...pack.coreSources,
    ...pack.supportingSources,
    ...pack.secondarySources,
  ];
}

function countByRole(items: LegalSourcePackItem[]): Partial<Record<SourceRole, number>> {
  const out: Partial<Record<SourceRole, number>> = {};
  for (const it of items) {
    if (!it.role) continue;
    out[it.role] = (out[it.role] ?? 0) + 1;
  }
  return out;
}

/**
 * Count items matching a role with quality + confidence rules:
 *   - never count `placeholder` quality
 *   - for `must` requirements, require confidence != "low"
 *   - for `should` requirements, accept any confidence
 */
function countMatching(
  items: LegalSourcePackItem[],
  role: SourceRole,
  priority: "must" | "should",
): number {
  let n = 0;
  for (const it of items) {
    if (it.role !== role) continue;
    if (it.citationQuality === "placeholder") continue;
    if (priority === "must" && it.roleConfidence === "low") continue;
    n++;
  }
  return n;
}

/**
 * Build a Hebrew banner describing the gaps. The banner does NOT instruct
 * the drafter to add citations — instead it tells the drafter to QUALIFY
 * any claim that would otherwise have leaned on a missing role.
 *
 * Hard rules embedded in the banner:
 *   - אל תמציא citations כדי "למלא" תפקיד חסר.
 *   - אל תציג מקור חלש / יישומי כעוגן דוקטרינרי.
 *   - אל תוסיף הערת שוליים אלא אם יש מסמן [cite:S#] אמיתי בגוף.
 *   - אם תפקיד חובה חסר — סייג את המסקנה במפורש.
 */
export function buildGateV2Banner(result: SourcePackGateV2Result): string {
  if (result.gaps.length === 0) return "";
  const lines: string[] = [];
  lines.push("⚠️ כיסוי תפקידי מקור — חסרים תפקידים נדרשים:");
  for (const gap of result.gaps) {
    const tag = gap.priority === "must" ? "חובה" : "מומלץ";
    lines.push(
      `- ${gap.role} (${tag}): נמצאו ${gap.found}/${gap.required}`,
    );
  }
  lines.push("");
  lines.push("הוראות לטיפול בחוסר (חובה לפעול לפיהן):");
  lines.push('• אל תטען טענות חזקות בנושא שתפקיד החובה שלו חסר; השתמש ב"ייתכן" / "טרם הוכרע במאגר" / "לא אותר מקור דוקטרינרי מספק".');
  lines.push("• אל תצטט מקור חלש (docket-only / ערכאה דיונית / יישומי) כאוטוריטה דוקטרינרית מרכזית.");
  lines.push("• אל תוסיף הערת שוליים אלא אם יש מסמן [cite:S#] אמיתי בגוף הטקסט שמתייחס לאותו מקור.");
  lines.push("• אל תמציא citations חדשים כדי \"למלא\" תפקיד חסר — עדיף סעיף קצר וכן מאשר citation מומצא.");
  return lines.join("\n");
}

/**
 * Stronger banner used AFTER role-gap targeted retrieval has already run
 * and required roles are STILL unsatisfied. Tells the drafter to qualify
 * the answer rather than promote weak sources.
 */
export function buildGateV2QualifyBanner(result: SourcePackGateV2Result): string {
  if (result.satisfied || result.blockingGaps.length === 0) return "";
  const lines: string[] = [];
  lines.push("⚠️ לאחר ריצת איסוף ממוקד — תפקידי חובה עדיין חסרים:");
  for (const gap of result.blockingGaps) {
    lines.push(`- ${gap.role}: ${gap.found}/${gap.required}`);
  }
  lines.push("");
  lines.push("חובה: סייג את התשובה במפורש. דוגמאות לניסוח:");
  lines.push('• "לא אותר מקור דוקטרינרי מספק במאגר לעניין זה."');
  lines.push('• "להלן ניתוח כללי בלבד; קביעה מחייבת מצריכה עיון בהלכה הפסוקה הרלוונטית."');
  lines.push("אסור לקדם מקור יישומי / docket-only / ערכאה דיונית כעוגן דוקטרינרי מרכזי.");
  return lines.join("\n");
}

/**
 * Map a missing role to candidate retrieval queries. Targeted retrieval per
 * role uses planner.canonicalSearchTargets when relevant, plus role-specific
 * keyword templates. Domain-agnostic — no contract-law special case.
 */
export function buildQueriesForMissingRole(
  role: SourceRole,
  plan: LegalResearchPlan,
  question: string,
): string[] {
  const queries: string[] = [];
  const targets = plan.canonicalSearchTargets ?? [];
  const statutes = plan.statuteNames ?? [];
  const anchors = plan.doctrinalAnchorNames ?? [];
  const baseQuestion = question.slice(0, 120);

  switch (role) {
    case "doctrinal_anchor":
      for (const a of anchors) queries.push(`${a} הלכה`);
      for (const t of targets.slice(0, 2)) queries.push(`${t} הלכה פסיקה`);
      if (queries.length === 0) queries.push(`${baseQuestion} הלכה פסק דין`);
      break;
    case "statutory_anchor":
      for (const s of statutes) queries.push(s);
      for (const t of targets.slice(0, 2)) queries.push(`${t} חוק סעיף`);
      break;
    case "legislative_history":
      for (const s of statutes) queries.push(`${s} הצעת חוק דברי הסבר`);
      queries.push(`${baseQuestion} פרוטוקול ועדה`);
      queries.push(`${baseQuestion} מחקר כנסת`);
      break;
    case "academic_commentary":
    case "theoretical_anchor":
      queries.push(`${baseQuestion} מאמר אקדמי`);
      for (const t of targets.slice(0, 2)) queries.push(`${t} מאמר`);
      break;
    case "policy_analysis":
      queries.push(`${baseQuestion} ניתוח מדיניות`);
      queries.push(`${baseQuestion} מכון מחקר`);
      break;
    case "counter_position":
      queries.push(`${baseQuestion} דעת מיעוט`);
      queries.push(`${baseQuestion} ביקורת`);
      break;
    case "case_example":
    case "application_example":
      for (const t of targets.slice(0, 2)) queries.push(`${t} פסק דין`);
      if (queries.length === 0) queries.push(`${baseQuestion} פסק דין`);
      break;
    case "institutional_context":
    case "background_context":
      queries.push(baseQuestion);
      break;
    default:
      queries.push(baseQuestion);
  }

  // De-dup, cap at 3 per role.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const k = q.trim().toLowerCase();
    if (!k || k.length < 3 || seen.has(k)) continue;
    seen.add(k);
    out.push(q.trim());
    if (out.length >= 3) break;
  }
  return out;
}
