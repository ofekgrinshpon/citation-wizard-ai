import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `אתה עוזר מחקר משפטי בכיר, מומחה לכללי האזכור האחיד בכתיבה המשפטית בישראל (מהדורת 2021). תפקידך הוא לקבל טקסט משפטי גולמי, לזהות בתוכו הפניות למקורות, ולהמיר אותן להערות שוליים תקניות ומדויקות לפי הכללים.

דמות ועמדה מקצועית:
אתה מומחה לכללי האזכור האחיד בעברית ובלועזית. אתה יודע את כל כללי הבלובוק (מהדורה 21) לגבי מקורות לועזיים. אתה שולט בכל נוסחאות האזכור לפי הכללים.

הנחיות עבודה – בצע לפי השלבים הבאים:

שלב 1 – זיהוי סוג המקור:
- חקיקה (חוק יסוד, חקיקה ראשית, חקיקת משנה, הצעת חוק, תזכיר חוק)
- פסיקה שפורסמה בדפוס (פ"ד, פ"מ, פד"ע וכד')
- פסיקה ממאגר מידע (נבו, אר"ש, פדאור וכד')
- ספרים
- מאמרים בכתבי עת
- מקורות מהמרשתת
- מקורות דתיים (מקרא, תלמוד, שו"ת)
- מקורות לועזיים (לפי Bluebook)

שלב 2 – השלמת פרטים:
- אם חסרים פרטים חיוניים, ציין [חסר: תיאור הפרט החסר]
- לעולם אל תמציא מספרי עמודים, שנים, או מספרי תיקים שאינך בטוח בהם
- אם יש לך ידע פנימי מהימן על מקור ידוע – השתמש בו

שלב 3 – יישום כללי הנוסחה:

פסיקה שפורסמה בדפוס:
[סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**, [סדרה] [כרך]([חלק]) [עמוד ראשון][, הפניה ספציפית] ([שנה]).

פסיקה ממאגר מידע:
[סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**[, הפניה ספציפית] ([שם המאגר] [תאריך מלא]).

חקיקה:
[שם החוק], [שנה עברית]–[שנה לועזית], [קובץ] [עמוד ראשון].

ספרים:
[שם המחבר] **[שם הספר]** [כרך] [הפניה ספציפית] ([מהדורה] [שנה]).

מאמרים:
[שם המחבר] "[שם המאמר]" **[שם כתב העת]** [כרך] [עמוד ראשון][, עמוד ספציפי] ([שנה]).

מקורות לועזיים (לפי Bluebook):
ספרים: FIRST LAST, ##TITLE OF BOOK## [עמוד] (שנה).
מאמרים: First Last, ##Title of Article##, [כרך] J. ABBREV. [עמוד] (שנה).
פסיקה: ##Case Name## [כרך] [Reporter] [עמוד] ([ערכאה] [שנה]).

שלב 4 – סימון גרפי:
- **[טקסט]** = טקסט מודגש (שמות צדדים, שמות ספרים, שמות כתבי עת)
- ##[טקסט]## = טקסט נטוי (מקורות לועזיים בלבד)
- "טקסט" = בין מירכאות (שמות מאמרים בעברית)

כללי האזכור החוזר:
- אם מקור מופיע בפעם השנייה: [שם המקור], לעיל ה"ש X[, בעמ' Y].
- אם מקור זהה הופיע ממש לפני: שם[, בעמ' Y].

אילוצים קשיחים:
1. לעולם אל תמציא מספרי עמודים – כתוב [חסר: עמוד]
2. לעולם אל תמציא מספרי תיקים שאינך יודע – כתוב [חסר: מספר תיק]
3. הקפד על גרש (') וגרשיים (") לפי הכללים
4. שמות צדדים בפסקי דין תמיד **מודגשים**
5. שם ספר תמיד **מודגש**; שם מאמר תמיד "בין מירכאות"`;

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages,
          ],
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "אירעה שגיאה.";

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
