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

כללי כתיבה לגוף התשובה:
1. כתוב תשובה מקצועית בעברית. אל תשתמש בסימני עיצוב כמו ** או # או כוכביות – כתוב טקסט רגיל בלבד.
2. בגוף הטקסט, השתמש בשמות מקוצרים של חוקים (למשל "סעיף 15 לחוק החוזים" ולא "סעיף 15 לחוק החוזים (חלק כללי), התשל"ג–1973"). השם המלא יופיע רק בהערת השוליים.
3. חובה: כל הערת שוליים שאתה מגדיר חייבת להופיע כמספר סופרסקריפט בגוף הטקסט. השתמש בתווי יוניקוד: ⁰¹²³⁴⁵⁶⁷⁸⁹. עבור מספרים דו-ספרתיים, שרשר: ¹⁰, ¹¹, ¹², ¹³, ¹⁴, ¹⁵ וכו'.
4. מיקום הסופרסקריפט: תמיד בסוף המשפט, מיד אחרי סימן הפיסוק. דוגמאות נכונות:
   - "ביטול חוזה עקב הטעיה מעוגן בסעיף 15 לחוק החוזים.¹"
   - "גישה זו אומצה בפסיקה.¹⁴"
   - דוגמה שגויה: "ביטול חוזה¹ עקב הטעיה..."
5. אל תמציא מקורות. כל הערת שוליים חייבת להתבסס על מקור אמיתי מתוצאות החיפוש.
6. סווג כל מקור: legislation, caselaw, book, article, international.
7. אם יש לך 14 הערות שוליים, חייבים להופיע בגוף הטקסט 14 סופרסקריפטים: ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ¹⁰ ¹¹ ¹² ¹³ ¹⁴.

כללי כתיבה להערות שוליים (כללי האזכור האחיד 2021):
הערות השוליים הן האזכור המשפטי המלא. כתוב אותן בדיוק לפי הפורמט הבא:
- חקיקה ראשית (כלל 2): שם החוק המלא, שנה עברית–שנה לועזית, ס"ח עמוד ראשון. דוגמה: חוק החוזים (חלק כללי), התשל"ג–1973, ס"ח 118.
- חקיקת משנה (כלל 6): שם התקנות, שנה עברית–שנה לועזית, ק"ת עמוד. דוגמה: תקנות סדר הדין האזרחי, התשע"ט–2018, ק"ת 234.
- פסיקה מפורסמת (כלל 18): סוג הליך מספר תיק שם נ' שם, פ"ד כרך(חלק) עמוד (שנה). דוגמה: ע"א 461/62 צים נ' מזיאר, פ"ד יז 1319 (1963).
- פסיקה ממאגר (כלל 19): סוג הליך מספר תיק שם נ' שם (שם מאגר, תאריך מלא DD.MM.YYYY). דוגמה: ע"א 1234/05 כהן נ' לוי (נבו, 15.3.2010).
- ספרים (כלל 23): שם מחבר, שם הספר, עמוד (מהדורה, שנה). דוגמה: גבריאלה שלו דיני חוזים – החלק הכללי 350 (מהדורה שנייה, 2005).
- מאמרים (כלל 24): שם מחבר "שם המאמר" שם כתב העת כרך עמוד פתיחה, עמוד ספציפי (שנה). דוגמה: אהרן ברק "פרשנות חוזה" הפרקליט מג 118, 125 (1997).
- אל תשתמש בכוכביות (**) או בסימני עיצוב אחרים בהערות השוליים.
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
                          description: "Full legal citation formatted per Israeli Uniform Citation Rules (2021). For legislation: law name, Hebrew year–Gregorian year, S.H./K.T. page. For case law: procedure type, case number, party v party, P.D. volume(part) page (year). For books: author **title** page (edition, year). For articles: author 'title' **journal** volume page (year).",
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

    // Post-processing: ensure superscript footnote numbers exist in the answer
    let answer = parsed.answer || "";
    const footnotes = parsed.footnotes || [];

    const digitToSuperscript: Record<string, string> = {
      "0": "\u2070", "1": "\u00B9", "2": "\u00B2", "3": "\u00B3",
      "4": "\u2074", "5": "\u2075", "6": "\u2076",
      "7": "\u2077", "8": "\u2078", "9": "\u2079",
    };

    function toSuperscript(n: number): string {
      return String(n).split("").map((d) => digitToSuperscript[d] || d).join("");
    }

    // First, convert any [N] or (N) bracket patterns to superscript
    answer = answer.replace(/\[(\d{1,2})\]/g, (_: string, num: string) => toSuperscript(parseInt(num, 10)));
    answer = answer.replace(/\((\d{1,2})\)(?=[^\dא-ת]|$)/g, (_: string, num: string) => toSuperscript(parseInt(num, 10)));

    // For each footnote, verify its superscript exists; if not, try to inject it
    for (const fn of footnotes) {
      const sup = toSuperscript(fn.number);
      if (!answer.includes(sup)) {
        // Try to find a sentence ending (period followed by space or end) and append there
        // Find the Nth period as a heuristic
        const periodRegex = /([.。])([\s\n]|$)/g;
        let match;
        let count = 0;
        let insertPos = -1;
        while ((match = periodRegex.exec(answer)) !== null) {
          count++;
          if (count === fn.number) {
            insertPos = match.index + match[1].length;
            break;
          }
        }
        if (insertPos > 0) {
          answer = answer.slice(0, insertPos) + sup + answer.slice(insertPos);
        } else {
          // Append at end of last sentence before footnotes section
          const lastPeriod = answer.lastIndexOf(".");
          if (lastPeriod > 0) {
            answer = answer.slice(0, lastPeriod + 1) + sup + answer.slice(lastPeriod + 1);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        answer,
        footnotes,
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
