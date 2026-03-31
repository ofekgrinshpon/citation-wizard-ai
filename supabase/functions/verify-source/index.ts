import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `אתה מערכת אימות מקורות משפטיים ישראליים. תפקידך לבדוק אם מקור משפטי (פסק דין או חוק) שהוזן על ידי משתמש הוא מדויק ותקין.

עבור כל מקור, עליך לבצע בדיקה לוגית:

**פסיקה (Case Law):**
- בדוק שמספר התיק תואם את סוג ההליך (למשל בג"ץ = תיק בג"ץ, ע"א = ערעור אזרחי)
- בדוק שהשנה בתיק הגיונית (לא עתידית, לא לפני הקמת המדינה ב-1948 עבור בג"ץ)
- בדוק שהצדדים הגיוניים (לא חסרים, לא זהים)
- בדוק שבית המשפט תואם את סוג ההליך (בג"ץ = בית משפט עליון)
- בדוק עקביות פנימית של האזכור (שנה, כרך, עמודים)

**חקיקה (Legislation):**
- בדוק ששם החוק תקני ומוכר (למשל "חוק-יסוד: כבוד האדם וחירותו" ולא "חוק כבוד")
- בדוק שהשנה תואמת (חוק לא יכול להיות מ-1940 אם הוא חוק ישראלי)
- בדוק שסימון ס"ח/ק"ת תואם את סוג החקיקה (ס"ח = חקיקה ראשית, ק"ת = חקיקת משנה)
- בדוק שמספר העמוד הגיוני (לא 0, לא שלילי)

**ספרות (Literature):**
- בדוק שיש שם מחבר, שם יצירה, ושנה
- בדוק עקביות בסיסית

החזר תשובה בפורמט JSON בלבד:
{
  "status": "verified" | "invalid",
  "confidence": 0.0-1.0,
  "issues": ["תיאור בעיה 1", "תיאור בעיה 2"],
  "details": "הסבר קצר על הבדיקה שבוצעה"
}

אם אין בעיות, החזר status=verified עם confidence גבוה ו-issues ריק.
אם יש בעיות, החזר status=invalid עם תיאור הבעיות.

*** לעולם אל תחזיר status=verified אם יש חוסר עקביות ברור ***`;

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

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
