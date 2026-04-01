/**
 * Citation Engine – כללי האזכור האחיד (2021)
 * 
 * Comprehensive mapping of every source type to its specific rules,
 * required fields, formatting templates, and validation constraints.
 */

// ─── General Rules (כללים כלליים) ────────────────────────────────

export const GENERAL_RULES = {
  "1.1": { title: "מבנה אזכור כללי", description: "כל אזכור כולל את רכיבי המקור בסדר קבוע, ומסתיים בנקודה." },
  "1.3": { title: "עיצוב טקסט", description: "שמות ספרים וכתבי עת מודגשים; שמות מאמרים במירכאות; מקורות לועזיים בהטייה (italic)." },
  "1.5": { title: "אזכור חוזר – שם", description: "אזכור חוזר של מקור שכבר אוזכר בהערה קודמת: שם המחבר/הצדדים + 'לעיל הערה X'." },
  "1.6": { title: "אזכור חוזר – שם, שם", description: "אזכור חוזר של מקור שאוזכר בהערה הקודמת בדיוק: 'שם, שם' (ללא פרטים נוספים)." },
  "1.9": { title: "פיסוק", description: "פסיק מפריד בין רכיבים; נקודה מסיימת את האזכור; נקודה-פסיק מפריד בין מקורות שונים באותה הערה." },
  "1.10": { title: "טווחי מספרים", description: "טווחי עמודים ומספרים נכתבים מימין לשמאל (למשל: 40-37)." },
  "1.11": { title: "סימני קיצור", description: "קיצורים סטנדרטיים בהתאם לנספחים א–י." },
} as const;

// ─── Source Type Rule Map ────────────────────────────────────────

export interface CitationRuleSet {
  /** Main rule number governing this source type */
  primaryRule: string;
  /** Human-readable rule title */
  ruleTitle: string;
  /** Sub-rules for individual components, in citation order */
  components: CitationComponent[];
  /** The canonical template showing citation structure */
  template: string;
  /** Example of a correctly formatted citation */
  example: string;
  /** Additional notes or exceptions */
  notes?: string[];
}

export interface CitationComponent {
  /** Field key matching REQUIRED_FIELDS / FIELD_LABELS */
  field: string;
  /** The sub-rule governing this component */
  rule: string;
  /** Short description of the formatting requirement */
  description: string;
  /** Whether this component is mandatory */
  required: boolean;
  /** Formatting instruction (bold, italic, quotes, brackets, etc.) */
  format?: "bold" | "italic" | "quotes" | "brackets" | "plain";
}

