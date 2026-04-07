import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const digitToSuperscript: Record<string, string> = {
  "0": "\u2070", "1": "\u00B9", "2": "\u00B2", "3": "\u00B3",
  "4": "\u2074", "5": "\u2075", "6": "\u2076",
  "7": "\u2077", "8": "\u2078", "9": "\u2079",
};

function toSuperscript(n: number): string {
  return String(n).split("").map((d) => digitToSuperscript[d] || d).join("");
}

const BLOG_URL_PATTERNS = [
  /\/blog\//i, /\/blogs\//i, /adv-/i, /adv\./i,
  /עורכי-דין/i, /law-firm/i, /lawfirm/i, /lawyer/i,
  /kolzchut\.org/i, /ynet\.co\.il/i, /walla\.co\.il/i,
  /mako\.co\.il/i, /globes\.co\.il/i, /calcalist\.co\.il/i,
  /themarker\.com/i, /israelhayom/i,
];

function isBlogUrl(url?: string): boolean {
  if (!url) return false;
  return BLOG_URL_PATTERNS.some((p) => p.test(url));
}

async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 768,
    }),
  });

  if (!res.ok) {
    // Non-fatal: log and return null to fall back to Perplexity
    const errText = await res.text();
    console.error("Embedding error (non-fatal):", res.status, errText);
    return [];
  }

  const data = await res.json();
  return data.data?.[0]?.embedding || [];
}

interface LocalMatch {
  chunk_id: string;
  document_id: string;
  chunk_content: string;
  document_title: string;
  document_citation: string;
  source_type: string;
  source_url: string | null;
  metadata: Record<string, unknown>;
  similarity: number;
}

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
    if (!PERPLEXITY_API_KEY) throw new Error("PERPLEXITY_API_KEY is not configured");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ========= Step 1: Local vector search =========
    let localMatches: LocalMatch[] = [];
    let localContext = "";
    let usedLocalSearch = false;

    try {
      const queryEmbedding = await getEmbedding(question, LOVABLE_API_KEY);

      if (queryEmbedding.length > 0) {
        const { data: matches, error: matchError } = await adminClient.rpc("match_legal_chunks", {
          query_embedding: JSON.stringify(queryEmbedding),
          match_threshold: 0.7,
          match_count: 8,
        });

        if (!matchError && matches && matches.length > 0) {
          localMatches = matches;
          usedLocalSearch = true;
          console.log(`Local search: found ${matches.length} matching chunks`);

          // Build local context for the LLM
          const seenDocs = new Set<string>();
          localContext = "\n\n=== מקורות מהמאגר המקומי (מאומתים) ===\n";
          for (const m of localMatches) {
            if (!seenDocs.has(m.document_id)) {
              seenDocs.add(m.document_id);
              localContext += `\n--- מקור: ${m.document_title} ---\nסוג: ${m.source_type}\nאזכור: ${m.document_citation}\n`;
              if (m.source_url) localContext += `קישור: ${m.source_url}\n`;
            }
            localContext += `\nקטע רלוונטי (דמיון: ${(m.similarity * 100).toFixed(0)}%):\n${m.chunk_content}\n`;
          }
        } else {
          console.log("Local search: no matches found or error:", matchError?.message);
        }
      }
    } catch (embErr) {
      console.error("Local search failed (non-fatal), falling back to Perplexity:", embErr);
    }

    // ========= Step 2: Perplexity search (always, but as supplement) =========
    console.log("Searching Perplexity for additional sources...");
    const perplexityRes = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        search_domain_filter: [
          "nevo.co.il", "www.nevo.co.il", "supreme.court.gov.il",
          "knesset.gov.il", "lawdata.co.il", "psakdin.co.il",
          "huji.ac.il", "tau.ac.il", "biu.ac.il", "haifa.ac.il",
        ],
        messages: [
          {
            role: "system",
            content: `You are a legal research assistant specializing in Israeli law.
Your job is to find PRIMARY legal sources ONLY. This means:
- Israeli statutes and legislation with EXACT publication references (ס"ח page number, ק"ת page number)
- Israeli court decisions with EXACT case numbers (e.g., ע"א 461/62, בג"ץ 5100/94)
- Academic books published by recognized publishers (e.g., נבו, פרלשטיין-גינוסר, שוקן)
- Academic articles from law journals (e.g., הפרקליט, משפטים, עיוני משפט, משפט וממשל)
- International treaties and conventions when relevant

CRITICAL: Do NOT cite any of the following:
- Lawyer blogs or law firm websites
- Legal news summaries or marketing pages
- General news articles about legal topics
- "סקירות משפטיות" from lawyer websites
- Any URL containing "/blog/", "adv-", "עורכי-דין", or law firm names

For each source, provide:
- The EXACT law name, case number, or book title
- Publication details (ס"ח/ק"ת page, פ"ד volume, publisher and year for books)
- Never fabricate case numbers, page numbers, or publication references`,
          },
          { role: "user", content: question },
        ],
      }),
    });

    let searchResults = "";
    let citations: string[] = [];

    if (perplexityRes.ok) {
      const perplexityData = await perplexityRes.json();
      searchResults = perplexityData.choices?.[0]?.message?.content || "";
      citations = perplexityData.citations || [];
      console.log(`Perplexity returned ${citations.length} citations`);
    } else {
      const errText = await perplexityRes.text();
      console.error("Perplexity error (non-fatal):", perplexityRes.status, errText);
      // If we have local matches, continue without Perplexity
      if (!usedLocalSearch) {
        throw new Error(`Perplexity search failed: ${perplexityRes.status}`);
      }
    }

    // ========= Step 3: Build combined context for LLM =========
    const contextParts: string[] = [];

    if (localContext) {
      contextParts.push(localContext);
      contextParts.push("\nהערה חשובה: מקורות מהמאגר המקומי הם מאומתים ואמינים. העדף אותם על פני מקורות מ-Perplexity.");
    }

    if (searchResults) {
      contextParts.push("\n\n=== מקורות מחיפוש Perplexity ===\n" + searchResults);
      if (citations.length > 0) {
        contextParts.push(`\nקישורי מקור:\n${citations.map((c: string, i: number) => `[${i + 1}] ${c}`).join("\n")}`);
      }
    }

    const combinedContext = contextParts.join("\n");

    // ========= Step 4: Gemini structuring =========
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

