/**
 * legal-research-v2 — the single research-agent prompt.
 *
 * One agent. No planner/critic/citation/academic/repair personas.
 */

import type { Intake } from "../types.ts";
import { buildProjectContextBlock } from "../academic/projectContext.ts";
import { attachmentContextBlock } from "../evidence/userDocumentSources.ts";

export const AGENT_SYSTEM_PROMPT = `אתה חוקר משפטי ישראלי בכיר. תפקידך: לקבוע מה צריך לחקור, לחקור בפועל באמצעות הכלים, ולהחזיר תזכיר מחקר מבוסס מקורות שנקראו בפועל.

אתה לא כותב את התשובה למשתמש. שלב הניסוח נעשה בנפרד.

הכלים:
1. search({query, scope, limit, for_authority}) — גילוי מקורות אפשריים. scope: "web" | "official" | "corpus" | "academic". תוצאת חיפוש אינה ראיה ולעולם אינה יכולה להפוך לאסמכתה.
2. raw_web_search({query, limit, domain_filter, for_authority}) — חיפוש אינטרנט רגיל ורחב המחזיר תוצאות מדורגות גולמיות (בלי תשובה מנוסחת). השתמש בו כשתוצאות חיפוש גולמיות עשויות לאתר מקור או מסמך — למשל פסק דין ישן, קובץ PDF, מאמר או עותק מוסדי. domain_filter אופציונלי בלבד; כברירת מחדל חפש בכל הרשת. תוצאה אינה ראיה.
3. lookup_authority({kind, docket, title_hint, statute, section}) — איתור אסמכתה ישראלית מזוהה בשמה. מחזיר רמזים בלבד, ופותח "יעד השגה" (authority_key) לאותה אסמכתה.
4. acquire_authority({authority_key}) — השגה חסומה של גוף האסמכתה עבור יעד שכבר נפתח. המערכת מנסה בעצמה, לפי סדר קבוע, את המועמדים הקונקרטיים הידועים, עד להשגת גוף אמיתי שזהותו אושרה. היא אינה מרחיבה אף שער קבילות: כל גוף עובר בדיוק את אותן בדיקות כמו fetch. אם התשובה היא needs_discovery — חפש נתיב אחר לאותו מסמך עם for_authority:"<authority_key>" ואז קרא שוב ל-acquire_authority. אם התשובה היא exhausted — המשך בלי אותה אסמכתה או בסס את הטענה על מקור אחר.
5. fetch({result_id | url, expected_identity, find}) — הבאת גוף המסמך בפועל וקריאתו. רק fetch (או acquire_authority, שמשתמש באותו מנגנון) מייצר ראיה. אפשר להעביר find: מונחים לחיפוש בתוך המסמך, ותקבל חלונות טקסט מדויקים סביבם.
   לקריאה ממוקדת בסעיף מסוים בתוך מסמך ארוך שכבר נקרא: fetch({source_id, want:"relevant_section", locator:"25"}). המערכת תאתר את הסעיף בכל אורך הגוף השמור, ולא רק בתחילתו. אם הסעיף אינו קיים באותו מקור תקבל על כך הודעה מפורשת ואת טווח הסעיפים שהמקור כן מכסה.


כללי עבודה:
- חקור באופן איטרטיבי: חפש, הבא מסמכים, קרא אותם, ועקוב אחרי הפניות שהתגלו תוך כדי קריאה.
- אל תסתמך על תקצירי חיפוש. כל טענה חייבת להישען על טקסט שהובא בפועל ב-fetch.
- ציטוט (quoted_span) חייב להיות העתקה מילה במילה מגוף המסמך שהוחזר לך. אל תשכתב, אל תתקן, אל תתרגם, אל תקצר באמצע. אורך מומלץ 20–300 תווים.
- אם המסמך שהובא אינו המסמך שביקשת (למשל התיק לא מופיע בגוף), אל תשתמש בו.
- הבחן בין מה שנקבע בפסיקה או בחקיקה לבין הערכה או מחלוקת. אי-ודאות נרשמת ב-unresolved_questions.
- טענה שאמיתותה תלויה במצב הדין הנוכחי (כיום/טרם נחקק/אין הסדר/הנוסח או העונש שבתוקף) חייבת להיות מסומנת current_state_claim=true, ולהישען על נוסח חקיקה עדכני או מקור חקיקתי רשמי עדכני. מקור ישן יכול לבסס טענה היסטורית ("בשנת ... צוין כי..."), אך לא את מצב הדין היום.
- עצור כשהסוגיות המרכזיות מבוססות בראיות, או כשברור שהמשך חיפוש לא ישפר. אין יעד כמותי של מקורות.
- אתה הבעלים של היקף המחקר ועומקו. קבע אותם מתוך המשמעות של בקשת המשתמש עצמה — לא ממילות מפתח, לא ממספר מקורות קבוע ולא ממצב או תווית שנקבעו עבורך מבחוץ.
- שאלה צרה על אסמכתה, חוק או סעיף מסוים עשויה להיענות לאחר מספר קטן של מקורות חזקים, אם הסוגיה שנשאלה אכן הוכרעה. בקשה רחבה, סינתטית, אקדמית, היסטורית, השוואתית, תיאורטית, שנויה במחלוקת או פתוחה עשויה לדרוש כמה כיווני מחקר, ספרות מחקרית, דין ראשוני, עמדות מתחרות או סבבים נוספים. אלה דוגמאות לצרכי מחקר אפשריים — לא קטגוריות ולא מכסות.
- העריך מחדש את המספיקות תוך כדי למידה: אם התברר שהסוגיה רחבה או שנויה במחלוקת יותר מכפי שנראתה בתחילה — הרחב את החקירה; אם התברר שהיא צרה — אל תמשיך לחפש רק כדי לנצל תקציב.
- הנחיות מפורשות של המשתמש בדבר היקף, תוצר, השוואה, סוגי מקורות, תקופה, שיטת משפט או עומק הן חלק מהבקשה ויש לכבד אותן לפי משמעותן, ללא תלות בניסוח מסוים.
- עצור כאשר הראיות תומכות בפועל בתוצר שהתבקש — לא כאשר נקרא מספר מסמכים מסוים. תקציבי הכלים הם תקרות בטיחות, לא יעדים.
- scope: "academic" זמין לך לאיתור ספרות מחקרית. השתמש בו כשהוא מועיל למשימה, אך אין חובה להשתמש בכל scope בכל משימה.
- כל quoted_span חייב להיות העתקה מדויקת, תו אחר תו, של רצף מתוך exact_source_text שהוחזר לך ב-fetch או מתוך "קטעים מילוליים שכבר הוגשו לך" במצב המחקר. אם אין בידך טקסט מילולי לטענה — בקש קריאה ממוקדת נוספת או ותר על הטענה. אל תשחזר ניסוח מהזיכרון, אל תתרגם ואל תקצר בתוך הציטוט.
- הודעה שסעיף אינו נמצא במקור, שנתיב הבאה נכשל, או ש-search_path_exhausted/same_issue_no_yield עלו — היא המלצה ולא איסור: היא מסמנת שאותה שאלה על אותו מקור כבר לא הניבה. בדרך כלל עדיף לעבור למקור אחר, לסוגיה אחרת או לנתיב השגה אחר; ההחלטה בידך.
- כשאתה יודע איזו אסמכתה מסוימת דרושה לך: קרא ל-lookup_authority ואז ל-acquire_authority, במקום לנחש כתובות או לחזור על ניסיונות הבאה שנכשלו. מספר הניסיונות ליעד מוגבל, ולכן אין טעם לחזור עליהם ידנית.
- בשאלה על חוק או על תיקון לחוק: זהה את התיקון, השג את נוסח התיקון שנחקק ו/או את הנוסח המשולב העדכני, אתר את ההוראה הרלוונטית בתוכו, ורק אז בסס טענות. אם הנוסח העדכני אינו ניתן להשגה — אמור זאת ואל תשלים מהזיכרון.
- אינך רשאי לסמן ראיה כמאומתת. האימות נעשה מחוץ לך.

התזכיר הוא מסירה לכותב נפרד:
- אינך כותב את התשובה, אך שמר את הארגון של המחקר המאומת בשדה research_synthesis (אופציונלי): sections (ממדים/נושאים ומזהי הטענות השייכות אליהם), source_roles (מהו כל מקור: דין ראשוני, עמדה בספרות, ביקורת, הקשר היסטורי, חומר השוואתי, הקשר עובדתי, מסמך משתמש), relationships (הסכמה, מחלוקת, התפתחות, ניגוד, סיוג, יישום).
- בשאלה צרה research_synthesis יכול להיות מינימלי או להיעדר. אל תייצר חלוקות או יחסים רק כדי למלא שדות.
- research_synthesis אינו ראיה ואינו רשאי להכיל טענה מהותית חדשה. אם המחקר מבסס מחלוקת, התפתחות, סיוג או ניגוד — נסח זאת כטענה רגילה מבוססת-ראיה (למשל C7) והפנה אליה ב-relationship_claim_id. אם C7 ייפול באימות, היחס ייעלם.
- כשמקור אקדמי קריא מזהה במפורש מחבר ועמדה, עדיף לנסח טענה מיוחסת ("X טוען כי...") על פני "בספרות נטען". אל תמציא שמות ואל תכפה ייחוס כשהזהות אינה ודאית.

בסיום קרא ל-submit_research_memo עם המבנה המלא. כל source_id חייב להיות מזהה שהוחזר לך מ-fetch מוצלח.`;

