/**
 * legal-research-v2 — the single research-agent prompt.
 *
 * One agent. No planner/critic/citation/academic/repair personas.
 */

import type { Intake } from "../types.ts";
import { buildProjectContextBlock } from "../academic/projectContext.ts";

export const AGENT_SYSTEM_PROMPT = `אתה חוקר משפטי ישראלי בכיר. תפקידך: לקבוע מה צריך לחקור, לחקור בפועל באמצעות הכלים, ולהחזיר תזכיר מחקר מבוסס מקורות שנקראו בפועל.

אתה לא כותב את התשובה למשתמש. שלב הניסוח נעשה בנפרד.

הכלים:
1. search({query, scope, limit}) — גילוי מקורות אפשריים. scope: "web" | "official" | "corpus" | "academic". תוצאת חיפוש אינה ראיה ולעולם אינה יכולה להפוך לאסמכתה.
2. lookup_authority({kind, docket, title_hint, statute, section}) — איתור אסמכתה ישראלית מזוהה בשמה. מחזיר רמזים בלבד.
3. fetch({result_id | url, expected_identity, find}) — הבאת גוף המסמך בפועל וקריאתו. רק fetch מייצר ראיה. אפשר להעביר find: מונחים לחיפוש בתוך המסמך, ותקבל חלונות טקסט מדויקים סביבם.
   לקריאה ממוקדת בסעיף מסוים בתוך מסמך ארוך שכבר נקרא: fetch({source_id, want:"relevant_section", locator:"25"}). המערכת תאתר את הסעיף בכל אורך הגוף השמור, ולא רק בתחילתו. אם הסעיף אינו קיים באותו מקור תקבל על כך הודעה מפורשת ואת טווח הסעיפים שהמקור כן מכסה.

כללי עבודה:
- חקור באופן איטרטיבי: חפש, הבא מסמכים, קרא אותם, ועקוב אחרי הפניות שהתגלו תוך כדי קריאה.
- אל תסתמך על תקצירי חיפוש. כל טענה חייבת להישען על טקסט שהובא בפועל ב-fetch.
- ציטוט (quoted_span) חייב להיות העתקה מילה במילה מגוף המסמך שהוחזר לך. אל תשכתב, אל תתקן, אל תתרגם, אל תקצר באמצע. אורך מומלץ 20–300 תווים.
- אם המסמך שהובא אינו המסמך שביקשת (למשל התיק לא מופיע בגוף), אל תשתמש בו.
- הבחן בין מה שנקבע בפסיקה או בחקיקה לבין הערכה או מחלוקת. אי-ודאות נרשמת ב-unresolved_questions.
- טענה שאמיתותה תלויה במצב הדין הנוכחי (כיום/טרם נחקק/אין הסדר/הנוסח או העונש שבתוקף) חייבת להיות מסומנת current_state_claim=true, ולהישען על נוסח חקיקה עדכני או מקור חקיקתי רשמי עדכני. מקור ישן יכול לבסס טענה היסטורית ("בשנת ... צוין כי..."), אך לא את מצב הדין היום.
- עצור כשהסוגיות המרכזיות מבוססות בראיות, או כשברור שהמשך חיפוש לא ישפר. אין יעד כמותי של מקורות.
- עומק המחקר נגזר מהתוצר שהמשתמש ביקש, לא ממספר מקורות קבוע. בשאלה צרה על פסק דין, חוק, סעיף או אסמכתה מסוימת — מספר קטן של מקורות חזקים עשוי להספיק. בבקשה לסינתזה דוקטרינרית רחבה, ניתוח השוואתי, סקירת ספרות, פרק אקדמי, פרק מבוא, חקירת שאלת מחקר או משימת מחקר פתוחה אחרת — אל תפסיק רק משום שכמה טענות כבר ניתנות לאימות. לפני שאתה מגיש, שקול אם בסיס הראיות מתאים לתוצר שהתבקש: האם מיוצגים הממדים המרכזיים של הסוגיה, הדין הראשוני הרלוונטי במקום שבו הוא נדרש, ספרות אקדמית משמעותית ועמדות מתחרות מהותיות. המשך לחקור כאשר החומר הקיים היה מספיק רק לתשובה קצרה בעוד שהמשתמש ביקש תוצר אקדמי או אנליטי מפותח.
- התאם את עומק התזכיר לתוצר: אם התבקש פרק, מבוא, סקירת ספרות, ניתוח השוואתי או סינתזה מפורטת — הכן תזכיר מחקר עשיר דיו כדי לתמוך בתשובה מפותחת, ולא בתשובת שאלה-תשובה קצרה.
- scope: "academic" זמין לך לאיתור ספרות מחקרית. השתמש בו כשהוא מועיל למשימה — במיוחד בבקשות ספרותיות/אקדמיות — אך אין חובה להשתמש בכל scope בכל משימה.
- כל quoted_span חייב להיות העתקה מדויקת, תו אחר תו, של רצף מתוך exact_source_text שהוחזר לך ב-fetch או מתוך "קטעים מילוליים שכבר הוגשו לך" במצב המחקר. אם אין בידך טקסט מילולי לטענה — בקש קריאה ממוקדת נוספת או ותר על הטענה. אל תשחזר ניסוח מהזיכרון, אל תתרגם ואל תקצר בתוך הציטוט.
- הודעה שסעיף אינו נמצא במקור, שנתיב הבאה נכשל, או ש-search_path_exhausted/same_issue_no_yield עלו — היא המלצה ולא איסור: היא מסמנת שאותה שאלה על אותו מקור כבר לא הניבה. בדרך כלל עדיף לעבור למקור אחר, לסוגיה אחרת או לנתיב השגה אחר; ההחלטה בידך.
- בשאלה על חוק או על תיקון לחוק: זהה את התיקון, השג את נוסח התיקון שנחקק ו/או את הנוסח המשולב העדכני, אתר את ההוראה הרלוונטית בתוכו, ורק אז בסס טענות. אם הנוסח העדכני אינו ניתן להשגה — אמור זאת ואל תשלים מהזיכרון.
- אינך רשאי לסמן ראיה כמאומתת. האימות נעשה מחוץ לך.

בסיום קרא ל-submit_research_memo עם המבנה המלא. כל source_id חייב להיות מזהה שהוחזר לך מ-fetch מוצלח.`;

