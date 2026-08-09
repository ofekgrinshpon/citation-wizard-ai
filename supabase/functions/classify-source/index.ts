// Gemini-backed source-type classifier.
// Returns one of the SourceType enum values from src/data/abbreviations.ts
// with a confidence (0..1) and a one-line reason in Hebrew.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ALLOWED_TYPES = [
  "case_law_published",
  "case_law_database",
  "primary_legislation",
  "basic_law",
  "secondary_legislation",
  "bill",
  "book",
  "article",
  "article_in_book",
  "internet",
  "internet_comment",
  "religious",
  "treaty",
  "regulation",
  "government_decision",
  "expert_opinion",
  "planning_plan",
  "collective_agreement",
  "court_pleading",
  "encyclopedia_entry",
  "academic_work",
  "correspondence",
  "interview",
  "lecture",
  "press_release",
  "film",
  "tv_show",
  "radio",
  "foreign",
  "other",
  "unknown",
] as const;

const SYSTEM_PROMPT = `אתה מסווג מקורות משפטיים ישראליים לפי כללי האזכור האחיד.
קלט: שאילתת חיפוש חופשית של משתמש (לעיתים שם מקור בלבד, ללא ציטוט מלא).
פלט: JSON בלבד בפורמט:
{"sourceType":"<one of allowed>","confidence":0.0-1.0,"reason":"משפט קצר בעברית"}

הסוגים האפשריים (החזר בדיוק אחד מהם):
- case_law_published: פסיקה שפורסמה (פ"ד, פד"ע, פ"מ)
- case_law_database: פסיקה ממאגר (נבו, תקדין וכד')
- primary_legislation: חוק / פקודה
- basic_law: חוק יסוד
- secondary_legislation: תקנות / צווים
- bill: הצעת חוק
- book: ספר אקדמי/משפטי
- article: מאמר בכתב עת (למשל "משפטים", "עיוני משפט", "הפרקליט")
- article_in_book: מאמר שפורסם בתוך ספר/אסופה
- internet: מקור אינטרנט (אתר/פוסט/יוטיוב)
- internet_comment: תגובה במרשתת
- religious: מקור דתי (תלמוד, משנה, שו"ת וכו')
- treaty: אמנה בינלאומית
- regulation: תקנון
- government_decision: החלטת ממשלה/רשות
- expert_opinion: חוות דעת
- planning_plan: תכנית תכנון ובנייה
- collective_agreement: הסכם קיבוצי
- court_pleading: כתב טענות
- encyclopedia_entry: ערך באנציקלופדיה/מילון
- academic_work: עבודת גמר/דוקטורט/תזה
- correspondence / interview / lecture / press_release / film / tv_show / radio
- foreign: מקור לועזי לפי Bluebook
- other: דברי כנסת וכו'
- unknown: אם באמת אי אפשר להחליט

חשוב:
- שילוב של שם מחבר ישראלי + כותרת קצרה בלי שם כתב עת או "ספר" — לרוב מאמר, לא ספר.
- אם יש "משפטים", "עיוני משפט", "הפרקליט", "משפט וממשל", "דין ודברים", "מחקרי משפט", "תיאוריה וביקורת" וכד' → article.
- אם יש "בתוך" או "ספר X לכבוד" → article_in_book.
- אם יש "ספר" כמילה עצמאית או "מהדורה" → book.
- אם יש מספר תיק (כמו 1234/56) או ערכאה (ע"א, בג"ץ וכד') → caselaw.
- הבחנה קריטית — שם מחבר + כותרת שמזכירה חוק ≠ חקיקה:
  * "אורי אהרונסון חוק הלאום בראי חוקי היסוד האחרים" → מאמר/מאמר בספר (מלגה אקדמית), לא חוק יסוד.
  * "דניאל פרידמן נער לפי שנות החקיקה הישראלית החדשה" → ספר/מאמר, לא חקיקה.
  * הכלל: אם הקלט נפתח בשם אדם (2–3 מילים) ואחריו כותרת תיאורית, זהו מקור אקדמי גם אם מופיעה בו המילה "חוק".
- לעומת זאת, קלט שהוא עצמו שם החוק → חקיקה, גם בלי שנה עברית ובלי ניסוח רשמי:
  * "חוק הלאום", "חוק יסוד הלאום", "חוק-יסוד: ישראל — מדינת הלאום של העם היהודי", "חוק יסוד כבוד האדם וחירותו" → basic_law.
  * "חוק החוזים", "חוק החוזים (חלק כללי)", "פקודת הנזיקין" → primary_legislation.
  * "תקנות סדר הדין האזרחי" → secondary_legislation.
- אם יש "חוק", "פקודת", "תקנות", "הצעת חוק", "חוק-יסוד" בתחילת הקלט → סוג החקיקה המתאים.
- אם באמת לא בטוח, בחר unknown עם confidence נמוך.`;


interface ClassifyResult {
  sourceType: string;
  confidence: number;
  reason: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawText: string = (body?.rawText || "").toString().trim();
    if (!rawText) {
      return new Response(
        JSON.stringify({ error: "rawText is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `סווג את המקור הבא:\n${rawText}` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[classify-source] gateway error", resp.status, text);
      // Fail soft so the frontend can fall back to regex classifier
      return new Response(
        JSON.stringify({ sourceType: "unknown", confidence: 0, reason: "gateway error" } satisfies ClassifyResult),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content || "";
    let parsed: ClassifyResult = { sourceType: "unknown", confidence: 0, reason: "" };
    try {
      const jm = content.match(/\{[\s\S]*\}/);
      if (jm) parsed = JSON.parse(jm[0]);
    } catch (e) {
      console.error("[classify-source] parse error", e, content.substring(0, 200));
    }

    if (!ALLOWED_TYPES.includes(parsed.sourceType as typeof ALLOWED_TYPES[number])) {
      parsed.sourceType = "unknown";
      parsed.confidence = 0;
    }
    parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    parsed.reason = (parsed.reason || "").toString().slice(0, 200);

    console.log(`[classify-source] "${rawText.slice(0, 80)}" → ${parsed.sourceType} (${parsed.confidence})`);

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[classify-source] error", e);
    return new Response(
      JSON.stringify({ sourceType: "unknown", confidence: 0, reason: "error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
