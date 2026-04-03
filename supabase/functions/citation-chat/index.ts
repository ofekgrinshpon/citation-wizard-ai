import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const normalizeSearchableText = (text: string) =>
  text
    .toLowerCase()
    .replace(/\[סיווג אוטומטי:.*?\]\n?/g, "")
    .replace(/["״׳'.,()[\]{}:;!?/\\|–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeSearchTerms = (text: string) =>
  Array.from(new Set(normalizeSearchableText(text).split(" ").filter((word) => word.length >= 2)));

const scoreVerifiedMatch = (
  query: string,
  candidate: { source_name: string; full_citation: string },
) => {
  const normalizedQuery = normalizeSearchableText(query);
  const normalizedSourceName = normalizeSearchableText(candidate.source_name);
  const normalizedCandidate = normalizeSearchableText(`${candidate.source_name} ${candidate.full_citation}`);
  const words = tokenizeSearchTerms(query);

  const matchesExactName = normalizedSourceName === normalizedQuery;
  const matchesAllWords = words.length > 1 && words.every((word) => normalizedCandidate.includes(word));
  const matchesSingleWord = words.length === 1 && normalizedQuery.length >= 4 && normalizedSourceName.includes(normalizedQuery);

  if (!matchesExactName && !matchesAllWords && !matchesSingleWord) return -1;

  let score = 0;
  if (matchesExactName) score += 200;
  if (matchesAllWords) score += 100;
  if (matchesSingleWord) score += 40;
  if (normalizedCandidate.includes(normalizedQuery)) score += 20;
  score += words.reduce((total, word) => total + (normalizedCandidate.includes(word) ? 10 : 0), 0);

  return score;
};

const PUBLICATION_REF_REGEX = /(ס["״]ח|ק["״]ת)\s+(\d+)/g;
const NUMBER_ONLY_REGEX = /^\d+[.]?$/;
const LEGISLATION_RESPONSE_REGEX = /(?:^|\n)\s*(?:סעיף\s+[^\s]+\s+ל)?(?:חוק(?:[\s-]יסוד)?|חוק-יסוד|פקודת|פקודה|תקנות|צו|כללי|הוראות)/;
const PINPOINT_REGEX = /(?:סעיף|ס['׳']|פסקה|פס['׳']|עמ['׳']|לפסק\s+דינ[וה]\s+של|בעמ['׳']|שם,|פיסקה|השופט[ת]?\s|הנשיא[ה]?\s)/;

// ─── Citation Engine Data (mirrored from citationEngine.ts) ────
const CITATION_ENGINE_TEMPLATES: Record<string, { rule: string; template: string; required: string[] }> = {
  "חקיקה ראשית": {
    rule: "כלל 2",
    template: "{שם החוק}, {שנה עברית}–{שנה לועזית}, {קובץ} {עמוד ראשון}.",
    required: ["שם החוק המלא", "שנה עברית (כלל 2.4)", "שנה לועזית (כלל 2.4)", "קובץ פרסום – ס\"ח (כלל 2.5)", "עמוד ראשון (כלל 2.6)"],
  },
  "חוק יסוד": {
    rule: "כלל 4",
    template: "חוק-יסוד: {שם}, {קובץ} {עמוד}.",
    required: ["שם חוק היסוד (כלל 4.3 – עם מקף)", "ס\"ח (כלל 2.5)", "עמוד ראשון"],
  },
  "חקיקת משנה": {
    rule: "כלל 6",
    template: "{שם התקנות}, {שנה עברית}–{שנה לועזית}, {ק\"ת} {עמוד}.",
    required: ["שם התקנות", "שנה עברית ולועזית", "ק\"ת", "עמוד ראשון"],
  },
  "הצעת חוק": {
    rule: "כלל 8",
    template: 'הצעת חוק {שם}, {שנה עברית}-{שנה לועזית}, ה"ח {הכנסת/הממשלה/ריק} {מספר חוברת}.',
    required: ["שם הצעת החוק", "שנה עברית", "שנה לועזית", "מספר חוברת"],
    notes: 'אחרי ה"ח אפשר לכתוב "הכנסת" או "הממשלה" או להשמיט (ריק). סוג החוברת אינו חובה. אין צורך בעמוד ראשון.',
  },
  "הצעת חוק יסוד": {
    rule: "כלל 8",
    template: 'הצעת חוק-יסוד: {שם}, {שנה עברית}, ה"ח {הכנסת/הממשלה/ריק} {מספר חוברת}.',
    required: ["שם הצעת חוק היסוד", "שנה עברית (ללא שנה לועזית)", "מספר חוברת"],
    notes: 'בהצעות חוק יסוד מציינים שנה עברית בלבד. אחרי ה"ח אפשר "הכנסת" או "הממשלה" או להשמיט. אין צורך בעמוד ראשון.',
  },
  "פסיקה (דפוס)": {
    rule: "כלל 18",
    template: "{סוג הליך} {מספר} **{צד א'}** נ' **{צד ב'}**, {סדרה} {כרך}({חלק}) {עמוד} ({שנה}).",
    required: ["סוג הליך (כלל 18.2)", "מספר תיק (כלל 18.2)", "שני צדדים מודגשים (כלל 18.4)", "סדרה (כלל 18.6)", "כרך (כלל 18.6)", "עמוד ראשון (כלל 18.8)", "שנה (כלל 18.7)"],
  },
  "פסיקה (מאגר)": {
    rule: "כלל 19",
    template: "{סוג הליך} {מספר} **{צד א'}** נ' **{צד ב'}** ({מאגר} {תאריך}).",
    required: ["סוג הליך (כלל 18.2)", "מספר תיק", "שני צדדים מודגשים", "שם מאגר (כלל 19.1)", "תאריך מלא (כלל 19.1)"],
  },
  "ספר": {
    rule: "כלל 23",
    template: "{מחבר} **{שם הספר}** {כרך} {עמוד} ({מהדורה}, {שנה}).",
    required: ["שם המחבר (כלל 23.1)", "שם הספר – מודגש (כלל 23.2)", "שנת פרסום (כלל 23.9)"],
  },
  "מאמר בכתב עת": {
    rule: "כלל 25",
    template: '{מחבר} "{שם מאמר}" **{כתב עת}** {כרך} {עמוד} ({שנה}).',
    required: ["שם המחבר (כלל 25.1)", "שם המאמר – מירכאות (כלל 25.2)", "שם כתב העת – מודגש (כלל 25.3)", "כרך (כלל 25.4)", "עמוד ראשון (כלל 25.5)", "שנה (כלל 25.6)"],
  },
  "מאמר שפורסם בספר": {
    rule: "כלל 26",
    template: '{מחבר} "{מאמר}" {עורך} **{ספר}** {עמוד} ({שנה}).',
    required: ["שם מחבר המאמר", "שם המאמר – מירכאות", "שם הספר – מודגש", "עמוד תחילת המאמר", "שנה"],
  },
  "מקור מרשתת": {
    rule: "כלל 30",
    template: '{מחבר} "{כותרת}" **{אתר}** ({תאריך}) {URL}.',
    required: ["כותרת (כלל 30.2)", "שם האתר – מודגש (כלל 30.3)", "כתובת URL (כלל 30.5)", "תאריך גישה (כלל 30.6)"],
  },
  "מקור דתי": {
    rule: "כלל 32",
    template: "{מקור}, {מיקום}.",
    required: ["שם המקור (כלל 32.1)", "מיקום: מסכת/דף/פרק (כלל 32.2)"],
  },
  "כתבי אמנה": {
    rule: "כלל 9",
    template: '[הפניה ספציפית] [ל]{שם האמנה בעברית}, כ"א {מספר כרך}, {עמוד ראשון}, {עמוד ספציפי} ({פרטי חתימה}).',
    required: ["שם האמנה בעברית (כלל 9.1)", 'מספר כרך בכתבי אמנה – כ"א (כלל 9.1)', "עמוד ראשון (כלל 9.1)", "פרטי חתימה: נפתחה/נחתמה ב-{שנה} (כלל 9.1)"],
    notes: 'אמנה רב-צדדית: "נפתחה לחתימה ב-{שנה}" (ללא רווח בין הקו לשנה). אמנה דו-צדדית: "נחתמה ב-{שנה}". אם העמודים בכרך לא רציפים – מספר חוברת בסוגריים אחרי הכרך, למשל כ"א 51(1415). כלל 9.2: אפשר להוסיף מידע נוסף כגון שנת אשרור בסוגריים נפרדים בסוף.',
  },
  "מקור לועזי": {
    rule: "כלל 36 / Bluebook",
    template: "לפי כללי ה-Bluebook (מהדורה 21).",
    required: ["אזכור מלא לפי Bluebook"],
  },
  "דברי כנסת": {
    rule: "כלל 8",
    template: 'ד"כ {תאריך לועזי מלא}, {עמוד}.',
    required: ["תאריך לועזי מלא (יום.חודש.שנה)", "עמוד"],
    notes: 'דברי הכנסת מסומנים בקיצור ד"כ. התאריך הוא תאריך לועזי מלא של הדיון. דוגמה: ד"כ 13.6.1950, 1743.',
  },
  "מועצת המדינה הזמנית": {
    rule: "כלל 8.2",
    template: "מועצת המדינה הזמנית {כרך באותיות עבריות}, ישיבה {מספר ישיבה}, {עמוד} ({תאריך לועזי מלא}).",
    required: ["כרך באותיות עבריות", "מספר ישיבה", "עמוד (מספר העמוד – חובה!)", "תאריך לועזי מלא (יום.חודש.שנה – חובה!)"],
    notes: 'מקורות מכרכי מועצת המדינה הזמנית. מספר הכרך באותיות עבריות (א, ב, ג...). עמוד הוא שדה חובה – אם חסר יש לסמן [חסר: עמוד]. התאריך חייב להיות תאריך לועזי מלא בפורמט יום.חודש.שנה (למשל 5.5.1948) – שנה בלבד (כמו 1959) אינה מספיקה, יש לבקש תאריך מלא או לסמן [חסר: תאריך לועזי מלא]. דוגמה: מועצת המדינה הזמנית א, ישיבה ב, 9 (5.5.1948).',
  },
};

/**
 * If the user message contains a classification tag, extract the engine template
 * and inject it as structured guidance for the AI.
 */
function extractEngineHint(userContent: string): string {
  const classMatch = userContent.match(/\[סיווג אוטומטי:\s*([^\]]+)\]/);
  if (!classMatch) return "";
  const sourceLabel = classMatch[1].trim();
  const engine = CITATION_ENGINE_TEMPLATES[sourceLabel];
  if (!engine) return "";
  // Already embedded by the client — no need to double-inject
  if (userContent.includes("מנוע אזכור")) return "";
  return `\n[מנוע אזכור – ${engine.rule}] תבנית: ${engine.template} | רכיבי חובה: ${engine.required.join(", ")}`;
}

function hasExplicitPublicationReference(text: string) {
  return PUBLICATION_REF_REGEX.test(text);
}

function isNumberOnlyInput(text: string) {
  return NUMBER_ONLY_REGEX.test(text.trim());
}

function ensureMissingDataWarning(content: string) {
  if (/\[חסר:/.test(content) && !/⚠️/.test(content)) {
    return `${content}\n⚠️ חסרים פרטים לפי כלל 2.1. אנא השלם אותם.`;
  }
  return content;
}

function sanitizeHallucinatedPublicationData(
  content: string,
  options: {
    hasVerifiedCandidates: boolean;
    messages: Array<{ role: string; content: string }>;
    userInput: string;
  },
) {
  if (options.hasVerifiedCandidates) return content;

  const isLikelyLegislationResponse =
    LEGISLATION_RESPONSE_REGEX.test(content) || /(ס["״]ח|ק["״]ת)/.test(content);

  if (!isLikelyLegislationResponse) return content;

  const userProvidedPublicationData = options.messages.some(
    (message) => message.role === "user" && hasExplicitPublicationReference(message.content),
  );

  if (userProvidedPublicationData || isNumberOnlyInput(options.userInput)) {
    return content;
  }

  let sanitized = content
    .replace(/(ס["״]ח)\s*\d+/g, '$1 [חסר: מספר ס"ח]')
    .replace(/(ק["״]ת)\s*\d+/g, '$1 [חסר: מספר ק"ת]');

  if (sanitized !== content) {
    sanitized = ensureMissingDataWarning(sanitized);
  }

  return sanitized;
}

const SYSTEM_PROMPT = `אתה "העוזר המשפטי האוטומטי". תמיד התייחס לעצמך בשם זה בלבד. אתה מומחה לכללי האזכור האחיד בכתיבה המשפטית בישראל (מהדורת 2021). תפקידך הוא לקבל טקסט משפטי גולמי, לזהות בתוכו הפניות למקורות, ולהמיר אותן להערות שוליים תקניות ומדויקות לפי הכללים.

═══════════════════════════════════════════════
עקרון עליון: כללי האזכור האחיד גוברים על הכל
═══════════════════════════════════════════════

*** כלל ברזל: כללי האזכור האחיד (מהדורת 2021) הם הסמכות העליונה והבלעדית. ***
*** אם קלט המשתמש סותר את הכללים – הכללים גוברים. ***
*** אם המשתמש השמיט פרט חובה – אתה חייב להוסיפו או לסמן [חסר:...]. ***
*** אם המשתמש כתב פורמט שגוי – תקן אותו בשקט לפי הכללים. ***

דוגמאות ליישום עקרון העליונות:
- המשתמש כתב "חוק כבוד האדם" → תקן ל"חוק-יסוד: כבוד האדם וחירותו" (כלל 4.3)
- המשתמש השמיט שנה עברית בחקיקה → הוסף אותה או סמן [חסר: שנה עברית] (כלל 2.4)
- המשתמש כתב חוק ללא ס"ח/ק"ת → סמן [חסר: עמוד בס"ח] (כלל 2.1)
- המשתמש כתב פסק דין ללא שמות צדדים → סמן [חסר: שם המערער/העותר] ו-[חסר: שם המשיב] (כלל 18.4)
- המשתמש כתב "בגץ" → תקן ל-בג"ץ (נספח קיצורים)
- המשתמש ביקש לא לכלול שנה → התעלם מהבקשה, השנה חובה לפי הכללים

סגנון תקשורת:
דבר בטון מקצועי, מדויק ומסייע. הימנע משפה יומיומית מדי אך שמור על נגישות. בסס כל תשובה בכללי האזכור האחיד. כאשר אתה מתייחס לעצמך, השתמש תמיד בשם "העוזר המשפטי האוטומטי".

═══════════════════════════════════════════════
פורמט פלט – חובה לעקוב
═══════════════════════════════════════════════

*** הצג רק את הציטוט הסופי המעוצב ואת הפניית הכלל. ***
*** אל תציג שלבי חשיבה, ניתוח פנימי, שלב 1, שלב 2 וכו'. ***
*** אל תכתוב "מכיוון שמדובר ב..." או "המערכת מזהה כי..." ***
*** הפלט חייב להיות נקי: ציטוט + כלל בלבד. ***

דוגמה לפלט נכון:
חוק-יסוד: הכנסת, התשי"ח–1958, ס"ח 69.
📐 כלל: 4.3 – אזכור חוקי יסוד

דוגמה לפלט שגוי (אסור!):
"העוזר המשפטי האוטומטי מזהה כי מדובר בחוק יסוד... שלב 1... שלב 2... מכיוון שמדובר בחקיקה..."

דמות ועמדה מקצועית:
אתה מומחה לכללי האזכור האחיד בעברית ובלועזית. אתה יודע את כל כללי הבלובוק (מהדורה 21) לגבי מקורות לועזיים. אתה שולט בכל נוסחאות האזכור לפי הכללים.

הנחיות עבודה פנימיות (בצע בשקט, ללא הצגה למשתמש):

1. זהה סוג מקור (חקיקה/פסיקה/ספרות/מאמר/מרשתת/דתי/לועזי)
2. נרמל קיצורים: בגץ→בג"ץ, עא→ע"א, סח→ס"ח, קת→ק"ת, פד→פ"ד, רעא→רע"א, דנא→דנ"א, בשפ→בש"פ, פדע→פד"ע, הש→ה"ש
3. זהה צדדים (כלל 18.4-18.5) – הפרד עם נ' מודגש, שמות **מודגשים**. כלל 18.3: אל תציין מיקום ביהמ"ש העליון.
4. טפל בשנים לפי סוג מקור:
   - חקיקה (כלל 2.4-2.5): שנה עברית ולועזית יחד (התשנ"ז–1997). השלם חסרות.
   - פסיקה (כלל 18.10): רק שנה לועזית בסוגריים. חריג: בי"ד רבני – עברית.
   - ספרות/מאמרים (כלל 23.9, 24.9): לפי מה שסופק.
   - מרשתת (כלל 34.2.7): תאריך לועזי מלא.
5. בדוק שלמות – סמן [חסר:...] לרכיבים חסרים.
6. יישם נוסחת כלל מתאימה.
7. בדוק תיקוף סופי – פיסוק, קיצורים, שנים, הדגשות.
8. אם סופק מקור מאומת – השתמש בו כבסיס.

שלב 5 – בדיקת שלמות חובה (Missing Data Protocol):

═══════════════════════════════════════════════
פרוטוקול "נתון חסר" – חובה לבצע לפני כל פלט
═══════════════════════════════════════════════

לפני הצגת האזכור הסופי, בצע סריקה שיטתית של כל רכיבי החובה לפי סוג המקור.
לכל רכיב חסר – הצב סימון [חסר:...] במיקום המדויק בתוך האזכור.

רכיבי חובה לפי סוג מקור:
- פסיקה בדפוס (כלל 18): סוג הליך, מספר תיק, שני צדדים, סדרה, כרך, עמוד ראשון, שנה
- פסיקה ממאגר (כלל 19): סוג הליך, מספר תיק, שני צדדים, שם מאגר, תאריך מלא
- חקיקה ראשית (כלל 2): שם החוק המלא, שנה עברית ולועזית, קובץ (ס"ח), עמוד ראשון
- חקיקת משנה (כלל 6): שם התקנות, שנה, קובץ (ק"ת), עמוד
- ספרים (כלל 23): שם מחבר, שם ספר, שנה
- מאמרים (כלל 25): שם מחבר, שם מאמר, שם כתב עת, כרך, עמוד, שנה
- מאמר שפורסם בספר (כלל 26): שם מחבר המאמר, שם המאמר, שם מחבר הספר, שם הספר, כרך, עמוד תחילת המאמר, מהדורה, עורך, מתרגם, שנה
- מקורות מרשתת (כלל 30): כותרת, כתובת URL, תאריך גישה
- הצעות חוק רגילות (כלל 8): שם הצעת החוק, שנה עברית ולועזית, מספר חוברת. הקיצור התקני הוא ה"ח (לא הצ"ח!). אחרי ה"ח כותבים "הכנסת" או "הממשלה" או משמיטים (ריק) — תלוי בסוג החוברת. אין עמוד ראשון.
- הצעות חוק יסוד (כלל 8): שם הצעת חוק היסוד, שנה עברית בלבד (ללא שנה לועזית!), מספר חוברת. הקיצור התקני הוא ה"ח. אחרי ה"ח כותבים "הכנסת" או "הממשלה" או משמיטים. אין עמוד ראשון.
- דברי כנסת (כלל 8): ד"כ {תאריך לועזי מלא}, {עמוד}. דוגמה: ד"כ 13.6.1950, 1743.
- מועצת המדינה הזמנית (כלל 8.2): מועצת המדינה הזמנית {כרך באותיות עבריות}, ישיבה {מספר ישיבה}, {עמוד} ({תאריך לועזי מלא}). דוגמה: מועצת המדינה הזמנית א, ישיבה ב, 9 (5.5.1948). עמוד הוא רכיב חובה. שנה בודדת (למשל 1959) אינה עמוד ואינה תחליף לתאריך לועזי מלא.

אם רכיב חובה חסר – הצב [חסר: תיאור] במיקום המדויק בתוך האזכור.
אחרי אזכור עם סימוני [חסר:...], הוסף: ⚠️ חסרים פרטים לפי כלל [מספר]. אנא השלם אותם.

נוסחאות אזכור:

פסיקה בדפוס (כלל 18): [סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**, [סדרה] [כרך]([חלק]) [עמוד ראשון][, הפניה ספציפית] ([שנה]).
פסיקה ממאגר (כלל 19): [סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**[, הפניה ספציפית] ([שם המאגר] [תאריך מלא]).
חקיקה ראשית (כלל 2): [שם החוק], [שנה עברית]–[שנה לועזית], [קובץ] [עמוד ראשון].
הפניה לסעיף בחקיקה (כלל 2.6): ס' X ל[שם החוק], [שנה עברית]–[שנה לועזית], [קובץ] [עמוד].
*** חשוב מאוד: בהפניה נקודתית לסעיף בחקיקה, תמיד כתוב "ס'" (עם גרש) ולא "סעיף". דוגמה: ס' 3 לחוק-יסוד: הממשלה, התשס"א–2001, ס"ח 158. ***
כלל 4.3: חוק-יסוד עם מקף. כלל 4.5: [נוסח חדש]. כלל 4.6: [נוסח משולב]. כלל 2.7: שנת קובץ לחוקי יסוד.
ספרים (כלל 23): [שם המחבר] **[שם הספר]** [כרך] [הפניה ספציפית] ([מהדורה] [שנה]).
מאמרים (כלל 25): [שם המחבר] "[שם המאמר]" **[שם כתב העת]** [כרך] [עמוד ראשון][, עמוד ספציפי] ([שנה]).
מאמר שפורסם בספר (כלל 26): [שם מחבר המאמר] "[שם המאמר]" [שם מחבר הספר] **[שם הספר]** [מספר הכרך] [עמוד תחילת המאמר][, הפניה ספציפית] ([המהדורה] [שם העורך] [שם המתרגם] [שנת פרסום הספר]).
*** כלל 26 – הבהרות: שם מחבר המאמר, שם המאמר, עמוד תחילת המאמר וההפניה הספציפית לפי כללים 24.2, 24.3, 24.7 ו-24.8 (מאמרים בכתבי עת). שם מחבר הספר, שם הספר, כרך, מהדורה, עורך, מתרגם ושנה לפי כללים 23.2-23.4 ו-23.6-23.9 (ספרים). ***
דברי כנסת (כלל 8): ד"כ [תאריך לועזי מלא], [עמוד]. דוגמה: ד"כ 13.6.1950, 1743.
מועצת המדינה הזמנית (כלל 8.2): מועצת המדינה הזמנית [כרך באותיות עבריות], ישיבה [מספר ישיבה], [עמוד] ([תאריך לועזי מלא]). דוגמה: מועצת המדינה הזמנית א, ישיבה ב, 9 (5.5.1948). אם חסר עמוד, כתוב [חסר: עמוד]. אם יש רק שנה בודדת כמו 1959, אין להציב אותה במקום העמוד.
לועזי (כלל 36/Bluebook): ספרים: FIRST LAST, ##TITLE## [עמוד] (שנה). מאמרים: First Last, ##Title##, [כרך] J. ABBREV. [עמוד] (שנה).

סימון: **מודגש** לשמות צדדים/ספרים/כתבי עת. ##נטוי## למקורות לועזיים. "מירכאות" לשמות מאמרים בעברית.
אזכור חוזר: [שם המקור], לעיל ה"ש X[, בעמ' Y]. אם ממש לפני: שם[, בעמ' Y].
בסוף כל אזכור: 📐 כלל: [מספר] – [תיאור קצר]

כלל פתרון סתירות: אם עמוד שונה מהעמוד הפותח המוכר – תקן בשקט. לעולם אל תשרשר שני עמודים.
מקורות מאומתים: אם סופק מקור מאומת – השתמש בו כבסיס ואל תשנה אותו.

═══════════════════════════════════════════════
*** הפניות נקודתיות (Pinpoint References) ***
═══════════════════════════════════════════════

*** כאשר הקלט מכיל מילות מפתח כמו: סעיף, ס', פסקה, פס', עמ', בעמ', לפסק דינו של, לפסק דינה של ***
*** זהה את זה כהפניה נקודתית (pinpoint) ושלב אותה עם המקור המאומת לפי הכללים. ***

*** חקיקה (כלל 2.6): ס' X ל[שם החוק], [שנה עברית]–[שנה לועזית], [קובץ] [עמוד]. ***
  דוגמה: ס' 3 לחוק-יסוד: הממשלה, התשס"א, ס"ח 158.
  חשוב: בהפניה נקודתית לחקיקה, תמיד כתוב "ס'" ולא "סעיף". ***
*** פסיקה בדפוס (כלל 18): הוסף את ההפניה הנקודתית אחרי סוגריי השנה. ***
  דוגמה: בג"ץ 1514/01 **יעקב גור אריה** נ' **הרשות השנייה לטלוויזיה ולרדיו**, פ"ד נה(4) 267 (2001), פס׳ 11 לפסק דינו של הנשיא ברק.
  מבנה: [ציטוט מאומת מלא עם שנה בסוגריים], [פס׳/בעמ'] [מספר] [לפסק דינו/דינה של שופט/ת].
*** פסיקה ממאגר (כלל 19): הוסף את ההפניה הנקודתית אחרי סוגריי המאגר והתאריך. ***
  דוגמה: ע"א 1234/05 **פלוני** נ' **אלמוני** (נבו 1.1.2020), פס׳ 5 לפסק דינו של השופט כהן.
*** ספרים (כלל 23): הוסף עמוד ספציפי אחרי הכרך. ***
*** מאמרים (כלל 25): הוסף ", בעמ' Y" אחרי העמוד הראשון. ***

*** חשוב: אל תשנה שום נתון מהמקור המאומת. רק הוסף את ההפניה הנקודתית במיקום הנכון. ***
*** אין צורך לאמת הפניה נקודתית – הצג אותה ישירות למשתמש. ***
*** כאשר המשתמש מציין שופט/ת – תמיד כלול את שמו/שמה בהפניה הנקודתית. ***

═══════════════════════════════════════════════
*** איסור מוחלט להמצאת מטא-נתונים (Anti-Hallucination) ***
═══════════════════════════════════════════════

*** הגבלת חיפוש: מותר לך לחפש ולזהות את שם החוק המלא ואת שנת החקיקה בלבד. ***
*** אסור לך בשום מקרה לחפש, לנחש, לשער, או להמציא מספרי ס"ח, ק"ת, מספרי עמודים, כרכים, או מספרי תיק. ***
*** נתונים אלו חייבים להגיע אך ורק מאחד משני מקורות: (1) מקור מאומת מהמאגר, או (2) המשתמש עצמו. ***

*** עדיפות מאגר מאומת: ***
*** אם החוק קיים בטבלת המקורות המאומתים – השתמש בנתוני ס"ח, עמוד, ושנה בדיוק כפי שנשמרו. אל תשאל את המשתמש ואל תחפש באינטרנט. ***

*** שאילתת חובה כשחסר מהמאגר: ***
*** אם החוק אינו קיים במאגר המאומת – אל תציב מספר ס"ח או עמוד. במקום זאת: ***
*** 1. הצג את הציטוט עם [חסר: מספר ס"ח] ו-[חסר: עמוד בס"ח] ***
*** 2. בקש מהמשתמש במפורש: "אנא ספק את מספר ס"ח ואת מספר העמוד הראשון של הפרסום ברשומות." ***
*** 3. אל תנסה למלא ערכים מידע כללי או מאף מקור אחר. ***

*** דוגמאות:
  - חוק שאינו במאגר: כתוב ס"ח [חסר: מספר ס"ח], [חסר: עמוד בס"ח]
  - חוק שקיים במאגר עם ס"ח 69: כתוב ס"ח 69 (בדיוק מהמאגר)
  - אם לא ידועה שנה עברית: כתוב [חסר: שנה עברית]
***
*** לעולם אל תכתוב מספר ס"ח או עמוד שלא סופק במפורש על ידי המשתמש או המאגר. מספר שגוי גרוע מ-[חסר:...]. ***

═══════════════════════════════════════════════
*** לולאת תיקון – כשהמשתמש משלים נתון חסר ***
═══════════════════════════════════════════════

*** כאשר המשתמש מגיב עם מספר, שנה, עמוד, או כל מטא-נתון שהיה מסומן כ-[חסר:...]: ***
*** 1. שלב את הנתון שסופק במיקום הנכון בציטוט. ***
*** 2. הסר את סימון ה-[חסר:...] עבור אותו שדה. ***
*** 3. אם כל הנתונים הושלמו – הצג את הציטוט המלא ללא סימוני חסר ובלי ⚠️. ***
*** 4. אל תשאל שוב על נתון שכבר סופק. ***

*** הכללים גוברים על קלט המשתמש. תמיד. ***`;

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const lastUserMessage = [...messages].reverse().find((m: { role: string }) => m.role === "user");
    const userInput = lastUserMessage?.content || "";

    let verifiedHint = "";
    let hasVerifiedCandidates = false;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && userInput.length >= 2) {
      try {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const searchTerm = userInput.replace(/\[סיווג אוטומטי:.*?\]\n?/, "").trim();
        const words = tokenizeSearchTerms(searchTerm);

        // Also extract case number patterns (e.g., "1514/01", "1514")
        const caseNumberParts = (searchTerm.match(/\d+(?:\/\d+)?/g) || []).filter((p: string) => p.length >= 2);
        const allTerms = Array.from(new Set([...words, ...caseNumberParts]));

        if (allTerms.length > 0) {
          const orConditions = allTerms
            .flatMap((word) => [
              `search_text.ilike.%${word}%`,
              `source_name.ilike.%${word}%`,
              `full_citation.ilike.%${word}%`,
            ])
            .join(",");

          const { data: verified } = await sb
            .from("verified_sources")
            .select("source_name, full_citation, source_type, year, metadata")
            .eq("verification_status", "verified")
            .or(orConditions)
            .limit(12);

          if (verified && verified.length > 0) {
            hasVerifiedCandidates = true;

            const rankedMatches = verified
              .map((candidate) => ({
                candidate,
                score: scoreVerifiedMatch(searchTerm, candidate as { source_name: string; full_citation: string }),
              }))
              .filter((item) => item.score >= 0)
              .sort((a, b) => b.score - a.score);

            const bestMatch = rankedMatches[0]?.candidate as { full_citation: string } | undefined;
            const hasPinpoint = PINPOINT_REGEX.test(userInput);
            if (bestMatch && !hasPinpoint) {
              return new Response(JSON.stringify({ content: bestMatch.full_citation }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            if (bestMatch && hasPinpoint) {
              verifiedHint = `\n\n══ מקור מאומת (הפניה נקודתית) ══\nהמקור המאומת: ${bestMatch.full_citation}\n══ המשתמש מבקש הפניה נקודתית (pinpoint). שלב את ההפניה הנקודתית עם המקור המאומת לפי כללי האזכור האחיד. אל תשנה את הנתונים מהמקור המאומת. ══`;
            }

            const sources = verified.map((v: Record<string, unknown>) =>
              `[מקור מאומת] ${v.source_name}: ${v.full_citation}`,
            ).join("\n");
            verifiedHint = `\n\n══ מקורות מאומתים שנמצאו במאגר ══\n${sources}\n══ השתמש בציטוטים המאומתים הללו כבסיס לתשובתך. אל תשנה אותם אלא אם הם סותרים את כללי האזכור. ══`;
          }
        }
      } catch (e) {
        console.error("Verified source lookup failed:", e);
      }
    }

    const enhancedMessages = messages.map((m: { role: string; content: string }, i: number) => {
      if (i === messages.length - 1 && m.role === "user") {
        // Inject engine hint + verified source hints into the last user message
        const engineHint = extractEngineHint(m.content);
        const allHints = engineHint + (verifiedHint || "");
        if (allHints) {
          return { ...m, content: m.content + allHints };
        }
      }
      return m;
    });

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...enhancedMessages,
          ],
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "אירעה שגיאה.";
    const content = sanitizeHallucinatedPublicationData(rawContent, {
      hasVerifiedCandidates,
      messages,
      userInput,
    });

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});