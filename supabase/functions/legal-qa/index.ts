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
      return `מצב עבודה: ניתוח כתב טענה. בנה לפי: **תקציר**, **מסגרת נורמטיבית**, **ניתוח מפורט**, **המלצות מעשיות**.`;
    case "case_summary":
      return `מצב עבודה: סיכום פסיקה. בנה לפי: **תקציר**, **מסגרת נורמטיבית**, **ניתוח מפורט**, **המלצות מעשיות**.`;
    case "argument_draft":
      return `מצב עבודה: ניסוח טיעון. בנה לפי: **תקציר**, **מסגרת נורמטיבית**, **ניתוח מפורט**, **המלצות מעשיות**.`;
    default:
      return `מצב עבודה: מחקר משפטי. בנה לפי: **תקציר**, **מסגרת נורמטיבית**, **ניתוח מפורט**, **המלצות מעשיות**.`;
  }
}

// ─── Fetch with timeout helper ───────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Truncate combined context to a max character budget ─────────────

const MAX_CONTEXT_CHARS = 6000;

function truncateContext(text: string): string {
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  return text.slice(0, MAX_CONTEXT_CHARS) + "\n[... קוצר מטעמי אורך ...]";
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
      documentContext = `\n=== מסמך שהועלה: ${documentName || "ללא שם"} ===\n${documentText.slice(0, 15000)}\n=== סוף המסמך ===\n`;
      console.log(`Document uploaded: ${documentName}, ${documentText.length} chars`);
    }

    // ========= Step 1: Local search + Perplexity IN PARALLEL =========
    const localSearchPromise = (async (): Promise<{ matches: LocalMatch[]; used: boolean }> => {
      try {
        const { data: textMatches, error: textError } = await adminClient.rpc("search_legal_chunks_text", {
          search_query: question,
          match_count: 5,
        });
        if (!textError && textMatches && textMatches.length > 0) {
          console.log(`Text search: found ${textMatches.length} matching chunks`);
          return { matches: textMatches, used: true };
        }
      } catch (err) {
        console.error("Text search failed (non-fatal):", err);
      }
      return { matches: [], used: false };
    })();

    const perplexityPromise = (async (): Promise<{ content: string; citations: string[] }> => {
      try {
        const res = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar-pro",
            search_domain_filter: [
              "nevo.co.il", "supreme.court.gov.il",
              "knesset.gov.il", "psakdin.co.il",
              "huji.ac.il", "tau.ac.il",
            ],
            messages: [
              {
                role: "system",
                content: `Israeli law research assistant. Find PRIMARY legal sources only: statutes with ס"ח/ק"ת page numbers, court decisions with exact case numbers, academic books/articles. No blogs or law firm sites.`,
              },
              { role: "user", content: question },
            ],
          }),
        }, 15000); // 15s timeout

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || "";
          const cits = data.citations || [];
          console.log(`Perplexity returned ${cits.length} citations`);
          return { content, citations: cits };
        } else {
          const errText = await res.text();
          console.error("Perplexity error (non-fatal):", res.status, errText);
        }
      } catch (err) {
        console.error("Perplexity call failed (non-fatal):", err);
      }
      return { content: "", citations: [] };
    })();

    // Await both in parallel
    const [localResult, perplexityResult] = await Promise.all([localSearchPromise, perplexityPromise]);

    const localMatches = localResult.matches;
    const usedLocalSearch = localResult.used;
    const searchResults = perplexityResult.content;
    const citations = perplexityResult.citations;

    // If ALL sources failed and no document, we can't produce anything useful
    if (!usedLocalSearch && !searchResults && !hasDocument) {
      return new Response(
        JSON.stringify({ error: "לא נמצאו מקורות רלוונטיים. נסו לנסח את השאלה אחרת." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========= Step 2: Build combined context (trimmed) =========
    const contextParts: string[] = [];

    if (hasDocument) {
      contextParts.push(documentContext);
    }

    if (usedLocalSearch && localMatches.length > 0) {
      const seenDocs = new Set<string>();
      let localContext = "\n=== מקורות מאומתים ===\n";
      for (const m of localMatches) {
        if (m.source_type === "notebook") continue;
        if (!seenDocs.has(m.document_id)) {
          seenDocs.add(m.document_id);
          localContext += `\n--- ${m.document_title} ---\nסוג: ${m.source_type} | אזכור: ${m.document_citation}\n`;
          if (m.source_url) localContext += `קישור: ${m.source_url}\n`;
        }
        localContext += `${m.chunk_content.slice(0, 800)}\n`;
      }
      contextParts.push(localContext);
    }

    if (searchResults) {
      contextParts.push("\n=== מקורות מחיפוש ===\n" + searchResults.slice(0, 3000));
      if (citations.length > 0) {
        contextParts.push(citations.slice(0, 8).map((c, i) => `[${i + 1}] ${c}`).join("\n"));
      }
    }

    const combinedContext = truncateContext(contextParts.join("\n"));

    // ========= Step 3: Gemini call (Flash for speed) =========
    const taskInstructions = getTaskModeInstructions(taskMode);
    const citationInstructions = buildCitationInstructions();

    const systemPrompt = `אתה עוזר משפטי מומחה. כתוב חוות דעת משפטית מקצועית בעברית.
${taskInstructions}

כללי כתיבה:
- אורך: 800-1500 מילים. כל חלק חייב להיות מהותי.
- השתמש בכותרות מודגשות: **תקציר**, **מסגרת נורמטיבית**, **ניתוח מפורט**, **המלצות מעשיות**.
- כל הערת שוליים חייבת להופיע כסופרסקריפט יוניקוד (⁰¹²³⁴⁵⁶⁷⁸⁹) בסוף משפט.
- לכל משפט לכל היותר הערה אחת. העדף 8-12 הערות איכותיות.
- אל תמציא מקורות. כל הערה מבוססת על המקורות שלהלן.
- מספור רציף: 1, 2, 3...
- source: "local" למאגר מאומת, "perplexity" לחיפוש${hasDocument ? ', "document" למסמך' : ''}.

${citationInstructions}

מקורות:
${combinedContext}`;

    const aiBody = JSON.stringify({
      model: "google/gemini-2.5-flash",
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
            description: "Format a structured legal memo with footnotes.",
            parameters: {
              type: "object",
              properties: {
                answer: {
                  type: "string",
                  description: "Full Hebrew legal memo with section headings and superscript footnote numbers.",
                },
                footnotes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      number: { type: "number" },
                      citation: { type: "string" },
                      source_type: { type: "string", enum: ["legislation", "caselaw", "book", "article", "international", "document"] },
                      url: { type: "string" },
                      source: { type: "string", enum: ["local", "perplexity", "document"] },
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
      tool_choice: { type: "function", function: { name: "format_legal_answer" } },
    });

    let parsed: any = null;
    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`AI attempt ${attempt}/${MAX_RETRIES}...`);

      try {
        const aiRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: aiBody,
        }, 40000); // 40s timeout

        if (!aiRes.ok) {
          if (aiRes.status === 429) {
            return new Response(
              JSON.stringify({ error: "יותר מדי בקשות. נסו שוב בעוד דקה." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          if (aiRes.status === 402) {
            return new Response(
              JSON.stringify({ error: "נגמרו הקרדיטים. יש להוסיף קרדיטים בהגדרות." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          const errText = await aiRes.text();
          console.error(`AI gateway error (attempt ${attempt}):`, aiRes.status, errText);
          if (attempt < MAX_RETRIES) continue;
          return new Response(
            JSON.stringify({ error: "שגיאה בשירות ה-AI. נסו שוב בעוד רגע." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const aiData = await aiRes.json();
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        const finishReason = aiData.choices?.[0]?.finish_reason || "unknown";
        console.log(`AI response (attempt ${attempt}): tool_calls=${toolCall ? "yes" : "no"}, finish_reason=${finishReason}`);

        if (!toolCall?.function?.arguments) {
          const content = aiData.choices?.[0]?.message?.content || "";
          if (content && content.length >= 50) {
            parsed = { answer: content, footnotes: [] };
            break;
          }
          console.error(`No usable response (attempt ${attempt}), content length: ${content.length}`);
          if (attempt < MAX_RETRIES) continue;
          return new Response(
            JSON.stringify({ error: "העוזר המשפטי לא הצליח לייצר תשובה. נסו שוב." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        try {
          parsed = JSON.parse(toolCall.function.arguments);
        } catch {
          console.error(`Failed to parse tool call (attempt ${attempt})`);
          if (attempt < MAX_RETRIES) continue;
          return new Response(
            JSON.stringify({ error: "העוזר המשפטי לא הצליח לייצר תשובה. נסו שוב." }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (parsed.answer && parsed.answer.length >= 50) break;
        console.error(`Answer too short (attempt ${attempt}): ${parsed.answer?.length || 0} chars`);
        if (attempt < MAX_RETRIES) { parsed = null; continue; }
        return new Response(
          JSON.stringify({ error: "העוזר המשפטי לא הצליח לייצר תשובה מלאה. נסו שוב." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error(`AI call error (attempt ${attempt}):`, err);
        if (attempt < MAX_RETRIES) continue;
        return new Response(
          JSON.stringify({ error: "תם הזמן לעיבוד השאלה. נסו שוב או קצרו את השאלה." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let answer = parsed.answer || "";
    let footnotes: Array<{ number: number; citation: string; source_type: string; url?: string; source?: string }> = parsed.footnotes || [];

    console.log(`Final: answer=${answer.length} chars, footnotes=${footnotes.length}`);

    // --- Post-processing: Filter blog footnotes ---
    footnotes = footnotes.filter((fn) => !isBlogUrl(fn.url));

    // --- Post-processing: Strip titles ---
    const titlePattern = /\b(פרופ['׳]|ד"ר|ד״ר|עו"ד|עו״ד|רו"ח|רו״ח|שופטת|שופט|המנוחה|המנוח|ז"ל|ז״ל)\s*/g;
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(titlePattern, "").replace(/\s{2,}/g, " ").trim();
    }

    // --- Post-processing: Remove placeholders ---
    const placeholderPattern = /\[missing:[^\]]*\]|\[חסר:[^\]]*\]|\[פרט חסר[^\]]*\]/g;
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(placeholderPattern, "").trim();
      fn.citation = fn.citation.replace(/,?\s*עמ['׳]?\s*$/, "").trim();
    }

    // --- Post-processing: Filter short footnotes ---
    footnotes = footnotes.filter((fn) => fn.citation.trim().length >= 10);

    // --- Post-processing: Renumber ---
    {
      const survivingOldNumbers = new Set(footnotes.map((fn) => fn.number));
      const allOldNumbers = (parsed.footnotes || []).map((fn: any) => fn.number as number);
      for (const oldNum of allOldNumbers) {
        if (!survivingOldNumbers.has(oldNum)) {
          answer = answer.replaceAll(toSuperscript(oldNum), "");
        }
      }
      const oldToNew = new Map<number, number>();
      footnotes.forEach((fn, idx) => { oldToNew.set(fn.number, idx + 1); });
      for (const [oldNum, newNum] of oldToNew) {
        if (oldNum !== newNum) {
          answer = answer.replaceAll(toSuperscript(oldNum), `__FN_${newNum}__`);
        }
      }
      for (const [, newNum] of oldToNew) {
        answer = answer.replaceAll(`__FN_${newNum}__`, toSuperscript(newNum));
      }
      footnotes.forEach((fn, idx) => { fn.number = idx + 1; });
    }

    // --- Convert bracket patterns to superscript ---
    answer = answer.replace(/\[(\d{1,2})\]/g, (_: string, num: string) => toSuperscript(parseInt(num, 10)));
    answer = answer.replace(/\((\d{1,2})\)(?=[^\dא-ת]|$)/g, (_: string, num: string) => toSuperscript(parseInt(num, 10)));

    // --- De-cluster adjacent superscripts ---
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
              if (superscriptChars.has(result[j])) prevSupChars.unshift(result[j]);
              else break;
            }
            prevSupChars.push(ch);
            const superscriptToDigit: Record<string, string> = {};
            for (const [d, s] of Object.entries(digitToSuperscript)) superscriptToDigit[s] = d;
            const numStr = prevSupChars.map((c) => superscriptToDigit[c] || "").join("");
            const num = parseInt(numStr, 10);
            const maxFn = footnotes.length > 0 ? Math.max(...footnotes.map((f) => f.number)) : 20;
            if (num <= maxFn) result += ch;
          }
        } else {
          inSuperscriptRun = false;
          result += ch;
        }
      }
      return result;
    });
    answer = processedLines.join("\n");

    // --- Inject missing superscripts ---
    for (const fn of footnotes) {
      const sup = toSuperscript(fn.number);
      if (!answer.includes(sup)) {
        const periodRegex = /([.。])([\s\n]|$)/g;
        let match;
        let count = 0;
        let insertPos = -1;
        while ((match = periodRegex.exec(answer)) !== null) {
          count++;
          if (count === fn.number) { insertPos = match.index + match[1].length; break; }
        }
        if (insertPos > 0) {
          answer = answer.slice(0, insertPos) + sup + answer.slice(insertPos);
        } else {
          const lastPeriod = answer.lastIndexOf(".");
          if (lastPeriod > 0) answer = answer.slice(0, lastPeriod + 1) + sup + answer.slice(lastPeriod + 1);
        }
      }
    }

    // Log
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
      JSON.stringify({ error: "שגיאה בעיבוד השאלה. נסו שוב." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
