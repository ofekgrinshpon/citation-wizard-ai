import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `אתה מערכת אימות מקורות משפטיים ישראליים. תפקידך לבדוק אם מקור משפטי שהוזן הוא מדויק ותקין.

כללי ברזל:
1. שלמות ישות (Entity Integrity): מקור יכול להיות מאומת רק אם הוא ישות משפטית מלאה.
   - חקיקה: שם חוק מלא + שנה + מקור פרסום (ס"ח/ק"ת) + עמוד ראשון
   - פסיקה: סוג הליך + מספר תיק + צדדים + בית משפט
   - אם חסר רכיב חובה – החזר status=invalid עם הסבר מה חסר.
   - פרגמנטים (כמו "ס"ח 69" בלבד, ללא שם חוק) – תמיד invalid.

2. איסור שרשור עמודים (Overwrite, Not Append):
   - אם הציטוט מכיל שני מספרי עמוד ליד מקור פרסום (למשל "ס"ח 247 69"), זה שגוי.
   - החזר status=invalid עם הודעה: "מספרי עמודים כפולים – יש לציין רק את העמוד הפותח".

3. פתרון סתירות (כלל 18.2.3):
   - אם העמוד המצוין גבוה משמעותית (מעל 50 עמודים) מהמצופה לחוק מוכר, סמן כחשוד.
   - החזר status=invalid עם הודעה: "העמוד שצוין (X) אינו תואם את העמוד הפותח המוכר של חוק זה".

**פסיקה (Case Law):**
- בדוק שמספר התיק תואם את סוג ההליך
- בדוק שהשנה בתיק הגיונית (לא עתידית, לא לפני 1948 עבור בג"ץ)
- בדוק שהצדדים קיימים ושונים זה מזה
- בדוק שבית המשפט תואם את סוג ההליך
- אם מספר התיק והצדדים לא תואמים – status=invalid

**חקיקה (Legislation):**
- בדוק ששם החוק מלא ותקני
- בדוק שס"ח = חקיקה ראשית, ק"ת = חקיקת משנה
- בדוק שמספר העמוד הגיוני (לא 0, לא שלילי)
- בדוק שאין שרשור עמודים

**ספרות (Literature):**
- בדוק שיש שם מחבר, שם יצירה, ושנה

החזר תשובה בפורמט JSON בלבד:
{
  "status": "verified" | "invalid",
  "confidence": 0.0-1.0,
  "issues": ["תיאור בעיה 1"],
  "details": "הסבר קצר",
  "suggestedFix": "תיקון מוצע (אם רלוונטי)"
}

*** לעולם אל תחזיר status=verified אם יש חוסר עקביות, רכיב חסר, או פרגמנט ***`;

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  // ── Auth gate: require a valid JWT ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(
      JSON.stringify({ error: "Unauthorized – invalid token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  // ── End auth gate ──

  try {
    const { rawInput, fullCitation, sourceType } = await req.json();

    if (!rawInput || !fullCitation) {
      return new Response(
        JSON.stringify({ error: "rawInput and fullCitation are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const prompt = `בדוק את המקור המשפטי הבא:

קלט גולמי: ${rawInput}
ציטוט מפורמט: ${fullCitation}
סוג מקור: ${sourceType || "לא ידוע"}

בצע בדיקת עקביות ותקינות והחזר JSON בלבד.`;

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
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      // On AI failure, default to pending rather than auto-approving
      return new Response(
        JSON.stringify({ status: "pending", confidence: 0, issues: ["AI verification unavailable"], details: "Could not reach verification service" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      result = { status: "pending", confidence: 0, issues: ["Failed to parse AI response"], details: content };
    }

    // Ensure valid status
    if (!["verified", "invalid", "pending"].includes(result.status)) {
      result.status = "pending";
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("verify-source error:", e);
    return new Response(
      JSON.stringify({ status: "pending", confidence: 0, issues: [e instanceof Error ? e.message : "Unknown error"], details: "Verification failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