export const CITATION_RULES: Record<string, CitationRuleSet> = {

  // ─── חקיקה ראשית (Primary Legislation) ──────────────────────
  primary_legislation: {
    primaryRule: "2",
    ruleTitle: "כלל 2 – חקיקה ראשית",
    template: "{lawName}, {hebrewYear} {gregorianYear}, {collection} {firstPage}.",
    example: 'חוק העונשין, התשל"ז-1977, ס"ח 864, 226.',
    components: [
      { field: "lawName", rule: "2.1", description: "שם החוק המלא כפי שמופיע בכותרתו", required: true, format: "plain" },
      { field: "hebrewYear", rule: "2.4", description: "שנה עברית (למשל: התשל\"ז)", required: true, format: "plain" },
      { field: "gregorianYear", rule: "2.4", description: "שנה לועזית מחוברת במקף (למשל: -1977)", required: true, format: "plain" },
      { field: "collection", rule: "2.5", description: 'קובץ פרסום: ס"ח או ק"ת', required: true, format: "plain" },
      { field: "volume", rule: "2.5", description: "מספר חוברת/כרך הקובץ", required: false, format: "plain" },
      { field: "firstPage", rule: "2.6", description: "עמוד ראשון של החוק בקובץ", required: true, format: "plain" },
      { field: "specificPage", rule: "2.6", description: "עמוד ספציפי מופניה (עם פסיק)", required: false, format: "plain" },
      { field: "section", rule: "2.8", description: 'הפניה לסעיף ספציפי: ס\' X, סס\' X-Y', required: false, format: "plain" },
    ],
    notes: [
      'כלל 2.2: "פקודה" – שם ישן לחוק; אותם כללי אזכור.',
      "כלל 2.3: תיקוני חקיקה – לציין את מספר התיקון בסוגריים.",
      'כלל 2.7: אם אין שנה עברית (פקודות מנדט) – מציינים שנה לועזית בלבד.',
    ],
  },

  // ─── חוק יסוד (Basic Law) ──────────────────────────────────
  basic_law: {
    primaryRule: "4",
    ruleTitle: "כלל 4 – חוק יסוד",
    template: "חוק-יסוד: {lawName}, {collection} {firstPage}.",
    example: 'חוק-יסוד: כבוד האדם וחירותו, ס"ח 1391, 150.',
    components: [
      { field: "lawName", rule: "4.3", description: 'חוק-יסוד נכתב עם מקף; נקודתיים לפני שם החוק (חריג: חוק-יסוד: משק המדינה)', required: true, format: "plain" },
      { field: "hebrewYear", rule: "4.4", description: "שנה עברית (אם קיימת)", required: false, format: "plain" },
      { field: "gregorianYear", rule: "4.4", description: "שנה לועזית", required: false, format: "plain" },
      { field: "collection", rule: "2.5", description: 'ס"ח – ספר החוקים', required: true, format: "plain" },
      { field: "firstPage", rule: "2.6", description: "עמוד ראשון בספר החוקים", required: false, format: "plain" },
    ],
    notes: [
      "כלל 4.3: חוק-יסוד: משק המדינה – החריג היחיד שנכתב עם נקודתיים.",
      'כלל 4.5: [נוסח חדש] – בסוגריים מרובעים, כאשר החוק עודכן.',
      'כלל 4.6: [נוסח משולב] – בסוגריים מרובעים.',
    ],
  },

  // ─── חקיקת משנה (Secondary Legislation) ────────────────────
  secondary_legislation: {
    primaryRule: "6",
    ruleTitle: "כלל 6 – חקיקת משנה",
    template: "{regulationName}, {hebrewYear} {gregorianYear}, {collection} {firstPage}.",
    example: 'תקנות התעבורה, התשכ"א-1961, ק"ת 1128, 1425.',
    components: [
      { field: "regulationName", rule: "6.1", description: "שם התקנות המלא", required: true, format: "plain" },
      { field: "hebrewYear", rule: "6.2", description: "שנה עברית", required: true, format: "plain" },
      { field: "gregorianYear", rule: "6.2", description: "שנה לועזית", required: true, format: "plain" },
      { field: "collection", rule: "6.3", description: 'ק"ת – קובץ התקנות', required: true, format: "plain" },
      { field: "firstPage", rule: "6.3", description: "עמוד ראשון בקובץ התקנות", required: true, format: "plain" },
    ],
  },

  // ─── הצעות חוק (Bills) ─────────────────────────────────────
  bill: {
    primaryRule: "8",
    ruleTitle: "כלל 8 – הצעות חוק",
    template: 'הצעת חוק {billName}, {hebrewYear}-{gregorianYear}, ה"ח [הכנסת/הממשלה/ריק] {billNumber}, {firstPage}.',
    example: 'הצעת חוק העונשין (תיקון מס\' 137), התשע"ח-2018, ה"ח הממשלה 1234, 56.',
    components: [
      { field: "billName", rule: "8.1", description: "שם הצעת החוק", required: true, format: "plain" },
      { field: "hebrewYear", rule: "8.2", description: "שנה עברית", required: true, format: "plain" },
      { field: "gregorianYear", rule: "8.2", description: "שנה לועזית", required: true, format: "plain" },
      { field: "billType", rule: "8.3", description: 'סוג הצעת חוק (הכנסת / הממשלה / ריק) – אופציונלי', required: false, format: "plain" },
      { field: "billNumber", rule: "8.3", description: 'מספר חוברת ה"ח', required: true, format: "plain" },
      { field: "firstPage", rule: "8.3", description: "עמוד ראשון", required: true, format: "plain" },
    ],
  },

  // ─── הצעות חוק יסוד (Basic Law Bills) ─────────────────────
  basic_law_bill: {
    primaryRule: "8",
    ruleTitle: "כלל 8 – הצעות חוק יסוד",
    template: 'הצעת חוק-יסוד: {billName}, {hebrewYear}, ה"ח [הכנסת/הממשלה/ריק] {billNumber}, {firstPage}.',
    example: 'הצעת חוק-יסוד: כבוד האדם וחירותו (תיקון), התשפ"ג, ה"ח הכנסת 456, 78.',
    components: [
      { field: "billName", rule: "8.1", description: "שם הצעת חוק היסוד", required: true, format: "plain" },
      { field: "hebrewYear", rule: "8.2", description: "שנה עברית בלבד (ללא שנה לועזית)", required: true, format: "plain" },
      { field: "billType", rule: "8.3", description: 'סוג הצעת חוק (הכנסת / הממשלה / ריק) – אופציונלי', required: false, format: "plain" },
      { field: "billNumber", rule: "8.3", description: 'מספר חוברת ה"ח', required: true, format: "plain" },
      { field: "firstPage", rule: "8.3", description: "עמוד ראשון", required: true, format: "plain" },
    ],
  },

  // ─── פסיקה מדפוס (Published Case Law) ─────────────────────
  case_law_published: {
    primaryRule: "18",
    ruleTitle: "כלל 18 – פסיקה שפורסמה בדפוס",
    template: "{caseType} {caseNumber} {party1} **נ'** {party2}, {series} {volume}({part}) {firstPage}, {specificPage} ({year}).",
    example: 'ע"א 2401/08 **מדינת ישראל** נ\' **גיספן**, פ"ד סד(3) 202, 225 (2011).',
    components: [
      { field: "caseType", rule: "18.2", description: "סוג ההליך בקיצור (ע\"א, בג\"ץ, רע\"א וכו')", required: true, format: "plain" },
      { field: "caseNumber", rule: "18.2", description: "מספר התיק (מספר/שנה)", required: true, format: "plain" },
      { field: "court", rule: "18.3", description: "ערכאה – אין לציין לעליון; חובה לציין מחוז למחוזי/שלום", required: false, format: "plain" },
      { field: "party1", rule: "18.4", description: "שם הצד הראשון (ללא תוארים)", required: true, format: "bold" },
      { field: "party2", rule: "18.4", description: "שם הצד השני (ללא תוארים)", required: true, format: "bold" },
      { field: "series", rule: "18.6", description: 'סדרת הפרסום (פ"ד, פד"ע וכו\')', required: true, format: "plain" },
      { field: "volume", rule: "18.6", description: "מספר כרך", required: true, format: "plain" },
      { field: "part", rule: "18.6", description: "מספר חלק (בסוגריים)", required: false, format: "plain" },
      { field: "firstPage", rule: "18.8", description: "עמוד ראשון של פסק הדין", required: true, format: "plain" },
      { field: "specificPage", rule: "18.8", description: "עמוד ספציפי מופניה", required: false, format: "plain" },
      { field: "year", rule: "18.7", description: "שנת מתן פסק הדין (בסוגריים)", required: true, format: "plain" },
    ],
    notes: [
      "כלל 18.3: בית המשפט העליון – אין לציין ערכאה; בתי משפט אחרים – יש לציין ערכאה ומחוז.",
      'כלל 18.5: ה-"נ\'" (versus) חייב להיות מודגש.',
      "כלל 18.4: שמות צדדים ללא תוארים (עו\"ד, פרופ', ד\"ר).",
    ],
  },

  // ─── פסיקה ממאגר (Database Case Law) ──────────────────────
  case_law_database: {
    primaryRule: "19",
    ruleTitle: "כלל 19 – פסיקה ממאגר מידע",
    template: "{caseType} {caseNumber} {party1} **נ'** {party2} ({fullDate}).",
    example: 'ת\"א (מחוזי ת\"א) 1234/05 **ישראלי** נ\' **כהן** (פורסם בנבו, 15.3.2010).',
    components: [
      { field: "caseType", rule: "18.2", description: "סוג ההליך בקיצור", required: true, format: "plain" },
      { field: "caseNumber", rule: "18.2", description: "מספר התיק", required: true, format: "plain" },
      { field: "court", rule: "18.3", description: "ערכאה ומחוז (חובה לבתי משפט שאינם העליון)", required: false, format: "plain" },
      { field: "party1", rule: "18.4", description: "שם צד א'", required: true, format: "bold" },
      { field: "party2", rule: "18.4", description: "שם צד ב'", required: true, format: "bold" },
      { field: "database", rule: "19.1", description: "שם המאגר (נבו, פדאור, דינים)", required: true, format: "plain" },
      { field: "fullDate", rule: "19.1", description: "תאריך פרסום מלא (יום.חודש.שנה)", required: true, format: "plain" },
      { field: "paragraph", rule: "19.2", description: "הפניה לפסקה ספציפית", required: false, format: "plain" },
    ],
    notes: [
      'כלל 19.1: הנוסח: "פורסם ב[שם מאגר], [תאריך]".',
      "כלל 19.2: הפניה לפסקה ספציפית – פס' X.",
    ],
  },

  // ─── ספרים (Books) ─────────────────────────────────────────
  book: {
    primaryRule: "23",
    ruleTitle: "כלל 23 – ספרים",
    template: "{author} **{bookTitle}** {volume} {firstPage} ({edition}, {year}).",
    example: 'אהרן ברק **פרשנות במשפט** כרך ג 150 (מהדורה שנייה, 2006).',
    components: [
      { field: "author", rule: "23.1", description: "שם המחבר – שם פרטי ואחריו שם משפחה", required: true, format: "plain" },
      { field: "bookTitle", rule: "23.2", description: "שם הספר – מודגש", required: true, format: "bold" },
      { field: "volume", rule: "23.4", description: "מספר כרך (אם יש)", required: false, format: "plain" },
      { field: "firstPage", rule: "23.6", description: "עמוד ההפניה", required: false, format: "plain" },
      { field: "edition", rule: "23.8", description: "מהדורה (אם לא ראשונה)", required: false, format: "plain" },
      { field: "year", rule: "23.9", description: "שנת פרסום (בסוגריים)", required: true, format: "plain" },
    ],
    notes: [
      'כלל 23.3: מחברים מרובים – עד שלושה שמות; מעל כך: שם ראשון + "ואח\'".',
      'כלל 23.5: עורך/מתרגם – שם + (עורך) / (מתרגם) בסוגריים.',
      "כלל 23.7: אם הספר לא יצא עדיין – (צפוי להתפרסם [שנה]).",
    ],
  },

  // ─── מאמרים בכתבי עת (Journal Articles) ────────────────────
  article: {
    primaryRule: "25",
    ruleTitle: "כלל 25 – מאמרים בכתבי עת",
    template: '{author} "{articleTitle}" **{journalName}** {volume} {firstPage}, {specificPage} ({year}).',
    example: 'מנחם מאוטנר "הירידה של הפורמליזם ועליית הערכים במשפט הישראלי" **עיוני משפט** יז 503, 510 (1993).',
    components: [
      { field: "author", rule: "25.1", description: "שם המחבר", required: true, format: "plain" },
      { field: "articleTitle", rule: "25.2", description: "שם המאמר – במירכאות", required: true, format: "quotes" },
      { field: "journalName", rule: "25.3", description: "שם כתב העת – מודגש", required: true, format: "bold" },
      { field: "volume", rule: "25.4", description: "מספר כרך (ספרות עבריות או ערביות)", required: true, format: "plain" },
      { field: "firstPage", rule: "25.5", description: "עמוד ראשון של המאמר", required: true, format: "plain" },
      { field: "specificPage", rule: "25.5", description: "עמוד ספציפי מופניה", required: false, format: "plain" },
      { field: "year", rule: "25.6", description: "שנת פרסום (בסוגריים)", required: true, format: "plain" },
    ],
  },

  // ─── מאמר בספר (Article in Book) ──────────────────────────
  article_in_book: {
    primaryRule: "26",
    ruleTitle: "כלל 26 – מאמר שפורסם בספר",
    template: '{author} "{articleTitle}" {bookEditor} **{bookTitle}** {firstPage} ({year}).',
    example: 'רות גביזון "הזכות לפרטיות ולכבוד" דניאל פרידמן עורך **ספר ברנזון** כרך ב 61 (1990).',
    components: [
      { field: "author", rule: "24.2", description: "שם מחבר המאמר", required: true, format: "plain" },
      { field: "articleTitle", rule: "24.3", description: "שם המאמר – במירכאות", required: true, format: "quotes" },
      { field: "bookTitle", rule: "23.2", description: "שם הספר – מודגש", required: true, format: "bold" },
      { field: "editor", rule: "23.5", description: "שם העורך + (עורך)", required: false, format: "plain" },
      { field: "volume", rule: "23.4", description: "מספר כרך", required: false, format: "plain" },
      { field: "firstPage", rule: "24.7", description: "עמוד ראשון של המאמר בספר", required: true, format: "plain" },
      { field: "year", rule: "24.8", description: "שנת פרסום", required: true, format: "plain" },
    ],
  },

  // ─── מקורות מרשתת (Internet Sources) ─────────────────────
  internet: {
    primaryRule: "30",
    ruleTitle: "כלל 30 – מקורות מהמרשתת",
    template: '{author} "{title}" {siteName} ({fullDate}) {url}.',
    example: 'יוסי שריד "רפורמה בחינוך" **אתר הארץ** (14.5.2020) www.haaretz.co.il/...',
    components: [
      { field: "author", rule: "30.1", description: "שם המחבר (אם ידוע)", required: false, format: "plain" },
      { field: "title", rule: "30.2", description: "כותרת הפרסום – במירכאות", required: true, format: "quotes" },
      { field: "siteName", rule: "30.3", description: "שם האתר – מודגש", required: true, format: "bold" },
      { field: "fullDate", rule: "30.4", description: "תאריך פרסום", required: false, format: "plain" },
      { field: "url", rule: "30.5", description: "כתובת URL מלאה", required: true, format: "plain" },
      { field: "accessDate", rule: "30.6", description: "תאריך גישה אחרונה", required: true, format: "plain" },
    ],
    notes: [
      'כלל 30.6: תאריך גישה חובה; הנוסח: "נדלה ביום [תאריך]".',
    ],
  },

  // ─── מקורות דתיים (Religious Sources) ─────────────────────
  religious: {
    primaryRule: "32",
    ruleTitle: "כלל 32 – מקורות דתיים",
    template: "{source}, {location}.",
    example: "תלמוד בבלי, בבא קמא פד ע\"א.",
    components: [
      { field: "source", rule: "32.1", description: "שם המקור (תלמוד, משנה, שו\"ת וכו')", required: true, format: "plain" },
      { field: "location", rule: "32.2", description: "מיקום: מסכת, דף, עמוד / פרק, משנה", required: true, format: "plain" },
    ],
    notes: [
      "כלל 32.1: תלמוד בבלי – ברירת מחדל; תלמוד ירושלמי – יש לציין במפורש.",
      "כלל 32.3: שו\"ת – שם הספר מודגש, סימן ומספר.",
    ],
  },

  // ─── מקורות לועזיים (Foreign Sources – Bluebook) ──────────
  foreign: {
    primaryRule: "36",
    ruleTitle: "כלל 36 – מקורות לועזיים (Bluebook)",
    template: "לפי כללי ה-Bluebook (מהדורה 21).",
    example: "Jack M. Balkin, ##Living Originalism## 45 (2011).",
    components: [
      { field: "citation", rule: "36", description: "אזכור מלא לפי כללי ה-Bluebook", required: true, format: "italic" },
    ],
    notes: [
      "כלל 36: מקורות לועזיים מאוזכרים לפי כללי ה-Bluebook (מהדורה 21).",
      "שמות ספרים וכתבי עת בהטייה (italic), סומנים ב-##...##.",
    ],
  },

  // ─── אחר (Other) ──────────────────────────────────────────
  other: {
    primaryRule: "—",
    ruleTitle: "מקורות שונים",
    template: "בהתאם לסוג המקור הספציפי.",
    example: 'הכרזה על הקמת מדינת ישראל, ע"ר התש"ח 1.',
    components: [
      { field: "citation", rule: "—", description: "אזכור מלא בהתאם לכללים הרלוונטיים", required: true, format: "plain" },
    ],
  },
};

