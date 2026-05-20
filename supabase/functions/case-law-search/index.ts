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
    const retryQuery = `אנא מצא שוב את פסק הדין הישראלי ${fullCaseRef}. חפש ישירות ב-https://lite.takdin.co.il/search-results ובאתר נבו את העמוד הייעודי של התיק (לא דפי ריכוז של מספר תיקים). ציין שמות צדדים, תאריך מתן פסק הדין המדויק, בית המשפט, פרסום בפד"י (כרך/חלק/עמוד) או שם המאגר.`;

    const systemPrompt = `אתה עוזר מחקר משפטי. כשמבקשים ממך למצוא פסק דין ישראלי, החזר את המידע בפורמט JSON מדויק בלבד, ללא טקסט נוסף.
טיפ חיפוש: בעמוד https://lite.takdin.co.il/search-results מוצגים בעמוד אחד שמות הצדדים, מספר התיק, בית המשפט, תאריך פסק הדין, ופרסום בפ"ד (אם קיים). העדף לאתר את התיק שם — זה חוסך חיפושים ומספק את כל הנתונים הנדרשים לאזכור.
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
  "year": "שנת פסק הדין (YYYY)",
  "confidence": "high/low"
}
אם לא מצאת את פסק הדין, החזר {"found": false}.
חשוב: שמות צדדים - לאנשים פרטיים שם משפחה בלבד. לתאגידים/גופים ציבוריים - שם מלא. אל תכלול תארים (עו"ד, ד"ר וכו'). אל תכלול "עזבון" או "יורשי" - רק שם המשפחה.

כלל קריטי לחילוץ תאריך פסק הדין (אסור לעבור עליו):
1. מקור מועדף: עמוד התיק עצמו במאגר ייעודי (נבו / תקדין / פסקדין / supreme.court.gov.il / supremedecisions.court.gov.il). אם מצאת שם תאריך — קח אותו וסיים.
2. אם התיק מוזכר רק בתוך פסק דין אחר או מסמך אחר, מותר לקחת את התאריך אך ורק אם הוא מופיע צמוד לאזכור התיק בפורמט המקובל: "[סוג תיק] [מספר]/[שנה] [צד א] נ' [צד ב] (DD.MM.YYYY)" — הסוגריים מיד אחרי שמות הצדדים של אותו תיק, באותה שורה.
3. אסור לקחת תאריך מ: דף ריכוז/רשימת תיקים שמכיל מספר תאריכים שונים; משפט תיאורי ("נדון בעניין X", "ראו פסק דין מיום ..."); או הקשר של פסק דין אחר שמצטט תאריך משלו.
4. אם אף מקור לא עומד בכללים — החזר "date":"" ו-"year":"" וסמן "confidence":"low". אל תנחש.`;

    const callPerplexity = async (userMsg: string, attempt: number) => {
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar-pro",
          search_domain_filter: ["nevo.co.il", "court.gov.il", "supreme.court.gov.il", "takdin.co.il", "lite.takdin.co.il", "psakdin.co.il"],
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
        }),
      });
      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`[case-law-search] Perplexity attempt ${attempt} error:`, resp.status, errorText);
        return { ok: false as const, data: null as any, content: "" };
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || "";
      console.log(`[case-law-search] perplexity sources for ${fullCaseRef} (attempt ${attempt}):`, JSON.stringify({
        citations: data.citations ?? null,
        search_results: data.search_results ?? null,
        model: data.model,
      }));
      console.log(`[case-law-search] raw content (attempt ${attempt}):`, content);
      return { ok: true as const, data, content };
    };

    let attempt1 = await callPerplexity(query, 1);
    if (!attempt1.ok) {
      return new Response(
        JSON.stringify({ found: false, error: "Search service error" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let perplexityData = attempt1.data;
    let content = attempt1.content;

    // Retry once on empty/not-found result
    const hadResults1 = (perplexityData?.search_results?.length ?? 0) > 0;
    let firstFound = false;
    try {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) firstFound = !!JSON.parse(m[0]).found;
    } catch { /* ignore */ }
    if (!hadResults1 || !firstFound) {
      console.log(`[case-law-search] retry attempt 2 for ${fullCaseRef} (hadResults=${hadResults1}, firstFound=${firstFound})`);
      const attempt2 = await callPerplexity(retryQuery, 2);
      if (attempt2.ok && (attempt2.data?.search_results?.length ?? 0) > 0) {
        perplexityData = attempt2.data;
        content = attempt2.content;
      }
    }

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

    // ── Decision-date verification ──
    // Published cases: anchor on פ"ד volume/page.
    // Unpublished cases: anchor on case number + parties with strict adjacency rule.
    const dateVerifyPrompt = `החזר JSON בלבד: {"date":"DD.MM.YYYY","year":"YYYY","confidence":"high/low"}.
התאריך הנדרש הוא תאריך מתן פסק הדין על ידי בית המשפט — לא שנת הוצאת כרך פ"ד.

כלל קריטי לחילוץ תאריך (אסור לעבור עליו):
1. מקור מועדף: עמוד התיק עצמו במאגר (נבו/תקדין/פסקדין/supreme.court.gov.il/supremedecisions.court.gov.il). מצאת שם — confidence:"high".
2. אם התיק מוזכר רק בתוך פסק דין אחר, מותר לקחת תאריך אך ורק אם הוא מופיע צמוד לאזכור בפורמט: "[סוג] [מספר]/[שנה] [צד א] נ' [צד ב] (DD.MM.YYYY)" — בסוגריים מיד אחרי שמות הצדדים. במקרה זה confidence:"low".
3. אסור לקחת תאריך מדף ריכוז/רשימת תיקים, ממשפט תיאורי, או מהקשר של פסק דין אחר.
4. אם אף מקור לא עומד בכללים — החזר {"date":"","year":"","confidence":"low"}.`;

    try {
      let dvUserMsg = "";
      if (parsed.isPublished && parsed.padi_volume) {
        const part = parsed.padi_part ? `(${parsed.padi_part})` : "";
        const padiRef = `פ"ד ${parsed.padi_volume}${part} ${parsed.padi_page || ""}`.trim();
        dvUserMsg = `מהו התאריך המדויק שבו ניתן פסק הדין ${fullCaseRef} שפורסם ב-${padiRef}?`;
      } else if (parsed.party1 && parsed.party2) {
        dvUserMsg = `מהו תאריך מתן פסק הדין ${fullCaseRef} בעניין ${parsed.party1} נ' ${parsed.party2}? החל את הכלל הקריטי במלואו.`;
      }

      if (dvUserMsg) {
        const dvResp = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "sonar-pro",
            search_domain_filter: ["nevo.co.il", "supreme.court.gov.il", "supremedecisions.court.gov.il", "court.gov.il", "psakdin.co.il", "takdin.co.il", "lite.takdin.co.il"],
            messages: [
              { role: "system", content: dateVerifyPrompt },
              { role: "user", content: dvUserMsg },
            ],
          }),
        });
        if (dvResp.ok) {
          const dvData = await dvResp.json();
          const dvContent = dvData.choices?.[0]?.message?.content || "";
          console.log(`[case-law-search] date-verify sources for ${fullCaseRef}:`, JSON.stringify({
            citations: dvData.citations ?? null,
            search_results: dvData.search_results ?? null,
          }));
          console.log(`[case-law-search] date-verify raw content:`, dvContent);
          const dvMatch = dvContent.match(/\{[\s\S]*\}/);
          if (dvMatch) {
            const dvParsed = JSON.parse(dvMatch[0]);
            const newDate = dvParsed.date ? String(dvParsed.date).trim() : "";
            const newYear = dvParsed.year ? String(dvParsed.year).trim() : "";
            const dvConf = dvParsed.confidence ? String(dvParsed.confidence).trim() : "";
            const origDate = parsed.date ? String(parsed.date) : "";
            console.log(`[case-law-search] date verification: original={date:${origDate},year:${parsed.year}} verified={date:${newDate},year:${newYear},confidence:${dvConf}}`);
            const isPub = !!parsed.isPublished && !!parsed.padi_volume;

            if (isPub) {
              // Published: existing behavior — override with whatever verifier returns, clear if empty.
              if (newDate || newYear) {
                parsed.date = newDate;
                parsed.year = newYear || (newDate.match(/\d{4}/)?.[0] ?? "");
              } else {
                parsed.date = "";
                parsed.year = "";
              }
            } else {
              // Unpublished: stricter reconciliation.
              if (!newDate && !newYear) {
                parsed.date = "";
                parsed.year = "";
              } else if (newDate && origDate && newDate !== origDate) {
                if (dvConf === "high") {
                  parsed.date = newDate;
                  parsed.year = newYear || (newDate.match(/\d{4}/)?.[0] ?? "");
                } else {
                  parsed.date = "";
                  parsed.year = "";
                }
              } else if (newDate && !origDate) {
                parsed.date = newDate;
                parsed.year = newYear || (newDate.match(/\d{4}/)?.[0] ?? "");
              }
            }
          }
        }
      }
    } catch (dvErr) {
      console.error("[case-law-search] date verification error:", dvErr);
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
