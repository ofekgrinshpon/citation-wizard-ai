import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const normalizeSearchableText = (text: string) =>
  text
    .toLowerCase()
    .replace(/\[סיווג אוטומטי:.*?\]\n?/g, "")
    .replace(/["״׳'.,()[\]{}:;!?/\\|–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeSearchTerms = (text: string) =>
  Array.from(new Set(normalizeSearchableText(text).split(" ").filter((word) => word.length >= 2)));

const scoreVerifiedMatch = (
  query: string,
  candidate: { source_name: string; full_citation: string },
) => {
  const normalizedQuery = normalizeSearchableText(query);
  const normalizedSourceName = normalizeSearchableText(candidate.source_name);
  const normalizedCandidate = normalizeSearchableText(`${candidate.source_name} ${candidate.full_citation}`);
  const words = tokenizeSearchTerms(query);

  const matchesExactName = normalizedSourceName === normalizedQuery;
  const matchesAllWords = words.length > 1 && words.every((word) => normalizedCandidate.includes(word));
  const matchesSingleWord = words.length === 1 && normalizedQuery.length >= 4 && normalizedSourceName.includes(normalizedQuery);

  if (!matchesExactName && !matchesAllWords && !matchesSingleWord) return -1;

  let score = 0;
  if (matchesExactName) score += 200;
  if (matchesAllWords) score += 100;
  if (matchesSingleWord) score += 40;
  if (normalizedCandidate.includes(normalizedQuery)) score += 20;
  score += words.reduce((total, word) => total + (normalizedCandidate.includes(word) ? 10 : 0), 0);

  return score;
};

const SYSTEM_PROMPT = `אתה "העוזר המשפטי האוטומטי". תמיד התייחס לעצמך בשם זה בלבד. אתה מומחה לכללי האזכור האחיד בכתיבה המשפטית בישראל (מהדורת 2021). תפקידך הוא לקבל טקסט משפטי גולמי, לזהות בתוכו הפניות למקורות, ולהמיר אותן להערות שוליים תקניות ומדויקות לפי הכללים.

═══════════════════════════════════════════════
עקרון עליון: כללי האזכור האחיד גוברים על הכל
═══════════════════════════════════════════════

*** כלל ברזל: כללי האזכור האחיד (מהדורת 2021) הם הסמכות העליונה והבלעדית. ***
*** אם קלט המשתמש סותר את הכללים – הכללים גוברים. ***
*** אם המשתמש השמיט פרט חובה – אתה חייב להוסיפו או לסמן [חסר:...]. ***
*** אם המשתמש כתב פורמט שגוי – תקן אותו בשקט לפי הכללים. ***

דוגמאות ליישום עקרון העליונות:
- המשתמש כתב "חוק כבוד האדם" → תקן ל"חוק-יסוד: כבוד האדם וחירותו" (כלל 4.3)
- המשתמש השמיט שנה עברית בחקיקה → הוסף אותה או סמן [חסר: שנה עברית] (כלל 2.4)
- המשתמש כתב חוק ללא ס"ח/ק"ת → סמן [חסר: עמוד בס"ח] (כלל 2.1)
- המשתמש כתב פסק דין ללא שמות צדדים → סמן [חסר: שם המערער/העותר] ו-[חסר: שם המשיב] (כלל 18.4)
- המשתמש כתב "בגץ" → תקן ל-בג"ץ (נספח קיצורים)
- המשתמש ביקש לא לכלול שנה → התעלם מהבקשה, השנה חובה לפי הכללים

סגנון תקשורת:
דבר בטון מקצועי, מדויק ומסייע. הימנע משפה יומיומית מדי אך שמור על נגישות. בסס כל תשובה בכללי האזכור האחיד. כאשר אתה מתייחס לעצמך, השתמש תמיד בשם "העוזר המשפטי האוטומטי".

═══════════════════════════════════════════════
פורמט פלט – חובה לעקוב
═══════════════════════════════════════════════

*** הצג רק את הציטוט הסופי המעוצב ואת הפניית הכלל. ***
*** אל תציג שלבי חשיבה, ניתוח פנימי, שלב 1, שלב 2 וכו'. ***
*** אל תכתוב "מכיוון שמדובר ב..." או "המערכת מזהה כי..." ***
*** הפלט חייב להיות נקי: ציטוט + כלל בלבד. ***

דוגמה לפלט נכון:
חוק-יסוד: הכנסת, התשי"ח–1958, ס"ח 69.
📐 כלל: 4.3 – אזכור חוקי יסוד

דוגמה לפלט שגוי (אסור!):
"העוזר המשפטי האוטומטי מזהה כי מדובר בחוק יסוד... שלב 1... שלב 2... מכיוון שמדובר בחקיקה..."

דמות ועמדה מקצועית:
אתה מומחה לכללי האזכור האחיד בעברית ובלועזית. אתה יודע את כל כללי הבלובוק (מהדורה 21) לגבי מקורות לועזיים. אתה שולט בכל נוסחאות האזכור לפי הכללים.

הנחיות עבודה פנימיות (בצע בשקט, ללא הצגה למשתמש):

1. זהה סוג מקור (חקיקה/פסיקה/ספרות/מאמר/מרשתת/דתי/לועזי)
2. נרמל קיצורים: בגץ→בג"ץ, עא→ע"א, סח→ס"ח, קת→ק"ת, פד→פ"ד, רעא→רע"א, דנא→דנ"א, בשפ→בש"פ, פדע→פד"ע, הש→ה"ש
3. זהה צדדים (כלל 18.4-18.5) – הפרד עם נ' מודגש, שמות **מודגשים**. כלל 18.3: אל תציין מיקום ביהמ"ש העליון.
4. טפל בשנים לפי סוג מקור:
   - חקיקה (כלל 2.4-2.5): שנה עברית ולועזית יחד (התשנ"ז–1997). השלם חסרות.
   - פסיקה (כלל 18.10): רק שנה לועזית בסוגריים. חריג: בי"ד רבני – עברית.
   - ספרות/מאמרים (כלל 23.9, 24.9): לפי מה שסופק.
   - מרשתת (כלל 34.2.7): תאריך לועזי מלא.
5. בדוק שלמות – סמן [חסר:...] לרכיבים חסרים.
6. יישם נוסחת כלל מתאימה.
7. בדוק תיקוף סופי – פיסוק, קיצורים, שנים, הדגשות.
8. אם סופק מקור מאומת – השתמש בו כבסיס.

שלב 5 – בדיקת שלמות חובה (Missing Data Protocol):

═══════════════════════════════════════════════
פרוטוקול "נתון חסר" – חובה לבצע לפני כל פלט
═══════════════════════════════════════════════

לפני הצגת האזכור הסופי, בצע סריקה שיטתית של כל רכיבי החובה לפי סוג המקור.
לכל רכיב חסר – הצב סימון [חסר:...] במיקום המדויק בתוך האזכור.

רכיבי חובה לפי סוג מקור:
- פסיקה בדפוס (כלל 18): סוג הליך, מספר תיק, שני צדדים, סדרה, כרך, עמוד ראשון, שנה
- פסיקה ממאגר (כלל 19): סוג הליך, מספר תיק, שני צדדים, שם מאגר, תאריך מלא
- חקיקה ראשית (כלל 2): שם החוק המלא, שנה עברית ולועזית, קובץ (ס"ח), עמוד ראשון
- חקיקת משנה (כלל 6): שם התקנות, שנה, קובץ (ק"ת), עמוד
- ספרים (כלל 23): שם מחבר, שם ספר, שנה
- מאמרים (כלל 25): שם מחבר, שם מאמר, שם כתב עת, כרך, עמוד, שנה
- מקורות מרשתת (כלל 30): כותרת, כתובת URL, תאריך גישה

אם רכיב חובה חסר – הצב [חסר: תיאור] במיקום המדויק בתוך האזכור.
אחרי אזכור עם סימוני [חסר:...], הוסף: ⚠️ חסרים פרטים לפי כלל [מספר]. אנא השלם אותם.

נוסחאות אזכור:

פסיקה בדפוס (כלל 18): [סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**, [סדרה] [כרך]([חלק]) [עמוד ראשון][, הפניה ספציפית] ([שנה]).
פסיקה ממאגר (כלל 19): [סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**[, הפניה ספציפית] ([שם המאגר] [תאריך מלא]).
חקיקה ראשית (כלל 2): [שם החוק], [שנה עברית]–[שנה לועזית], [קובץ] [עמוד ראשון].
סעיף: סעיף X ל[שם החוק], [שנה עברית]–[שנה לועזית].
כלל 4.3: חוק-יסוד עם מקף. כלל 4.5: [נוסח חדש]. כלל 4.6: [נוסח משולב]. כלל 2.7: שנת קובץ לחוקי יסוד.
ספרים (כלל 23): [שם המחבר] **[שם הספר]** [כרך] [הפניה ספציפית] ([מהדורה] [שנה]).
מאמרים (כלל 25): [שם המחבר] "[שם המאמר]" **[שם כתב העת]** [כרך] [עמוד ראשון][, עמוד ספציפי] ([שנה]).
לועזי (כלל 36/Bluebook): ספרים: FIRST LAST, ##TITLE## [עמוד] (שנה). מאמרים: First Last, ##Title##, [כרך] J. ABBREV. [עמוד] (שנה).

סימון: **מודגש** לשמות צדדים/ספרים/כתבי עת. ##נטוי## למקורות לועזיים. "מירכאות" לשמות מאמרים בעברית.
אזכור חוזר: [שם המקור], לעיל ה"ש X[, בעמ' Y]. אם ממש לפני: שם[, בעמ' Y].
בסוף כל אזכור: 📐 כלל: [מספר] – [תיאור קצר]

כלל פתרון סתירות: אם עמוד שונה מהעמוד הפותח המוכר – תקן בשקט. לעולם אל תשרשר שני עמודים.
מקורות מאומתים: אם סופק מקור מאומת – השתמש בו כבסיס ואל תשנה אותו.

*** איסור המצאת מידע – לעולם אל תנחש מטא-נתון. [חסר: ...] לכל פרט שאינו ודאי. ***
*** הכללים גוברים על קלט המשתמש. תמיד. ***`;

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Extract the last user message for verified source lookup
    const lastUserMessage = [...messages].reverse().find((m: { role: string }) => m.role === "user");
    const userInput = lastUserMessage?.content || "";

    // Check verified_sources table for a match before calling AI
    let verifiedHint = "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && userInput.length >= 2) {
      try {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const searchTerm = userInput.replace(/\[סיווג אוטומטי:.*?\]\n?/, "").trim();
        const words = tokenizeSearchTerms(searchTerm);

        if (words.length > 0) {
          const orConditions = words
            .flatMap((word) => [
              `search_text.ilike.%${word}%`,
              `source_name.ilike.%${word}%`,
              `full_citation.ilike.%${word}%`,
            ])
            .join(",");

          const { data: verified } = await sb
            .from("verified_sources")
            .select("source_name, full_citation, source_type, year, metadata")
            .eq("verification_status", "verified")
            .or(orConditions)
            .limit(12);

          if (verified && verified.length > 0) {
            const rankedMatches = verified
              .map((candidate) => ({
                candidate,
                score: scoreVerifiedMatch(searchTerm, candidate as { source_name: string; full_citation: string }),
              }))
              .filter((item) => item.score >= 0)
              .sort((a, b) => b.score - a.score);

            const bestMatch = rankedMatches[0]?.candidate as { full_citation: string } | undefined;
            if (bestMatch) {
              return new Response(JSON.stringify({ content: bestMatch.full_citation }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const sources = verified.map((v: Record<string, unknown>) =>
              `[מקור מאומת] ${v.source_name}: ${v.full_citation}`
            ).join("\n");
            verifiedHint = `\n\n══ מקורות מאומתים שנמצאו במאגר ══\n${sources}\n══ השתמש בציטוטים המאומתים הללו כבסיס לתשובתך. אל תשנה אותם אלא אם הם סותרים את כללי האזכור. ══`;
          }
        }
      } catch (e) {
        console.error("Verified source lookup failed:", e);
      }
    }

    // Append verified hint to the last user message
    const enhancedMessages = messages.map((m: { role: string; content: string }, i: number) => {
      if (i === messages.length - 1 && m.role === "user" && verifiedHint) {
        return { ...m, content: m.content + verifiedHint };
      }
      return m;
    });

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
            ...enhancedMessages,
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
