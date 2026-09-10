// =========================================================================
// legal-qa edge function — POST-D3.1.5 (pipeline excised)
// -------------------------------------------------------------------------
// LIVE paths:
//   • taskMode === "academic_writing" && academicStep ∈
//       { "suggest_topics", "validate_question", "propose_outline" }
//   • taskMode === "case_summary"
//
// 503 short-circuits (offline while the research engine is rebuilt):
//   • taskMode === "research"
//   • academicStep ∈ { "write_chapter", "write_introduction", "write_conclusion" }
//   • taskMode === "pleading_analysis"
//
// All Fast / Deep / V2 / V3 / V4 / Core / anchor / source-pack /
// claim-verification / chapter / pleading pipeline code has been removed
// from this file. The unreachable on-disk modules are scheduled for
// physical deletion in phase D3.2.
// =========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { acquireOperationLock, lockUnavailablePayload, operationInProgressPayload } from "../_shared/operationLock.ts";
import { USAGE_WEIGHTS } from "../_shared/usageWeights.ts";

const RESEARCH_MODE = "research";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Caselaw-only Perplexity domain filter for the suggest_topics reality check.
const CASELAW_DOMAINS: readonly string[] = [
  "nevo.co.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
];

// ─── Hebrew stop words + abbreviation expansions for extractKeywords ───
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