// ─── Repeated Citations (אזכור חוזר) ────────────────────────

export const REPEATED_CITATION_RULES = {
  "1.5": {
    title: "לעיל הערה",
    description: 'כאשר המקור כבר אוזכר בהערה קודמת: "[שם מחבר/צדדים], לעיל הערה [מספר], בעמ\' [עמוד]."',
    templateAuthors: "{lastName}, לעיל הערה {noteNumber}, בעמ' {page}.",
    templateCaseLaw: "עניין {partyName}, לעיל הערה {noteNumber}, בעמ' {page}.",
    templateLegislation: "חוק {shortName}, לעיל הערה {noteNumber}.",
  },
  "1.6": {
    title: "שם, שם",
    description: 'כאשר המקור זהה למקור בהערה הקודמת בדיוק: "שם" (ולמקור אחר באותה הערה: "שם, שם").',
    template: "שם, בעמ' {page}.",
  },
} as const;

// ─── Pinpoint References (הפניה מדויקת) ────────────────────

export const PINPOINT_RULES = {
  section: { rule: "2.8", prefix: "ס'", pluralPrefix: "סס'", description: "הפניה לסעיף בחקיקה" },
  subsection: { rule: "2.8", format: "(א)", description: "תת-סעיף בסוגריים" },
  page: { rule: "18.8", prefix: "בעמ'", description: "הפניה לעמוד ספציפי בפסיקה/ספרות" },
  paragraph: { rule: "19.2", prefix: "פס'", description: "הפניה לפסקה בפסיקה ממאגר" },
  footnote: { rule: "1.4", prefix: "ה\"ש", description: "הפניה להערת שוליים" },
} as const;

// ─── Validation helpers ─────────────────────────────────────

/**
 * Get all required fields for a given source type from the engine.
 */
export function getRequiredFields(sourceType: string): string[] {
  const ruleSet = CITATION_RULES[sourceType];
  if (!ruleSet) return [];
  return ruleSet.components.filter(c => c.required).map(c => c.field);
}

/**
 * Get the formatting instruction for a specific field in a source type.
 */
export function getFieldFormat(sourceType: string, field: string): CitationComponent["format"] | undefined {
  const ruleSet = CITATION_RULES[sourceType];
  if (!ruleSet) return undefined;
  return ruleSet.components.find(c => c.field === field)?.format;
}

/**
 * Get the rule number for a specific field in a source type.
 */
export function getFieldRule(sourceType: string, field: string): string | undefined {
  const ruleSet = CITATION_RULES[sourceType];
  if (!ruleSet) return undefined;
  return ruleSet.components.find(c => c.field === field)?.rule;
}

/**
 * Validate a set of field values against required fields for a source type.
 * Returns an array of missing required field keys.
 */
export function validateCitation(sourceType: string, fields: Record<string, string | undefined>): string[] {
  const required = getRequiredFields(sourceType);
  return required.filter(f => !fields[f]?.trim());
}