כללים קריטיים לפיזור הערות שוליים:
7. לכל משפט מותר לצרף לכל היותר הערת שוליים אחת (סופרסקריפט אחד). אסור בשום מקרה לצרף מספר הערות שוליים לאותו משפט (למשל ¹²³ או ¹⁴¹⁵¹⁶ – אסור!).
8. פזר את ההערות לאורך כל התשובה. אם מספר מקורות תומכים באותה נקודה, כתוב משפטים נפרדים שכל אחד מהם מתייחס להיבט שונה, וצרף לכל משפט הערה אחת בלבד.
9. העדף 5–8 הערות שוליים איכותיות על פני הערות רבות ודלות.
10. אל תיצור הערות שוליים עבור בלוגים משפטיים, אתרי משרדי עורכי דין, או סקירות משפטיות. צטט רק מקורות משפטיים ראשוניים: חקיקה, פסיקה, ספרים אקדמיים, ומאמרים בכתבי עת.

כללים לסימון מקור ההערות:
11. לכל הערת שוליים, ציין את שדה source מהמקורות:
    - אם ההערה מבוססת על מקור מהמאגר המקומי (מאומת), סמן source: "local"
    - אם ההערה מבוססת על מקור מחיפוש Perplexity, סמן source: "perplexity"

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
${combinedContext}`;

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
                "Format a structured legal answer with inline footnotes. CRITICAL: each sentence may have AT MOST one footnote superscript. Never cluster multiple footnotes on the same sentence.",
              parameters: {
                type: "object",
                properties: {
                  answer: {
                    type: "string",
                    description:
                      "The full Hebrew answer with superscript footnote numbers (¹²³). Each sentence has AT MOST one superscript.",
                  },
                  footnotes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        number: { type: "number" },
                        citation: {
                          type: "string",
                          description: "Full legal citation formatted per Israeli Uniform Citation Rules (2021).",
                        },
                        source_type: {
                          type: "string",
                          enum: ["legislation", "caselaw", "book", "article", "international"],
                        },
                        url: {
                          type: "string",
                          description: "Source URL if available",
                        },
                        source: {
                          type: "string",
                          enum: ["local", "perplexity"],
                          description: "Whether this footnote comes from the local verified database or from Perplexity search",
                        },
                      },
                      required: ["number", "citation", "source_type", "source"],
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

    let answer = parsed.answer || "";
    let footnotes: Array<{ number: number; citation: string; source_type: string; url?: string; source?: string }> = parsed.footnotes || [];

    // --- Post-processing Step 1: Filter out blog/marketing footnotes ---
    const filteredFootnotes = footnotes.filter((fn) => !isBlogUrl(fn.url));
    const removedNumbers = new Set(
      footnotes.filter((fn) => isBlogUrl(fn.url)).map((fn) => fn.number)
    );

    if (removedNumbers.size > 0) {
      console.log(`Filtered out ${removedNumbers.size} blog/marketing footnotes`);
      for (const num of removedNumbers) {
        const sup = toSuperscript(num);
        answer = answer.replaceAll(sup, "");
      }
      const oldToNew = new Map<number, number>();
      filteredFootnotes.forEach((fn, idx) => {
        oldToNew.set(fn.number, idx + 1);
      });
      for (const [oldNum, newNum] of oldToNew) {
        if (oldNum !== newNum) {
          const oldSup = toSuperscript(oldNum);
          const placeholder = `__FN_PLACEHOLDER_${newNum}__`;
          answer = answer.replaceAll(oldSup, placeholder);
        }
      }
      for (const [, newNum] of oldToNew) {
        const placeholder = `__FN_PLACEHOLDER_${newNum}__`;
        answer = answer.replaceAll(placeholder, toSuperscript(newNum));
      }
      filteredFootnotes.forEach((fn, idx) => {
        fn.number = idx + 1;
      });
      footnotes = filteredFootnotes;
    }

    // --- Post-processing Step 2: Convert bracket patterns to superscript ---
    answer = answer.replace(/\[(\d{1,2})\]/g, (_: string, num: string) => toSuperscript(parseInt(num, 10)));
    answer = answer.replace(/\((\d{1,2})\)(?=[^\dא-ת]|$)/g, (_: string, num: string) => toSuperscript(parseInt(num, 10)));

    // --- Post-processing Step 3: De-cluster adjacent superscripts ---
    const superscriptChars = new Set(Object.values(digitToSuperscript));
    const lines = answer.split("\n");
    const processedLines = lines.map((line) => {
      let result = "";
      let inSuperscriptRun = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (superscriptChars.has(ch)) {
          if (!inSuperscriptRun) {
            inSuperscriptRun = true;
            result += ch;
          } else {
            const prevSupChars: string[] = [];
            for (let j = result.length - 1; j >= 0; j--) {
              if (superscriptChars.has(result[j])) {
                prevSupChars.unshift(result[j]);
              } else break;
            }
            prevSupChars.push(ch);
            const superscriptToDigit: Record<string, string> = {};
            for (const [d, s] of Object.entries(digitToSuperscript)) {
              superscriptToDigit[s] = d;
            }
            const numStr = prevSupChars.map((c) => superscriptToDigit[c] || "").join("");
            const num = parseInt(numStr, 10);
            const maxFootnote = footnotes.length > 0 ? Math.max(...footnotes.map((f) => f.number)) : 20;
            if (num <= maxFootnote) {
              result += ch;
            }
          }
        } else {
          inSuperscriptRun = false;
          result += ch;
        }
      }
      return result;
    });
    answer = processedLines.join("\n");

    // --- Post-processing Step 4: Inject missing superscripts ---
    for (const fn of footnotes) {
      const sup = toSuperscript(fn.number);
      if (!answer.includes(sup)) {
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