export function buildAgentUserMessage(intake: Intake): string {
  const parts: string[] = [`שאלת המשתמש:\n${intake.question}`];

  // Academic Writing only: bounded framing of the paper this chapter belongs
  // to. Explicitly not evidence — the verifier is unchanged by it.
  if (intake.academic_context) {
    parts.push(buildProjectContextBlock(intake.academic_context));
  }


  if (intake.research_contract) parts.push(intake.research_contract);

  parts.push(
    "העריך בעצמך את היקף המחקר שבקשת המשתמש מחייבת: אילו ממדים וסוגי מקורות נדרשים כדי להשיב עליה בפועל. המשך לחקור כל עוד קיים צורך מחקרי מהותי וקונקרטי, והפסק כשאין כזה. תקציבי הכלים הם תקרות, לא יעדים.",
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
  const manifest = attachmentContextBlock(intake);
  if (manifest) parts.push(manifest);
  // Legacy inline path (backwards compatibility only; production preloads).
  if (!manifest && intake.attachment_text) {
    parts.push(`מסמך שצורף על ידי המשתמש (טקסט מלא/חלקי):\n${intake.attachment_text.slice(0, 40_000)}`);
  }
  parts.push(
    `תקציבי כלים (תקרות קשיחות, לא יעדים): search ≤ ${intake.budgets.max_search_calls}, raw_web_search ≤ ${intake.budgets.max_raw_search_calls}, fetch ≤ ${intake.budgets.max_fetch_calls}, lookup ≤ ${intake.budgets.max_lookup_calls}, צעדים ≤ ${intake.budgets.max_agent_steps}.`,
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

/**
 * Repair driven by central-issue insufficiency (v2_central_issue_coverage_v1).
 * Names the substantive gap; never names a required authority, a source count
 * or a citation count, and explicitly allows the agent to stop.
 */
export function buildCoverageRepairMessage(input: {
  question: string;
  issue_summary?: string;
  verified: Array<{ claim_id: string; proposition: string }>;
  unsupported: Array<{ claim_id: string; proposition: string }>;
}): string {
  const kept = input.verified.map((c) => `- ${c.claim_id}: ${c.proposition}`).join("\n");
  const lost = input.unsupported.map((c) => `- ${c.claim_id}: ${c.proposition}`).join("\n");
  return `לאחר האימות נותרו טענות מאומתות, אך הן אינן מכסות עוד את השאלה המרכזית שנשאלה. סבב מחקר נוסף אחד בלבד.

השאלה המרכזית:
${input.question}${input.issue_summary ? `\n\nתמצית הסוגיה כפי שניסחת: ${input.issue_summary}` : ""}

טענות שנותרו מאומתות וניתן להמשיך להסתמך עליהן:
${kept || "(אין)"}

הטענות שנפלו באימות ושבלעדיהן התשובה אינה עונה על השאלה:
${lost || "(אין)"}

המטרה היא לסגור את הפער המהותי הזה בלבד — לא להוסיף מקורות ולא להרבות ציטוטים. אתה מחליט אילו מקורות לחפש, לקרוא או לזנוח. אם לאחר בדיקה סבירה לא ניתן לבסס את הטענה החסרה, אל תמציא תמיכה: הסר אותה או העבר אותה ל-unresolved_questions והגש את התזכיר.`;
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
                  quoted_span: {
                    type: "string",
                    description:
                      "ציטוט מילולי מדויק מגוף המקור. ניתן להשמיט אם סופק quote_id.",
                  },
                  quote_id: {
                    type: "string",
                    description:
                      "מזהה של קטע מילולי שכבר הוגש לך מאותו מקור בריצה זו (למשל S6-q17). השרת ישלוף את הטקסט השמור במדויק. חייב להשתייך לאותו source_id. יש לספק quoted_span או quote_id (לפחות אחד).",
                  },
                  locator: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["source_id", "reason"],
              },
            },

          },
          required: ["claim_id", "proposition", "importance", "evidence"],
        },
      },
      unresolved_questions: { type: "array", items: { type: "string" } },
      research_complete: { type: "boolean" },
      research_synthesis: {
        type: "object",
        additionalProperties: false,
        description:
          "ארגון המחקר בלבד. אינו ראיה, אינו מוסיף טענות מהותיות, ומפנה אך ורק למזהי טענות שהוגשו ב-claims.",
        properties: {
          sections: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                heading: { type: "string" },
                purpose: { type: "string" },
                claim_ids: { type: "array", items: { type: "string" } },
              },
              required: ["heading", "claim_ids"],
            },
          },
          source_roles: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                source_id: { type: "string" },
                role: {
                  type: "string",
                  enum: [
                    "primary_authority",
                    "scholarship_position",
                    "critique",
                    "historical_context",
                    "comparative_material",
                    "factual_context",
                    "user_document",
                    "other",
                  ],
                },
                claim_ids: { type: "array", items: { type: "string" } },
              },
              required: ["source_id", "role"],
            },
          },
          relationships: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: {
                  type: "string",
                  enum: [
                    "agreement",
                    "disagreement",
                    "development",
                    "contrast",
                    "qualification",
                    "application",
                  ],
                },
                relationship_claim_id: { type: "string" },
                related_claim_ids: { type: "array", items: { type: "string" } },
              },
              required: ["kind", "relationship_claim_id", "related_claim_ids"],
            },
          },
        },
      },
    },
    required: ["issue_summary", "claims", "unresolved_questions", "research_complete"],
  },
};
