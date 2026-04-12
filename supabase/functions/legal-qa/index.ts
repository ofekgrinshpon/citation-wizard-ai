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

// ─── Source card: server-built, numbered list of sources for the AI ───
interface SourceCard {
  id: number;
  citation: string;
  source_type: string;
  url?: string;
  provenance: "local" | "perplexity" | "document";
  excerpt: string;
}

// ─── Task mode → system prompt instructions ──────────────────────────

function getTaskModeInstructions(taskMode?: string): string {
  switch (taskMode) {
    case "pleading_analysis":
      return `מצב עבודה: ניתוח כתב טענה.
בנה את חוות הדעת לפי המבנה הבא:
**סיכום כתב הטענה** – תמצית קצרה של המסמך המנותח.
**חולשות משפטיות** – טענות חלשות, חסרות בסיס נורמטיבי או פסיקתי, טענות שאינן נתמכות בראיות.
**סתירות ואי-דיוקים** – סתירות פנימיות בין חלקי כתב הטענה, אי-דיוקים עובדתיים או משפטיים.
**אזכורים חסרים או שגויים** – מקורות שצוטטו באופן שגוי, אזכורים חסרים שהיו מחזקים את הטענה.
**המלצות לתיקון** – הצעות קונקרטיות לשיפור כתב הטענה.`;
    case "case_summary":
      return `מצב עבודה: סיכום פסיקה.
בנה את הסיכום לפי המבנה הבא:
**עובדות המקרה** – רקע עובדתי תמציתי.
**השאלה המשפטית** – הסוגיה המרכזית שנדונה.
**ההכרעה** – מה פסק בית המשפט.
**הרציו (Ratio Decidendi)** – הנימוק המשפטי המרכזי שביסוד ההכרעה.
**השלכות** – משמעות פסק הדין לדין הקיים ולתיקים דומים.`;
    case "argument_draft":
      return `מצב עבודה: ניסוח טיעון משפטי.
בנה את הטיעון לפי המבנה הבא:
**תמצית הטיעון** – טענה מרכזית ברורה במשפט אחד או שניים.
**בסיס נורמטיבי** – חקיקה ופסיקה התומכות בטיעון.
**ניתוח ופיתוח הטיעון** – פירוט הטענה, יישום הדין על העובדות, היקש מפסיקה.
**מענה לטענות צפויות** – ציפייה לטענות הנגד ודחייתן.
**סיכום** – חזרה על הטענה המרכזית ומסקנה.`;
    default:
      return `מצב עבודה: מחקר משפטי.
בנה את חוות הדעת לפי המבנה הבא:
**תקציר** – סקירה קצרה של הסוגיה והמסקנות.
**מסגרת נורמטיבית** – חקיקה ופסיקה רלוונטיים (IRAC).
**ניתוח מפורט** – יישום הדין על העובדות, ניתוח פסיקה, השוואה.
**המלצות מעשיות** – צעדים מומלצים בהתבסס על הניתוח.`;
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

    const t0 = Date.now();

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
          match_count: 10,
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
        }, 15000);

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

    const [localResult, perplexityResult] = await Promise.all([localSearchPromise, perplexityPromise]);

    const localMatches = localResult.matches;
    const usedLocalSearch = localResult.used;
    const searchResults = perplexityResult.content;
    const citations = perplexityResult.citations;

    const tRetrieval = Date.now();
    console.log(`Retrieval took ${tRetrieval - t0}ms`);

    if (!usedLocalSearch && !searchResults && !hasDocument) {
      return new Response(
        JSON.stringify({ error: "לא נמצאו מקורות רלוונטיים. נסו לנסח את השאלה אחרת." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========= Step 2: Build source cards (server-side) =========
    const sourceCards: SourceCard[] = [];
    let cardId = 1;

    // Local sources — build rich citations from structured fields
    if (usedLocalSearch && localMatches.length > 0) {
      const seenDocs = new Set<string>();
      for (const m of localMatches) {
        if (seenDocs.has(m.document_id)) continue;
        seenDocs.add(m.document_id);
        if (isBlogUrl(m.source_url || undefined)) continue;

        // Build a richer citation from structured metadata
        let richCitation = m.document_citation;
        const meta = (m.metadata || {}) as Record<string, unknown>;

        if (m.source_type === "caselaw") {
          // For case law: use case_number, court, decision_date, title
          const caseNumber = (meta.case_number as string) || "";
          const court = (meta.court as string) || "";
          const decisionDate = (meta.decision_date as string) || "";
          if (caseNumber) {
            richCitation = `${caseNumber} ${m.document_title}`;
            if (court) richCitation += ` (${court}`;
            if (decisionDate) richCitation += `, ${decisionDate}`;
            if (court) richCitation += ")";
          }
        } else if (m.source_type === "knesset_research") {
          // For knesset research / law journal: use title as-is, it's usually well-formatted
          richCitation = m.document_title || m.document_citation;
        }

        const sourceLabel = m.source_type === "caselaw" ? "פסיקה" :
          m.source_type === "knesset_research" ? "מחקר כנסת / חקיקה" : m.source_type;

        sourceCards.push({
          id: cardId++,
          citation: richCitation,
          source_type: sourceLabel,
          url: m.source_url || undefined,
          provenance: "local",
          excerpt: m.chunk_content.slice(0, 400),
        });
      }
    }

    // Perplexity sources — extract from citations array
    if (citations.length > 0) {
      for (const citUrl of citations.slice(0, 8)) {
        if (isBlogUrl(citUrl)) continue;
        sourceCards.push({
          id: cardId++,
          citation: citUrl, // URL as citation — AI will improve in its answer
          source_type: "web",
          url: citUrl,
          provenance: "perplexity",
          excerpt: "",
        });
      }
    }

    // Document source
    if (hasDocument) {
      sourceCards.push({
        id: cardId++,
        citation: documentName || "מסמך שהועלה",
        source_type: "document",
        provenance: "document",
        excerpt: documentText.slice(0, 300),
      });
    }

    // ========= Step 3: Build context for AI (without forcing tool_call) =========
    const contextParts: string[] = [];

    if (hasDocument) {
      contextParts.push(documentContext);
    }

    if (usedLocalSearch && localMatches.length > 0) {
      const seenDocs = new Set<string>();
      let localContext = "\n=== מקורות מאומתים מהמאגר המשפטי ===\n";
      for (const m of localMatches) {
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
    }

    const combinedContext = truncateContext(contextParts.join("\n"));

    // Build source catalog string for the AI — tag local sources as [מאומת]
    const sourceCatalog = sourceCards.map(
      (sc) => {
        const tag = sc.provenance === "local" ? " [מאומת]" : "";
        return `[${sc.id}]${tag} ${sc.citation}${sc.url ? ` (${sc.url})` : ""} — ${sc.source_type}`;
      }
    ).join("\n");

    // ========= Step 4: Gemini call — plain text, NO tool_call =========
    const taskInstructions = getTaskModeInstructions(taskMode);
    const citationInstructions = buildCitationInstructions();

    const systemPrompt = `אתה עוזר משפטי מומחה. כתוב חוות דעת משפטית מקצועית בעברית.
${taskInstructions}

כללי כתיבה:
- אורך: 800-1500 מילים. כל חלק חייב להיות מהותי.
- אל תשתמש בסימני # לכותרות. השתמש ב-**כותרת** (הדגשה) בלבד.
- השתמש בכותרות המודגשות שמפורטות במצב העבודה למעלה. אל תשתמש בכותרות אחרות.
- הפנה למקורות באמצעות סימון [X] בסוף משפט, כאשר X הוא מספר המקור מרשימת המקורות למטה.
- העדף 8-12 הפניות איכותיות. אל תמציא מקורות. השתמש רק במקורות מהרשימה.
- אתה יכול גם לכתוב אזכורים נוספים שאינם ברשימה, אם אתה בטוח לחלוטין שהם קיימים. סמן אותם כ-[NEW:אזכור מלא לפי כללי האזכור].

כלל חשוב – עדיפות מקורות:
מקורות המסומנים [מאומת] הם מקורות שנמצאים במאגר המשפטי המקומי ועברו אימות.
תעדיף תמיד לצטט מקורות מאומתים על פני מקורות מהאינטרנט.
השתמש במקורות אינטרנט רק כהשלמה למקורות מאומתים, לא כתחליף.
אם יש מקורות מאומתים רלוונטיים, לפחות 60% מההפניות חייבות להיות מקורות מאומתים.

${citationInstructions}

רשימת מקורות זמינים:
${sourceCatalog}

הקשר מהמקורות:
${combinedContext}`;

    const promptLen = systemPrompt.length;
    console.log(`Prompt length: ${promptLen} chars, ${sourceCards.length} source cards`);

    const aiBody = JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `השאלה המשפטית: ${question}` },
      ],
    });

    console.log("AI call starting (90s timeout, no tool_call)...");
    let answerText = "";
    try {
      const aiRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: aiBody,
      }, 90000); // 90s — no tool_call overhead, plenty of time

      const tAi = Date.now();
      console.log(`AI call took ${tAi - tRetrieval}ms`);

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
        console.error("AI gateway error:", aiRes.status, errText);
        return new Response(
          JSON.stringify({ error: "שגיאה בשירות ה-AI. נסו שוב בעוד רגע." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const aiData = await aiRes.json();
      answerText = aiData.choices?.[0]?.message?.content || "";
      const finishReason = aiData.choices?.[0]?.finish_reason || "unknown";
      console.log(`AI response: ${answerText.length} chars, finish_reason=${finishReason}`);

      if (!answerText || answerText.length < 50) {
        return new Response(
          JSON.stringify({ error: "העוזר המשפטי לא הצליח לייצר תשובה. נסו שוב." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch (err) {
      console.error("AI call error:", err);
      return new Response(
        JSON.stringify({ error: "תם הזמן לעיבוד השאלה. נסו שוב או קצרו את השאלה." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========= Step 5: Build footnotes deterministically on server =========
    // Find all [X] references in the answer
    const usedSourceIds = new Set<number>();
    const newCitations: Array<{ citation: string; source_type: string }> = [];

    // Match [X] patterns (source references)
    const refPattern = /\[(\d{1,2})\]/g;
    let refMatch;
    while ((refMatch = refPattern.exec(answerText)) !== null) {
      usedSourceIds.add(parseInt(refMatch[1], 10));
    }

    // Match [NEW:...] patterns (AI-generated new citations)
    const newRefPattern = /\[NEW:([^\]]+)\]/g;
    let newMatch;
    while ((newMatch = newRefPattern.exec(answerText)) !== null) {
      newCitations.push({ citation: newMatch[1].trim(), source_type: "unknown" });
    }

    // Build footnotes array from source cards
    const footnotes: Array<{ number: number; citation: string; source_type: string; url?: string; source?: string }> = [];
    const oldIdToNewNumber = new Map<number, number>();
    let fnNum = 1;

    for (const srcId of Array.from(usedSourceIds).sort((a, b) => a - b)) {
      const card = sourceCards.find((sc) => sc.id === srcId);
      if (!card) continue;
      oldIdToNewNumber.set(srcId, fnNum);
      footnotes.push({
        number: fnNum,
        citation: card.citation,
        source_type: card.source_type,
        url: card.url,
        source: card.provenance,
      });
      fnNum++;
    }

    // Add new AI-generated citations
    for (const nc of newCitations) {
      footnotes.push({
        number: fnNum,
        citation: nc.citation,
        source_type: nc.source_type,
        source: "perplexity", // treat as web-discovered
      });
      fnNum++;
    }

    // ========= Step 6: Replace [X] markers with superscripts =========
    let answer = answerText;

    // Replace [X] with superscript, remapping to new numbers
    answer = answer.replace(/\[(\d{1,2})\]/g, (_: string, num: string) => {
      const oldId = parseInt(num, 10);
      const newNum = oldIdToNewNumber.get(oldId);
      if (newNum) return toSuperscript(newNum);
      return ""; // source not found, remove reference
    });

    // Replace [NEW:...] with superscript numbers
    let newIdx = footnotes.length - newCitations.length + 1;
    answer = answer.replace(/\[NEW:[^\]]+\]/g, () => {
      return toSuperscript(newIdx++);
    });

    // ========= Step 7: Post-processing =========
    // Strip titles from citations
    const titlePattern = /\b(פרופ['׳]|ד"ר|ד״ר|עו"ד|עו״ד|רו"ח|רו״ח|שופטת|שופט|המנוחה|המנוח|ז"ל|ז״ל)\s*/g;
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(titlePattern, "").replace(/\s{2,}/g, " ").trim();
    }

    // Remove placeholders
    const placeholderPattern = /\[missing:[^\]]*\]|\[חסר:[^\]]*\]|\[פרט חסר[^\]]*\]/g;
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(placeholderPattern, "").trim();
      fn.citation = fn.citation.replace(/,?\s*עמ['׳]?\s*$/, "").trim();
    }

    // Ensure trailing period on every citation
    for (const fn of footnotes) {
      if (fn.citation && !/[.。]$/.test(fn.citation.trim())) {
        fn.citation = fn.citation.trim() + ".";
      }
    }

    // Filter short footnotes and renumber
    const validFootnotes = footnotes.filter((fn) => fn.citation.trim().length >= 10);
    if (validFootnotes.length !== footnotes.length) {
      // Need to renumber
      const removedNumbers = new Set(
        footnotes.filter((fn) => fn.citation.trim().length < 10).map((fn) => fn.number)
      );
      for (const num of removedNumbers) {
        answer = answer.replaceAll(toSuperscript(num), "");
      }
      validFootnotes.forEach((fn, idx) => {
        const oldSup = toSuperscript(fn.number);
        const newNum = idx + 1;
        if (fn.number !== newNum) {
          answer = answer.replaceAll(oldSup, `__FN_${newNum}__`);
        }
        fn.number = newNum;
      });
      for (const fn of validFootnotes) {
        answer = answer.replaceAll(`__FN_${fn.number}__`, toSuperscript(fn.number));
      }
    }

    const finalFootnotes = validFootnotes;

    console.log(`Final: answer=${answer.length} chars, footnotes=${finalFootnotes.length}, total time=${Date.now() - t0}ms`);

    // Log
    try {
      const localCount = finalFootnotes.filter((f) => f.source === "local").length;
      const perplexityCount = finalFootnotes.filter((f) => f.source === "perplexity").length;
      await adminClient.from("qa_logs").insert({
        user_id: user.id,
        question: question.substring(0, 500),
        local_footnotes_count: localCount,
        perplexity_footnotes_count: perplexityCount,
        total_footnotes: finalFootnotes.length,
      });
    } catch (logErr) {
      console.error("Failed to log QA stats (non-fatal):", logErr);
    }

    return new Response(
      JSON.stringify({ answer, footnotes: finalFootnotes, source_urls: citations }),
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
