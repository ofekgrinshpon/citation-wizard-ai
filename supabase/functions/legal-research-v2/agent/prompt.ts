/**
 * legal-research-v2 — the single research-agent prompt.
 *
 * One agent. No planner/critic/citation/academic/repair personas.
 */

import type { Intake } from "../types.ts";

export const AGENT_SYSTEM_PROMPT = `אתה חוקר משפטי ישראלי בכיר. תפקידך: לקבוע מה צריך לחקור, לחקור בפועל באמצעות הכלים, ולהחזיר תזכיר מחקר מבוסס מקורות שנקראו בפועל.

אתה לא כותב את התשובה למשתמש. שלב הניסוח נעשה בנפרד.

הכלים:
1. search({query, scope, limit}) — גילוי מקורות אפשריים. scope: "web" | "official" | "corpus" | "academic". תוצאת חיפוש אינה ראיה ולעולם אינה יכולה להפוך לאסמכתה.
2. lookup_authority({kind, docket, title_hint, statute, section}) — איתור אסמכתה ישראלית מזוהה בשמה. מחזיר רמזים בלבד.
3. fetch({result_id | url, expected_identity, find}) — הבאת גוף המסמך בפועל וקריאתו. רק fetch מייצר ראיה. אפשר להעביר find: מונחים לחיפוש בתוך המסמך, ותקבל חלונות טקסט מדויקים סביבם.

כללי עבודה:
- חקור באופן איטרטיבי: חפש, הבא מסמכים, קרא אותם, ועקוב אחרי הפניות שהתגלו תוך כדי קריאה.
- אל תסתמך על תקצירי חיפוש. כל טענה חייבת להישען על טקסט שהובא בפועל ב-fetch.
- ציטוט (quoted_span) חייב להיות העתקה מילה במילה מגוף המסמך שהוחזר לך. אל תשכתב, אל תתקן, אל תתרגם, אל תקצר באמצע. אורך מומלץ 20–300 תווים.
- אם המסמך שהובא אינו המסמך שביקשת (למשל התיק לא מופיע בגוף), אל תשתמש בו.
- הבחן בין מה שנקבע בפסיקה או בחקיקה לבין הערכה או מחלוקת. אי-ודאות נרשמת ב-unresolved_questions.
- עצור כשהסוגיות המרכזיות מבוססות בראיות, או כשברור שהמשך חיפוש לא ישפר. אין יעד כמותי של מקורות.
- אינך רשאי לסמן ראיה כמאומתת. האימות נעשה מחוץ לך.

בסיום קרא ל-submit_research_memo עם המבנה המלא. כל source_id חייב להיות מזהה שהוחזר לך מ-fetch מוצלח.`;

export function buildAgentUserMessage(intake: Intake): string {
  const parts: string[] = [`שאלת המשתמש:\n${intake.question}`];

  if (intake.docket_obligations.length) {
    parts.push(
      `חובת מחקר מפורשת — התיקים הבאים הוזכרו במפורש בשאלה ויש לאתר ולקרוא את גוף פסק הדין שלהם: ${
        intake.docket_obligations.map((d) => d.display).join(", ")
      }. אם לא ניתן להשיג את הטקסט, אמור זאת ב-unresolved_questions.`,
    );
  }
  if (intake.statute_obligations.length) {
    parts.push(
      `חובת מחקר מפורשת — יש לאתר ולקרוא את נוסח החקיקה: ${
        intake.statute_obligations
          .map((s) => `${s.statute}${s.section ? ` סעיף ${s.section}` : ""}`)
          .join(", ")
      }.`,
    );
  }
  if (intake.attachment_text) {
    parts.push(`מסמך שצורף על ידי המשתמש (טקסט מלא/חלקי):\n${intake.attachment_text.slice(0, 40_000)}`);
  }
  parts.push(
    `תקציבי כלים (תקרות קשיחות, לא יעדים): search ≤ ${intake.budgets.max_search_calls}, fetch ≤ ${intake.budgets.max_fetch_calls}, lookup ≤ ${intake.budgets.max_lookup_calls}, צעדים ≤ ${intake.budgets.max_agent_steps}.`,
  );
  return parts.join("\n\n");
}

export function buildRepairMessage(input: {
  unsupported: Array<{ claim_id: string; proposition: string }>;
  rejected: Array<{ claim_id: string; source_id: string; reason: string; detail: string }>;
}): string {
  const claims = input.unsupported
    .map((c) => `- ${c.claim_id}: ${c.proposition}`)
    .join("\n");
  const rejects = input.rejected
    .map((r) => `- ${r.claim_id} ← ${r.source_id}: ${r.reason} (${r.detail})`)
    .join("\n");
  return `האימות דחה ראיות. סבב מחקר נוסף אחד בלבד.

טענות ליבה ללא תמיכה מאומתת:
${claims || "(אין)"}

ראיות שנדחו והסיבה המדויקת:
${rejects || "(אין)"}

בצע קריאות כלים נוספות לפי הצורך והחזר תזכיר מחקר מעודכן. אם לא ניתן לבסס טענה, הסר אותה או העבר אותה ל-unresolved_questions — אל תמציא תמיכה.`;
}

export const MEMO_TOOL = {
  name: "submit_research_memo",
  description: "הגשת תזכיר המחקר הסופי. כל source_id חייב להגיע מ-fetch מוצלח.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      issue_summary: { type: "string" },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            claim_id: { type: "string" },
            proposition: { type: "string" },
            importance: { type: "string", enum: ["core", "supporting"] },
            evidence: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  source_id: { type: "string" },
                  quoted_span: { type: "string" },
                  locator: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["source_id", "quoted_span", "reason"],
              },
            },
          },
          required: ["claim_id", "proposition", "importance", "evidence"],
        },
      },
      unresolved_questions: { type: "array", items: { type: "string" } },
      research_complete: { type: "boolean" },
    },
    required: ["issue_summary", "claims", "unresolved_questions", "research_complete"],
  },
};
