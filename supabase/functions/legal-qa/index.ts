import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildCitationInstructions } from "./citationRules.ts";

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

async function getEmbedding(_text: string, _apiKey: string): Promise<number[]> {
  // Embedding models are not supported by the Lovable AI Gateway.
  // Skip vector search entirely and fall through to text-based search.
  return [];
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

// ─── Task mode → system prompt instructions ──────────────────────────

function getTaskModeInstructions(taskMode?: string): string {
  switch (taskMode) {
    case "pleading_analysis":
      return `\n\nמצב עבודה: ניתוח כתב טענה
חובה לבנות את התשובה לפי המבנה הבא:
**תקציר** – סיכום הטענות המרכזיות בכתב הטענה.
**מסגרת נורמטיבית** – החוקים והפסיקה הרלוונטיים לטענות.
**ניתוח מפורט** – ניתוח ביקורתי של כל טענה: חוזקות, חולשות, ופערים.
**המלצות מעשיות** – המלצות לשיפור כתב הטענה או לתשובה עליו.`;

    case "case_summary":
      return `\n\nמצב עבודה: סיכום פסיקה
חובה לבנות את התשובה לפי המבנה הבא:
**תקציר** – עובדות המקרה והשאלה המשפטית.
**מסגרת נורמטיבית** – הדין שהופעל והתקדימים הרלוונטיים.
**ניתוח מפורט** – הכרעת בית המשפט, הנמקה, דעות מיעוט.
**המלצות מעשיות** – השלכות פסק הדין על מקרים עתידיים.`;

    case "argument_draft":
      return `\n\nמצב עבודה: ניסוח טיעון
חובה לבנות את התשובה לפי המבנה הבא:
**תקציר** – הטיעון המרכזי בתמצית.
**מסגרת נורמטיבית** – הבסיס החוקי והפסיקתי לטיעון.
**ניתוח מפורט** – בניית הטיעון שלב אחר שלב עם סימוכין.
**המלצות מעשיות** – טיעוני נגד אפשריים ודרכי התמודדות.`;

    default: // "research"
      return `\n\nמצב עבודה: מחקר משפטי
חובה לבנות את התשובה לפי המבנה הבא:
**תקציר** – תמצית הסוגיה והמסקנות.
**מסגרת נורמטיבית** – סקירת החקיקה והפסיקה הרלוונטית.
**ניתוח מפורט** – דיון מעמיק בגישות השונות ובפרשנויות.
**המלצות מעשיות** – יישום מעשי ותובנות לפעולה.`;
  }
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

    const body = await req.json();
    const { question, taskMode, documentText, documentName } = body;

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

    // ========= Step 0: Document context (if uploaded) =========
    let documentContext = "";
    const hasDocument = documentText && typeof documentText === "string" && documentText.trim().length > 100;
    if (hasDocument) {
      documentContext = `\n\n=== מסמך שהועלה: ${documentName || "ללא שם"} ===\n${documentText.slice(0, 30000)}\n=== סוף המסמך ===\n`;
      console.log(`Document uploaded: ${documentName}, ${documentText.length} chars`);
    }

    // ========= Step 1: Local search (vector + text fallback) =========
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
          console.log(`Vector search: found ${matches.length} matching chunks`);
        }
      }
    } catch (embErr) {
      console.error("Vector search failed (non-fatal):", embErr);
    }

    if (!usedLocalSearch) {
      try {
        const { data: textMatches, error: textError } = await adminClient.rpc("search_legal_chunks_text", {
          search_query: question,
          match_count: 8,
        });
        if (!textError && textMatches && textMatches.length > 0) {
          localMatches = textMatches;
          usedLocalSearch = true;
          console.log(`Text search fallback: found ${textMatches.length} matching chunks`);
        }
      } catch (textErr) {
        console.error("Text search failed (non-fatal):", textErr);
      }
    }

    if (usedLocalSearch && localMatches.length > 0) {
      const seenDocs = new Set<string>();
      localContext = "\n\n=== מקורות מהמאגר המקומי (מאומתים) ===\n";
      for (const m of localMatches) {
        const isNotebook = m.source_type === "notebook";
        if (!seenDocs.has(m.document_id)) {
          seenDocs.add(m.document_id);
          if (isNotebook) {
            localContext += `\n--- מחברת לימודים (לרקע בלבד – אל תצטט כמקור): ${m.document_title} ---\n`;
          } else {
            localContext += `\n--- מקור: ${m.document_title} ---\nסוג: ${m.source_type}\nאזכור: ${m.document_citation}\n`;
            if (m.source_url) localContext += `קישור: ${m.source_url}\n`;
          }
        }
        localContext += `\nקטע רלוונטי (דמיון: ${(m.similarity * 100).toFixed(0)}%):\n${m.chunk_content}\n`;
      }
    }

    // ========= Step 2: Perplexity search =========
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
- Academic books published by recognized publishers
- Academic articles from law journals (e.g., הפרקליט, משפטים, עיוני משפט, משפט וממשל)
- International treaties and conventions when relevant