const HEBREW_ABBREVIATION_EXPANSIONS: Array<{ pattern: RegExp; expansions: string[] }> = [
  { pattern: /יועמ["״]ש|יועמש|היועמשי?ת|היועמש/g, expansions: ["היועץ המשפטי לממשלה", "היועצת המשפטית לממשלה"] },
  { pattern: /בג["״]ץ/g, expansions: ["בית המשפט הגבוה לצדק"] },
  { pattern: /בימ["״]ש/g, expansions: ["בית המשפט"] },
  { pattern: /ביה["״]ד/g, expansions: ["בית הדין"] },
  { pattern: /ע["״]א(?![\u0590-\u05FF])/g, expansions: ["ערעור אזרחי"] },
  { pattern: /ע["״]פ(?![\u0590-\u05FF])/g, expansions: ["ערעור פלילי"] },
  { pattern: /רע["״]א/g, expansions: ["רשות ערעור אזרחי"] },
  { pattern: /ס["״]ח/g, expansions: ["ספר החוקים"] },
  { pattern: /ק["״]ת/g, expansions: ["קובץ התקנות"] },
  { pattern: /תקנ['׳]/g, expansions: ["תקנות"] },
  { pattern: /ועדת חוקה(?! חוק)/g, expansions: ["ועדת חוקה חוק ומשפט"] },
  { pattern: /מ["״]י(?![\u0590-\u05FF])/g, expansions: ["מדינת ישראל"] },
  { pattern: /חו["״]י/g, expansions: ["חוק יסוד"] },
  { pattern: /פס["״]ד/g, expansions: ["פסק דין"] },
  { pattern: /ב["״]כ(?![\u0590-\u05FF])/g, expansions: ["בא כוח"] },
  { pattern: /פד["״]י/g, expansions: ["פסקי דין"] },
  { pattern: /דנ["״]א/g, expansions: ["דיון נוסף אזרחי"] },
  { pattern: /בש["״]פ/g, expansions: ["בקשה פלילית"] },
  { pattern: /עע["״]מ/g, expansions: ["ערעור מינהלי"] },
];

function expandHebrewAbbreviations(text: string): string[] {
  const found: string[] = [];
  for (const { pattern, expansions } of HEBREW_ABBREVIATION_EXPANSIONS) {
    if (pattern.test(text)) found.push(...expansions);
    pattern.lastIndex = 0;
  }
  return found;
}

function extractKeywords(question: string): string {
  const words = question
    .replace(/[?!.,;:"״׳']/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !HEBREW_STOP_WORDS.has(w));
  const baseKeywords = words.slice(0, 6);
  const expansions = expandHebrewAbbreviations(question);
  const expansionWords: string[] = [];
  for (const phrase of expansions) {
    for (const w of phrase.split(/\s+/)) {
      if (w.length > 1 && !HEBREW_STOP_WORDS.has(w) && !baseKeywords.includes(w) && !expansionWords.includes(w)) {
        expansionWords.push(w);
      }
    }
  }
  return [...baseKeywords, ...expansionWords].join(" ");
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Case-summary system prompt (live path) ───
function getCaseSummaryInstructions(): string {
  return `מצב עבודה: סיכום פסיקה — דו"ח מובנה ומחייב.

חוק ברזל: הסיכום מבוסס אך ורק על טקסט פסק הדין שסופק לך בהקשר. אסור בהחלט להוסיף, להשלים, להסיק או לדמיין מידע שלא מופיע במפורש בטקסט. אם פרט חסר — כתוב "(לא צוין בפסק הדין)".

אסור להשתמש בהערות שוליים, באזכורי [N], או במספרים עיליים — זהו דו"ח עצמאי, לא חוות דעת.

בנה את הדו"ח בדיוק לפי המבנה הבא, באותו סדר ועם אותן כותרות מודגשות:

**כותרת**
בשורה אחת: מספר התיק | שמות הצדדים | (שנה).

**עובדות**
תיאור תמציתי של העובדות הרלוונטיות בלבד. ללא אזכורים משפטיים.

**טענות הצדדים**
פסקה ייעודית לכל צד (תובע/עותר/מערער מול נתבע/משיב). תמצית טענותיו המרכזיות.

**השאלה המשפטית**
ניסוח חד וברור של הסוגיה המשפטית המרכזית במשפט אחד עד שניים.

**דעות השופטים**
פסקה נפרדת לכל שופט (רוב, מיעוט, הסכמה במנומק). בכל פסקה: שם השופט, עמדתו, המסגרת הנורמטיבית עליה הסתמך, והמבחנים שיישם.

**הכרעה**
שורה אחת: התקבל / נדחה / התקבל בחלקו (כולל הסעד שניתן בפועל).

**ההלכה**
הכלל המחייב הנובע מדעת הרוב, מנוסח כאמירה נורמטיבית עצמאית.`;
}

// ─── Academic sub-mode prompts (live: 3 short steps only) ───
function getAcademicSubModePrompt(academicStep: string, body: Record<string, unknown>): string | null {
  switch (academicStep) {
    case "suggest_topics": {
      const prev = Array.isArray(body.previousQuestions)
        ? (body.previousQuestions as unknown[]).map((q) => String(q || "").trim()).filter(Boolean)
        : [];
      const round = typeof body.round === "number" && body.round > 0 ? body.round : 1;
      const prevBlock = prev.length > 0
        ? `\n\nשאלות שכבר הוצעו למשתמש בסבבים קודמים (סבב נוכחי: ${round}). אסור לחזור עליהן ואסור לנסחן מחדש בווריאציה זניחה. הצע **3 שאלות חדשות לחלוטין** באותו נושא — זוויות שונות, היבטים שונים, או רמות הפשטה שונות:\n${prev.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n`
        : "";
      return `אתה חוקר אקדמי בכיר במשפטים. המשתמש הציג נושא כללי.${prevBlock}
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
    }

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
      return `אתה חוקר אקדמי בכיר במשפטים.

⚠️ שאלת המחקר שלהלן היא קבועה ואין לשנותה, לנסחה מחדש, או להחליפה. השתמש בה כפי שהיא בדיוק, מילה במילה, בלי תוספות, השמטות או שכתוב.

שאלת המחקר (קבועה): "${rq}"

עליך להפיק **הצעת מחקר אקדמית** לעבודה סמינריונית משפטית, במבנה מחייב של שלושה חלקים. הקפד על המבנה המדויק שלהלן — אל תוסיף, תחסיר או תשנה את שמות הכותרות.

חוקים מחייבים:
- **שאלת המחקר נעולה**: בסעיף "שאלת המחקר" במבוא, העתק את שאלת המחקר לעיל **מילה במילה**, ללא שינוי כלשהו בניסוח, בסדר המילים, או בסימני הפיסוק. אסור לפרש, לנסח מחדש, לקצר, להרחיב או להחליף את שאלת המחקר.
- **טון טיעוני (Argumentative)**: השתמש בניסוחים כגון "פרק זה טוען ש…", "במאמר ייטען כי…", "הטענה המרכזית היא ש…". אסור להשתמש בניסוחים תיאוריים כגון "אסקור", "אבחן", "אציג", "ארצה לבדוק".
- **זרימה לוגית — מן הכלל אל הפרט**: הפרקים חייבים להתקדם מהדין המצוי, דרך ניתוח ביקורתי/השוואתי, אל הדין הראוי / הצעה נורמטיבית. סמן בסוף כל כותרת פרק תג זרימה: "– הדין המצוי" / "– ניתוח ביקורתי" / "– משפט משווה" / "– הדין הראוי".
- **מספר פרקים**: 4 עד 6 פרקי גוף. אל תכלול תקציר, מבוא או סיכום במתווה — שלושת אלה מטופלים בנפרד בשלבים מאוחרים בתהליך הכתיבה (לאחר שפרקי הגוף ייכתבו).
- **רישום אקדמי בעברית** — ללא הערות שוליים, ללא מספרי עמודים, ללא ציטוטים מלאים.

הפק את הפלט בדיוק לפי התבנית הבאה (שמור על הכותרות המודגשות ועל הסימונים המדויקים):

**מבוא**
- שאלת המחקר: ${rq}
- התזה המרכזית (Thesis): <טענה משפטית מרכזית במשפט אחד — מה תוכיח העבודה>
- חשיבות ותרומה לשיח המשפטי: <2-3 שורות — מדוע הסוגיה חשובה ומה תוסיף העבודה לדיון הקיים>
- קו הטיעון (Line of Argument): <כיצד התזה מתפתחת ומתבססת לאורך הפרקים, צעד אחר צעד>
- מבנה העבודה: <משפט מקשר אחד שמסביר את ההיגיון של חלוקת הפרקים>

**רשימת הפרקים**
1. **<כותרת הפרק>** – הדין המצוי
   - הרחבה: <2-4 משפטים בטון טיעוני: על מה הפרק מתמקד, אילו טיעונים יוצגו בו, וכיצד הפרק משרת את שאלת המחקר והתזה>
   - טיעוני נגד אפשריים: <משפט-שניים — אילו השגות צפויות לעלות נגד הטיעון בפרק זה, וכיצד הפרק נערך להתמודד עמן>
2. **<כותרת הפרק>** – ניתוח ביקורתי
   - הרחבה: ...
   - טיעוני נגד אפשריים: ...
3. **<כותרת הפרק>** – משפט משווה
   - הרחבה: ...
   - טיעוני נגד אפשריים: ...
4. **<כותרת הפרק>** – הדין הראוי
   - הרחבה: ...
   - טיעוני נגד אפשריים: ...

**סיכום ומסקנות (משוערות)**
- מסקנה משוערת: <מה צפוי לעלות מהמחקר על-בסיס מה שידוע עד כה — ניסוח זהיר אך ברור>
- תרומה משפטית: <שורה-שתיים — מה תתרום העבודה לשיח המשפטי, לפסיקה או לחקיקה עתידית>

ענה אך ורק בתבנית לעיל, בעברית אקדמית, ללא הקדמות וללא הערות מסכמות.`;
    }

    default:
      return null;
  }
}

// =========================================================================
// Request handler
// =========================================================================
async function handleLegalQARequest(req: Request): Promise<Response> {
  // Hoisted state — outer catch needs these to refund on unexpected throws.
  let __creditsCharged = false;
  let __creditRequestId: string | null = null;
  let __userClientForRefund: ReturnType<typeof createClient> | null = null;
  // Account-level concurrency ownership (case_summary only).
  let __lockOperationId: string | null = null;

  try {
    // ─── Auth gate ────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Body parse ───────────────────────────────────────────────
    const body = await req.json();
    const {
      question,
      taskMode,
      documentText,
      documentName: _documentName,
      academicStep,
      documentTexts,
      requestId: clientRequestId,
      runId: clientRunId,
      projectId: bodyProjectId,
    } = body;

    const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isShortAcademicStep =
      taskMode === "academic_writing" &&
      typeof academicStep === "string" &&
      ["propose_outline", "suggest_topics", "validate_question"].includes(academicStep);
    const resumableRunId: string | null = isShortAcademicStep
      ? (typeof clientRunId === "string" && UUID_V4_RE.test(clientRunId) ? clientRunId : crypto.randomUUID())
      : null;

    const isChapterClassWrite =
      taskMode === "academic_writing" &&
      (academicStep === "write_chapter" ||
        academicStep === "write_introduction" ||
        academicStep === "write_conclusion");

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return new Response(JSON.stringify({ error: "Question too short" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── D2 reset: offline-engine short-circuits ─────────────────
    if (taskMode === RESEARCH_MODE) {
      console.log("[offline] research engine offline — short-circuit 503");
      return new Response(
        JSON.stringify({ error: "research_engine_offline", message: "מצב מחקר משפטי בשדרוג. חוזר בקרוב." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (isChapterClassWrite) {
      console.log(`[offline] academic chapter engine offline — short-circuit 503 (step=${academicStep})`);
      return new Response(
        JSON.stringify({ error: "academic_chapter_engine_offline", message: "כתיבת פרקים בשדרוג. חוזרת בקרוב." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    // Product availability freeze — Academic Writing is not part of the public
    // beta. Rejected before any credit gate; all other task modes untouched.
    if (taskMode === "academic_writing" && Deno.env.get("ACADEMIC_WRITING_ENABLED") !== "true") {
      console.log(`[availability] academic writing disabled — 503 (step=${academicStep})`);
      return new Response(
        JSON.stringify({
          error: "academic_writing_unavailable",
          message: "כתיבה אקדמית עדיין בפיתוח ותיפתח בהמשך.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (taskMode === "pleading_analysis") {
      console.log("[offline] pleading_analysis engine offline — short-circuit 503");
      return new Response(
        JSON.stringify({ error: "pleading_analysis_engine_offline", message: "בדיקת כתבי טענות בשדרוג. חוזרת בקרוב." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── Usage gate ──────────────────────────────────────────────
    // Short academic steps (suggest_topics / validate_question / propose_outline) → free.
    // case_summary → 2 internal units when named, 1 when the judgment is uploaded.
    const isAcademicSubModeFree =
      taskMode === "academic_writing" &&
      typeof academicStep === "string" &&
      ["suggest_topics", "validate_question", "propose_outline"].includes(academicStep);
    const hasGroundingDoc =
      (Array.isArray(documentTexts) && documentTexts.length > 0) ||
      (typeof documentText === "string" && documentText.trim().length > 100);

    let creditCost = 0;
    if (isAcademicSubModeFree) {
      creditCost = 0;
    } else if (taskMode === "case_summary") {
      creditCost = hasGroundingDoc
        ? USAGE_WEIGHTS.case_summary_upload
        : USAGE_WEIGHTS.case_summary_named;
    } else {
      // Any other taskMode (general legal QA, unknown modes) is offline too.
      console.log(`[offline] unsupported taskMode="${taskMode ?? "(none)"}" — short-circuit 503`);
      return new Response(
        JSON.stringify({ error: "engine_offline", message: "השירות בשדרוג. חוזר בקרוב." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const creditRequestId =
      typeof clientRequestId === "string" && clientRequestId.length >= 8
        ? clientRequestId
        : crypto.randomUUID();
    __creditRequestId = creditRequestId;

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    __userClientForRefund = userClient;

    // ── Account-level concurrency protection (protected operation) ──────
    // Case Summary keeps its own targeted pipeline; only the account-level
    // ownership is shared with V2 research. Acquired BEFORE the credit charge.
    if (taskMode === "case_summary") {
      const lock = await acquireOperationLock(
        userClient as unknown as { rpc(fn: string, params?: Record<string, unknown>): unknown },
        "case_summary",
        creditRequestId,
        typeof bodyProjectId === "string" ? bodyProjectId : null,
      );
      if (!lock.ok) {
        const unavailable = lock.error === "lock_unavailable";
        return new Response(
          JSON.stringify(unavailable ? lockUnavailablePayload() : operationInProgressPayload(lock.active_operation_type)),
          {
            status: unavailable ? 503 : 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      __lockOperationId = lock.bypass ? null : creditRequestId;
    }

    let creditsCharged = false;
    if (creditCost > 0) {
      const { data: consumeData, error: consumeErr } = await userClient.rpc("consume_credits", {
        _amount: creditCost,
        _reason: `legal-qa:${taskMode || "unknown"}${hasGroundingDoc ? "+doc" : ""}`,
        _request_id: creditRequestId,
      });
      console.log(
        `[credit] fn=legal-qa mode=${taskMode || "unknown"} request_id=${creditRequestId} amount=${creditCost} ` +
        `ok=${(consumeData as Record<string, unknown> | null)?.ok === true} rpc_error=${consumeErr?.message ?? "none"} ` +
        `app_error=${((consumeData as Record<string, unknown> | null)?.error as string) ?? "none"}`,
      );
      if (consumeErr) {
        console.error("consume_credits error:", consumeErr);
        return new Response(JSON.stringify({ error: "שגיאה בחיוב קרדיטים. נסו שוב." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const cr = (consumeData ?? {}) as Record<string, unknown>;
      if (!cr.ok) {
        if (cr.error === "INSUFFICIENT_CREDITS") {
          return new Response(JSON.stringify({
            error: "INSUFFICIENT_CREDITS",
            required: cr.required ?? creditCost,
            remaining_included: cr.remaining_included ?? 0,
            remaining_topup: cr.remaining_topup ?? 0,
          }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ error: cr.error || "CREDIT_ERROR" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      creditsCharged = true;
      __creditsCharged = true;
    }

    const refundAndPayload = async (extraReason: string, payload: Record<string, unknown>) => {
      let refunded = false;
      if (creditsCharged) {
        try {
          const { data: refundData } = await userClient.rpc("refund_credits", {
            _request_id: creditRequestId,
            _reason: `auto-refund: ${extraReason}`,
          });
          refunded = Boolean((refundData as Record<string, unknown> | null)?.ok);
          creditsCharged = !refunded;
          __creditsCharged = creditsCharged;
        } catch (rfErr) {
          console.error("refund_credits failed (non-fatal):", rfErr);
        }
      }
      return { ...payload, refunded, refundReason: refunded ? extraReason : undefined };
    };

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const t0 = Date.now();

    // =====================================================================
    // LIVE PATH 1 — Academic sub-modes (suggest_topics / validate_question / propose_outline)
    // =====================================================================
    if (
      taskMode === "academic_writing" &&
      typeof academicStep === "string" &&
      ["suggest_topics", "validate_question", "propose_outline"].includes(academicStep)
    ) {
      const subPrompt = getAcademicSubModePrompt(academicStep, body);
      if (!subPrompt) {
        return new Response(JSON.stringify({ error: "Invalid academic step" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Pre-insert qa_logs row with the client-supplied runId so the client
      // can poll legal-qa-status after navigation.
      if (resumableRunId) {
        try {
          await adminClient.from("qa_logs").insert({
            id: resumableRunId,
            user_id: user.id,
            question: question.substring(0, 500),
            answer: null,
            footnotes: [],
            task_mode: taskMode,
            project_id: typeof bodyProjectId === "string" ? bodyProjectId : null,
            local_footnotes_count: 0,
            perplexity_footnotes_count: 0,
            total_footnotes: 0,
            metadata: { academic_step: academicStep, checkpoint: "running", run_id: resumableRunId },
          });
        } catch (preInsertErr) {
          console.error("Failed to pre-insert qa_logs row for resumable short step:", preInsertErr);
        }
      }

      // ───── Topic Reality Check (suggest_topics only) ─────
      type TCSource = { title: string; source_type: string; origin: "local" | "external"; url?: string };
      let topicCoverage: {
        queries: string[];
        localHits: number;
        externalHits: number;
        sources: TCSource[];
        minCoverageReached: boolean;
        pplxCalled: boolean;
        pplxDurationMs: number;
        totalDurationMs: number;
      } | null = null;
      let localContext = "";
      const REALITY_CHECK_ENABLED = (Deno.env.get("TOPIC_REALITY_CHECK_ENABLED") ?? "true").toLowerCase() !== "false";
      const PPLX_ENABLED = (Deno.env.get("TOPIC_REALITY_PPLX_ENABLED") ?? "true").toLowerCase() !== "false";
      const MIN_HITS = parseInt(Deno.env.get("TOPIC_REALITY_MIN_HITS") ?? "4", 10) || 4;

      if (academicStep === "suggest_topics" && REALITY_CHECK_ENABLED) {
        const trcStart = Date.now();

        // Stage 1 — planner expands the topic into 3-4 retrieval queries.
        let queries: string[] = [question];
        try {
          const plannerRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "openai/gpt-5-mini",
              reasoning_effort: "minimal",
              messages: [
                { role: "system", content: "אתה מתכנן שאילתות חיפוש לעבודת מחקר משפטית בעברית. החזר 3-4 ניסוחי חיפוש קצרים וממוקדים (כולל הניסוח המקורי) שיעזרו לאתר חקיקה, פסיקה וספרות אקדמית במאגר משפטי. החזר רק את ה-tool call." },
                { role: "user", content: `נושא: ${question.slice(0, 500)}` },
              ],
              tools: [{
                type: "function",
                function: {
                  name: "plan_queries",
                  parameters: {
                    type: "object",
                    properties: { queries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 } },
                    required: ["queries"], additionalProperties: false,
                  },
                },
              }],
              tool_choice: { type: "function", function: { name: "plan_queries" } },
            }),
          }, 8000);
          if (plannerRes.ok) {
            const pj = await plannerRes.json();
            const args = pj.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
            if (args) {
              const parsed = JSON.parse(args);
              if (Array.isArray(parsed.queries) && parsed.queries.length > 0) {
                queries = parsed.queries.map((q: unknown) => String(q || "").trim()).filter(Boolean).slice(0, 4);
                if (queries.length === 0) queries = [question];
              }
            }
          }
        } catch (e) {
          console.warn("Topic-reality planner failed, using single-query fallback:", e instanceof Error ? e.message : e);
        }

        // Stage 2 — hybrid local retrieval (text + vector per query).
        type LocalHit = { document_id: string; document_title: string; source_type: string; source_url?: string; metadata?: Record<string, unknown>; score: number };
        const hitsByDoc = new Map<string, LocalHit>();
        const isBrokenPlaceholder = (t: string | null | undefined) => {
          const s = (t || "").trim();
          if (!s) return true;
          return /^(פרטי\s+מסמך|ללא\s+כותרת)/i.test(s);
        };
        const embed = async (text: string): Promise<number[] | null> => {
          try {
            const key = Deno.env.get("OPENAI_API_KEY");
            if (!key) return null;
            const r = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 2000), dimensions: 768 }),
            }, 4000);
            if (!r.ok) return null;
            const d = await r.json();
            return d.data?.[0]?.embedding || null;
          } catch { return null; }
        };

        await Promise.all(queries.map(async (q) => {
          const kw = extractKeywords(q) || q;
          // deno-lint-ignore no-explicit-any
          const [textRes, emb] = await Promise.all([
            adminClient.rpc("search_legal_chunks_text", { search_query: kw, match_count: 8 }).then((r: any) => r).catch(() => ({ data: null })),
            embed(q),
          ]);
          // deno-lint-ignore no-explicit-any
          const vecRes: any = emb
            ? await adminClient.rpc("match_legal_chunks", { query_embedding: JSON.stringify(emb), match_threshold: 0.55, match_count: 8 }).then((r: any) => r).catch(() => ({ data: null }))
            : { data: null };
          // deno-lint-ignore no-explicit-any
          const merge = (rows: any[] | null, weight: number) => {
            if (!Array.isArray(rows)) return;
            for (const m of rows) {
              if (isBrokenPlaceholder(m.document_title)) continue;
              const meta = (m.metadata || {}) as Record<string, unknown>;
              if (meta.broken_title === true) continue;
              const prev = hitsByDoc.get(m.document_id);
              const addScore = ((m.similarity as number) || 0) * weight;
              if (prev) {
                prev.score += addScore;
              } else {
                hitsByDoc.set(m.document_id, {
                  document_id: m.document_id,
                  document_title: m.document_title,
                  source_type: m.source_type,
                  source_url: m.source_url || undefined,
                  metadata: meta,
                  score: addScore,
                });
              }
            }
          };
          merge(textRes?.data, 0.4);
          merge(vecRes?.data, 1.0);
        }));

        const localSorted = Array.from(hitsByDoc.values()).sort((a, b) => b.score - a.score).slice(0, 12);
        const localSources: TCSource[] = localSorted.map((h) => ({
          title: h.document_title,
          source_type: h.source_type,
          origin: "local" as const,
          url: h.source_url,
        }));

        // Stage 3 — Perplexity fallback (only when local hits < MIN_HITS).
        let externalSources: TCSource[] = [];
        let pplxCalled = false;
        let pplxDurationMs = 0;
        const PPLX_KEY = Deno.env.get("PERPLEXITY_API_KEY");
        if (PPLX_ENABLED && PPLX_KEY && localSources.length < MIN_HITS) {
          const pStart = Date.now();
          pplxCalled = true;
          try {
            const pRes = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${PPLX_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "sonar",
                messages: [
                  { role: "system", content: "אתה מאתר מקורות משפטיים ישראליים. החזר רק JSON תקף לפי הסכמה." },
                  { role: "user", content: `מצא עד 6 מקורות משפטיים ישראליים רלוונטיים (חקיקה, פסיקה, מאמרים אקדמיים) לנושא:\n${question.slice(0, 800)}\n\nהחזר JSON עם המפתח sources.` },
                ],
                search_domain_filter: [...CASELAW_DOMAINS],
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "sources",
                    schema: {
                      type: "object",
                      properties: {
                        sources: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              title: { type: "string" },
                              source_type: { type: "string" },
                              why_relevant: { type: "string" },
                            },
                            required: ["title", "source_type"],
                          },
                        },
                      },
                      required: ["sources"],
                    },
                  },
                },
              }),
            }, 15000);
            if (pRes.ok) {
              const pj = await pRes.json();
              const content = pj.choices?.[0]?.message?.content || "";
              const citations: string[] = Array.isArray(pj.citations) ? pj.citations : [];
              try {
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed.sources)) {
                  // deno-lint-ignore no-explicit-any
                  externalSources = parsed.sources.slice(0, 6).map((s: any, i: number) => ({
                    title: String(s.title || "").trim(),
                    source_type: String(s.source_type || "אחר").trim(),
                    origin: "external" as const,
                    url: citations[i] || undefined,
                  })).filter((s: TCSource) => s.title.length > 0);
                }
              } catch (parseErr) {
                console.warn("Perplexity reality-check JSON parse failed:", parseErr instanceof Error ? parseErr.message : parseErr);
              }
            } else {
              console.warn("Perplexity reality-check HTTP", pRes.status);
            }
          } catch (e) {
            console.warn("Perplexity reality-check failed:", e instanceof Error ? e.message : e);
          }
          pplxDurationMs = Date.now() - pStart;
        }

        const allSources: TCSource[] = [...localSources, ...externalSources];
        const minCoverageReached = allSources.length >= 3;

        topicCoverage = {
          queries,
          localHits: localSources.length,
          externalHits: externalSources.length,
          sources: allSources,
          minCoverageReached,
          pplxCalled,
          pplxDurationMs,
          totalDurationMs: Date.now() - trcStart,
        };

        // Early exit: no sources at all → guidance message, no questions.
        if (allSources.length === 0) {
          const noCoverageAnswer = "לא מצאתי מקורות מספקים לנושא הזה במאגר ובחיפוש מהיר. נסה לצמצם את הנושא, לבחור זווית ספציפית יותר, או לנסח אותו אחרת.";
          try {
            if (resumableRunId) {
              await adminClient.from("qa_logs").update({
                answer: noCoverageAnswer,
                metadata: { academic_step: academicStep, checkpoint: "completed", run_id: resumableRunId, topic_reality_check: topicCoverage, no_coverage: true, duration_ms: Date.now() - t0 },
              }).eq("id", resumableRunId);
            } else {
              await adminClient.from("qa_logs").insert({
                user_id: user.id,
                question: question.substring(0, 500),
                answer: noCoverageAnswer,
                footnotes: [],
                task_mode: taskMode,
                local_footnotes_count: 0,
                perplexity_footnotes_count: 0,
                total_footnotes: 0,
                metadata: { academic_step: academicStep, topic_reality_check: topicCoverage, no_coverage: true, duration_ms: Date.now() - t0 },
              });
            }
          } catch { /* non-fatal */ }
          return new Response(
            JSON.stringify({
              answer: noCoverageAnswer,
              footnotes: [],
              source_urls: [],
              topicCoverage,
              noCoverage: true,
              ...(resumableRunId ? { runId: resumableRunId } : {}),
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const localList = localSources.length > 0
          ? localSources.map((s) => `- ${s.title} (${s.source_type}) [מאגר]`).join("\n")
          : "(אין)";
        const externalList = externalSources.length > 0
          ? externalSources.map((s) => `- ${s.title} (${s.source_type}) [חיצוני]`).join("\n")
          : "(לא נדרש חיפוש חיצוני)";
        const lowCoverageNote = minCoverageReached ? "" : "\n⚠️ כיסוי מקורות דל — סמן כל שאלה שמסתמכת בעיקר על מקורות לא-מאומתים בתג \"⚠️ כיסוי דל\".";
        localContext =
`\n=== מקורות שאומתו לנושא (השתמש רק במקורות מהרשימה הזו תחת "מקורות זמינים") ===
מקומיים (${localSources.length}):
${localList}

חיצוניים (${externalSources.length}):
${externalList}

חוקים נוספים:
- ציין ליד כל מקור [מאגר] או [חיצוני] לפי הרשימה.
- אסור להמציא מקורות שלא ברשימה.${lowCoverageNote}
`;
      } else {
        // Lightweight context for validate_question / propose_outline.
        try {
          const keywords = extractKeywords(question);
          // deno-lint-ignore no-explicit-any
          const { data: textMatches } = await adminClient.rpc("search_legal_chunks_text", {
            search_query: keywords, match_count: 5,
          });
          if (textMatches && textMatches.length > 0) {
            localContext = "\n=== מקורות רלוונטיים מהמאגר ===\n" +
              // deno-lint-ignore no-explicit-any
              textMatches.slice(0, 5).map((m: any) => `- ${m.document_title} (${m.source_type})`).join("\n");
          }
        } catch { /* non-fatal */ }
      }

      // Optional uploaded-file context.
      let fileContext = "";
      if (documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
        fileContext = "\n=== מסמכים שהועלו ===\n" +
          // deno-lint-ignore no-explicit-any
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
        if (resumableRunId) {
          try {
            await adminClient.from("qa_logs").update({
              metadata: { academic_step: academicStep, checkpoint: "failed", run_id: resumableRunId, error_message: `AI ${aiRes.status}` },
            }).eq("id", resumableRunId);
          } catch { /* non-fatal */ }
        }
        return new Response(JSON.stringify({ error: "שגיאה בשירות ה-AI." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const aiData = await aiRes.json();
      const answerText = aiData.choices?.[0]?.message?.content || "";

      console.log(`Academic sub-mode (${academicStep}): ${answerText.length} chars, ${Date.now() - t0}ms${topicCoverage ? `, reality-check: local=${topicCoverage.localHits} ext=${topicCoverage.externalHits}` : ""}`);

      try {
        if (resumableRunId) {
          await adminClient.from("qa_logs").update({
            answer: answerText,
            metadata: {
              academic_step: academicStep,
              checkpoint: "completed",
              run_id: resumableRunId,
              duration_ms: Date.now() - t0,
              ...(topicCoverage ? { topic_reality_check: topicCoverage } : {}),
            },
          }).eq("id", resumableRunId);
        } else {
          await adminClient.from("qa_logs").insert({
            user_id: user.id,
            question: question.substring(0, 500),
            answer: answerText,
            footnotes: [],
            task_mode: taskMode,
            local_footnotes_count: 0,
            perplexity_footnotes_count: 0,
            total_footnotes: 0,
            metadata: {
              academic_step: academicStep,
              duration_ms: Date.now() - t0,
              ...(topicCoverage ? { topic_reality_check: topicCoverage } : {}),
            },
          });
        }
      } catch (logErr) {
        console.error("Failed to insert academic sub-mode qa_logs row (non-fatal):", logErr);
      }

      return new Response(
        JSON.stringify({
          answer: answerText,
          footnotes: [],
          source_urls: [],
          ...(topicCoverage ? { topicCoverage } : {}),
          ...(resumableRunId ? { runId: resumableRunId } : {}),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // =====================================================================
    // LIVE PATH 2 — case_summary (strict full-text gate)
    // =====================================================================
    if (taskMode === "case_summary") {
      let userSuppliedText = "";
      if (documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
        // deno-lint-ignore no-explicit-any
        userSuppliedText = documentTexts.map((dt: any) => dt.text || "").join("\n\n");
      } else if (documentText && typeof documentText === "string") {
        userSuppliedText = documentText;
      }

      let verify: { source: "user" | "local" | "external" | "none"; fullText?: string; metadata?: Record<string, unknown>; refusal_message?: string } | null = null;
      try {
        const vRes = await fetchWithTimeout(`${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-case-fulltext`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": authHeader },
          body: JSON.stringify({ question, userText: userSuppliedText }),
        }, 20000);
        if (vRes.ok) verify = await vRes.json();
      } catch (e) {
        console.error("verify-case-fulltext call failed:", e instanceof Error ? e.message : e);
      }

      if (!verify || verify.source === "none" || !verify.fullText) {
        console.log("case_summary: refusing — no full text available");
        const payload = await refundAndPayload("case_summary:no-fulltext", {
          refusal: true,
          source: "none",
          message: verify?.refusal_message || "פסק הדין אינו קיים במערכת ולא ניתן היה לאתר את הטקסט המלא שלו. כדי שאוכל לסכם אותו עבורך, אנא העלה את הקובץ או הדבק את הטקסט בתיבת הטקסט.",
          answer: "",
          footnotes: [],
          source_urls: [],
        });
        return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Defense-in-depth: Hebrew-ratio sanity gate.
      {
        const ft = verify.fullText as string;
        const sample = ft.slice(0, 20000);
        const total = sample.length || 1;
        const hebrew = (sample.match(/[\u0590-\u05FF]/g) || []).length;
        const ratio = hebrew / total;
        if (ratio < 0.05) {
          console.log(`case_summary: refusing — extracted text failed Hebrew-ratio gate (${(ratio * 100).toFixed(2)}%, source=${verify.source})`);
          const payload = await refundAndPayload("case_summary:hebrew-ratio-fail", {
            refusal: true,
            source: "none",
            message: "פסק הדין אינו קיים במערכת ולא ניתן היה לאתר את הטקסט המלא שלו. כדי שאוכל לסכם אותו עבורך, אנא העלה את הקובץ או הדבק את הטקסט בתיבת הטקסט.",
            answer: "",
            footnotes: [],
            source_urls: [],
          });
          return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      const md = verify.metadata || {};
      const headerHints = [
        md.case_number ? `מספר תיק: ${md.case_number}` : null,
        md.parties ? `צדדים: ${md.parties}` : null,
        md.court ? `ערכאה: ${md.court}` : null,
        md.year ? `שנה: ${md.year}` : null,
      ].filter(Boolean).join(" | ");

      const caseInstructions = getCaseSummaryInstructions();
      const sumPrompt = `אתה עוזר משפטי מומחה לסיכום פסיקה ישראלית.
${caseInstructions}

מטא-דאטה זמינה לכותרת (אם חסר — כתוב "(לא צוין בפסק הדין)"):
${headerHints || "(לא נמסרה)"}

=== טקסט פסק הדין המלא — מקור האמת היחיד ===
${(verify.fullText as string).slice(0, 50000)}
=== סוף הטקסט ===

צור עכשיו את הדו"ח לפי המבנה המחייב. ללא הערות שוליים. ללא [N]. ללא ציטוט מקורות חיצוניים.`;

      const aiRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 3500,
          messages: [
            { role: "system", content: sumPrompt },
            { role: "user", content: `סכם את פסק הדין הבא: ${question.trim() || (md.case_number || "פסק הדין שסופק")}` },
          ],
        }),
      }, 90000);

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error("case_summary AI error:", aiRes.status, errText);
        const payload = await refundAndPayload("case_summary:ai-error", { error: "שגיאה בעיבוד הסיכום. נסו שוב." });
        return new Response(JSON.stringify(payload), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const aiData = await aiRes.json();
      const summary = (aiData.choices?.[0]?.message?.content || "").trim();
      console.log(`case_summary: produced ${summary.length} chars (source=${verify.source}, ${Date.now() - t0}ms)`);

      return new Response(JSON.stringify({
        answer: summary,
        footnotes: [],
        source_urls: md.source_url ? [md.source_url] : [],
        case_summary: true,
        verified_source: verify.source,
        case_metadata: md,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── Unreachable fallthrough (should never happen — credit gate already 503'd unknown modes) ───
    console.error(`[legal-qa] unreachable fallthrough for taskMode="${taskMode}"`);
    const fallthroughPayload = await refundAndPayload("unreachable-fallthrough", {
      error: "engine_offline",
      message: "השירות בשדרוג. חוזר בקרוב.",
    });
    return new Response(JSON.stringify(fallthroughPayload), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("legal-qa error:", e);
    let refunded = false;
    if (__creditsCharged && __creditRequestId && __userClientForRefund) {
      try {
        const { data: refundData } = await __userClientForRefund.rpc("refund_credits", {
          _request_id: __creditRequestId,
          _reason: "auto-refund: legal-qa runtime error",
        });
        refunded = Boolean((refundData as Record<string, unknown> | null)?.ok);
      } catch (rfErr) {
        console.error("refund_credits failed in catch (non-fatal):", rfErr);
      }
    }
    return new Response(
      JSON.stringify({ error: "שגיאה בעיבוד השאלה. נסו שוב.", refunded, refundReason: refunded ? "runtime-error" : undefined }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } finally {
    // Terminal release on every exit path — success, refusal, error.
    if (__lockOperationId && __userClientForRefund) {
      try {
        await __userClientForRefund.rpc("release_operation_lock", {
          _operation_id: __lockOperationId,
          _reason: "terminal",
        });
      } catch (e) {
        console.error("[lock] release failed (non-fatal):", e);
      }
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return handleLegalQARequest(req);
});
