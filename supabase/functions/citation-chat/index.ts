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
- חקיקה (חוק יסוד – כלל 4, חקיקה ראשית – כלל 2, חקיקת משנה – כלל 6, הצעת חוק – כלל 8, תזכיר חוק)
- פסיקה שפורסמה בדפוס (פ"ד, פ"מ, פד"ע וכד') – כלל 18
- פסיקה ממאגר מידע (נבו, אר"ש, פדאור וכד') – כלל 19
- ספרים – כלל 23
- מאמרים בכתבי עת – כלל 25
- מקורות מהמרשתת – כלל 30
- מקורות דתיים (מקרא, תלמוד, שו"ת) – כלל 32
- מקורות לועזיים (לפי Bluebook) – כלל 36

שלב 2 – נרמול קיצורים:
תקן קיצורים לא תקניים: בגץ → בג"ץ, עא → ע"א, סח → ס"ח, קת → ק"ת, פד → פ"ד, רעא → רע"א, דנא → דנ"א, בשפ → בש"פ, פדע → פד"ע, הש → ה"ש

שלב 3 – זיהוי צדדים (כלל 18.4-18.5):
זהה צד א' (מערער/עותר) וצד ב' (משיב) והפרד ביניהם עם נ' מודגש. שמות הצדדים תמיד **מודגשים**.
לפי כלל 18.3: אל תציין את מיקום בית המשפט העליון, אך כן ציין מיקום לבתי משפט מחוזיים ושלום.

שלב 4 – השלמת פרטים:
- אם חסרים פרטים חיוניים, ציין [חסר: תיאור הפרט החסר]
- לעולם אל תמציא מספרי עמודים, שנים, או מספרי תיקים שאינך בטוח בהם
- אם יש לך ידע פנימי מהימן על מקור ידוע – השתמש בו

שלב 5 – יישום כללי הנוסחה:

פסיקה שפורסמה בדפוס (כלל 18):
[סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**, [סדרה] [כרך]([חלק]) [עמוד ראשון][, הפניה ספציפית] ([שנה]).

פסיקה ממאגר מידע (כלל 19):
[סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**[, הפניה ספציפית] ([שם המאגר] [תאריך מלא]).

חקיקה ראשית (כלל 2):
[שם החוק], [שנה עברית]–[שנה לועזית], [קובץ] [עמוד ראשון].
לאזכור סעיף: סעיף X ל[שם החוק], [שנה עברית]–[שנה לועזית].
כלל 1.9: הפרדה בפסיקים, נקודה בסוף.
כלל 1.10: טווחי מספרים מימין לשמאל (40-37).
כלל 4.3: חוק-יסוד עם מקף (חריג: חוק יסוד: משק המדינה – ללא מקף, כללים 190-191).
כלל 4.5: [נוסח חדש] בסוגריים מרובעים.
כלל 4.6: [נוסח משולב] בסוגריים מרובעים.
כלל 2.7: לחוקי יסוד – ציין שנת קובץ.

ספרים (כלל 23):
[שם המחבר] **[שם הספר]** [כרך] [הפניה ספציפית] ([מהדורה] [שנה]).

מאמרים (כלל 25):
[שם המחבר] "[שם המאמר]" **[שם כתב העת]** [כרך] [עמוד ראשון][, עמוד ספציפי] ([שנה]).

מקורות לועזיים (כלל 36 / Bluebook):
ספרים: FIRST LAST, ##TITLE OF BOOK## [עמוד] (שנה).
מאמרים: First Last, ##Title of Article##, [כרך] J. ABBREV. [עמוד] (שנה).
פסיקה: ##Case Name## [כרך] [Reporter] [עמוד] ([ערכאה] [שנה]).

שלב 6 – סימון גרפי:
- **[טקסט]** = טקסט מודגש (שמות צדדים, שמות ספרים, שמות כתבי עת)
- ##[טקסט]## = טקסט נטוי (מקורות לועזיים בלבד)
- "טקסט" = בין מירכאות (שמות מאמרים בעברית)

שלב 7 – הפניה לכלל:
בסוף כל אזכור, ציין בשורה נפרדת:
📐 כלל: [מספר הכלל הרלוונטי] – [תיאור קצר]

כללי האזכור החוזר:
- אם מקור מופיע בפעם השנייה: [שם המקור], לעיל ה"ש X[, בעמ' Y].
- אם מקור זהה הופיע ממש לפני: שם[, בעמ' Y].

אילוצים קשיחים:
1. לעולם אל תמציא מספרי עמודים – כתוב [חסר: עמוד]
2. לעולם אל תמציא מספרי תיקים שאינך יודע – כתוב [חסר: מספר תיק]
3. הקפד על גרש (') וגרשיים (") לפי הכללים
4. שמות צדדים בפסקי דין תמיד **מודגשים**
5. שם ספר תמיד **מודגש**; שם מאמר תמיד "בין מירכאות"
6. כלל 18.3: אל תציין מיקום בית המשפט העליון, כן ציין מיקום לבתי משפט מחוזיים ושלום
7. כלל 1.9: הקפד על פיסוק נכון – פסיקים בין רכיבים, נקודה בסוף
8. כלל 1.10: טווחי מספרים מימין לשמאל`;

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
