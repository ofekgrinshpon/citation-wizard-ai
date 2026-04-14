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

/**
 * Fix bare Hebrew years (e.g. תשס"ב) by prepending ה' → התשס"ב.
 */
function fixHebrewYearPrefix(text: string): string {
  return text.replace(/(?<!ה)(תש[א-ת]["״\u05F4][א-ת])/g, "ה$1");
}

/**
 * Rule 24.9.2: When both Hebrew and Gregorian years appear in parentheses,
 * keep only the Gregorian year.
 */
function normalizeArticleYearByRule2492(text: string): string {
  const hebrewYearPattern = `ה?ת(?:ש|רש)[א-ת]["״׳'\\u05F4][א-ת]["״׳'\\u05F4]?[א-ת]?`;
  const gregorianYearPattern = `\\d{4}`;
  const separator = `[–\\-,\\s]+`;

  const pattern1 = new RegExp(
    `\\(\\s*${hebrewYearPattern}${separator}(${gregorianYearPattern})\\s*\\)`,
    "g"
  );
  text = text.replace(pattern1, "($1)");

  const pattern2 = new RegExp(
    `\\(\\s*(${gregorianYearPattern})${separator}${hebrewYearPattern}\\s*\\)`,
    "g"
  );
  text = text.replace(pattern2, "($1)");

  return text;
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

// ─── Hebrew stop words for keyword extraction ───
const HEBREW_STOP_WORDS = new Set([
  "האם","יכול","יכולה","יכולים","את","של","על","כי","זה","הם","אם","לא","גם","כל","עם",
  "היא","הוא","אין","מה","איך","כאשר","כדי","בין","אלא","רק","עוד","אשר","היה","יש",
  "אך","אף","כך","לפי","בו","בה","או","אל","כן","פי","שלא","שהיא","שהוא","שלו","שלה",
  "אותו","אותה","הזה","הזאת","לפני","אחרי","תחת","מול","ליד","היו","היתה","להיות",
  "כלומר","לכן","אולם","למרות","מאחר","הרי","כבר","עדיין","בכל","ואם","שאם","מאוד",
  "ביותר","כמו","למשל","אלה","אלו","זאת","הנ","אינו","אינה","אינם","מי","כיצד",
  "מדוע","האם","שם","כאן","שוב","תמיד","לעולם","בעוד","משום","הן","והם","והיא",
  "שהם","ולא","אבל","אותם","אותן","עליו","עליה","עליהם","ממנו","ממנה","בהם","בהן",
  "להם","להן","אני","אנחנו","הוא","היא","אתה","את","הם","הן",
]);

function extractKeywords(question: string): string {
  const words = question
    .replace(/[?!.,;:"״׳']/g, "")
    .split(/\s+/)
    .filter(w => w.length > 1 && !HEBREW_STOP_WORDS.has(w));
  
  // Take up to 6 most meaningful keywords
  return words.slice(0, 6).join(" ");
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
        // Extract keywords (strip stop words) for better OR-based matching
        const keywords = extractKeywords(question);
        console.log(`Search keywords: "${keywords}" (from: "${question.slice(0, 80)}")`);
        
        const { data: textMatches, error: textError } = await adminClient.rpc("search_legal_chunks_text", {
          search_query: keywords,
          match_count: 10,
        });
        if (!textError && textMatches && textMatches.length > 0) {
          console.log(`Text search: found ${textMatches.length} matching chunks`);
          return { matches: textMatches, used: true };
        }
        console.log(`Text search: 0 results for keywords "${keywords}"`);
        
        // Fallback: try with fewer keywords (top 3)
        if (keywords.split(" ").length > 3) {
          const fewerKeywords = keywords.split(" ").slice(0, 3).join(" ");
          console.log(`Retry with fewer keywords: "${fewerKeywords}"`);
          const { data: retryMatches, error: retryError } = await adminClient.rpc("search_legal_chunks_text", {
            search_query: fewerKeywords,
            match_count: 10,
          });
          if (!retryError && retryMatches && retryMatches.length > 0) {
            console.log(`Retry search: found ${retryMatches.length} matching chunks`);
            return { matches: retryMatches, used: true };
          }
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
          // For knesset research: use title as-is
          richCitation = m.document_title || m.document_citation;
        } else if (m.source_type === "journal_article") {
          // For journal articles: build academic citation from metadata
          const author = (meta.author as string) || "";
          const journal = (meta.journal as string) || "משפטים";
          const vol = (meta.volume as string) || "";
          if (author) {
            richCitation = `${author} "${m.document_title}" ${journal}`;
            if (vol) richCitation += ` ${vol}`;
          } else {
            richCitation = m.document_title || m.document_citation;
          }
        }

        const sourceLabel = m.source_type === "caselaw" ? "פסיקה" :
          m.source_type === "knesset_research" ? "מחקר כנסת / חקיקה" :
          m.source_type === "journal_article" ? "מאמר אקדמי" : m.source_type;

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

    const localCount = sourceCards.filter(sc => sc.provenance === "local").length;
    const perplexityCount = sourceCards.filter(sc => sc.provenance === "perplexity").length;
    const docCount = sourceCards.filter(sc => sc.provenance === "document").length;
    console.log(`Source cards: ${localCount} local, ${perplexityCount} perplexity, ${docCount} document`);

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
          const typeLabel = m.source_type === "caselaw" ? "פסיקה" :
            m.source_type === "knesset_research" ? "מחקר כנסת" :
            m.source_type === "journal_article" ? "מאמר אקדמי" : m.source_type;
          localContext += `\n--- ${m.document_title} ---\nסוג מקור: ${typeLabel} | אזכור: ${m.document_citation}\n`;
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
- טון: פורמלי, אובייקטיבי ואנליטי. כל טענה משפטית חייבת להיות מעוגנת בהערת שוליים.
- העדף 8-12 הפניות איכותיות. אל תמציא מקורות. השתמש רק במקורות מהרשימה.
- אתה יכול גם לכתוב אזכורים נוספים שאינם ברשימה, אם אתה בטוח לחלוטין שהם קיימים. כתוב אותם ישירות בחלק הערות השוליים בדיוק כמו כל הערה אחרת, ללא סימון מיוחד.

כלל קריטי – גוף טקסט נקי:
- בגוף הטקסט, אין לציין שנים (עבריות או לועזיות), מספרי ס"ח/ק"ת, או כל פרט טכני של מקור.
  נכון: "חוק העונשין אוסר על..."
  לא נכון: "חוק העונשין, התשל"ז-1977 אוסר על..."
- כל הפרטים הטכניים (שנה, מספר פרסום, כרך, עמוד) יופיעו אך ורק בהערות השוליים.

כלל קריטי – הפניות נרטיביות לפסיקה:
- בגוף הטקסט, אין להשתמש במספרי תיק (ע"א, בג"ץ, ת"א וכדומה). במקום זאת, השתמש בניסוח נרטיבי:
  נכון: "בעניין גת קבע בית המשפט העליון כי..."
  נכון: "בפרשת פלוני נקבע כי..."
  נכון: "כפי שקבע בית המשפט המחוזי..."
  נכון: "בהלכת מזרחי..."
  לא נכון: "בע"א 33/33 גת נ' מדינת ישראל נקבע..."
  לא נכון: "בבג"ץ 123/24 קבע בית המשפט..."
- בחר את השם המזוהה ביותר של בעל הדין לשימוש בפורמט "בעניין...".
- מספר התיק, שמות הצדדים המלאים, פרטי הפרסום – כל אלה יופיעו רק בהערת השוליים.
- כלל קריטי – התאמה בין גוף להערה: כאשר אתה מזכיר מקור בגוף הטקסט בשם נרטיבי (למשל "בעניין רוזנשטיין"), הערת השוליים המתאימה חייבת להכיל את אותו מקור בדיוק. אסור בשום מצב שהגוף יזכיר שם אחד (רוזנשטיין) וההערה תכיל תיק אחר (אלמקייס). אם אין לך את הפרטים הטכניים של המקור שאתה מזכיר — אל תזכיר אותו בגוף הטקסט.

כלל קריטי – אזכורים חוזרים (שם / לעיל):
- כאשר מקור כבר צוטט קודם:
  א. אם זו הערה זהה להערת השוליים הקודמת מיד: כתוב "שם." בלבד. אם יש עמוד שונה: "שם, בעמ' X."
  ב. אם המקור צוטט קודם אך לא בהערה הקודמת מיד: השתמש בשם קצר + "לעיל ה"ש X" (X = מספר ההערה הראשונה שבה הופיע).
     דוגמה: "פרוקצ'יה, לעיל ה"ש 2, בעמ' 45."
  ג. חקיקה חוזרת: השתמש בשם הקצר של החוק + הסעיף הרלוונטי, ללא אזכור מלא חוזר.
      דוגמה: "חוק העונשין, סעיף 3."

- כלל קריטי – שימוש נכון ב"לעיל ה"ש":
  * "לעיל ה"ש X" משמעותו: ראה את המקור שצוטט בהערת שוליים מספר X. הערה X חייבת להכיל את האזכור המלא של אותו מקור בדיוק.
  * אסור בשום מצב שהערה תפנה לעצמה (למשל הערה 7 לא יכולה לכתוב "לעיל ה"ש 7").
  * אסור שהערה תפנה להערה שמכילה מקור אחר לחלוטין. אם אינך בטוח מהו מספר ההערה הנכון — כתוב אזכור מלא במקום "לעיל".

כלל קריטי – סימון הפניות בגוף הטקסט:
- אל תשתמש בסימוני [X] בסוגריים מרובעים בגוף הטקסט.
- במקום זאת, מספר הערת השוליים בגוף הטקסט ייכתב כמספר עילי (superscript) בלבד.
- סימן ההפניה חייב לבוא תמיד אחרי סימן הפיסוק, לא לפניו.
  נכון: בעניין בן גביר,¹
  נכון: מערכת בתי המשפט.¹
  לא נכון: בעניין בן גביר¹,

כלל חשוב – עדיפות מקורות:
מקורות המסומנים [מאומת] הם מקורות שנמצאים במאגר המשפטי המקומי ועברו אימות.
תעדיף תמיד לצטט מקורות מאומתים על פני מקורות מהאינטרנט.
השתמש במקורות אינטרנט רק כהשלמה למקורות מאומתים, לא כתחליף.
אם יש מקורות מאומתים רלוונטיים, לפחות 60% מההפניות חייבות להיות מקורות מאומתים.

כלל קריטי – רלוונטיות מקורות:
- לפני שאתה מצטט מקור כלשהו, בדוק שהוא רלוונטי מהותית לשאלה המשפטית. התאמה במילות מפתח (למשל "ראש הממשלה") אינה מספיקה — המקור חייב לעסוק באותה סוגיה משפטית.
- אם מקור מהרשימה עוסק בנושא אחר לחלוטין (למשל: השאלה עוסקת בחנינה, והמקור עוסק במינויים), אל תצטט אותו כלל, גם אם הוא מסומן [מאומת].
- עדיף לצטט פחות מקורות רלוונטיים מאשר להוסיף מקורות שאינם קשורים לנושא.

${citationInstructions}

חשוב מאוד – הערות שוליים מעוצבות:
בסוף התשובה, הוסף חלק נפרד בדיוק בפורמט הזה:

--- הערות שוליים ---
1. [אזכור מעוצב לפי כללי האזכור האחיד]
2. [אזכור מעוצב לפי כללי האזכור האחיד]
...

כל הערת שוליים חייבת להיות מעוצבת לפי כללי האזכור האחיד שלמעלה.
אל תעתיק את הציטוט מרשימת המקורות כפי שהוא — עצב אותו מחדש לפי הכללים.
דוגמאות לעיצוב נכון:
- פסיקה מפורסמת: בג"ץ 5555/18 **חסון** נ' **כנסת ישראל**, פ"ד עג(4) 53 (2021).
- פסיקה במאגר: ע"א 1234/20 **פלוני** נ' **אלמוני** (פורסם בנבו, 15.3.2022).
- חקיקה: חוק-יסוד: הממשלה, ס"ח 150.
- מאמר: יואב דותן "ביקורת שיפוטית על חקיקה בישראל" **משפטים** כח 77 (1997).
- מחקר כנסת: שירות המחקר של הכנסת **מינוי ופיטורי היועץ המשפטי לממשלה – סקירה משווה** (2023).
- אזכור חוזר (שם): שם, בעמ' 85.
- אזכור חוזר (לעיל): פרוקצ'יה, לעיל ה"ש 2, בעמ' 45.

אל תציין כתובות URL בהערות השוליים, אלא אם המקור הוא אתר אינטרנט בלבד (כלל 34.2).
לכל מקור מקומי [מאומת] — עצב את ההפניה מהפרטים שסופקו (מספר תיק, שמות צדדים, ערכאה, תאריך) לפי כלל 18 (פסיקה) או הכלל המתאים.
לכל מקור אינטרנט — אם יש מספיק מידע ליצור אזכור מעוצב, עשה זאת. אם לא, ציין את הכתובת לפי כלל 34.2.

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

    // ========= Step 5: Parse AI footnotes section =========
    // The AI appends a footnotes header followed by numbered citations.
    // Try multiple separator patterns from strict to loose.
    const separatorPatterns = [
      /---\s*הערות שוליים\s*---/,          // strict: --- הערות שוליים ---
      /\*\*\s*הערות שוליים\s*\*\*/,        // bold: **הערות שוליים**
      /^#{1,3}\s*הערות שוליים/m,           // markdown heading: ## הערות שוליים
      /^הערות שוליים\s*:?\s*$/m,           // standalone line: הערות שוליים or הערות שוליים:
    ];

    let separatorMatch: RegExpMatchArray | null = null;
    for (const pattern of separatorPatterns) {
      separatorMatch = answerText.match(pattern);
      if (separatorMatch && separatorMatch.index !== undefined) {
        console.log(`Footnote separator matched pattern: ${pattern}`);
        break;
      }
    }

    let answerBody = answerText;
    const aiFootnoteLines: Array<{ num: number; text: string }> = [];

    if (separatorMatch && separatorMatch.index !== undefined) {
      answerBody = answerText.slice(0, separatorMatch.index).trim();
      const footnotesSection = answerText.slice(separatorMatch.index + separatorMatch[0].length);

      const linePattern = /^(\d{1,2})\.\s+(.+)$/gm;
      let lineMatch;
      while ((lineMatch = linePattern.exec(footnotesSection)) !== null) {
        aiFootnoteLines.push({
          num: parseInt(lineMatch[1], 10),
          text: lineMatch[2].trim(),
        });
      }
      console.log(`Parsed ${aiFootnoteLines.length} AI-formatted footnotes`);
    } else {
      // Final fallback: detect a trailing block of consecutive numbered lines (1. 2. 3. ...)
      const lines = answerText.split("\n");
      let firstFootnoteLine = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (/^\d{1,2}\.\s+.+/.test(lines[i].trim())) {
          firstFootnoteLine = i;
        } else if (firstFootnoteLine !== -1) {
          break; // stop when we hit a non-numbered line
        }
      }
      if (firstFootnoteLine !== -1 && firstFootnoteLine > 0) {
        // Verify the block starts with "1." to confirm it's footnotes
        const firstNum = lines[firstFootnoteLine].trim().match(/^(\d{1,2})\./);
        if (firstNum && parseInt(firstNum[1], 10) === 1) {
          answerBody = lines.slice(0, firstFootnoteLine).join("\n").trim();
          const footnoteBlock = lines.slice(firstFootnoteLine).join("\n");
          const linePattern = /^(\d{1,2})\.\s+(.+)$/gm;
          let lineMatch;
          while ((lineMatch = linePattern.exec(footnoteBlock)) !== null) {
            aiFootnoteLines.push({
              num: parseInt(lineMatch[1], 10),
              text: lineMatch[2].trim(),
            });
          }
          console.log(`Fallback: parsed ${aiFootnoteLines.length} trailing footnotes`);
        }
      }
      if (aiFootnoteLines.length === 0) {
        console.log("No footnote separator found — falling back to source card citations");
      }
    }

    // ========= Step 5b: Match AI footnotes to source cards for provenance =========
    function matchFootnoteToCard(fnText: string, cards: SourceCard[]): SourceCard | null {
      const fnLower = fnText.toLowerCase();
      // Try matching by case number
      const caseNumMatch = fnText.match(/(\d{2,5}\/\d{2,4})/);
      if (caseNumMatch) {
        const found = cards.find(c => c.citation.includes(caseNumMatch[1]));
        if (found) return found;
      }
      // Try matching by URL
      for (const card of cards) {
        if (card.url && fnLower.includes(card.url.replace(/https?:\/\//, "").slice(0, 30).toLowerCase())) {
          return card;
        }
      }
      // Try matching by keyword overlap (first 3 significant words of card citation)
      for (const card of cards) {
        const cardWords = card.citation.replace(/[^א-תa-zA-Z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2).slice(0, 3);
        if (cardWords.length >= 2) {
          const matchCount = cardWords.filter(w => fnLower.includes(w.toLowerCase())).length;
          if (matchCount >= 2) return card;
        }
      }
      return null;
    }

    // Build footnotes: prefer AI-formatted text, fall back to source card raw data
    const footnotes: Array<{ number: number; citation: string; source_type: string; url?: string; source?: string }> = [];
    const usedSourceIds = new Set<number>();
    const newCitations: Array<{ citation: string; source_type: string }> = [];

    // Collect [X] and [NEW:...] refs from body
    const refPattern = /\[(\d{1,2})\]/g;
    let refMatch;
    while ((refMatch = refPattern.exec(answerBody)) !== null) {
      usedSourceIds.add(parseInt(refMatch[1], 10));
    }
    const newRefPattern = /\[NEW:([^\]]+)\]/g;
    let newMatch;
    while ((newMatch = newRefPattern.exec(answerBody)) !== null) {
      newCitations.push({ citation: newMatch[1].trim(), source_type: "unknown" });
    }

    const oldIdToNewNumber = new Map<number, number>();
    let fnNum = 1;

    if (aiFootnoteLines.length > 0) {
      // Use AI-formatted footnotes — match each to a source card for provenance
      for (const aiFn of aiFootnoteLines) {
        const matchedCard = matchFootnoteToCard(aiFn.text, sourceCards);
        footnotes.push({
          number: fnNum,
          citation: aiFn.text,
          source_type: matchedCard?.source_type || "unknown",
          url: matchedCard?.url,
          source: matchedCard?.provenance || "perplexity",
        });
        // Map original [X] number to new sequential number
        oldIdToNewNumber.set(aiFn.num, fnNum);
        fnNum++;
      }
    } else {
      // Fallback: use source card citations (old behavior)
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
          source: "perplexity",
        });
        fnNum++;
      }
    }

    // ========= Step 6: Replace [X] markers with superscripts =========
    let answer = answerBody;

    answer = answer.replace(/\[(\d{1,2})\]/g, (_: string, num: string) => {
      const oldId = parseInt(num, 10);
      const newNum = oldIdToNewNumber.get(oldId);
      if (newNum) return toSuperscript(newNum);
      return "";
    });

    let newIdx = footnotes.length - newCitations.length + 1;
    answer = answer.replace(/\[NEW:[^\]]+\]/g, () => {
      return toSuperscript(newIdx++);
    });

    // ========= Step 6b: Reorder footnotes by first appearance in body =========
    const superscriptPattern = /[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+/g;
    const superscriptToNum = (s: string) => {
      const reverseMap: Record<string, string> = {};
      for (const [digit, sup] of Object.entries(digitToSuperscript)) {
        reverseMap[sup] = digit;
      }
      return parseInt(s.split("").map(c => reverseMap[c] || c).join(""), 10);
    };

    // Collect footnote numbers in order of first appearance
    const appearanceOrder: number[] = [];
    let supMatch;
    while ((supMatch = superscriptPattern.exec(answer)) !== null) {
      const num = superscriptToNum(supMatch[0]);
      if (!isNaN(num) && !appearanceOrder.includes(num)) {
        appearanceOrder.push(num);
      }
    }

    // Build old→new mapping based on appearance order
    if (appearanceOrder.length > 0) {
      const reorderMap = new Map<number, number>();
      appearanceOrder.forEach((oldNum, idx) => {
        reorderMap.set(oldNum, idx + 1);
      });

      // Replace superscripts in body with placeholders, then with new numbers
      for (const [oldNum, newNum] of reorderMap) {
        answer = answer.replaceAll(toSuperscript(oldNum), `__REORDER_${newNum}__`);
      }
      for (const [, newNum] of reorderMap) {
        answer = answer.replaceAll(`__REORDER_${newNum}__`, toSuperscript(newNum));
      }

      // Reorder footnotes array to match
      const reorderedFootnotes: typeof footnotes = [];
      for (let i = 1; i <= appearanceOrder.length; i++) {
        const oldNum = appearanceOrder[i - 1];
        const fn = footnotes.find(f => f.number === oldNum);
        if (fn) {
          reorderedFootnotes.push({ ...fn, number: i });
        }
      }
      // Add any footnotes not referenced in body at the end
      for (const fn of footnotes) {
        if (!appearanceOrder.includes(fn.number)) {
          reorderedFootnotes.push({ ...fn, number: reorderedFootnotes.length + 1 });
        }
      }
      footnotes.length = 0;
      footnotes.push(...reorderedFootnotes);
    }

    // ========= Step 7: Post-processing =========
    // Fix superscripts that precede punctuation — move them after
    answer = answer.replace(/([\u00B9\u00B2\u00B3\u2074-\u2079]+)([,.\-;:!?])/g, '$2$1');

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

    // Strip [NEW:...] wrappers from footnotes and body
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(/^\[NEW:\s*/, "").replace(/\]$/, "").trim();
    }
    answer = answer.replace(/\[NEW:[^\]]+\]/g, "");

    // Fix self-referencing "לעיל ה"ש X" where X equals the footnote's own number
    for (const fn of footnotes) {
      const selfRefPattern = new RegExp(`לעיל\\s+ה"ש\\s+${fn.number}\\b`, "g");
      if (selfRefPattern.test(fn.citation)) {
        // Remove the self-referencing phrase and clean up
        fn.citation = fn.citation.replace(new RegExp(`,?\\s*לעיל\\s+ה"ש\\s+${fn.number}\\b`, "g"), "").trim();
        fn.citation = fn.citation.replace(/^[,،\s]+/, "").trim();
      }
    }

    // Fix Hebrew year prefix (e.g. תשס"ב → התשס"ב)
    answer = fixHebrewYearPrefix(answer);
    for (const fn of footnotes) {
      fn.citation = fixHebrewYearPrefix(fn.citation);
    }

    // Rule 24.9.2: strip Hebrew year when both Hebrew and Gregorian appear in parens
    answer = normalizeArticleYearByRule2492(answer);
    for (const fn of footnotes) {
      fn.citation = normalizeArticleYearByRule2492(fn.citation);
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
