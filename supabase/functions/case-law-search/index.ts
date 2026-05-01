import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CaseLawResult {
  found: boolean;
  parties?: string;
  date?: string;
  court?: string;
  publication?: string;
  isPublished?: boolean;
  databaseName?: string;
  summary?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth gate
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { error: claimsError } = await authClient.auth.getClaims(token);
  if (claimsError) {
    return new Response(
      JSON.stringify({ error: "Unauthorized – invalid token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { caseNumber, caseType } = await req.json();
    if (!caseNumber || !caseType) {
      return new Response(
        JSON.stringify({ found: false, error: "Missing caseNumber or caseType" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) {
      console.error("PERPLEXITY_API_KEY is not configured");
      return new Response(
        JSON.stringify({ found: false, error: "Search service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const normalizedCaseNumber = caseNumber.replace('-', '/');
    const fullCaseRef = `${caseType} ${normalizedCaseNumber}`;
    const query = `מצא את פסק הדין הישראלי ${fullCaseRef}. ציין: 1) שמות הצדדים (שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים), 2) תאריך מתן פסק הדין (יום.חודש.שנה), 3) שם בית המשפט, 4) אם פורסם בפד"י - ציין כרך, חלק ועמוד ראשון, 5) אם לא פורסם בפד"י - ציין באיזה מאגר (נבו/תקדין/פסקדין). ענה בעברית בלבד.`;

    const perplexityResponse = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        search_domain_filter: [
          "lite.takdin.co.il",
          "takdin.co.il",
          "nevo.co.il",
          "supreme.court.gov.il",
          "court.gov.il",
          "psakdin.co.il",
        ],
        messages: [
          {
            role: "system",
            content: `אתה עוזר מחקר משפטי. כשמבקשים ממך למצוא פסק דין ישראלי, החזר את המידע בפורמט JSON מדויק בלבד, ללא טקסט נוסף.

מקור עיקרי — דף תוצאות החיפוש של תקדין לייט (ציבורי, חינמי): https://lite.takdin.co.il/search-results?txtSearch=<מספר התיק>
דף התוצאות עצמו כבר חושף בכל כרטיסיית תוצאה את כל הפרטים הדרושים — אין צורך להיכנס לדף התיק הפנימי או להוריד PDF:
- שמות הצדדים המלאים (בכותרת הכרטיסייה, אחרי המקף).
- הקידומת בסוגריים מציינת את בית המשפט (למשל "תל אביב", "ראשון לציון").
- מספר התיק המלא בפורמט DD-MM-YY (למשל 50358-09-16).
- התאריך המלא של פסק הדין מופיע בפינת הכרטיסייה בפורמט DD/MM/YYYY (למשל 19/10/2021) — שלוף אותו ישירות משם.

חובה: שלוף את התאריך המלא ישירות מכרטיסיית תוצאת החיפוש והחזר אותו בפורמט DD.MM.YYYY (המר '/' ל-'.'). אל תחזיר רק שנה כשהתאריך המלא גלוי בכרטיסייה. אל תיכנס לדף התיק הפנימי ואל תפתח PDF — כל המידע נמצא בדף התוצאות.
אם פסק הדין לא נמצא בתקדין לייט, נסה nevo.co.il ו-supreme.court.gov.il.

הפורמט:
{
  "found": true/false,
  "party1": "שם צד א (שם משפחה בלבד לאנשים פרטיים)",
  "party2": "שם צד ב",
  "date": "DD.MM.YYYY",
  "court": "שם בית המשפט",
  "isPublished": true/false,
  "padi_volume": "כרך (מספר)",
  "padi_part": "חלק (מספר)",
  "padi_page": "עמוד ראשון (מספר)",
  "databaseName": "נבו/תקדין/פסקדין (רק אם לא פורסם בפד\"י)",
  "year": "שנת פסק הדין (YYYY)"
}
אם לא מצאת את פסק הדין, החזר {"found": false}.
חשוב: שמות צדדים - לאנשים פרטיים שם משפחה בלבד. לתאגידים/גופים ציבוריים - שם מלא. אל תכלול תארים (עו"ד, ד"ר וכו'). אל תכלול "עזבון" או "יורשי" - רק שם המשפחה.`,
          },
          { role: "user", content: query },
        ],
      }),
    });

    if (!perplexityResponse.ok) {
      const errorText = await perplexityResponse.text();
      console.error("Perplexity API error:", perplexityResponse.status, errorText);
      return new Response(
        JSON.stringify({ found: false, error: "Search service error" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const perplexityData = await perplexityResponse.json();
    const content = perplexityData.choices?.[0]?.message?.content || "";
    console.log("Perplexity raw response:", content);

    // Extract JSON from the response (may be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Could not extract JSON from Perplexity response");
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse JSON from Perplexity:", jsonMatch[0]);
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!parsed.found) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build structured result
    const result: CaseLawResult = {
      found: true,
      parties: parsed.party1 && parsed.party2
        ? `${parsed.party1} נ' ${parsed.party2}`
        : undefined,
      date: parsed.date as string | undefined,
      court: parsed.court as string | undefined,
      isPublished: parsed.isPublished as boolean | undefined,
    };

    if (parsed.isPublished && parsed.padi_volume) {
      const part = parsed.padi_part ? `(${parsed.padi_part})` : "";
      result.publication = `פ"ד ${parsed.padi_volume}${part} ${parsed.padi_page || "[חסר: עמוד]"}`;
    }

    if (!parsed.isPublished && parsed.databaseName) {
      result.databaseName = parsed.databaseName as string;
    }

    // Extract year
    const year = parsed.year || (parsed.date ? (parsed.date as string).match(/\d{4}/)?.[0] : null);

    return new Response(
      JSON.stringify({ ...result, year }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("case-law-search error:", e);
    return new Response(
      JSON.stringify({ found: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
