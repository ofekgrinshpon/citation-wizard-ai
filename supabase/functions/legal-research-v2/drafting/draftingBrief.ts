/**
 * legal-research-v2 — agent-owned drafting brief (agent_owned_drafting_brief_v1).
 *
 * The research agent already reads the user's request, decides how deep to
 * research and knows what the research established. It therefore also
 * describes the deliverable for the drafter: genre, depth, audience, a soft
 * length target and the goals/structure it should serve.
 *
 * TRUST BOUNDARY: the brief is writing guidance, never evidence. It cannot
 * state law, add a claim, create authority or bypass verification. Everything
 * substantive still has to come from the verified evidence pack; if the brief
 * asks for something the pack does not support, the drafter omits it (or, when
 * material, notes the gap in general terms).
 */

import type { DraftingBrief, DraftingDeliverable } from "../types.ts";

const DELIVERABLES: DraftingDeliverable[] = [
  "short_answer",
  "legal_analysis",
  "research_answer",
  "academic_introduction",
  "academic_body_chapter",
  "literature_review",
  "comparative_analysis",
  "conclusion",
  "other",
];

export const BRIEF_LIMITS = {
  goals: 8,
  structure: 12,
  emphasis: 8,
  limitations: 6,
  item_chars: 220,
  style_chars: 300,
  min_words: 80,
  max_words: 6_000,
} as const;

function str(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function strList(v: unknown, count: number): string[] {
  return Array.isArray(v)
    ? v.map((x) => str(x, BRIEF_LIMITS.item_chars)).filter(Boolean).slice(0, count)
    : [];
}

function words(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(BRIEF_LIMITS.max_words, Math.max(BRIEF_LIMITS.min_words, Math.round(n)));
}

/** Parse + bound an agent-supplied brief. Returns null when unusable. */
export function normalizeDraftingBrief(raw: unknown): DraftingBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const deliverable = DELIVERABLES.includes(r.deliverable as DraftingDeliverable)
    ? (r.deliverable as DraftingDeliverable)
    : null;
  if (!deliverable) return null;
  const depth = r.depth === "concise" || r.depth === "deep" ? r.depth : "standard";
  const audience =
    r.audience === "general" || r.audience === "legal_professional" ||
      r.audience === "law_student" || r.audience === "academic"
      ? r.audience
      : undefined;
  const tw = (r.target_words ?? {}) as Record<string, unknown>;
  let min = words(tw.min);
  let max = words(tw.max);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  const brief: DraftingBrief = {
    deliverable,
    depth,
    ...(audience ? { audience } : {}),
    ...(min !== undefined || max !== undefined ? { target_words: { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) } } : {}),
    goals: strList(r.goals, BRIEF_LIMITS.goals),
    structure: strList(r.structure, BRIEF_LIMITS.structure),
    emphasis: strList(r.emphasis, BRIEF_LIMITS.emphasis),
    limitations: strList(r.limitations, BRIEF_LIMITS.limitations),
    ...(str(r.style, BRIEF_LIMITS.style_chars) ? { style: str(r.style, BRIEF_LIMITS.style_chars) } : {}),
  };
  return brief;
}

const DELIVERABLE_HE: Record<DraftingDeliverable, string> = {
  short_answer: "תשובה קצרה וישירה",
  legal_analysis: "ניתוח משפטי",
  research_answer: "תשובת מחקר מפותחת",
  academic_introduction: "פרק מבוא בעבודה אקדמית",
  academic_body_chapter: "פרק גוף בעבודה אקדמית",
  literature_review: "סקירת ספרות",
  comparative_analysis: "ניתוח משפטי משווה",
  conclusion: "פרק סיכום",
  other: "תוצר כתיבה",
};

const DEPTH_HE = {
  concise: "תמציתי",
  standard: "רגיל",
  deep: "מעמיק",
} as const;

/** The Hebrew instruction block appended to the drafter's input. */
export function renderDraftingBrief(brief: DraftingBrief | null | undefined): string {
  if (!brief) return "";
  const parts: string[] = [
    "אפיון התוצר שהמשתמש ביקש (הנחיית כתיבה בלבד — אינו ראיה, אינו קובע מה הדין, ואינו מתיר להוסיף טענה, אסמכתא או מסקנה שאינן בטענות המאומתות):",
    `- סוג התוצר: ${DELIVERABLE_HE[brief.deliverable]}`,
    `- עומק נדרש: ${DEPTH_HE[brief.depth]}`,
  ];
  if (brief.audience) {
    const aud = {
      general: "קהל כללי",
      legal_professional: "משפטנים",
      law_student: "סטודנטים למשפטים",
      academic: "קהל אקדמי",
    }[brief.audience];
    parts.push(`- קהל היעד: ${aud}`);
  }
  const { min, max } = brief.target_words ?? {};
  if (min || max) {
    parts.push(
      `- יעד אורך רך: ${min && max ? `${min}–${max}` : min ? `לפחות ${min}` : `עד ${max}`} מילים. כשהחומר המאומת מספיק — נצל אותו במלואו וכוון לטווח. כשאין די חומר מאומת — כתוב קצר יותר. אין למלא אורך בחזרות, בהכללות או בהמצאות.`,
    );
  }
  if (brief.goals?.length) parts.push(`- מטרות הפרק:\n${brief.goals.map((g) => `  • ${g}`).join("\n")}`);
  if (brief.structure?.length) {
    parts.push(`- מבנה מוצע (ניתן לסטות ממנו אם החומר המאומת מחייב זאת):\n${brief.structure.map((s) => `  • ${s}`).join("\n")}`);
  }
  if (brief.emphasis?.length) parts.push(`- דגשים: ${brief.emphasis.join(" | ")}`);
  if (brief.style) parts.push(`- סגנון: ${brief.style}`);
  if (brief.limitations?.length) {
    parts.push(`- מגבלות שיש להציג בגלוי אם הן מהותיות: ${brief.limitations.join(" | ")}`);
  }
  parts.push(
    "אם אפיון זה מבקש לדון בנושא שאין לגביו טענה מאומתת — אל תמציא את הדיון. השמט אותו, או ציין ברמה כללית שלא ניתן היה לבססו.",
  );
  return parts.join("\n");
}

/** Deliverables whose writing standard is academic prose. */
export function isAcademicDeliverable(brief: DraftingBrief | null | undefined): boolean {
  return brief?.deliverable === "academic_introduction" ||
    brief?.deliverable === "academic_body_chapter" ||
    brief?.deliverable === "literature_review";
}

/**
 * Which academic chapter role the agent's declared deliverable corresponds to.
 * This is not a classifier: the agent already chose the deliverable, this only
 * maps its own choice onto the existing writing-guide roles.
 */
export function academicGuideRole(
  brief: DraftingBrief | null | undefined,
): "introduction" | "body" {
  return brief?.deliverable === "academic_introduction" ? "introduction" : "body";
}

