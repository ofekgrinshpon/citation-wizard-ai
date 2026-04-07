import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth gate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { question } = await req.json();
    if (!question || typeof question !== "string" || question.trim().length < 5) {
      return new Response(JSON.stringify({ error: "Question too short" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) {
      throw new Error("PERPLEXITY_API_KEY is not configured");
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Step 1: Perplexity search for legal sources
    console.log("Searching Perplexity for legal sources...");
    const perplexityRes = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: `You are a legal research assistant specializing in Israeli law. 
Search for real, verifiable legal sources relevant to the question.
Focus on:
- Israeli statutes and legislation (חוקים, תקנות)
- Israeli Supreme Court and district court decisions (פסקי דין)
- Israeli legal academic articles and books
- International law and treaties when relevant
- Provide exact case numbers, law names, publication references (ס"ח, ק"ת, פ"ד) when available.
Always cite real sources. Never fabricate case numbers or law references.`,
          },
          { role: "user", content: question },
        ],
      }),
    });

    if (!perplexityRes.ok) {
      const errText = await perplexityRes.text();
      console.error("Perplexity error:", perplexityRes.status, errText);
      throw new Error(`Perplexity search failed: ${perplexityRes.status}`);
    }

    const perplexityData = await perplexityRes.json();
    const searchResults = perplexityData.choices?.[0]?.message?.content || "";
    const citations = perplexityData.citations || [];

    console.log(`Perplexity returned ${citations.length} citations`);

    // Step 2: Lovable AI to structure the answer with footnotes
    const systemPrompt = `אתה עוזר משפטי מומחה. קיבלת תוצאות חיפוש משפטי ועליך לכתוב תשובה מובנית בעברית.

כללים:
1. כתוב תשובה מקצועית בעברית עם מספרי הערות שוליים בסופרסקריפט (¹²³⁴⁵⁶⁷⁸⁹).
2. מספר הערת השוליים תמיד בא אחרי סימן פיסוק (נקודה, פסיק, נקודתיים) ולא לפניו.
3. כל הערת שוליים חייבת להתבסס על מקור אמיתי מתוצאות החיפוש שסופקו.
4. אל תמציא מקורות. אם אין מקור מתאים, ציין זאת.
5. סווג כל מקור לפי סוג: legislation, caselaw, book, article, international.

פורמט אזכור להערות שוליים (כללי האזכור האחיד 2021):
- חקיקה ראשית (כלל 2): שם החוק, שנה עברית–שנה לועזית, ס"ח עמוד ראשון. דוגמה: חוק החוזים (חלק כללי), התשל"ג–1973, ס"ח 118.
- חקיקת משנה (כלל 6): שם התקנות, שנה עברית–שנה לועזית, ק"ת עמוד. דוגמה: תקנות סדר הדין האזרחי, התשע"ט–2018, ק"ת 234.
- פסיקה מפורסמת (כלל 18): סוג הליך מספר תיק שם נ' שם, פ"ד כרך(חלק) עמוד (שנה). דוגמה: ע"א 461/62 צים נ' מזיאר, פ"ד יז 1319 (1963).
- פסיקה ממאגר (כלל 19): סוג הליך מספר תיק שם נ' שם (שם מאגר, תאריך מלא). דוגמה: ע"א 1234/05 כהן נ' לוי (נבו, 15.3.2010).
- ספרים (כלל 23): שם מחבר **שם הספר** עמוד (מהדורה, שנה). דוגמה: גבריאלה שלו **דיני חוזים – החלק הכללי** 350 (מהדורה שנייה, 2005).
- מאמרים (כלל 24): שם מחבר "שם המאמר" **שם כתב העת** כרך עמוד פתיחה, עמוד ספציפי (שנה). דוגמה: אהרן ברק "פרשנות חוזה" **הפרקליט** מג 118, 125 (1997).
- עבור מידע חסר, השתמש ב-[missing:פרט חסר].

תוצאות החיפוש המשפטי:
${searchResults}

${citations.length > 0 ? `\nקישורי מקור:\n${citations.map((c: string, i: number) => `[${i + 1}] ${c}`).join("\n")}` : ""}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `השאלה המשפטית: ${question}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "format_legal_answer",
              description:
                "Format a structured legal answer with inline footnotes",
              parameters: {
                type: "object",
                properties: {
                  answer: {
                    type: "string",
                    description:
                      "The full Hebrew answer with superscript footnote numbers (¹²³)",
                  },
                  footnotes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        number: { type: "number" },
                        citation: {
                          type: "string",
                          description: "Full citation text in Hebrew",
                        },
                        source_type: {
                          type: "string",
                          enum: [
                            "legislation",
                            "caselaw",
                            "book",
                            "article",
                            "international",
                          ],
                        },
                        url: {
                          type: "string",
                          description: "Source URL if available",
                        },
                      },
                      required: ["number", "citation", "source_type"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["answer", "footnotes"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "format_legal_answer" },
        },
      }),
    });

    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      throw new Error(`AI gateway error: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      // Fallback: try to use content directly
      const content = aiData.choices?.[0]?.message?.content || "";
      return new Response(
        JSON.stringify({
          answer: content,
          footnotes: [],
          source_urls: citations,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({
        answer: parsed.answer,
        footnotes: parsed.footnotes || [],
        source_urls: citations,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("legal-qa error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