CRITICAL: Do NOT cite lawyer blogs, law firm websites, legal news summaries, or marketing pages.

For each source, provide the EXACT law name, case number, or book title with full publication details.`,
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
      if (!usedLocalSearch && !hasDocument) {
        throw new Error(`Perplexity search failed: ${perplexityRes.status}`);
      }
    }

    // ========= Step 3: Build combined context =========
    const contextParts: string[] = [];

    if (hasDocument) {
      contextParts.push(documentContext);
      contextParts.push("\nהערה: המסמך שהועלה הוא מקור הקשרי ראשוני. ענה על השאלה תוך התייחסות ישירה לתוכנו. אם אתה מצטט ממנו, סמן את ההערה כ-source: \"document\".");
    }

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
    const taskInstructions = getTaskModeInstructions(taskMode);

    const citationInstructions = buildCitationInstructions();

    const systemPrompt = `אתה עוזר משפטי מומחה. קיבלת תוצאות חיפוש משפטי ועליך לכתוב חוות דעת משפטית מובנית ומקיפה בעברית.
${taskInstructions}

כללי כתיבה לגוף התשובה:
1. **קריטי – אורך התשובה**: כתוב חוות דעת מקצועית ומפורטת מאוד בעברית, באורך של 1200–2000 מילים לפחות. כל חלק (תקציר, מסגרת נורמטיבית, ניתוח מפורט, המלצות מעשיות) חייב להיות מהותי ומפורט. הדגש על עומק הניתוח ולא על קיצור. תשובה קצרה מ-1000 מילים אינה מספקת.
2. השתמש בכותרות מודגשות (**תקציר**, **מסגרת נורמטיבית**, **ניתוח מפורט**, **המלצות מעשיות**) לארגון התשובה.
3. בגוף הטקסט, השתמש בשמות מקוצרים של חוקים (למשל "סעיף 15 לחוק החוזים"). השם המלא יופיע רק בהערת השוליים.
4. חובה: כל הערת שוליים שאתה מגדיר חייבת להופיע כמספר סופרסקריפט בגוף הטקסט. השתמש בתווי יוניקוד: ⁰¹²³⁴⁵⁶⁷⁸⁹.
5. מיקום הסופרסקריפט: תמיד בסוף המשפט, מיד אחרי סימן הפיסוק.
6. אל תמציא מקורות. כל הערת שוליים חייבת להתבסס על מקור אמיתי מתוצאות החיפוש${hasDocument ? " או מהמסמך שהועלה" : ""}.
7. סווג כל מקור: legislation, caselaw, book, article, international${hasDocument ? ", document" : ""}.

כללים קריטיים לפיזור הערות שוליים:
8. לכל משפט מותר לצרף לכל היותר הערת שוליים אחת.
9. פזר את ההערות לאורך כל התשובה. העדף 8–15 הערות שוליים איכותיות.
10. אל תיצור הערות שוליים עבור בלוגים, אתרי משרדי עורכי דין, או מחברות לימודים.
11. מספור הערות השוליים חייב להיות רציף: 1, 2, 3... ללא דילוגים.

סימון מקור ההערות:
12. לכל הערת שוליים, ציין את שדה source:
    - מקור מהמאגר המקומי: source: "local"
    - מקור מחיפוש Perplexity: source: "perplexity"${hasDocument ? '\n    - מקור מהמסמך שהועלה: source: "document"' : ""}
${hasDocument ? '\n13. מקור מהמסמך שהועלה: ציין "[מתוך הקובץ שהועלה]" בסוף הציטוט.\n' : ""}

${citationInstructions}

היררכיית מקורות:
1. ראשוני: מאגר פנימי (מקורות מאומתים)
2. משני: Perplexity/Scholar לאימות מקוון
${hasDocument ? "3. הקשרי: המסמך שהועלה – השתמש בו כמקור ראשוני להקשר" : ""}

