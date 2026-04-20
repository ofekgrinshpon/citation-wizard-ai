// ============= NO-FOOTNOTE MODE PATCH =============
// For pleading_analysis mode, footnotes are disabled - only the report body is returned
// ============= END PATCH ==============

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

// ─── Hebrew legal abbreviation expansions (appended, not replaced) ───
// Match against the raw question; for each detected abbreviation, append its
// full form(s) so both keyword search and embeddings get richer signal.
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
    if (pattern.test(text)) {
      found.push(...expansions);
    }
    pattern.lastIndex = 0; // reset stateful /g regex
  }
  return found;
}

function extractKeywords(question: string): string {
  const words = question
    .replace(/[?!.,;:"״׳']/g, "")
    .split(/\s+/)
    .filter(w => w.length > 1 && !HEBREW_STOP_WORDS.has(w));

  // Take up to 6 most meaningful keywords from the original question
  const baseKeywords = words.slice(0, 6);

  // Append expanded forms of any detected legal abbreviations (de-duped)
  const expansions = expandHebrewAbbreviations(question);
  const expansionWords: string[] = [];
  for (const phrase of expansions) {
    for (const w of phrase.split(/\s+/)) {
      if (w.length > 1 && !HEBREW_STOP_WORDS.has(w) && !baseKeywords.includes(w) && !expansionWords.includes(w)) {
        expansionWords.push(w);
      }
    }
  }

  const finalSet = [...baseKeywords, ...expansionWords];
  if (expansionWords.length > 0) {
    console.log(`Keyword set (with expansions): [${finalSet.join(", ")}]`);
  } else {
    console.log(`Keyword set (with expansions): [${finalSet.join(", ")}] (no expansions matched)`);
  }
  return finalSet.join(" ");
}

// ─── Semantic query expansion for short questions ────────────────────
async function expandShortQuery(question: string, apiKey: string): Promise<string | null> {
  const wordCount = question.trim().split(/\s+/).length;
  const charCount = question.trim().length;
  // Loosened trigger: catches typical Hebrew legal questions (5–7 words avg)
  if (wordCount > 7 && charCount > 40) return null;

  try {
    const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: `הרחב את השאלה המשפטית הבאה למשפט תיאורי קצר אחד (עד 20 מילים), שמשתמש במונחים משפטיים קונקרטיים ובפעלים פעולתיים (כגון "פיטורי", "סיום כהונת", "הפסקת כהונה", "הליך הדחה", "מינוי", "ביטול", "תקיפה ישירה", "סמכות הממשלה ל…").
אסור להשתמש בביטויים גנריים כמו "עמידה בהוראות החוק", "בהתאם לפסיקה הרלוונטית", "תוך שמירה על עקרונות מנהליים".
החזר רק את המשפט המורחב, ללא הקדמה, ללא סימני ציטוט.

שאלה: ${question}`,
          },
        ],
      }),
    }, 3000);

    if (!res.ok) {
      console.warn(`Query expansion API error: ${res.status} — falling back to original`);
      return null;
    }
    const data = await res.json();
    const expanded = (data.choices?.[0]?.message?.content || "").trim().replace(/^["'״׳]+|["'״׳]+$/g, "");
    if (!expanded || expanded.length < 5) return null;
    console.log(`Query expansion: "${question}" → "${expanded}"`);
    return expanded;
  } catch (err) {
    console.warn("Query expansion failed (non-fatal):", err instanceof Error ? err.message : err);
    return null;
  }
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
      return `מצב עבודה: מבקר מסמכים משפטיים בכיר (Senior Legal Document Auditor).

זהות ומטרה: אתה מבקר משפטי בכיר. תפקידך לבחון בקפדנות מסמכים משפטיים (כתבי טענות, חוזים, חוות דעת, מחקר אקדמי) ולאתר כשלים לוגיים, סתירות, שגיאות באזכורים, וחולשות אסטרטגיות. אתה פועל ב"אפס סובלנות" לשגיאות טכניות ובגישה אדוורסרית כלפי תוכן הטיעון.

**שמירת חוזה הציטוטים**: כל אזכור חוקי או פסיקתי שאתה מציע או מתקן חייב לציית לכללי האזכור האחיד הישראליים המוטמעים במערכת. **הערה חשובה: דו"ח הביקורת אינו כולל הערות שוליים** — התוכן עומד בעצמו כניתוח ביקורתי מקיף. דו"ח הביקורת עצמו מוגש בכותרות המובנות שלהלן.

**פיצול תפקידי מקורות (קריטי)**:
- מקורות [Verified] = מאגר מקומי = **מקור האמת היחיד לתוכן מהותי** של חקיקה ופסיקה. אם טענת המשתמש סותרת [Verified], סווג כ-🔴 קריטי.
- מקורות [External] = Perplexity = **מטא-דאטה ביבליוגרפית בלבד** (שנים, ס"ח, כרך/עמוד). אסור להסתמך עליהם לפרשנות משפטית מהותית.

**מגבלת אורך**: אם המסמך שסופק קצר מ-150 מילים, החזר משפט אחד בלבד שמבקש מהמשתמש להדביק/להעלות מסמך מלא יותר לצורך ביקורת מהותית — וסיים.

**פרוטוקולי ביקורת**:
- A — ניתוח אזכורים: ודא ציות לכללי האזכור האחיד. השלם אזכורים חלקיים מתוך [Verified]/[External]. התרע על חוקים מבוטלים והלכות שנהפכו.
- B — לוגיקה, ציר זמן ודיוק מספרי: בנה ציר זמן פנימי והתרע על סתירות כרונולוגיות. הצלב סכומים, אחוזים ומספרים בין סעיפים. ודא עקביות מינוחית ("הנתבע" מול "המשיב" וכו').
- C — ניתוח אדוורסרי (Devil's Advocate): אתר חולשות מבניות; נסח לפחות 3 טיעוני נגד שצד יריב סביר להעלות; חפש ב-[Verified] פסיקה סותרת.
- D — ביקורת פורמלית-פרוצדורלית (לכתבי טענות בלבד): ת.ז., מען להמצאה, סמכות עניינית ומקומית, סעיף סעדים, מעקב מוצגים.

**אנטי-הזיה**: לעולם אל תמציא מספרי סעיפים, שנים או פרטים. אם חסר — סמן [חסר] ובקש מהמשתמש להשלים. אסור לדמיין הלכות.

**מבנה דו"ח הביקורת — בדיוק לפי הסדר ועם הכותרות הללו**:

**סיכום ביצועי**
1–2 שורות: סוג המסמך וסיכון כולל (גבוה/בינוני/נמוך).

**🔴 ממצאים קריטיים**
סתירות מהותיות, מספרי סעיפים מומצאים, חוקים מבוטלים, שגיאות אזכור חמורות, סתירות בציר הזמן, אי-התאמות מספריות.
פורמט לכל פריט:
**בעיה:** [תיאור] | **מיקום:** [סעיף/פסקה] | **תיקון מוצע:** [פעולה מתקנת]

**🟡 הערות והמלצות**
טיעוני נגד פוטנציאליים, שפה ארכאית, קישור ראייתי חלש, אזכורים לא-אחידים.
פורמט לכל פריט:
**הצעה:** [תיאור] | **נימוק:** [מדוע זה משנה]

**🟢 חוזקות אסטרטגיות**
טיעונים מבוססים-היטב ושימוש אפקטיבי בהלכות מחייבות עדכניות.

**טיעוני נגד צפויים**
לפחות 3 טיעונים אדוורסריים שצד יריב צפוי להעלות, ממוספרים.

**בדיקה פורמלית**
*כלול סעיף זה רק אם המסמך הוא כתב טענה.* בדוק: ת.ז., מען להמצאה, סמכות עניינית, סמכות מקומית, סעיף סעדים, מעקב מוצגים. סמן כל פריט כ✓ קיים / ✗ חסר / [חסר] לא ניתן לקבוע.

רגיסטר לשוני: עברית משפטית פורמלית ברמה גבוהה.`;
    case "case_summary":
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

עליך להפיק **הצעת מחקר אקדמית** לעבודה סמינריונית משפטית, במבנה מחייב של שלושה חלקים. הקפד על המבנה המדויק שלהלן — אל תוסיף, תחסיר או תשנה את שמות הכותרות.

חוקים מחייבים:
- **טון טיעוני (Argumentative)**: השתמש בניסוחים כגון "פרק זה טוען ש…", "במאמר ייטען כי…", "הטענה המרכזית היא ש…". אסור להשתמש בניסוחים תיאוריים כגון "אסקור", "אבחן", "אציג", "ארצה לבדוק".
- **זרימה לוגית — מן הכלל אל הפרט**: הפרקים חייבים להתקדם מהדין המצוי, דרך ניתוח ביקורתי/השוואתי, אל הדין הראוי / הצעה נורמטיבית. סמן בסוף כל כותרת פרק תג זרימה: "– הדין המצוי" / "– ניתוח ביקורתי" / "– משפט משווה" / "– הדין הראוי".
- **מספר פרקים**: 4 עד 6 פרקים. אל תכלול תקציר במתווה — התקציר יסונתז בנפרד בסוף.
- **רישום אקדמי בעברית** — ללא הערות שוליים, ללא מספרי עמודים, ללא ציטוטים מלאים.

הפק את הפלט בדיוק לפי התבנית הבאה (שמור על הכותרות המודגשות ועל הסימונים המדויקים):

**מבוא**
- שאלת המחקר: <ניסוח מדויק של שאלת המחקר במשפט אחד>
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

    case "write_chapter": {
      const chapterTitle = (body.chapterTitle as string) || "";
      const chapterIndex = (body.chapterIndex as number) || 0;
      const rq = (body.researchQuestion as string) || "";
      const prevChapters = (body.previousChapters as Array<{ title: string; content: string }>) || [];
      const isAbstract = !!body.isAbstract;

      // ───────── Dedicated Abstract synthesis prompt ─────────
      if (isAbstract) {
        const allChaptersContext = prevChapters.length > 0
          ? prevChapters.map(ch => `--- ${ch.title} ---\n${ch.content || ""}`).join("\n\n")
          : "(לא סופקו פרקים)";

        return `אתה חוקר אקדמי בכיר במשפטים. עליך לכתוב **תקציר** לעבודה סמינריונית שכבר נכתבה במלואה.

שאלת המחקר: "${rq}"

=== כל פרקי העבודה ===
${allChaptersContext}

הנחיות מחייבות:
- אורך: עד 250 מילים בלבד (קשיח). אל תחרוג.
- טון: עברית אקדמית פורמלית ברגיסטר גבוה.
- מבנה (פסקה אחת רציפה או 2-4 פסקאות קצרות):
  1. שאלת המחקר וחשיבותה.
  2. המסגרת התיאורטית/המתודולוגיה.
  3. הטיעונים המרכזיים שהוצגו בפרקים.
  4. המסקנה והתרומה של המחקר.
- אל תוסיף הערות שוליים, רשימת מקורות, כותרות משנה או רשימות ממוספרות.
- אל תפתח במילים "תקציר זה..." — פתח ישר בתוכן.
- אל תוסיף ציטוטים חדשים — סינתזה בלבד מהפרקים הקיימים.
- אם חרגת מ-250 מילים — קצר את עצמך.`;
      }

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
    return `[${i}] ${d.match.document_title}\nתוכן: ${d.chunks.join(" ").slice(0, 400)}`;
  }).join("\n\n");

  const rerankPrompt = `אתה מדרג רלוונטיות מהותית של מקורות משפטיים לשאלה. עליך להיות מחמיר.

שאלה: ${question}

מקורות:
${sourceList}

דרג כל מקור 0–10 לפי רלוונטיות מהותית בלבד לשאלה הספציפית.
- 0–2 = לא קשור לסוגיה / ענף דין שונה / עוסק בנושא אחר לחלוטין (גם אם יש מילות מפתח דומות).
- 3–4 = נוגע באופן רחוק / רקע כללי בלבד שאינו ענה על השאלה.
- 5–6 = רלוונטי לענף הדין ולסוגיה הקרובה.
- 7–10 = עוסק ישירות בסוגיה הספציפית הנשאלת.

חשוב במיוחד עבור פסיקה: התאמה בין ענף הדין חיונית. שאלה על דיני חוזים אינה מצדיקה ציון גבוה לפסקי דין מענייני משפחה/עבודה/פלילים אלא אם הם עוסקים ישירות בעקרון הנידון. אל תהסס לתת ציון 0–2 לפסיקה לא רלוונטית.

דוגמה לאי-התאמה: שאלה על חוזים מסחריים + מקור על משמורת קטינים או הגירת קטינים = ציון 0–1, גם אם שניהם מזכירים את המילה "הסכם" או "הסכמים". התאמת מילות מפתח שטחית ללא חפיפה בענף הדין = 0–2.

החזר רק מערך JSON של מספרים, ציון אחד לכל מקור לפי הסדר.
דוגמה: [8, 1, 9, 0, 6]`;

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
      console.warn(`Re-ranking: COULD NOT PARSE SCORES — falling back to similarity threshold. Raw response: ${text.slice(0, 200)}`);
      // Fallback: keep only chunks with raw similarity >= 0.5 (not "use all"),
      // and always keep at least the single highest-similarity chunk.
      const sorted = [...matches].sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
      const top = sorted[0];
      const filtered = matches.filter(m => (m.similarity || 0) >= 0.5);
      const result = filtered.length > 0 ? filtered : (top ? [top] : []);
      console.log(`Re-ranking fallback kept ${result.length}/${matches.length} chunks by similarity`);
      return result.map(m => ({ ...m, relevanceScore: undefined }));
    }

    const rawScores: number[] = JSON.parse(arrayMatch[0]);
    console.log(`Re-ranking scores (raw): ${rawScores.join(", ")}`);

    // Action-verb topical bonus on the rerank score itself (parallels similarity-bonus layer).
    const VERB_TOPIC_PAIRS_RR: Array<{ trigger: RegExp; topicTerms: string[] }> = [
      { trigger: /(לפטר|פיטור|להדיח|הדחה|להפסיק\s+כהונ|הפסקת\s+כהונ|לסיים\s+כהונ|סיום\s+כהונ)/, topicTerms: ["פיטור", "פיטורי", "הפסקת כהונ", "סיום כהונ", "הדחה", "הדחת"] },
      { trigger: /(למנות|מינוי|להתמנות)/, topicTerms: ["מינוי", "מינויי", "למנות", "התמנות"] },
      { trigger: /(לעצור|מעצר|מעצרים)/, topicTerms: ["מעצר", "עצור", "עוצר", "מעצרים"] },
      { trigger: /(חיפוש|לערוך\s+חיפוש|צו\s+חיפוש)/, topicTerms: ["חיפוש", "צו חיפוש"] },
      { trigger: /(חקירה|חשד|לחקור)/, topicTerms: ["חקירה", "חשד", "חקירת"] },
    ];
    const activePairsRR = VERB_TOPIC_PAIRS_RR.filter(p => p.trigger.test(question));
    const computeBonus = (chunkContent: string): number => {
      if (activePairsRR.length === 0) return 0;
      for (const pair of activePairsRR) {
        if (pair.topicTerms.some(t => chunkContent.includes(t))) return 1;
      }
      return 0;
    };

    const docsArr = Array.from(docMap.entries());
    const docScores: Array<{ docId: string; score: number; rawScore: number; bonus: number; title: string; originalIndex: number }> = [];
    for (let i = 0; i < docsArr.length; i++) {
      const [docId, docData] = docsArr[i];
      const raw = rawScores[i] ?? 4;
      const bonus = computeBonus(docData.chunks.join(" "));
      docScores.push({ docId, score: raw + bonus, rawScore: raw, bonus, title: docData.match.document_title, originalIndex: i });
    }

    // Sort by score desc; tiebreak by original retrieval order (preserves upstream vector similarity ranking).
    // Then take top-N — no hard threshold, so semantically-relevant vector hits with score=0 still survive.
    const TOP_N_DOCS = 6;
    const sortedDocs = [...docScores].sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);

    // Hard relevance gate: drop docs with score <= 2 (off-topic).
    // For caselaw specifically: also drop score 3 (only weakly related), unless we'd end up with zero caselaw kept.
    const getDocSourceType = (docId: string): string =>
      docMap.get(docId)?.match.source_type || "";
    const isCaselaw = (docId: string): boolean => {
      const st = getDocSourceType(docId);
      return st === "case_law" || st === "caselaw" || st === "ruling";
    };

    const aboveHardFloor = sortedDocs.filter(d => d.score >= 3);
    const strictKept = aboveHardFloor.filter(d => !isCaselaw(d.docId) || d.score >= 5);
    // Safety valve: if filtering left zero caselaw AND the question itself is caselaw-domain
    // (explicit case markers like בג"ץ, ע"א, פס"ד, פסיקה, הלכה), allow back caselaw with score >= 3.
    // For doctrinal/contract questions, an empty caselaw bucket is fine — legislation/articles carry it.
    const isCaselawDomainQuestion = /(בג"ץ|בג״ץ|ע"א|ע״א|רע"א|רע״א|ע"פ|ע״פ|פס"ד|פס״ד|פסק\s+דין|פסיקה|הלכה|תקדים|בית\s+המשפט\s+העליון)/.test(question);
    const hadCaselaw = sortedDocs.some(d => isCaselaw(d.docId));
    const keptHasCaselaw = strictKept.some(d => isCaselaw(d.docId));
    let baseKept = strictKept;
    if (hadCaselaw && !keptHasCaselaw && isCaselawDomainQuestion) {
      const weakCaselaw = aboveHardFloor.filter(d => isCaselaw(d.docId) && d.score >= 3);
      baseKept = [...strictKept, ...weakCaselaw].sort(
        (a, b) => b.score - a.score || a.originalIndex - b.originalIndex,
      );
    }
    const topDocs = baseKept.slice(0, TOP_N_DOCS);
    const topDocIds = new Set(topDocs.map(d => d.docId));
    const droppedByGate = sortedDocs.length - baseKept.length;

    const result: RankedMatch[] = [];
    const rerankScoreLog: Record<string, string> = {};
    for (const ds of docScores) {
      const tag = ds.bonus > 0 ? `${ds.rawScore}+${ds.bonus}=${ds.score}` : `${ds.score}`;
      rerankScoreLog[ds.title.slice(0, 60)] = tag;
    }
    // Push chunks for top-N docs in score order
    for (const ds of topDocs) {
      for (const m of matches) {
        if (m.document_id === ds.docId) {
          result.push({ ...m, relevanceScore: ds.score });
        }
      }
    }

    const keptDocs = topDocIds.size;
    console.log(`Rerank scores per doc: ${JSON.stringify(rerankScoreLog)}`);
    console.log(`Rerank gate dropped ${droppedByGate} off-topic docs (score<3, or caselaw<4 with caselaw alternatives).`);
    console.log(`Rerank: kept top-${TOP_N_DOCS} of ${docsArr.length} docs by score`);
    console.log(`Local kept after gate + top-${TOP_N_DOCS} slice: ${keptDocs}/${docsArr.length} (active verb pairs: ${activePairsRR.length})`);

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

  // Refund state — hoisted so the outer catch can refund on unexpected throws.
  let __creditsCharged = false;
  let __creditRequestId: string | null = null;
  let __userClientForRefund: ReturnType<typeof createClient> | null = null;

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
    const { question, taskMode, documentText, documentName, academicStep, documentTexts, previousChapters, chapterTitle, chapterIndex, researchQuestion: bodyResearchQuestion, outline: bodyOutline, isAbstract, hasDocument: bodyHasDocument, requestId: clientRequestId } = body;

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return new Response(JSON.stringify({ error: "Question too short" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== Credit gate: consume up-front, refund automatically on failure / empty result =====
    // Cost: 5 for legal QA. Document grounding adds +2 surcharge.
    // Academic sub-modes (suggest_topics, validate_question, propose_outline) cost 0;
    // chapter generation costs 8 (handled below before its own AI call).
    const isAcademicSubModeFree =
      taskMode === "academic_writing" &&
      typeof academicStep === "string" &&
      ["suggest_topics", "validate_question", "propose_outline"].includes(academicStep);
    const isAcademicChapter =
      taskMode === "academic_writing" && academicStep === "write_chapter";
    const hasGroundingDoc =
      (Array.isArray(documentTexts) && documentTexts.length > 0) ||
      (typeof documentText === "string" && documentText.trim().length > 100);

    let creditCost = 5;
    if (isAcademicSubModeFree) creditCost = 0;
    else if (isAcademicChapter) creditCost = 8;
    if (hasGroundingDoc && !isAcademicChapter && !isAcademicSubModeFree) creditCost += 2;

    const creditRequestId =
      typeof clientRequestId === "string" && clientRequestId.length >= 8
        ? clientRequestId
        : crypto.randomUUID();

    // Use a user-scoped client (with the caller's JWT) so consume_credits sees auth.uid()
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    let creditsCharged = false;
    if (creditCost > 0) {
      const { data: consumeData, error: consumeErr } = await userClient.rpc("consume_credits", {
        _amount: creditCost,
        _reason: `legal-qa:${taskMode || "research"}${hasGroundingDoc ? "+doc" : ""}`,
        _request_id: creditRequestId,
      });
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
    }

    // Helper: build a refund-aware payload for refusals / empty results.
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
        } catch (rfErr) {
          console.error("refund_credits failed (non-fatal):", rfErr);
        }
      }
      return { ...payload, refunded, refundReason: refunded ? extraReason : undefined };
    };

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
    // For suggest_topics, validate_question, propose_outline: lighter flow without full retrieval.
    // Also: write_chapter when isAbstract === true, since the abstract is pure synthesis of
    // already-written chapters and must NOT introduce new external citations.
    const isAbstractGeneration =
      taskMode === "academic_writing" && academicStep === "write_chapter" && !!isAbstract;

    if (
      taskMode === "academic_writing" &&
      academicStep &&
      (["suggest_topics", "validate_question", "propose_outline"].includes(academicStep) || isAbstractGeneration)
    ) {
      const subPrompt = getAcademicSubModePrompt(academicStep, body);
      if (!subPrompt) {
        return new Response(JSON.stringify({ error: "Invalid academic step" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Quick local search for context (skipped for abstract — synthesis only)
      let localContext = "";
      if (!isAbstractGeneration) {
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
      }

      // Include multi-file context if available (skipped for abstract)
      let fileContext = "";
      if (!isAbstractGeneration && documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
        fileContext = "\n=== מסמכים שהועלו ===\n" +
          documentTexts.map((dt: any) => `=== ${dt.name} ===\n${dt.text?.slice(0, 5000) || ""}`).join("\n\n");
      }

      const aiRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: isAbstractGeneration ? 1024 : 4096,
          messages: [
            { role: "system", content: subPrompt + localContext + fileContext },
            { role: "user", content: isAbstractGeneration ? "כתוב את התקציר עכשיו, עד 250 מילים בלבד." : question },
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
      let answerText = aiData.choices?.[0]?.message?.content || "";

      // Defensive word-count guard for the abstract (≤250 words). Trim by sentence if exceeded.
      if (isAbstractGeneration && answerText) {
        const words = answerText.trim().split(/\s+/).filter(Boolean);
        if (words.length > 250) {
          console.warn(`Abstract exceeded 250 words (got ${words.length}). Trimming.`);
          // Trim to 250 words at a sentence boundary if possible.
          const truncated = words.slice(0, 250).join(" ");
          const lastStop = Math.max(
            truncated.lastIndexOf("."),
            truncated.lastIndexOf("!"),
            truncated.lastIndexOf("?")
          );
          answerText = lastStop > truncated.length * 0.6
            ? truncated.slice(0, lastStop + 1)
            : truncated + "…";
        }
      }

      console.log(`Academic sub-mode (${academicStep}${isAbstractGeneration ? ":abstract" : ""}): ${answerText.length} chars, ${Date.now() - t0}ms`);

      return new Response(
        JSON.stringify({ answer: answerText, footnotes: [], source_urls: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========= Case Summary short-circuit (strict full-text gate) =========
    if (taskMode === "case_summary") {
      let userSuppliedText = "";
      if (documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
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

      // Defense-in-depth: Hebrew-ratio sanity gate. If the extracted text is mostly
      // non-Hebrew (e.g., binary garbage that slipped through), refuse rather than
      // hallucinate placeholders from noise.
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

      const caseInstructions = getTaskModeInstructions("case_summary");
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

    // ========= pleading_analysis: 150-word guard on audit subject =========
    // Subject = uploaded document text (if any) OR the typed question.
    if (taskMode === "pleading_analysis") {
      let auditSubject = "";
      if (documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
        auditSubject = documentTexts.map((dt: any) => dt.text || "").join("\n\n");
      } else if (documentText && typeof documentText === "string") {
        auditSubject = documentText;
      } else {
        auditSubject = question || "";
      }
      const wordCount = auditSubject.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < 150) {
        const payload = await refundAndPayload("pleading_analysis:too-short", {
          answer: "המסמך שסופק קצר מדי לביקורת מהותית (פחות מ-150 מילים). אנא הדביקו או העלו מסמך מלא יותר.",
          footnotes: [],
          source_urls: [],
        });
        return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

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
        const embedding = data.data?.[0]?.embedding;
        if (!embedding || !Array.isArray(embedding)) {
          console.error(`Embedding returned null for query "${text.slice(0, 40)}..."`);
          return null;
        }
        const sample = embedding.slice(0, 3).map((v: number) => v.toFixed(3));
        console.log(`Embedding generated for query "${text.slice(0, 40)}...": dim=${embedding.length}, sample=[${sample.join(", ")}]`);
        return embedding;
      } catch (err) {
        console.error("Query embedding failed (non-fatal):", err);
        return null;
      }
    }

    const localSearchPromise = (async (): Promise<{ matches: LocalMatch[]; used: boolean }> => {
      try {
        // Step A: optionally expand short queries to a fuller legal phrasing
        const expandedQuery = await expandShortQuery(question, LOVABLE_API_KEY);
        const queriesForEmbedding = expandedQuery ? [question, expandedQuery] : [question];
        const keywordSourceText = expandedQuery ? `${question} ${expandedQuery}` : question;

        const keywords = extractKeywords(keywordSourceText);
        console.log(`Search keywords: "${keywords}" (from: "${question.slice(0, 80)}"${expandedQuery ? ` + expanded` : ""})`);

        // Keyword search (single combined query)
        const keywordPromise = adminClient.rpc("search_legal_chunks_text", {
          search_query: keywords,
          match_count: 15,
        });

        // Vector search — run for original AND expanded query in parallel, merge
        // Threshold 0.45: short Hebrew queries top out ~0.55 raw; re-ranker filters noise downstream.
        const vectorPromises = queriesForEmbedding.map(async (q) => {
          const embedding = await getQueryEmbedding(q);
          if (!embedding) return { data: null, error: null, embedding: null as number[] | null, query: q };
          const result = await adminClient.rpc("match_legal_chunks", {
            query_embedding: JSON.stringify(embedding),
            match_threshold: 0.45,
            match_count: 15,
          });
          return { ...result, embedding, query: q };
        });

        // Fix #2: Parallel caselaw-only vector query so precedent competes against itself
        // (not against denser academic prose). Use the original (non-expanded) question
        // since expansion often drifts toward academic phrasing.
        // Layer 3: lowered threshold 0.40→0.25 and expanded top 8→16 (caselaw embeds lower
        // than academic prose; rerank still gates downstream).
        const caselawVectorPromise = (async () => {
          const embedding = await getQueryEmbedding(question);
          if (!embedding) return { data: null, error: null };
          return await adminClient.rpc("match_legal_chunks_filtered", {
            query_embedding: JSON.stringify(embedding),
            filter_source_type: "caselaw",
            match_threshold: 0.25,
            match_count: 16,
          });
        })();

        // Layer 2: Landmark-case direct injection. When a question matches a topic trigger,
        // unconditionally fetch known landmark cases by case_number and inject them into the
        // candidate pool. They still go through rerank, so off-topic landmarks get filtered.
        const LANDMARK_CASES: Array<{ triggers: RegExp[]; case_numbers: string[] }> = [
          {
            triggers: [/יועמ["״']?ש/, /יועצת\s+המשפטית/, /יועץ\s+המשפטי/],
            case_numbers: ["18225-06-25", "4267/93"],
          },
        ];
        const questionForLandmark = `${question} ${expandedQuery || ""}`;
        const landmarkCaseNumbers = Array.from(new Set(
          LANDMARK_CASES
            .filter(lc => lc.triggers.some(t => t.test(questionForLandmark)))
            .flatMap(lc => lc.case_numbers)
        ));
        const landmarkPromise = (async (): Promise<LocalMatch[]> => {
          if (landmarkCaseNumbers.length === 0) return [];
          const { data: docs, error: docsErr } = await adminClient
            .from("legal_documents")
            .select("id, title, citation, source_type, source_url, metadata, case_number")
            .in("case_number", landmarkCaseNumbers);
          if (docsErr || !docs || docs.length === 0) {
            if (docsErr) console.error(`Landmark fetch error: ${docsErr.message}`);
            return [];
          }
          const docIds = docs.map(d => d.id);
          const { data: chunks, error: chunksErr } = await adminClient
            .from("legal_document_chunks")
            .select("id, document_id, content, chunk_index")
            .in("document_id", docIds)
            .order("chunk_index", { ascending: true });
          if (chunksErr || !chunks) {
            console.error(`Landmark chunks error: ${chunksErr?.message}`);
            return [];
          }
          // Take first 2 chunks per doc to match RPC behavior
          const perDocCount = new Map<string, number>();
          const injected: LocalMatch[] = [];
          for (const c of chunks) {
            const n = perDocCount.get(c.document_id) || 0;
            if (n >= 2) continue;
            perDocCount.set(c.document_id, n + 1);
            const doc = docs.find(d => d.id === c.document_id);
            if (!doc) continue;
            injected.push({
              chunk_id: c.id,
              document_id: c.document_id,
              chunk_content: c.content,
              document_title: doc.title,
              document_citation: doc.citation,
              source_type: doc.source_type,
              source_url: doc.source_url,
              metadata: (doc.metadata || {}) as Record<string, unknown>,
              similarity: 0.50, // moderate floor so it survives merge but doesn't dominate
            });
          }
          console.log(`Landmark injection: triggers=[${landmarkCaseNumbers.join(", ")}] matched ${docs.length} docs / ${injected.length} chunks`);
          return injected;
        })();

        const [keywordResult, caselawResult, landmarkInjected, ...vectorResults] = await Promise.all([
          keywordPromise,
          caselawVectorPromise,
          landmarkPromise,
          ...vectorPromises,
        ]);

        const caselawMatches: LocalMatch[] = (!caselawResult.error && caselawResult.data) ? caselawResult.data as LocalMatch[] : [];
        if (caselawResult.error) {
          console.error(`match_legal_chunks_filtered (caselaw) error: ${caselawResult.error.message || JSON.stringify(caselawResult.error)}`);
        } else {
          console.log(`Caselaw-filtered vector search: ${caselawMatches.length} chunks`);
        }

        const keywordMatches: LocalMatch[] = (!keywordResult.error && keywordResult.data) ? keywordResult.data : [];

        // Surface RPC errors instead of silently dropping
        for (const r of vectorResults) {
          if (r.error) {
            console.error(`match_legal_chunks RPC error for query "${(r.query || "").slice(0, 40)}...": ${r.error.message || JSON.stringify(r.error)}`);
          }
        }
        let vectorMatches: LocalMatch[] = vectorResults.flatMap(r =>
          (!r.error && r.data) ? r.data as LocalMatch[] : []
        );
        // Merge in caselaw-filtered results (Fix #2) AND landmark-injected docs (Layer 2):
        // dedupe by chunk_id, keeping higher similarity
        const vecMap = new Map<string, LocalMatch>();
        for (const m of vectorMatches) vecMap.set(m.chunk_id, m);
        for (const m of caselawMatches) {
          const existing = vecMap.get(m.chunk_id);
          if (!existing || (m.similarity || 0) > (existing.similarity || 0)) {
            vecMap.set(m.chunk_id, m);
          }
        }
        for (const m of landmarkInjected) {
          const existing = vecMap.get(m.chunk_id);
          if (!existing || (m.similarity || 0) > (existing.similarity || 0)) {
            vecMap.set(m.chunk_id, m);
          }
        }
        vectorMatches = Array.from(vecMap.values());

        // Safety-net: if 0 vector hits at 0.45, retry once at 0.35 with the first available embedding
        if (vectorMatches.length === 0) {
          const firstEmbedding = vectorResults.find(r => r.embedding)?.embedding;
          if (firstEmbedding) {
            console.log("Vector search safety-net retry at threshold 0.35");
            const retry = await adminClient.rpc("match_legal_chunks", {
              query_embedding: JSON.stringify(firstEmbedding),
              match_threshold: 0.35,
              match_count: 8,
            });
            if (retry.error) {
              console.error(`Safety-net match_legal_chunks RPC error: ${retry.error.message || JSON.stringify(retry.error)}`);
            } else if (retry.data) {
              vectorMatches = retry.data as LocalMatch[];
              console.log(`Safety-net returned ${vectorMatches.length} chunks at threshold 0.35`);
            }
          }
        }

        // Diagnostic: top-3 raw vector similarities
        const topVectorSims = [...vectorMatches]
          .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
          .slice(0, 3)
          .map(m => (m.similarity || 0).toFixed(3));
        console.log(`Vector search: top 3 raw similarities = [${topVectorSims.join(", ")}]`);
        console.log(`Keyword search: ${keywordMatches.length} results | Vector search: ${vectorMatches.length} results (across ${queriesForEmbedding.length} ${queriesForEmbedding.length === 1 ? "query" : "queries"})`);
        if (keywordMatches.length === 0) {
          console.log(`Keyword search returned 0 results — check Postgres NOTICE logs for fallback chain (top-2 → top-1 → plainto)`);
        }

        // ── Content-aware similarity bonus ──────────────────────────
        // Pair the question's action verbs with their nominal/legal counterparts
        // and award a small bonus to chunks whose content contains the counterpart.
        // This rescues on-topic chunks (e.g. בג"ץ גילון on AG dismissal) that
        // get out-scored by broader articles when the expanded query is generic.
        const VERB_TOPIC_PAIRS: Array<{ trigger: RegExp; topicTerms: string[] }> = [
          { trigger: /(לפטר|פיטור|להדיח|הדחה|להפסיק|הפסקת|לסיים|סיום\s+כהונ)/, topicTerms: ["פיטור", "פיטורי", "הפסקת כהונ", "סיום כהונ", "הדחה", "מנגנון הפסקת", "להפסיק את כהונ", "סיים את כהונ"] },
          { trigger: /(למנות|מינוי|להחליף)/, topicTerms: ["מינוי", "ועדת המינויים", "הליך מינוי", "מתמנה"] },
          { trigger: /(לעצור|מעצר|לעכב|עיכוב)/, topicTerms: ["מעצר", "עיכוב הליכים", "מעצר עד תום ההליכים"] },
          { trigger: /(להחרים|חילוט|תפיסה)/, topicTerms: ["חילוט", "תפיסת רכוש", "החרמה"] },
        ];
        const questionFull = `${question} ${expandedQuery || ""}`;
        const activePairs = VERB_TOPIC_PAIRS.filter(p => p.trigger.test(questionFull));
        if (activePairs.length > 0) {
          console.log(`Content-aware bonus active for triggers: ${activePairs.map(p => p.topicTerms[0]).join(", ")}`);
        }
        const applyBonus = (m: LocalMatch): LocalMatch => {
          if (activePairs.length === 0 || !m.chunk_content) return m;
          const content = m.chunk_content;
          let bonus = 0;
          for (const pair of activePairs) {
            if (pair.topicTerms.some(t => content.includes(t))) {
              bonus = 0.08;
              break;
            }
          }
          return bonus > 0 ? { ...m, similarity: (m.similarity || 0) + bonus } : m;
        };

        // Merge and deduplicate by chunk_id, keeping higher similarity (after bonus)
        const mergedMap = new Map<string, LocalMatch>();
        for (const m of keywordMatches.map(applyBonus)) {
          mergedMap.set(m.chunk_id, m);
        }
        for (const m of vectorMatches.map(applyBonus)) {
          const existing = mergedMap.get(m.chunk_id);
          if (!existing || m.similarity > existing.similarity) {
            mergedMap.set(m.chunk_id, m);
          }
        }

        // Fix #1: Reserve a quota for caselaw so precedent isn't crowded out by
        // denser academic prose. Layer 3: top 6 caselaw + top 6 non-caselaw (was 4/8).
        const sortedAll = Array.from(mergedMap.values())
          .sort((a, b) => b.similarity - a.similarity);
        const caselawTop = sortedAll.filter(m => m.source_type === "caselaw").slice(0, 6);
        const otherTop = sortedAll.filter(m => m.source_type !== "caselaw").slice(0, 6);
        const reservedIds = new Set([...caselawTop, ...otherTop].map(m => m.chunk_id));
        const merged = [...caselawTop, ...otherTop]
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 12);
        const caselawKept = merged.filter(m => m.source_type === "caselaw").length;
        console.log(`Caselaw quota: ${caselawKept} caselaw / ${merged.length - caselawKept} other (total ${merged.length})`);
        // Suppress unused warning
        void reservedIds;

        // Layer 4 diagnostic: report rank/similarity of any landmark case in candidate pool
        if (landmarkCaseNumbers.length > 0) {
          const landmarkChunkIds = new Set(landmarkInjected.map(m => m.chunk_id));
          const landmarkInPool = sortedAll
            .map((m, idx) => ({ m, rank: idx + 1 }))
            .filter(x =>
              landmarkChunkIds.has(x.m.chunk_id) ||
              landmarkCaseNumbers.some(cn => (x.m.metadata as Record<string, unknown>)?.case_number === cn)
            );
          if (landmarkInPool.length === 0) {
            console.log(`Landmark diagnostic: NONE of [${landmarkCaseNumbers.join(", ")}] reached the candidate pool`);
          } else {
            for (const { m, rank } of landmarkInPool) {
              const cn = (m.metadata as Record<string, unknown>)?.case_number || "?";
              const inMerged = merged.some(x => x.chunk_id === m.chunk_id) ? "KEPT" : "DROPPED";
              console.log(`Landmark diagnostic: case_number=${cn} rank=${rank}/${sortedAll.length} sim=${(m.similarity || 0).toFixed(3)} → ${inMerged}`);
            }
          }
        }

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
            match_count: 15,
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
      const payload = await refundAndPayload("legal-qa:no-sources", { error: "לא נמצאו מקורות רלוונטיים. נסו לנסח את השאלה אחרת." });
      return new Response(
        JSON.stringify(payload),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========= Step 2: Build source cards (server-side) =========
    const sourceCards: SourceCard[] = [];
    let cardId = 1;

    // Local sources — build rich citations from structured fields (using re-ranked matches)
    if (rankedMatches.length > 0) {
      const seenDocs = new Set<string>();
      let filteredBrokenKnesset = 0;
      for (const m of rankedMatches) {
        if (seenDocs.has(m.document_id)) continue;
        seenDocs.add(m.document_id);
        if (isBlogUrl(m.source_url || undefined)) continue;

        // Filter broken-title Knesset research docs (placeholder title or flagged in metadata).
        // These have generic "פרטי מסמך" titles from a scraping failure and cannot be cited usefully.
        if (m.source_type === "knesset_research") {
          const titleTrim = (m.document_title || "").trim();
          const metaFlag = (m.metadata as Record<string, unknown> | null)?.broken_title === true;
          if (titleTrim === "פרטי מסמך" || titleTrim === "ללא כותרת" || titleTrim === "" || metaFlag) {
            filteredBrokenKnesset++;
            continue;
          }
        }

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
          m.source_type === "journal_article" ? "מאמר אקדמי" :
          m.source_type === "israeli_law" ? "חקיקה ישראלית" : m.source_type;

        sourceCards.push({
          id: cardId++,
          citation: richCitation,
          source_type: sourceLabel,
          url: m.source_url || undefined,
          provenance: "local",
          excerpt: m.chunk_content.slice(0, 400),
          case_number: m.source_type === "caselaw" ? ((meta.case_number as string) || undefined) : undefined,
        });
      }
      if (filteredBrokenKnesset > 0) {
        console.log(`Filtered ${filteredBrokenKnesset} broken-title knesset docs from source pool`);
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
    console.log(`Final source mix: ${localCount} local / ${perplexityCount} perplexity (+ ${docCount} doc)`);

    // ========= Step 3: Build context for AI (without forcing tool_call) =========
    const contextParts: string[] = [];

    if (hasDocument) {
      contextParts.push(documentContext);
    }

    if (rankedMatches.length > 0) {
      const seenDocs = new Set<string>();
      let localContext = "\n=== [מאומת – מקור אמת לתוכן] מקורות מהמאגר המשפטי המקומי ===\n";
      localContext += "(תוכן הסעיפים, ההלכות והציטוטים המהותיים — חייב להיות מעוגן כאן בלבד)\n";
      for (const m of rankedMatches) {
        if (!seenDocs.has(m.document_id)) {
          seenDocs.add(m.document_id);
          const typeLabel = m.source_type === "caselaw" ? "פסיקה" :
            m.source_type === "knesset_research" ? "מחקר כנסת" :
            m.source_type === "journal_article" ? "מאמר אקדמי" :
            m.source_type === "israeli_law" ? "חקיקה ישראלית" : m.source_type;
          const relevanceTag = m.relevanceScore !== undefined ? ` | רלוונטיות: ${m.relevanceScore}/10` : "";
          localContext += `\n--- [מאומת] ${m.document_title} ---\nסוג מקור: ${typeLabel} | אזכור: ${m.document_citation}${relevanceTag}\n`;
          if (m.source_url) localContext += `קישור: ${m.source_url}\n`;
        }
        localContext += `${m.chunk_content.slice(0, 800)}\n`;
      }
      contextParts.push(localContext);
    }

    if (searchResults) {
      // Trim Perplexity body: keep only lines that look like bibliographic metadata
      // (years, ס"ח/ק"ת + page, volume references, journal/publisher hints).
      // Discard substantive prose so the model cannot lift content claims from it.
      const bibHintRe = /(ס"ח|ס״ח|ק"ת|ק״ת|פ"ד|פ״ד|פד"י|פד״י|כרך|חוברת|עמ['׳]?|עמוד|התש[א-ת"״''׳\-–]+|\b(19|20)\d{2}\b|נבו|תקדין|הוצאת|כתב\s+עת|משפטים|עיוני\s+משפט)/;
      const perplexityLines = searchResults
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && l.length < 400 && bibHintRe.test(l))
        .slice(0, 30);
      const perplexityTrimmed = perplexityLines.join("\n");
      if (perplexityTrimmed) {
        contextParts.push(
          "\n=== [חיצוני – למטא-דאטה ביבליוגרפית בלבד] רמזים מ-Perplexity ===\n" +
          "(אסור לשאוב מכאן תוכן מהותי של סעיפים או הלכות — רק שנים, ס\"ח/ק\"ת, עמוד, כרך, מו\"ל, שם כתב עת)\n" +
          perplexityTrimmed.slice(0, 2000)
        );
      }
    }

    const combinedContext = truncateContext(contextParts.join("\n"), contextCharLimit);

    // Build source catalog string for the AI — tag local vs Perplexity distinctly
    const sourceCatalog = sourceCards.map(
      (sc) => {
        const tag =
          sc.provenance === "local"     ? " [מאומת – מקור אמת לתוכן]" :
          sc.provenance === "perplexity" ? " [חיצוני – למטא-דאטה בלבד]" :
          sc.provenance === "document"   ? " [מסמך משתמש]" : "";
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

כללי שימוש במקורות (חובה — חוק ברזל):

🚫 איסור-על מוחלט – התאמת סימן הפניה למקור:
- **לעולם אל תצרף סימן הפניה [N] לאזכור של חוק/פקודה/תקנה אם הערת השוליים N היא מקור מסוג אחר** (פסק דין, מאמר אקדמי, פרוטוקול וכד'). אזכור של חוק חייב להיות מקושר אך ורק להערת שוליים שהיא ציטוט ביבליוגרפי של אותו חוק עצמו.
- כאשר גוף הטקסט אומר "חוק X", הערת השוליים שמופיעה לידו חייבת להיות הציטוט הביבליוגרפי של חוק X (ראה "חובה – הערת שוליים לחקיקה" למטה). אם אין באפשרותך לייצר ציטוט כזה — **השמט את סימן ההפניה** ואל תצרף מקור אחר במקומו.
- הפרה של כלל זה (קישור למשל בין "חוק החוזים" לפסק דין מענייני משפחה) היא הפרה חמורה ביותר של אמינות התשובה.

- מקורות המסומנים [מאומת – מקור אמת לתוכן] (מהמאגר המשפטי המקומי) הם **מקור האמת היחיד** לכל תוכן מהותי: נוסח סעיפי חוק, הלכות, ציטוטים מפסיקה, וקביעות משפטיות קונקרטיות.
  • כל קביעה מהסוג "סעיף X לחוק Y קובע כי...", "ההלכה ב-Z קבעה כי...", או כל ציטוט נוסח — חייבת להיות מעוגנת בטקסט שמופיע במפורש באחד ממקורות [מאומת].
  • אם אין במקור מקומי טקסט שתומך בקביעה הספציפית — **אסור** לקבוע אותה. נסח כללית ("חוק X מסדיר את הנושא") או השמט לחלוטין.
  • אסור להמציא לשון של סעיף או הלכה גם אם זה "ידע משפטי כללי".
- מקורות המסומנים [חיצוני – למטא-דאטה בלבד] (מ-Perplexity) משמשים אך ורק להשלמת **מטא-דאטה ביבליוגרפית** להערות השוליים: שנת פרסום, מספר ס"ח/ק"ת, מספר עמוד פתיחה, כרך, מו"ל, שם כתב עת, פרטי תיק.
  • **אסור** לשאוב מ-Perplexity קביעות מהותיות על תוכן סעיף, נוסח חוק, או הלכה.
  • אם Perplexity מכיל מידע מהותי שסותר את המקור המקומי — התעלם ממנו לחלוטין. המקומי גובר תמיד.
- בקונפליקט בין שני סוגי המקורות על תוכן/נוסח — המקומי גובר באופן מוחלט.
- אם המקורות [מאומת] רלוונטיים מהותית לשאלה — העדף אותם וצטט ככל האפשר. אך אם המקורות [מאומת] עוסקים בנושא אחר לחלוטין (למשל פסק דין מענייני משפחה כשהשאלה היא על דיני חוזים מסחריים) — **אל תצטט אותם בכלל**, גם אם המשמעות היא תשובה עם פחות הערות שוליים מקומיות. ציטוט מקור [מאומת] לא רלוונטי הוא הפרה חמורה — עדיף תשובה הנשענת על Perplexity וחקיקה מאשר להלביש מקור [מאומת] לא קשור על קביעה שאינה נובעת ממנו.

חריג מותר – הערת שוליים לחקיקה שהוזכרה במפורש:
- כאשר השאלה או גוף התשובה מאזכרים במפורש שם של חוק/פקודה/תקנה ספציפיים (למשל "חוק החוזים (חלק כללי)", "פקודת הנזיקין", "תקנות סדר הדין האזרחי"), מותר להוסיף הערת שוליים אחת לחקיקה זו גם אם החוק עצמו אינו מופיע במקורות [מאומת].
- את פרטי הפרסום (ס"ח/ק"ת, מספר עמוד, שנה) יש לקחת **אך ורק** ממקור [חיצוני – למטא-דאטה בלבד] של Perplexity. אם אין שם פרטי פרסום — כתוב "(לא נמצאו פרטי פרסום)" אחרי שם החוק. **אסור להמציא** מספרי ס"ח, עמודים או שנים.
- חריג זה חל רק על הציטוט הביבליוגרפי של החוק. **אסור** לצטט את לשון הסעיף או לקבוע מה החוק "קובע" אלא אם זה מעוגן במקור [מאומת].
- דוגמה מותרת: 'חוק החוזים (חלק כללי), התשל"ג-1973, ס"ח 118.' או 'חוק החוזים (חלק כללי) (לא נמצאו פרטי פרסום).'

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

איסור מוחלט – הערות שוליים שהן רק URL:
- **אסור** לכתוב הערת שוליים שכל תוכנה הוא כתובת URL (למשל "https://fs.knesset.gov.il/..." או "https://lawjournal.huji.ac.il/..."). זוהי הפרה של כללי האזכור האחיד.
- אם יש לך מקור [חיצוני] שמכיל URL בלבד, עליך לבחור אחת משתי אפשרויות:
  (1) לעצב הפניה מלאה לפי כללי האזכור האחיד (מחבר, כותרת, כתב עת, שנה, עמוד) על סמך מטא-דאטה שמופיעה בשורות [חיצוני] של Perplexity, או
  (2) **להשמיט את הערת השוליים לחלוטין** ולנסח את הקביעה ללא הפניה.
- כלל 34.2 (URL כהפניה) חל **אך ורק** על מקורות שהם אתר אינטרנט מובהק (בלוג, אתר ארגון, פוסט) — **לא** על פרוטוקולי כנסת, מאמרים אקדמיים בפורמט PDF, או מסמכים משפטיים אחרים שיש להם פורמט אזכור משלהם.
- פרוטוקולי ועדות כנסת: אם אין לך פרטי פרסום מלאים (שם הוועדה, מספר ישיבה, תאריך) — **השמט** את ההפניה במקום לכתוב URL.

לכל מקור מקומי [מאומת] — עצב את ההפניה מהפרטים שסופקו (מספר תיק, שמות צדדים, ערכאה, תאריך) לפי כלל 18 (פסיקה) או הכלל המתאים.

חובה – הערת שוליים לחקיקה שהוזכרה במפורש (מימוש החריג):
- בכל פעם שגוף התשובה מאזכר במפורש שם של חוק/פקודה/תקנה ספציפיים (לדוגמה: "חוק החוזים", "חוק החוזים האחידים", "חוק המחאת חיובים", "פקודת הנזיקין", "חוק חוזה הביטוח", "חוק-יסוד: כבוד האדם וחירותו", "תקנות סדר הדין האזרחי") — **חובה** להוסיף הערת שוליים אחת לאותה חקיקה בהופעתה הראשונה.
- את פרטי הפרסום (ס"ח/ק"ת, מספר עמוד, שנה עברית) קח מהשורות [חיצוני] של Perplexity אם יש שם מידע מתאים.
- אם אין פרטי פרסום ב-Perplexity — כתוב את שם החוק המלא בלבד עם "(לא נמצאו פרטי פרסום)". דוגמה: 'חוק החוזים (חלק כללי) (לא נמצאו פרטי פרסום).'
- **אסור להמציא** מספרי ס"ח, עמודים או שנים. עדיף "(לא נמצאו פרטי פרסום)" מאשר נתון בדוי.
- חריג זה הוא לציטוט הביבליוגרפי בלבד. **אסור** לקבוע מה החוק "קובע" בגוף הטקסט אלא אם מעוגן במקור [מאומת].

רשימת מקורות זמינים:
${sourceCatalog}

הקשר מהמקורות:
${combinedContext}`;

    const promptLen = systemPrompt.length;
    console.log(`Prompt length: ${promptLen} chars, ${sourceCards.length} source cards`);

    const aiMaxTokens = isAcademicMode ? 12288 : 8192;
    // For pleading_analysis with an uploaded document: the document IS the audit subject,
    // and the typed `question` becomes optional user instructions/focus directives.
    const isPleadingWithDoc = taskMode === "pleading_analysis" && (bodyHasDocument || hasDocument);
    const userMessage = isPleadingWithDoc
      ? `המסמך לבדיקה צורף בהקשר המקורות שלמעלה (תחת "=== מסמך: ... ==="). בצע עליו את פרוטוקול הביקורת המלא.

הנחיות נוספות מהמשתמש (אם קיימות — תן להן עדיפות בנוסף לפרוטוקול המלא):
${question.trim() || "ללא הנחיות נוספות — בצע ביקורת מקיפה לפי כל הפרוטוקולים."}`
      : `השאלה המשפטית: ${question}`;

    const aiBody = JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: aiMaxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
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
      // High-frequency Knesset / government / legislative boilerplate that
      // produces false matches against generic page titles.
      "כנסת", "דיון", "ישיבה", "הצעת", "חוקים", "ועדה", "פרוטוקול",
      "מליאה", "ממשלה", "משרד", "הוראות", "תיקון", "מספר", "לעניין",
    ]);

    function normalize(s: string): string {
      return s.toLowerCase().replace(/[״"׳'.,;:()\[\]{}]/g, " ").replace(/\s+/g, " ").trim();
    }

    function matchFootnoteToCard(fnText: string, cards: SourceCard[], fnNum?: number): SourceCard | null {
      const fnLower = fnText.toLowerCase();
      const fnNorm = normalize(fnText);

      // ===== Tier 1: strict identifier matches =====

      // 1a. Exact case number match (e.g., 1234/22) — check both citation text and structured field
      const fnCaseNums = Array.from(fnText.matchAll(/\b(\d{2,5}\/\d{2,4})\b/g)).map(m => m[1]);
      if (fnCaseNums.length > 0) {
        for (const card of cards) {
          for (const cn of fnCaseNums) {
            if (card.citation.includes(cn)) return card;
            if (card.case_number && card.case_number.includes(cn)) return card;
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

      // ===== Tier 2: significant-word overlap =====
      // Significant = length ≥ 4, not a stopword.
      // Both local DB cards and Perplexity cards require ≥3 overlap.
      // Perplexity cards additionally require ≥1 "topic-bearing" word (length ≥5,
      // not a stopword) to overlap — this prevents matches that rely only on
      // generic Knesset/legislative boilerplate (e.g. "כנסת"/"דיון"/"הצעת"/"חוק").
      for (const card of cards) {
        const cardWords = normalize(card.citation)
          .split(/\s+/)
          .filter(w => w.length >= 4 && !STOPWORDS.has(w));
        if (cardWords.length < 2) continue;
        const uniqueCardWords = Array.from(new Set(cardWords));
        const overlap = uniqueCardWords.filter(w => fnNorm.includes(w));
        const matchCount = overlap.length;
        if (matchCount < 3) continue;

        if (card.provenance === "perplexity") {
          const hasTopicWord = overlap.some(w => w.length >= 5 && !STOPWORDS.has(w));
          if (!hasTopicWord) {
            console.log(
              `Rejected Perplexity match for fn #${fnNum ?? "?"}: only generic words overlapped with card "${card.citation.slice(0, 80)}" — overlap=[${overlap.join(", ")}]`
            );
            continue;
          }
        }
        return card;
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
        const matchedCard = matchFootnoteToCard(aiFn.text, sourceCards, aiFn.num);
        if (!matchedCard) {
          // ── Fuzzy URL fallback: try to attach a URL via token overlap ──
          let fuzzyUrl: string | undefined;
          let fuzzyMatchedTitle: string | undefined;
          let fuzzyMatchedTokens: string[] = [];
          try {
            const fnText = aiFn.text;
            // Extract distinctive tokens:
            // 1) Case numbers like 338/60 or 35327-08-20
            const caseNumberMatches = Array.from(fnText.matchAll(/\b(\d{2,6}[-\/]\d{2,6}(?:[-\/]\d{2,6})?)\b/g)).map(m => m[1]);
            // 2) Latin all-caps tokens (≥3 letters), e.g. WOLT
            const latinTokens = Array.from(fnText.matchAll(/\b([A-Z]{3,}(?:\s+[A-Z]{2,})*)\b/g)).map(m => m[1]);
            // 3) Hebrew tokens between ** ** markers (party names)
            const boldTokens = Array.from(fnText.matchAll(/\*\*([^*]{2,40})\*\*/g)).map(m => m[1].trim());
            const distinctive = Array.from(new Set([...caseNumberMatches, ...latinTokens, ...boldTokens]));

            if (distinctive.length > 0) {
              for (const card of sourceCards) {
                if (!card.url) continue;
                const haystack = `${card.citation} ${card.case_number || ""} ${card.url} ${card.excerpt || ""}`.toLowerCase();
                const hits: string[] = [];
                for (const tok of distinctive) {
                  if (!tok) continue;
                  if (haystack.includes(tok.toLowerCase())) hits.push(tok);
                }
                // Match if: any case-number hit, OR ≥2 distinctive token hits
                const hasCaseNumberHit = caseNumberMatches.some(cn => hits.includes(cn));
                if (hasCaseNumberHit || hits.length >= 2) {
                  fuzzyUrl = card.url;
                  fuzzyMatchedTitle = card.citation.slice(0, 60);
                  fuzzyMatchedTokens = hits;
                  break;
                }
              }
            }
          } catch (e) {
            console.warn(`Fuzzy URL match error for footnote #${aiFn.num}:`, e);
          }

          if (fuzzyUrl) {
            console.log(`Fuzzy URL match: footnote #${aiFn.num} → "${fuzzyMatchedTitle}" (matched on: ${fuzzyMatchedTokens.join(", ")})`);
            footnotes.push({
              number: fnNum,
              citation: aiFn.text,
              source_type: "unverified",
              source: "unverified",
              url: fuzzyUrl,
            });
            oldIdToNewNumber.set(aiFn.num, fnNum);
            fnNum++;
            continue;
          }

          console.log(`Kept footnote #${aiFn.num} without URL (no card match): ${aiFn.text.slice(0, 80)}...`);
          footnotes.push({
            number: fnNum,
            citation: aiFn.text,
            source_type: "unverified",
            source: "unverified",
          });
          oldIdToNewNumber.set(aiFn.num, fnNum);
          fnNum++;
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

    // Content-aware "לעיל ה"ש" validator: ensure target footnote actually contains the same source.
    // Extracts identity keys (author surname, case number, law name) from each footnote
    // and rewrites mismatched back-refs to point at the earliest matching full-citation.
    const SUPRA_FULL = new RegExp(SUPRA_P + '(\\d{1,2})');
    const normalizeKey = (s: string) =>
      s
        .replace(/["'\u05F4\u201C\u201D\u2018\u2019׳]/g, "")
        .replace(/[.,;:!?\-–—()\[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    // Extract identity keys from a citation. Returns multiple candidate keys (case#, law name, author).
    const extractIdentityKeys = (citation: string): string[] => {
      const keys: string[] = [];
      // Skip if this citation is itself just a back-ref (no full content)
      if (SUPRA_FULL.test(citation) && citation.length < 80) {
        // It's likely a short-form — still try to extract author/law for matching
      }

      // 1. Case number patterns (e.g., 35327-08-20, 10007/09)
      const caseNumMatches = citation.match(/\d{3,6}[-\/]\d{1,4}([-\/]\d{1,4})?/g);
      if (caseNumMatches) {
        for (const cn of caseNumMatches) keys.push(normalizeKey(cn));
      }

      // 2. Law/regulation name (text starting with חוק/פקודת/תקנות/חוק-יסוד up to first comma)
      const lawMatch = citation.match(/^\s*((?:חוק[- ]יסוד|חוק|פקודת|פקודה|תקנות|צו|כללי)\s+[\u0590-\u05FF"׳״\s'\-]+?)(?:,|$)/);
      if (lawMatch) keys.push(normalizeKey(lawMatch[1]));

      // 3. Author surname: first 1-2 Hebrew words appearing before an opening quote (article/book title)
      // Strip leading non-Hebrew/whitespace
      const authorMatch = citation.match(/^\s*([\u0590-\u05FF]+(?:\s+[\u0590-\u05FF]+)?)\s+["\u201C\u05F4]/);
      if (authorMatch) {
        const author = authorMatch[1];
        // Avoid matching law-prefix words as authors
        if (!/^(חוק|פקודת|פקודה|תקנות|צו|כללי|בג"ץ|בג״ץ)/.test(author)) {
          keys.push(normalizeKey(author));
        }
      }

      return Array.from(new Set(keys.filter((k) => k.length >= 3)));
    };

    // Extract back-ref key from a short-form footnote (text before ", לעיל ה"ש X")
    const extractBackRefKey = (citation: string): string[] => {
      const supraIdx = citation.search(new RegExp(SUPRA_P));
      if (supraIdx < 0) return [];
      // Take text before the supra phrase, strip trailing comma/pinpoint clauses
      let prefix = citation.slice(0, supraIdx).trim().replace(/[,،]\s*$/, "").trim();
      // Strip trailing pinpoint clause (last comma-separated segment if it looks like a pinpoint)
      const parts = prefix.split(/,\s*/);
      if (parts.length > 1) {
        const last = parts[parts.length - 1];
        if (/^(ס['׳]|סעיף|עמ['׳]|עמוד|פס['׳]|פסקה|פיסקה|תק['׳]|תקנה)\b/.test(last) || /^\d/.test(last)) {
          prefix = parts.slice(0, -1).join(", ").trim();
        }
      }
      return extractIdentityKeys(prefix + ' "x"'); // add fake quote so author regex hits
    };

    // Pre-compute identity keys for every footnote (only for those that look like full citations)
    const fnKeys = new Map<number, string[]>();
    for (const fn of footnotes) {
      // Skip footnotes that are themselves back-refs (no full content to match against)
      const isShortForm = SUPRA_FULL.test(fn.citation) || /^שם\b/.test(fn.citation.trim());
      if (isShortForm) {
        fnKeys.set(fn.number, []);
      } else {
        fnKeys.set(fn.number, extractIdentityKeys(fn.citation));
      }
    }

    // Validate and rewrite back-refs
    for (const fn of footnotes) {
      const refMatch = fn.citation.match(new RegExp(SUPRA_P + '(\\d{1,2})'));
      if (!refMatch) continue;
      const aiTargetNum = parseInt(refMatch[1], 10);
      const backRefKeys = extractBackRefKey(fn.citation);
      if (backRefKeys.length === 0) continue;

      // Find earliest-numbered footnote (before current) whose keys overlap
      let bestMatch: number | null = null;
      const sortedFns = [...footnotes].sort((a, b) => a.number - b.number);
      for (const candidate of sortedFns) {
        if (candidate.number >= fn.number) break;
        const candKeys = fnKeys.get(candidate.number) || [];
        if (candKeys.some((ck) => backRefKeys.some((bk) => ck === bk || ck.includes(bk) || bk.includes(ck)))) {
          bestMatch = candidate.number;
          break;
        }
      }

      if (bestMatch !== null && bestMatch !== aiTargetNum) {
        const before = fn.citation;
        fn.citation = fn.citation.replace(
          new RegExp(SUPRA_P + '\\d{1,2}'),
          `לעיל ה"ש ${bestMatch}`
        );
        console.log(
          `Corrected back-ref in FN #${fn.number}: "${backRefKeys.join("|").slice(0, 60)}" → ה"ש ${aiTargetNum} became ה"ש ${bestMatch}`
        );
        console.log(`  before: ${before.slice(0, 120)}`);
        console.log(`  after:  ${fn.citation.slice(0, 120)}`);
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

    // Filter footnotes that are bare URLs / URL-only (violation of citation rules) or too short, then renumber
    const URL_ONLY_RE = /^(?:\[?\s*)?https?:\/\/\S+(?:\s*\([^)]*\))?\s*\.?\s*$/i;
    const isUrlOnly = (txt: string): boolean => {
      const t = txt.trim();
      if (!t) return false;
      // strip trailing parenthetical date like "(10.04.2024)" and trailing punctuation, then check
      const stripped = t.replace(/\s*\([^)]*\)\s*\.?$/, "").replace(/\.$/, "").trim();
      return URL_ONLY_RE.test(t) || /^https?:\/\/\S+$/i.test(stripped);
    };
    const validFootnotes = footnotes.filter(
      (fn) => fn.citation.trim().length >= 10 && !isUrlOnly(fn.citation),
    );
    if (validFootnotes.length !== footnotes.length) {
      const droppedUrlOnly = footnotes.filter((fn) => isUrlOnly(fn.citation)).length;
      const droppedShort = footnotes.filter((fn) => fn.citation.trim().length < 10).length;
      if (droppedUrlOnly > 0) console.log(`Dropped ${droppedUrlOnly} URL-only footnotes (rule violation)`);
      if (droppedShort > 0) console.log(`Dropped ${droppedShort} too-short footnotes`);
      const removedNumbers = new Set(
        footnotes
          .filter((fn) => fn.citation.trim().length < 10 || isUrlOnly(fn.citation))
          .map((fn) => fn.number),
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

    // ===== Post-response grounding sanity check (log-only, non-blocking) =====
    // Detect substantive statutory claims (סעיף X ל-Y ... קובע/מורה/מגדיר/אוסר/מחייב/מתיר)
    // and verify the section number + law name hint appear in at least one local chunk.
    try {
      const localCorpus = rankedMatches.map((m) => m.chunk_content || "").join("\n");
      const claimRe = /סעיף\s+([\dא-ת()'״"׳./\\–-]+)\s+ל([^\s,.;:()\[\]{}"״']{2,40})\s+[^.]{0,80}?(קובע|מורה|מגדיר|אוסר|מחייב|מתיר)/g;
      const violations: string[] = [];
      let cm: RegExpExecArray | null;
      while ((cm = claimRe.exec(answer)) !== null) {
        const sectionNum = cm[1];
        const lawHint = cm[2];
        const escSec = sectionNum.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const sectionInLocal = new RegExp(`סעיף\\s+${escSec}\\b`).test(localCorpus);
        const lawInLocal = localCorpus.includes(lawHint);
        if (!sectionInLocal || !lawInLocal) {
          violations.push(`סעיף ${sectionNum} ל${lawHint} (section=${sectionInLocal}, law=${lawInLocal})`);
        }
      }
      if (violations.length > 0) {
        console.warn(
          `[content-grounding-violation] ${violations.length} ungrounded statutory claim(s):`,
          violations.slice(0, 5)
        );
      }
    } catch (gErr) {
      console.error("Grounding check failed (non-fatal):", gErr);
    }

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
    // Best-effort refund: this catch may run before creditsCharged is in scope; we use a fresh client.
    try {
      const reqBody = (e as { __requestBody?: unknown })?.__requestBody;
      // No-op placeholder; real refund attempted in inner scope. The outer catch covers
      // truly unexpected throws where we've already lost the consume context.
    } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ error: "שגיאה בעיבוד השאלה. נסו שוב." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