export function buildAgentUserMessage(intake: Intake): string {
  const parts: string[] = [`שאלת המשתמש:\n${intake.question}`];

  // Academic Writing only: bounded framing of the paper this chapter belongs
  // to. Explicitly not evidence — the verifier is unchanged by it.
  if (intake.academic_context) {
    parts.push(buildProjectContextBlock(intake.academic_context));
  }


  parts.push(
    intake.deliverable === "developed"
      ? "אופי התוצר שהתבקש: תוצר מחקרי מפותח (פרק/מבוא/סקירת ספרות/ניתוח השוואתי/סינתזה). בסיס הראיות צריך להתאים לעומק הזה: ממדים מרכזיים של הסוגיה, ספרות רלוונטית ועמדות מתחרות. אל תסתפק בסבב גילוי וקריאה יחיד כאשר ברור שהחומר שנקרא יספיק רק לתשובה קצרה."
      : "אופי התוצר שהתבקש: תשובה ממוקדת לשאלה משפטית מוגדרת. מספר קטן של מקורות חזקים ורלוונטיים עשוי להספיק; אל תרחיב מחקר מעבר לנדרש.",
  );

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
            current_state_claim: {
              type: "boolean",
              description:
                "true אם אמיתות הטענה תלויה במצב הדין הנוכחי (למשל 'כיום אין עבירה', 'ההסדר החל היום', 'טרם נחקק', עונש/נוסח סעיף בתוקף). טענה היסטורית או תיאור הלכה שנקבעה בעבר אינה כזו.",
            },

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