תוצאות החיפוש המשפטי:
${combinedContext}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        max_tokens: 8192,
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
                "Format a structured legal memo with inline footnotes. CRITICAL: each sentence may have AT MOST one footnote superscript.",
              parameters: {
                type: "object",
                properties: {
                  answer: {
                    type: "string",
                    description:
                      "The full Hebrew legal memo with section headings (תקציר, מסגרת נורמטיבית, ניתוח מפורט, המלצות מעשיות) and superscript footnote numbers.",
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
                          enum: ["legislation", "caselaw", "book", "article", "international", "document"],
                        },
                        url: {
                          type: "string",
                          description: "Source URL if available",
                        },
                        source: {
                          type: "string",
                          enum: ["local", "perplexity", "document"],
                          description: "Whether this footnote comes from the local verified database, Perplexity search, or the uploaded document",
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

    console.log(`AI response: tool_calls=${toolCall ? "yes" : "no"}, finish_reason=${aiData.choices?.[0]?.finish_reason || "unknown"}`);

    if (!toolCall?.function?.arguments) {
      const content = aiData.choices?.[0]?.message?.content || "";
      console.error("No tool call returned. Content length:", content.length);
      if (!content || content.length < 50) {
        return new Response(
          JSON.stringify({ error: "העוזר המשפטי לא הצליח לייצר תשובה מלאה. נסו שוב בעוד רגע." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Model returned plain text instead of tool call — use it as-is
      return new Response(
        JSON.stringify({ answer: content, footnotes: [], source_urls: citations }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (parseErr) {
      console.error("Failed to parse tool call arguments:", parseErr);
      return new Response(
        JSON.stringify({ error: "העוזר המשפטי לא הצליח לייצר תשובה מלאה. נסו שוב בעוד רגע." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let answer = parsed.answer || "";
    let footnotes: Array<{ number: number; citation: string; source_type: string; url?: string; source?: string }> = parsed.footnotes || [];

    console.log(`Parsed AI output: answer=${answer.length} chars, footnotes=${footnotes.length}`);

    // Guard against empty answer
    if (!answer || answer.length < 50) {
      console.error("AI returned empty/very short answer");
      return new Response(
        JSON.stringify({ error: "העוזר המשפטי לא הצליח לייצר תשובה מלאה. נסו שוב בעוד רגע." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Post-processing Step 1: Filter out blog/marketing footnotes ---
    footnotes = footnotes.filter((fn) => !isBlogUrl(fn.url));

    // --- Post-processing Step 2: Strip academic/professional titles from citations ---
    const titlePattern = /\b(פרופ['׳]|ד"ר|ד״ר|עו"ד|עו״ד|רו"ח|רו״ח|שופטת|שופט|המנוחה|המנוח|ז"ל|ז״ל)\s*/g;
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(titlePattern, "").replace(/\s{2,}/g, " ").trim();
    }

    // --- Post-processing Step 3: Remove [missing:...] and [חסר:...] placeholders ---
    const placeholderPattern = /\[missing:[^\]]*\]|\[חסר:[^\]]*\]|\[פרט חסר[^\]]*\]/g;
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(placeholderPattern, "").trim();
      // Clean orphaned trailing "עמ'" or ", עמ'" left behind
      fn.citation = fn.citation.replace(/,?\s*עמ['׳]?\s*$/, "").trim();
    }

    // --- Post-processing Step 4: Filter truncated/empty footnotes ---
    footnotes = footnotes.filter((fn) => fn.citation.trim().length >= 10);

    // --- Post-processing Step 5: Universal sequential renumbering ---
    {
      // Remove superscripts for any footnotes that were filtered out
      const survivingOldNumbers = new Set(footnotes.map((fn) => fn.number));
      const allOldNumbers = (parsed.footnotes || []).map((fn: any) => fn.number as number);
      for (const oldNum of allOldNumbers) {
        if (!survivingOldNumbers.has(oldNum)) {
          answer = answer.replaceAll(toSuperscript(oldNum), "");
        }
      }

      // Renumber all surviving footnotes sequentially
      const oldToNew = new Map<number, number>();
      footnotes.forEach((fn, idx) => {
        oldToNew.set(fn.number, idx + 1);
      });

      // Use placeholders to avoid collisions
      for (const [oldNum, newNum] of oldToNew) {
        if (oldNum !== newNum) {
          answer = answer.replaceAll(toSuperscript(oldNum), `__FN_PLACEHOLDER_${newNum}__`);
        }
      }
      for (const [, newNum] of oldToNew) {
        answer = answer.replaceAll(`__FN_PLACEHOLDER_${newNum}__`, toSuperscript(newNum));
      }
      footnotes.forEach((fn, idx) => {
        fn.number = idx + 1;
      });
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

    // Log source provenance
    try {
      const localCount = footnotes.filter((f) => f.source === "local").length;
      const perplexityCount = footnotes.filter((f) => f.source === "perplexity").length;
      await adminClient.from("qa_logs").insert({
        user_id: user.id,
        question: question.substring(0, 500),
        local_footnotes_count: localCount,
        perplexity_footnotes_count: perplexityCount,
        total_footnotes: footnotes.length,
      });
    } catch (logErr) {
      console.error("Failed to log QA stats (non-fatal):", logErr);
    }

    return new Response(
      JSON.stringify({ answer, footnotes, source_urls: citations }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("legal-qa error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
