// Targeted revision pass for academic chapters.
//
// Invoked only when `shouldRevise()` returns true on the critic's verdict.
// Reuses the same drafter helper (and therefore the same variant: structured
// or legacy) so token caps, timeouts, and provider fallback behave identically
// to the original draft. Single call, no loop — on failure we keep the
// original draft and log it.

import { callDrafter, type DrafterResult } from "./aiProvider.ts";
import type { CriticIssue } from "./critic.ts";

export interface RunChapterRevisionArgs {
  originalDraft: string;
  issues: CriticIssue[];
  drafterSystemPrompt: string;
  userMessage: string;
  variant: "legacy" | "structured";
  maxTokens: number;
  timeoutMs: number;
}

export interface RunChapterRevisionOutput {
  result: DrafterResult | null;
  startedAt: Date;
  durationMs: number;
  status: "success" | "empty" | "error";
}

function buildRevisionSystemPrompt(
  base: string,
  issues: CriticIssue[],
  originalDraft: string,
): string {
  const issueLines = issues
    .map((i, idx) => {
      const claim = i.claim_id ? ` (claim ${i.claim_id})` : "";
      const sources = i.source_ids && i.source_ids.length > 0
        ? ` [sources: ${i.source_ids.join(", ")}]`
        : "";
      return `${idx + 1}. [${i.severity}/${i.kind}]${claim}${sources}
   ראיה: ${i.evidence}
   תיקון: ${i.fix_hint}`;
    })
    .join("\n");

  const guard = [
    "",
    "=== מצב תיקון (revision pass) ===",
    "הטיוטה הבאה עברה ביקורת ונמצאו בה ליקויים נקודתיים. החזר את הפרק המלא לאחר תיקון הליקויים בלבד.",
    "",
    "כללי תיקון מחייבים:",
    "• אל תוסיף מקורות שאינם בקבוצת המקורות שכבר סופקה לך.",
    "• אל תשנה את הטון או את המבנה הכללי — תיקון כירורגי בלבד.",
    "• שמור על מבנה הערות השוליים הקיים (---הערות שוליים--- והמספור).",
    "• אם תיקון של ליקוי מסוים מצריך הוספת מקור חדש שלא קיים — דלג עליו והשאר את הטקסט כפי שהוא.",
    "• החזר את הטיוטה המלאה (לא diff), כולל ההערות.",
    "",
    "ליקויים לתיקון:",
    issueLines,
    "",
    "=== טיוטה מקורית לתיקון ===",
    originalDraft,
  ].join("\n");

  return `${base}

${guard}`;
}

export async function runChapterRevision(
  args: RunChapterRevisionArgs,
): Promise<RunChapterRevisionOutput> {
  const startedAt = new Date();
  const t0 = Date.now();
  const revisionSystem = buildRevisionSystemPrompt(
    args.drafterSystemPrompt,
    args.issues,
    args.originalDraft,
  );

  try {
    const res = await callDrafter(
      revisionSystem,
      args.userMessage,
      args.maxTokens,
      args.timeoutMs,
      args.variant,
    );
    const durationMs = Date.now() - t0;
    if (!res || res.text.length < 50) {
      return { result: null, startedAt, durationMs, status: "empty" };
    }
    return { result: res, startedAt, durationMs, status: "success" };
  } catch (err) {
    console.error("[revision] call failed:", (err as Error).message);
    return { result: null, startedAt, durationMs: Date.now() - t0, status: "error" };
  }
}
