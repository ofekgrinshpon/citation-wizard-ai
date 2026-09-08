/**
 * legal-research-v2 — what the user actually asked to receive.
 *
 * This is NOT a research mode, gate or quota. It is a single label describing
 * the requested *deliverable*, used only to word the agent's commit signal and
 * to tell the agent (and the drafter) what shape of product was requested.
 *
 *   "focused"   — a question about a specific authority / narrow point.
 *   "developed" — a chapter, introduction, literature review, comparative or
 *                 synthesis product, i.e. an open-ended research task.
 *
 * Nothing downstream branches on this beyond wording.
 */

export type DeliverableKind = "focused" | "developed";

const DEVELOPED_CUES: RegExp[] = [
  /סקיר(?:ה|ת)\s+ספרות/,
  /סקירה\s+(?:תיאורטית|משפטית|היסטורית|כללית)/,
  /פרק\s*(?:מבוא|מבואי|ראשון|תיאורטי|רקע)?/,
  /מבוא\s+לסמינריון/,
  /סמינריון|סמינר|עבודה\s+אקדמית|עבודת\s+מחקר|חיבור\s+אקדמי|מאמר\s+אקדמי/,
  /שאלת\s+המחקר|שאלת\s+מחקר/,
  /מבט\s+השוואתי|ניתוח\s+השוואתי|השווא(?:ה|תי)/,
  /סקירה\s+ביקורתית|ניתוח\s+ביקורתי|דיון\s+תיאורטי/,
  /ספרות\s+(?:אקדמית|מחקרית)/,
  /תיאוריות|גישות\s+בספרות|עמדות\s+בספרות/,
  /כתוב\s+לי\s+פרק|כתוב\s+פרק|נסח\s+פרק/,
];

/** Deterministic, cue-based. Conservative: defaults to "focused". */
export function classifyDeliverable(question: string): DeliverableKind {
  const q = (question ?? "").replace(/\s+/g, " ").trim();
  if (!q) return "focused";
  for (const re of DEVELOPED_CUES) if (re.test(q)) return "developed";
  return "focused";
}
