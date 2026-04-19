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
  case_number?: string;
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
    case "academic_writing":
      return `מצב עבודה: כתיבה אקדמית (סמינריון / מאמר משפטי).
פרסונה: חוקר אקדמי בכיר בתחום המשפטים.
טון: עברית אקדמית ברמה גבוהה – רגיסטר גבוה, מינוח משפטי מקצועי.

כללי כתיבה אקדמית:
- כתיבה ברגיסטר אקדמי גבוה. הימנע ממשפטים קצרים וישירים – העדף ניסוח מורכב ועשיר.
- ציטוט בגוף הטקסט: נרטיבי בלבד ("בעניין נחמני", "פרופ' דויטש סבור..."). כל מידע טכני – רק בהערות שוליים.
- העדפת מקורות: בחלקים התיאורטיים, העדף מאמרים אקדמיים (journal_article) ממקורות מאומתים.
- כאשר מקור כבר צוטט, השתמש ב"שם" ו"לעיל ה"ש X" לפי כללי האזכור האחיד.
- מבנה סמינריון ישראלי תקני: תקציר → מבוא → מסגרת נורמטיבית → סקירה פסיקתית ודוקטרינרית → ניתוח ביקורתי → סיכום ומסקנות.`;
    default:
      return `מצב עבודה: מחקר משפטי.
בנה את חוות הדעת לפי המבנה הבא:
**תקציר** – סקירה קצרה של הסוגיה והמסקנות.
**מסגרת נורמטיבית** – חקיקה ופסיקה רלוונטיים (IRAC).
**ניתוח מפורט** – יישום הדין על העובדות, ניתוח פסיקה, השוואה.
**המלצות מעשיות** – צעדים מומלצים בהתבסס על הניתוח.`;
  }
}

// ─── Academic sub-mode prompts ───────────────────────────────────────

function getAcademicSubModePrompt(academicStep: string, body: Record<string, unknown>): string | null {
  switch (academicStep) {
    case "suggest_topics":
      return `אתה חוקר אקדמי בכיר במשפטים. המשתמש הציג נושא כללי.
נתח את הנושא והצע **3 שאלות מחקר** ספציפיות ומעניינות שמתאימות לעבודה סמינריונית בת 20-30 עמודים.

פורמט פלט מחייב — השתמש בדיוק במבנה הבא:

**שאלה 1:** <ניסוח ברור וממוקד של שאלת המחקר במשפט אחד>
- מעניינת אקדמית כי: <הסבר קצר>
- מקורות זמינים: <חקיקה / פסיקה / ספרות אקדמית רלוונטית>

**שאלה 2:** <ניסוח ברור וממוקד של שאלת המחקר במשפט אחד>
- מעניינת אקדמית כי: <הסבר קצר>
- מקורות זמינים: <חקיקה / פסיקה / ספרות אקדמית רלוונטית>

**שאלה 3:** <ניסוח ברור וממוקד של שאלת המחקר במשפט אחד>
- מעניינת אקדמית כי: <הסבר קצר>
- מקורות זמינים: <חקיקה / פסיקה / ספרות אקדמית רלוונטית>

חוקים מחייבים:
- אל תשתמש במספור (1./2./3.) בתת-הסעיפים — השתמש במקפים (-) בלבד.
- כל שאלה חייבת להתחיל בדיוק ב-"**שאלה N:**".
- ענה בעברית אקדמית.`;

    case "validate_question":
      return `אתה חוקר אקדמי בכיר במשפטים. המשתמש הציג שאלת מחקר.
בדוק את כדאיותה האקדמית:
1. האם השאלה ברורה וממוקדת מספיק?
2. האם יש מספיק ספרות וחומר מקורי לכתיבת עבודה סמינריונית?
3. הצע שיפורים לניסוח אם נדרש.
4. ציין מקורות ראשוניים רלוונטיים שמצאת.

ענה בעברית אקדמית.`;

    case "propose_outline": {
      const rq = (body.researchQuestion as string) || "";
      return `אתה חוקר אקדמי בכיר במשפטים. שאלת המחקר: "${rq}"

הצע מתווה (תוכן עניינים) לעבודה סמינריונית משפטית לפי המבנה הבא:
1. **תקציר** – סיכום התזה והממצאים
2. **מבוא** – רקע, שאלת המחקר והמתודולוגיה
3. **המסגרת הנורמטיבית** – חקיקה ו"משפט קשה" רלוונטי
4. **סקירה פסיקתית ודוקטרינרית** – ניתוח תקדימים ודעות אקדמיות
5. **ניתוח ביקורתי** – משפט השוואתי או פרשנות חדשה
6. **סיכום ומסקנות** – מענה לשאלת המחקר

הוסף תת-פרקים ספציפיים לנושא. ציין מקורות מרכזיים צפויים לכל פרק.
ענה בעברית אקדמית.`;
    }

    case "write_chapter": {
      const chapterTitle = (body.chapterTitle as string) || "";
      const chapterIndex = (body.chapterIndex as number) || 0;
      const rq = (body.researchQuestion as string) || "";
      const prevChapters = (body.previousChapters as Array<{ title: string; content: string }>) || [];
      
      let prevContext = "";
      if (prevChapters.length > 0) {
        prevContext = "\n\n=== פרקים שנכתבו עד כה ===\n" + 
          prevChapters.map(ch => `--- ${ch.title} ---\n${ch.content?.slice(0, 2000) || ""}`).join("\n\n");
      }

      const userFeedback = (body.userFeedback as string) || "";
      const feedbackLine = userFeedback ? `\n\nהנחיות נוספות מהמשתמש לשכתוב הפרק:\n${userFeedback}` : "";

      return `אתה חוקר אקדמי בכיר במשפטים. כתוב את הפרק הבא בעבודה הסמינריונית.

שאלת המחקר: "${rq}"
פרק נוכחי (${chapterIndex + 1}): **${chapterTitle}**
${prevContext}

הנחיות:
- כתוב פרק אחד בלבד: "${chapterTitle}".
- אורך: 500-1200 מילים (תלוי בחשיבות הפרק).
- שמור על רצף ועקביות עם הפרקים הקודמים.
- השתמש בהערות שוליים מעוצבות לפי כללי האזכור האחיד.
- העדף מקורות מאומתים ממאגר journal_article לחלקים תיאורטיים.
- טון: עברית אקדמית ברגיסטר גבוה.${feedbackLine}`;
    }

    default:
      return null;
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

function truncateContext(text: string, limit: number = MAX_CONTEXT_CHARS): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n[... קוצר מטעמי אורך ...]";
}

// ─── AI-based re-ranking: score source relevance to the question ─────

interface RankedMatch extends LocalMatch {
  relevanceScore?: number;
}

async function rerankLocalMatches(
  matches: LocalMatch[],
  question: string,
  apiKey: string,
): Promise<RankedMatch[]> {
  if (matches.length === 0) return [];

  // Deduplicate by document_id, aggregate chunks per doc
  const docMap = new Map<string, { match: LocalMatch; chunks: string[] }>();
  for (const m of matches) {
    const existing = docMap.get(m.document_id);
    if (existing) {
      existing.chunks.push(m.chunk_content.slice(0, 300));
    } else {
      docMap.set(m.document_id, { match: m, chunks: [m.chunk_content.slice(0, 300)] });
    }
  }

  const docs = Array.from(docMap.values());
  const sourceList = docs.map((d, i) => {
    const typeLabel = d.match.source_type === "caselaw" ? "פסיקה" :
      d.match.source_type === "journal_article" ? "מאמר" :
      d.match.source_type === "knesset_research" ? "מחקר כנסת" : d.match.source_type;
    return `[${i}] ${typeLabel}: ${d.match.document_title}\nתוכן: ${d.chunks.join(" ").slice(0, 400)}`;
  }).join("\n\n");

  const rerankPrompt = `אתה מדרג רלוונטיות של מקורות משפטיים לשאלה נתונה.

שאלה: ${question}

מקורות:
${sourceList}

דרג כל מקור מ-0 עד 10 לפי רלוונטיות מהותית לשאלה (לא רק התאמת מילות מפתח).
0 = לא קשור כלל, 10 = רלוונטי מאוד לסוגיה המשפטית.

החזר רק מערך JSON של מספרים, ציון אחד לכל מקור לפי הסדר.
דוגמה: [8, 2, 9, 1, 6]`;

  try {
    const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        max_tokens: 200,
        messages: [
          { role: "user", content: rerankPrompt },
        ],
      }),
    }, 10000);

    if (!res.ok) {
      console.error(`Re-ranking API error: ${res.status}`);
      return matches.map(m => ({ ...m, relevanceScore: undefined }));
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    // Extract JSON array from response
    const arrayMatch = text.match(/\[[\d\s,]+\]/);
    if (!arrayMatch) {
      console.log("Re-ranking: could not parse scores, using all sources");
      return matches.map(m => ({ ...m, relevanceScore: undefined }));
    }

    const scores: number[] = JSON.parse(arrayMatch[0]);
    console.log(`Re-ranking scores: ${scores.join(", ")}`);

    // Map scores back to matches, filter out low-relevance docs
    // But ALWAYS keep at least the top-scoring document to avoid 0 local sources
    const result: RankedMatch[] = [];
    const docsArr = Array.from(docMap.entries());
    let bestScore = -1;
    let bestDocId: string | null = null;
    for (let i = 0; i < docsArr.length; i++) {
      const score = scores[i] ?? 5;
      if (score > bestScore) {
        bestScore = score;
        bestDocId = docsArr[i][0];
      }
    }

    for (let i = 0; i < docsArr.length; i++) {
      const [docId, docData] = docsArr[i];
      const score = scores[i] ?? 5;
      if (score >= 5 || docId === bestDocId) {
        for (const m of matches) {
          if (m.document_id === docId) {
            result.push({ ...m, relevanceScore: score });
          }
        }
        if (score < 5) {
          console.log(`Kept top-scoring source despite low score (score=${score}): "${docData.match.document_title.slice(0, 50)}"`);
        }
      } else {
        console.log(`Filtered out low-relevance source (score=${score}): "${docData.match.document_title.slice(0, 50)}"`);
      }
    }

    return result;
  } catch (err) {
    console.error("Re-ranking failed (non-fatal):", err);
    return matches.map(m => ({ ...m, relevanceScore: undefined }));
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
    const { question, taskMode, documentText, documentName, academicStep, documentTexts, previousChapters, chapterTitle, chapterIndex, researchQuestion: bodyResearchQuestion, outline: bodyOutline } = body;

    if (!question || typeof question !== "string" || question.trim().length < 3) {
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

    // ========= Academic sub-mode shortcut =========
    // For suggest_topics, validate_question, propose_outline: lighter flow without full retrieval
    if (taskMode === "academic_writing" && academicStep && ["suggest_topics", "validate_question", "propose_outline"].includes(academicStep)) {
      const subPrompt = getAcademicSubModePrompt(academicStep, body);
      if (!subPrompt) {
        return new Response(JSON.stringify({ error: "Invalid academic step" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Quick local search for context
      let localContext = "";
      try {
        const keywords = extractKeywords(question);
        const { data: textMatches } = await adminClient.rpc("search_legal_chunks_text", {
          search_query: keywords, match_count: 5,
        });
        if (textMatches && textMatches.length > 0) {
          localContext = "\n=== מקורות רלוונטיים מהמאגר ===\n" +
            textMatches.slice(0, 5).map((m: any) => `- ${m.document_title} (${m.source_type})`).join("\n");
        }
      } catch { /* non-fatal */ }

      // Include multi-file context if available
      let fileContext = "";
      if (documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
        fileContext = "\n=== מסמכים שהועלו ===\n" +
          documentTexts.map((dt: any) => `=== ${dt.name} ===\n${dt.text?.slice(0, 5000) || ""}`).join("\n\n");
      }

      const aiRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 4096,
          messages: [
            { role: "system", content: subPrompt + localContext + fileContext },
            { role: "user", content: question },
          ],
        }),
      }, 60000);

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error("Academic sub-mode AI error:", aiRes.status, errText);
        return new Response(JSON.stringify({ error: "שגיאה בשירות ה-AI." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const aiData = await aiRes.json();
      const answerText = aiData.choices?.[0]?.message?.content || "";
      console.log(`Academic sub-mode (${academicStep}): ${answerText.length} chars, ${Date.now() - t0}ms`);

      return new Response(
        JSON.stringify({ answer: answerText, footnotes: [], source_urls: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========= Step 0: Document context (if uploaded) =========
    let documentContext = "";
    const isAcademicMode = taskMode === "academic_writing";
    const contextCharLimit = isAcademicMode ? 12000 : MAX_CONTEXT_CHARS;

    // Multi-file support
    if (documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
      documentContext = documentTexts.map((dt: any) => 
        `\n=== מסמך: ${dt.name || "ללא שם"} ===\n${(dt.text || "").slice(0, 15000)}\n=== סוף המסמך ===\n`
      ).join("\n");
      console.log(`Multi-file upload: ${documentTexts.length} files`);
    } else {
      const hasDocument = documentText && typeof documentText === "string" && documentText.trim().length > 100;
      if (hasDocument) {
        documentContext = `\n=== מסמך שהועלה: ${documentName || "ללא שם"} ===\n${documentText.slice(0, 15000)}\n=== סוף המסמך ===\n`;
        console.log(`Document uploaded: ${documentName}, ${documentText.length} chars`);
      }
    }
    const hasDocument = documentContext.length > 0;

    // ========= Step 1: Local search (hybrid: keyword + vector) + Perplexity IN PARALLEL =========

    // Helper: generate query embedding for vector search
    async function getQueryEmbedding(text: string): Promise<number[] | null> {
      try {
        const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
        if (!OPENAI_API_KEY) { console.error("OPENAI_API_KEY not configured"); return null; }
        const res = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: text.slice(0, 4000),
            dimensions: 768,
          }),
        }, 5000);
        if (!res.ok) {
          console.error("Query embedding error:", res.status);
          return null;
        }
        const data = await res.json();
        return data.data[0].embedding;
      } catch (err) {
        console.error("Query embedding failed (non-fatal):", err);
        return null;
      }
    }

    const localSearchPromise = (async (): Promise<{ matches: LocalMatch[]; used: boolean }> => {
      try {
        const keywords = extractKeywords(question);
        console.log(`Search keywords: "${keywords}" (from: "${question.slice(0, 80)}")`);

        // Run keyword search and vector search in parallel
        const keywordPromise = adminClient.rpc("search_legal_chunks_text", {
          search_query: keywords,
          match_count: 8,
        });

        const vectorPromise = (async () => {
          const embedding = await getQueryEmbedding(question);
          if (!embedding) return { data: null, error: null };
          return adminClient.rpc("match_legal_chunks", {
            query_embedding: JSON.stringify(embedding),
            match_threshold: 0.7,
            match_count: 8,
          });
        })();

        const [keywordResult, vectorResult] = await Promise.all([keywordPromise, vectorPromise]);

        const keywordMatches: LocalMatch[] = (!keywordResult.error && keywordResult.data) ? keywordResult.data : [];
        const vectorMatches: LocalMatch[] = (!vectorResult.error && vectorResult.data) ? vectorResult.data : [];

        console.log(`Keyword search: ${keywordMatches.length} results | Vector search: ${vectorMatches.length} results`);

        // Merge and deduplicate by chunk_id, keeping higher similarity
        const mergedMap = new Map<string, LocalMatch>();
        for (const m of keywordMatches) {
          mergedMap.set(m.chunk_id, m);
        }
        for (const m of vectorMatches) {
          const existing = mergedMap.get(m.chunk_id);
          if (!existing || m.similarity > existing.similarity) {
            mergedMap.set(m.chunk_id, m);
          }
        }

        const merged = Array.from(mergedMap.values())
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 12);

        if (merged.length > 0) {
          console.log(`Hybrid search: ${merged.length} unique chunks after merge`);
          return { matches: merged, used: true };
        }

        // Fallback: try with fewer keywords
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
        console.error("Hybrid search failed (non-fatal):", err);
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

    // ========= Step 1b: Enrich incomplete journal articles via Perplexity =========
    const incompleteArticles = localMatches.filter(m =>
      m.source_type === "journal_article" &&
      (!(m.metadata as Record<string, unknown>)?.author || !(m.metadata as Record<string, unknown>)?.year)
    );

    if (incompleteArticles.length > 0 && PERPLEXITY_API_KEY) {
      const journalMapEnrich: Record<string, string> = { mishpatim: "משפטים", tau_law_review: "עיוני משפט", hapraklit: "הפרקליט", runilawreview: "משפט ועסקים" };
      const enrichmentPromises = incompleteArticles.slice(0, 3).map(async (article) => {
        try {
          const artMeta = (article.metadata || {}) as Record<string, unknown>;
          const jName = (artMeta.journal as string) || journalMapEnrich[(artMeta.source_site as string) || ""] || "";
          const vName = (artMeta.volume as string) || "";
          const enrichPrompt = `מצא את שם המחבר ושנת הפרסום של המאמר האקדמי הישראלי: "${article.document_title}".${jName ? ` המאמר פורסם בכתב העת ${jName}` : ""}${vName ? ` ${vName}` : ""}. החזר רק בפורמט: מחבר: [שם], שנה: [שנה לועזית בת 4 ספרות]`;
          const res = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "sonar",
              messages: [{ role: "user", content: enrichPrompt }],
            }),
          }, 8000);
          const data = await res.json();
          const text = data.choices?.[0]?.message?.content || "";
          const authorMatch = text.match(/מחבר:\s*(.+?)(?:,|\n|$)/);
          const yearMatch = text.match(/שנה:\s*(\d{4})/);
          if (authorMatch) article.metadata = { ...(article.metadata || {}), author: authorMatch[1].trim() };
          if (yearMatch) {
            const enrichedYear = yearMatch[1];
            // Reject if year looks like it was confused with volume number
            const volNum = vName.match(/\d+/)?.[0];
            const yearLastTwo = enrichedYear.slice(-2);
            if (volNum && (yearLastTwo === volNum || `20${volNum}` === enrichedYear || `19${volNum}` === enrichedYear)) {
              console.log(`Rejected suspicious year ${enrichedYear} (matches volume ${volNum}) for "${article.document_title.slice(0, 40)}"`);
            } else {
              article.metadata = { ...(article.metadata || {}), year: enrichedYear };
            }
          }
          console.log(`Enriched article "${article.document_title.slice(0, 40)}": author=${authorMatch?.[1] || "?"}, year=${yearMatch?.[1] || "?"}`);
        } catch (e) { /* skip enrichment on error */ }
      });
      await Promise.all(enrichmentPromises);
    }

    const tRetrieval = Date.now();
    console.log(`Retrieval took ${tRetrieval - t0}ms`);

    // ========= Step 1c: AI-based re-ranking of local sources =========
    let rankedMatches: RankedMatch[] = localMatches.map(m => ({ ...m }));
    if (localMatches.length > 0 && LOVABLE_API_KEY) {
      try {
        rankedMatches = await rerankLocalMatches(localMatches, question, LOVABLE_API_KEY);
        const tRerank = Date.now();
        console.log(`Re-ranking took ${tRerank - tRetrieval}ms, kept ${rankedMatches.length}/${localMatches.length} chunks`);
      } catch (err) {
        console.error("Re-ranking error (non-fatal):", err);
      }
    }

    if (rankedMatches.length === 0 && !searchResults && !hasDocument) {
      return new Response(
        JSON.stringify({ error: "לא נמצאו מקורות רלוונטיים. נסו לנסח את השאלה אחרת." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========= Step 2: Build source cards (server-side) =========
    const sourceCards: SourceCard[] = [];
    let cardId = 1;

    // Local sources — build rich citations from structured fields (using re-ranked matches)
    if (rankedMatches.length > 0) {
      const seenDocs = new Set<string>();
      for (const m of rankedMatches) {
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
          const journalMap: Record<string, string> = {
            mishpatim: "משפטים",
            tau_law_review: "עיוני משפט",
            hapraklit: "הפרקליט",
            runilawreview: "משפט ועסקים",
          };
          const journal = (meta.journal as string) || journalMap[(meta.source_site as string) || ""] || "";
          const vol = (meta.volume as string) || "";

          // Extract starting page from URL patterns (e.g. /article/{issue}/{page})
          let startPage = (meta.page as string) || "";
          if (!startPage && m.source_url) {
            const pageMatch = m.source_url.match(/\/article\/\d+\/(\d+)/);
            if (pageMatch) startPage = pageMatch[1];
          }

          richCitation = author ? `${author} "${m.document_title}"` : `"${m.document_title}"`;
          if (journal) richCitation += ` **${journal}**`;
          if (vol) richCitation += ` ${vol}`;
          if (startPage) richCitation += ` ${startPage}`;
          const year = (meta.year as string) || "";
          if (year) richCitation += ` (${year})`;
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

    if (rankedMatches.length > 0) {
      const seenDocs = new Set<string>();
      let localContext = "\n=== מקורות מאומתים מהמאגר המשפטי ===\n";
      for (const m of rankedMatches) {
        if (!seenDocs.has(m.document_id)) {
          seenDocs.add(m.document_id);
          const typeLabel = m.source_type === "caselaw" ? "פסיקה" :
            m.source_type === "knesset_research" ? "מחקר כנסת" :
            m.source_type === "journal_article" ? "מאמר אקדמי" : m.source_type;
          const relevanceTag = m.relevanceScore !== undefined ? ` | רלוונטיות: ${m.relevanceScore}/10` : "";
          localContext += `\n--- ${m.document_title} ---\nסוג מקור: ${typeLabel} | אזכור: ${m.document_citation}${relevanceTag}\n`;
          if (m.source_url) localContext += `קישור: ${m.source_url}\n`;
        }
        localContext += `${m.chunk_content.slice(0, 800)}\n`;
      }
      contextParts.push(localContext);
    }

    if (searchResults) {
      contextParts.push("\n=== מקורות מחיפוש ===\n" + searchResults.slice(0, 3000));
    }

    const combinedContext = truncateContext(contextParts.join("\n"), contextCharLimit);

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

    // For academic write_chapter: use the dedicated sub-mode prompt as additional instruction
    let academicChapterContext = "";
    if (isAcademicMode && academicStep === "write_chapter") {
      const subPrompt = getAcademicSubModePrompt("write_chapter", body);
      if (subPrompt) academicChapterContext = "\n\n" + subPrompt;
    }

    const systemPrompt = `אתה עוזר משפטי מומחה. כתוב חוות דעת משפטית מקצועית בעברית.
${taskInstructions}
${academicChapterContext}

כללי כתיבה:
- אורך: ${isAcademicMode ? "500-1200" : "800-1500"} מילים. כל חלק חייב להיות מהותי.
- אל תשתמש בסימני # לכותרות. השתמש ב-**כותרת** (הדגשה) בלבד.
- השתמש בכותרות המודגשות שמפורטות במצב העבודה למעלה. אל תשתמש בכותרות אחרות.
- טון: פורמלי, אובייקטיבי ואנליטי. כל טענה משפטית חייבת להיות מעוגנת בהערת שוליים.
- העדף 8-12 הפניות איכותיות. השתמש אך ורק במקורות מהרשימה למעלה.
- אסור בהחלט לצטט מקורות שאינם מופיעים ברשימת המקורות הזמינים למעלה. אם אין מספיק מקורות ברשימה, כתוב פחות הערות שוליים — אל תמציא מקורות חדשים. עדיף מזכר עם 4 הערות שוליים אמיתיות מאשר 10 הערות שכוללות מקורות בדויים.

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
- השתמש בסימוני [X] בסוגריים מרובעים בגוף הטקסט (למשל [1], [2], [3]).
- אל תשתמש במספרים עיליים (superscript) — המערכת תמיר אותם אוטומטית.
- מספר ההפניה בגוף חייב להתאים בדיוק למספר ההערה ברשימת הערות השוליים.
- כל מספר הפניה [N] יופיע פעם אחת בלבד בגוף הטקסט. אם אותו מקור תומך בכמה טענות, השתמש ב-"שם" או "לעיל ה"ש N" עם מספר הפניה חדש — אל תחזור על אותו מספר [N] שוב ושוב.
- סימן ההפניה חייב לבוא תמיד אחרי סימן הפיסוק, לא לפניו.
  נכון: בעניין בן גביר,[1]
  נכון: מערכת בתי המשפט.[1]
  לא נכון: בעניין בן גביר[1],

כלל חשוב – עדיפות מקורות:
מקורות המסומנים [מאומת] הם מקורות שנמצאים במאגר המשפטי המקומי ועברו אימות.
תעדיף תמיד לצטט מקורות מאומתים על פני מקורות מהאינטרנט.
השתמש במקורות אינטרנט רק כהשלמה למקורות מאומתים, לא כתחליף.
אם יש מקורות מאומתים רלוונטיים, לפחות 60% מההפניות חייבות להיות מקורות מאומתים.

כלל קריטי – רלוונטיות מקורות:
- לפני שאתה מצטט מקור כלשהו, בדוק שהוא רלוונטי מהותית לשאלה המשפטית. התאמה במילות מפתח (למשל "ראש הממשלה") אינה מספיקה — המקור חייב לעסוק באותה סוגיה משפטית.
- אם מקור מהרשימה עוסק בנושא אחר לחלוטין (למשל: השאלה עוסקת בחנינה, והמקור עוסק במינויים), אל תצטט אותו כלל, גם אם הוא מסומן [מאומת].
- עדיף לצטט פחות מקורות רלוונטיים מאשר להוסיף מקורות שאינם קשורים לנושא.

כלל קריטי – פרטים חסרים:
- אם מקור מהמאגר חסר שנת פרסום, כתוב "(לא נמצאה שנת פרסום)" — אל תמציא שנה ואל תכתוב "תאריך לא ידוע".
- אם חסרים פרטים ביבליוגרפיים חיוניים (כמו שם מחבר), נסה לחלץ אותם מתוך תוכן המקור שסופק לך.

כלל קריטי – עמודים:
- כאשר מקור מהמאגר כולל מספר עמוד פתיחה, השתמש בו בדיוק. אל תמציא מספרי עמודים.
- ב"שם, בעמ' X" — ציין מספר עמוד רק אם אתה יודע בוודאות שהעמוד קיים במאמר. אם אינך בטוח, כתוב "שם" בלבד ללא הפניה לעמוד ספציפי.

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

    const aiMaxTokens = isAcademicMode ? 12288 : 8192;
    const aiBody = JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: aiMaxTokens,
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
    // STRICT matcher: only attach a card's URL when we have high-confidence identifier overlap.
    // Returns null when uncertain — the footnote will be dropped to avoid wrong-URL leaks.
    const STOPWORDS = new Set([
      "בית", "המשפט", "העליון", "המחוזי", "השלום", "של", "את", "לפי", "על", "עם",
      "אל", "מן", "כי", "או", "גם", "זה", "זו", "אשר", "כפי", "כמו", "אך", "אם",
      "פסק", "דין", "פסקדין", "הלכה", "ערעור", "בקשה", "החלטה", "סעיף", "חוק",
      "ישראל", "מדינת", "המדינה", "נגד", "נ׳", "פרשת", "עניין", "פרשה",
      "עמוד", "בעמ", "פסקה", "ראו", "ראה", "השוו", "וכן",
    ]);

    function normalize(s: string): string {
      return s.toLowerCase().replace(/[״"׳'.,;:()\[\]{}]/g, " ").replace(/\s+/g, " ").trim();
    }

    function matchFootnoteToCard(fnText: string, cards: SourceCard[]): SourceCard | null {
      const fnLower = fnText.toLowerCase();
      const fnNorm = normalize(fnText);

      // ===== Tier 1: strict identifier matches =====

      // 1a. Exact case number match (e.g., 1234/22)
      const fnCaseNums = Array.from(fnText.matchAll(/\b(\d{2,5}\/\d{2,4})\b/g)).map(m => m[1]);
      if (fnCaseNums.length > 0) {
        for (const card of cards) {
          for (const cn of fnCaseNums) {
            if (card.citation.includes(cn)) return card;
          }
        }
      }

      // 1b. URL substring match (domain + identifier)
      for (const card of cards) {
        if (!card.url) continue;
        try {
          const cardUrl = new URL(card.url);
          const domain = cardUrl.hostname.replace(/^www\./, "");
          if (!fnLower.includes(domain)) continue;
          // Domain present — require additional identifier to confirm same document
          if (domain.includes("nevo.co.il")) {
            const dParam = cardUrl.searchParams.get("d");
            const uParam = cardUrl.searchParams.get("u");
            if (dParam && fnLower.includes(dParam)) return card;
            if (uParam && uParam.length >= 8 && fnLower.includes(uParam.slice(0, 8))) return card;
          } else {
            // Generic: require a path segment of >=6 chars to also appear
            const segments = cardUrl.pathname.split("/").filter(s => s.length >= 6);
            for (const seg of segments) {
              if (fnLower.includes(seg.toLowerCase())) return card;
            }
          }
        } catch { /* skip malformed */ }
      }

      // 1c. Exact normalized title match
      for (const card of cards) {
        const titleNorm = normalize(card.citation);
        if (titleNorm.length >= 15 && fnNorm.includes(titleNorm)) return card;
      }

      // ===== Tier 2: ≥3 significant-word overlap =====
      // Significant = length ≥ 4, not a stopword
      for (const card of cards) {
        const cardWords = normalize(card.citation)
          .split(/\s+/)
          .filter(w => w.length >= 4 && !STOPWORDS.has(w));
        if (cardWords.length < 3) continue;
        const uniqueCardWords = Array.from(new Set(cardWords));
        const matchCount = uniqueCardWords.filter(w => fnNorm.includes(w)).length;
        if (matchCount >= 3) return card;
      }

      return null;
    }

    // Build footnotes: prefer AI-formatted text, fall back to source card raw data
    const footnotes: Array<{ number: number; citation: string; source_type: string; url?: string; source?: string }> = [];
    const usedSourceIds = new Set<number>();
    const newCitations: Array<{ citation: string; source_type: string }> = [];

    // Body-side dedup: if any [N] marker appears > 2 times, keep only the first occurrence.
    // Prevents the visual "several ¹" bug when the AI repeats the same reference number.
    {
      const counts = new Map<string, number>();
      const allMatches = Array.from(answerBody.matchAll(/\[(\d{1,2})\]/g));
      for (const m of allMatches) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      const seen = new Set<string>();
      answerBody = answerBody.replace(/\[(\d{1,2})\]/g, (full, n) => {
        if ((counts.get(n) || 0) > 2) {
          if (seen.has(n)) return "";
          seen.add(n);
          return full;
        }
        return full;
      });
    }

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
        if (!matchedCard) {
          console.log(`Stripped unmatched footnote #${aiFn.num}: ${aiFn.text.slice(0, 80)}...`);
          continue;
        }
        footnotes.push({
          number: fnNum,
          citation: aiFn.text,
          source_type: matchedCard.source_type,
          url: matchedCard.url,
          source: matchedCard.provenance || "local",
        });
        oldIdToNewNumber.set(aiFn.num, fnNum);
        fnNum++;
      }

      // NOTE: Removed the "keep all as unverified" safety fallback.
      // Better to show fewer accurate footnotes than many with wrong URLs.
      if (footnotes.length === 0 && aiFootnoteLines.length > 0) {
        console.log(`All ${aiFootnoteLines.length} AI footnotes failed strict matching — dropping all to avoid wrong-URL leaks`);
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

    // ========= Step 5c: Normalize any raw superscripts back to [X] brackets =========
    // Safety: if the AI still produces Unicode superscripts instead of [X], convert them first
    const superscriptToDigitMap: Record<string, string> = {
      "\u2070": "0", "\u00B9": "1", "\u00B2": "2", "\u00B3": "3",
      "\u2074": "4", "\u2075": "5", "\u2076": "6",
      "\u2077": "7", "\u2078": "8", "\u2079": "9",
    };
    answerBody = answerBody.replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+/g, (match) => {
      const num = match.split("").map(c => superscriptToDigitMap[c] || c).join("");
      return `[${num}]`;
    });
    console.log("Normalized superscripts to brackets in answer body");

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
    // Quote-agnostic pattern for "לעיל ה"ש" (matches ", ״, ", ")
      const SUPRA_QUOTE = '["\u05F4\u201C\u201D]';
      const SUPRA_PATTERN = `לעיל\\s+ה${SUPRA_QUOTE}ש\\s+`;

      // Update cross-references ("לעיל ה"ש X") inside footnote citations
      for (const fn of reorderedFootnotes) {
        fn.citation = fn.citation.replace(
          new RegExp(SUPRA_PATTERN + '(\\d{1,2})', 'g'),
          (match: string, num: string) => {
            const oldNum = parseInt(num, 10);
            const newNum = reorderMap.get(oldNum);
            return newNum ? `לעיל ה"ש ${newNum}` : match;
          }
        );
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
    const SUPRA_Q = '["\u05F4\u201C\u201D]';
    const SUPRA_P = `לעיל\\s+ה${SUPRA_Q}ש\\s+`;
    for (const fn of footnotes) {
      const selfRefPattern = new RegExp(SUPRA_P + `${fn.number}\\b`, "g");
      if (selfRefPattern.test(fn.citation)) {
        // Remove the self-referencing phrase and clean up
        fn.citation = fn.citation.replace(new RegExp(`,?\\s*` + SUPRA_P + `${fn.number}\\b`, "g"), "").trim();
        fn.citation = fn.citation.replace(/^[,،\s]+/, "").trim();
      }
    }

    // Validate cross-references: ensure "לעיל ה"ש X" points to a matching source
    for (const fn of footnotes) {
      const refMatch = fn.citation.match(new RegExp(SUPRA_P + '(\\d{1,2})'));
      if (refMatch) {
        const targetNum = parseInt(refMatch[1], 10);
        const targetFn = footnotes.find(f => f.number === targetNum);
        if (!targetFn) {
          // Target doesn't exist — remove the cross-reference phrase
          fn.citation = fn.citation.replace(new RegExp(`,?\\s*` + SUPRA_P + '\\d{1,2}'), "").trim();
          fn.citation = fn.citation.replace(/^[,،\s]+/, "").trim();
        }
      }
    }

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
