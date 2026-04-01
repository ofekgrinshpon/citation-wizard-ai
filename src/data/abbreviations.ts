// Abbreviation mappings based on נספחים א-י (Appendices A-J)
// For normalizing free-text input

// Court abbreviations (נספח א - סוגי הליכים)
export const CASE_TYPE_ABBREVIATIONS: Record<string, string> = {
  // Supreme Court
  'בגץ': 'בג"ץ',
  'בג"צ': 'בג"ץ',
  'בגצ': 'בג"ץ',
  'עא': 'ע"א',
  'ע"א': 'ע"א',
  'רעא': 'רע"א',
  'רע"א': 'רע"א',
  'דנא': 'דנ"א',
  'דנ"א': 'דנ"א',
  'דנג': 'דנ"ג',
  'עפ': 'ע"פ',
  'ע"פ': 'ע"פ',
  'רעפ': 'רע"פ',
  'רע"פ': 'רע"פ',
  'דנפ': 'דנ"פ',
  'דנ"פ': 'דנ"פ',
  'עע': 'ע"ע',
  'ע"ע': 'ע"ע',
  'עשמ': 'עש"מ',
  'עש"מ': 'עש"מ',
  'בשא': 'בש"א',
  'בש"א': 'בש"א',
  'בשפ': 'בש"פ',
  'בש"פ': 'בש"פ',

  // District Court
  'תא': 'ת"א',
  'ת"א': 'ת"א',
  'תפ': 'ת"פ',
  'ת"פ': 'ת"פ',
  'המ': 'ה"מ',
  'המר': 'המר\'',
  'עמ': 'ע"מ',
  'ע"מ': 'ע"מ',
  'פר': 'פר"ק',
  'פרק': 'פר"ק',
  'הפ': 'ה"פ',
  'ה"פ': 'ה"פ',

  // Labor Court
  'סק': 'ס"ק',
  'ס"ק': 'ס"ק',
  'דמ': 'ד"מ',
  'ד"מ': 'ד"מ',
  'עב': 'עב\'',

  // Administrative / Family
  'עתמ': 'עת"מ',
  'עת"מ': 'עת"מ',
  'תמש': 'תמ"ש',
  'תמ"ש': 'תמ"ש',
};

// Publication series abbreviations
export const PUBLICATION_ABBREVIATIONS: Record<string, string> = {
  'פד': 'פ"ד',
  'פ"ד': 'פ"ד',
  'פמ': 'פ"מ',
  'פ"מ': 'פ"מ',
  'פדע': 'פד"ע',
  'פד"ע': 'פד"ע',
  'פדמ': 'פד"מ',
  'פד"מ': 'פד"מ',
  'דינים': 'דינים',
  'נבו': 'נבו',
  'ארש': 'אר"ש',
  'אר"ש': 'אר"ש',
  'פדאור': 'פדאור',
  'סח': 'ס"ח',
  'ס"ח': 'ס"ח',
  'קת': 'ק"ת',
  'ק"ת': 'ק"ת',
  'ער': 'ע"ר',
  'ע"ר': 'ע"ר',
  'נח': 'נ"ח',
  'נ"ח': 'נ"ח',
  'יפ': 'י"פ',
  'י"פ': 'י"פ',
  'כה': 'כ"ה',
  'כ"ה': 'כ"ה',
};

// Court name abbreviations (Rule 18.3)
export const COURT_NAMES: Record<string, string> = {
  'עליון': 'בית המשפט העליון',
  'בהמ עליון': 'בית המשפט העליון',
  'מחוזי': 'בית המשפט המחוזי',
  'שלום': 'בית משפט השלום',
  'עבודה': 'בית הדין לעבודה',
  'ארצי': 'בית הדין הארצי לעבודה',
  'אזורי': 'בית הדין האזורי לעבודה',
  'משפחה': 'בית המשפט לענייני משפחה',
  'נוער': 'בית המשפט לנוער',
  'תעבורה': 'בית המשפט לתעבורה',
};

// District names for lower courts (Rule 18.3 - mention location for district/magistrate)
export const DISTRICTS = [
  'ירושלים', 'תל-אביב–יפו', 'תל אביב', 'חיפה', 'באר שבע',
  'נצרת', 'לוד', 'מרכז', 'דרום', 'צפון',
  'פתח תקווה', 'ראשון לציון', 'אשדוד', 'הרצליה', 'נתניה',
  'כפר סבא', 'רחובות', 'קריית גת', 'עכו', 'טבריה',
];

// Source type classification
export type SourceType = 
  | 'case_law_published'    // פסיקה מפ"ד
  | 'case_law_database'     // פסיקה ממאגר
  | 'primary_legislation'   // חקיקה ראשית
  | 'basic_law'             // חוק יסוד
  | 'secondary_legislation' // חקיקת משנה
  | 'bill'                  // הצעת חוק
  | 'book'                  // ספר
  | 'article'               // מאמר
  | 'article_in_book'       // מאמר שפורסם בספר
  | 'internet'              // מרשתת
  | 'religious'             // מקור דתי
  | 'foreign'               // לועזי
  | 'other'                 // אחר (דברי כנסת וכו')
  | 'unknown';

// Required fields per source type (for gap analysis)
export const REQUIRED_FIELDS: Record<SourceType, string[]> = {
  case_law_published: ['caseType', 'caseNumber', 'party1', 'party2', 'series', 'volume', 'firstPage', 'year'],
  case_law_database: ['caseType', 'caseNumber', 'party1', 'party2', 'database', 'fullDate'],
  primary_legislation: ['lawName', 'hebrewYear', 'gregorianYear', 'collection', 'firstPage'],
  basic_law: ['lawName', 'hebrewYear', 'gregorianYear', 'collection'],
  secondary_legislation: ['regulationName', 'hebrewYear', 'gregorianYear', 'collection', 'firstPage'],
  bill: ['billName', 'billNumber', 'hebrewYear', 'gregorianYear'],
  book: ['author', 'bookTitle', 'year'],
  article: ['author', 'articleTitle', 'journalName', 'volume', 'firstPage', 'year'],
  article_in_book: ['author', 'articleTitle', 'bookTitle', 'firstPage', 'year'],
  internet: ['author', 'title', 'siteName', 'url', 'accessDate'],
  religious: ['source', 'location'],
  foreign: ['citation'],
  unknown: [],
};

// Hebrew labels for fields
export const FIELD_LABELS: Record<string, string> = {
  caseType: 'סוג ההליך',
  caseNumber: 'מספר תיק',
  party1: 'צד א\'',
  party2: 'צד ב\'',
  series: 'סדרה (למשל פ"ד)',
  volume: 'כרך',
  part: 'חלק',
  firstPage: 'עמוד ראשון',
  specificPage: 'עמוד ספציפי',
  year: 'שנה',
  fullDate: 'תאריך מלא',
  database: 'שם מאגר',
  lawName: 'שם החוק',
  hebrewYear: 'שנה עברית',
  gregorianYear: 'שנה לועזית',
  collection: 'קובץ (ס"ח, ק"ת)',
  regulationName: 'שם התקנות',
  billName: 'שם הצעת החוק',
  billNumber: 'מספר הצעת חוק',
  author: 'שם המחבר',
  bookTitle: 'שם הספר',
  edition: 'מהדורה',
  articleTitle: 'שם המאמר',
  journalName: 'שם כתב העת',
  siteName: 'שם האתר',
  url: 'כתובת URL',
  accessDate: 'תאריך גישה',
  section: 'סעיף',
  paragraph: 'פסקה',
  source: 'מקור',
  location: 'מיקום',
  citation: 'אזכור מלא',
  court: 'ערכאה',
  district: 'מחוז',
};

// Normalize abbreviations in free text
export function normalizeAbbreviations(text: string): string {
  let result = text;
  
  // Sort by length descending to match longer patterns first
  const allAbbreviations = { ...CASE_TYPE_ABBREVIATIONS, ...PUBLICATION_ABBREVIATIONS };
  const sorted = Object.entries(allAbbreviations).sort(
    ([a], [b]) => b.length - a.length
  );
  
  for (const [abbr, normalized] of sorted) {
    if (abbr !== normalized) {
      // Word-boundary aware replacement
      const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<=^|\\s|[^א-ת])${escaped}(?=$|\\s|[^א-ת])`, 'g');
      result = result.replace(regex, normalized);
    }
  }
  
  return result;
}

// Detect source type from free text
export function detectSourceType(text: string): SourceType {
  const normalized = text.toLowerCase();
  const hebrewText = text;
  
  // Check for foreign sources
  if (/[a-zA-Z]{3,}/.test(text) && /v\.|vs\./.test(normalized)) return 'foreign';
  if (/[A-Z][a-z]+\s+v\.\s+[A-Z]/.test(text)) return 'foreign';
  
  // Check for case law
  for (const abbr of Object.values(CASE_TYPE_ABBREVIATIONS)) {
    if (hebrewText.includes(abbr)) {
      if (hebrewText.includes('פ"ד') || hebrewText.includes('פ"מ') || hebrewText.includes('פד"ע')) {
        return 'case_law_published';
      }
      return 'case_law_database';
    }
  }
  if (/נ['']|נגד/.test(hebrewText) && /\d+\/\d+/.test(hebrewText)) {
    return 'case_law_database';
  }
  
  // Check for legislation
  if (/חוק[- ]יסוד/.test(hebrewText)) return 'basic_law';
  if (/תקנות/.test(hebrewText)) return 'secondary_legislation';
  if (/הצעת חוק/.test(hebrewText)) return 'bill';
  if (/ד["״]כ|דברי הכנסת|דברי כנסת/.test(hebrewText)) return 'unknown';
  if (/חוק |פקודת /.test(hebrewText)) return 'primary_legislation';
  
  // Check for literature
  // Article in book: pattern like "author "title" book-name" (quoted article + book context)
  if (/"[^"]+".+(?:ספר|בתוך|עורך)/.test(hebrewText) || /".+"\s+.{5,}/.test(hebrewText) && !/עיוני משפט|משפטים|משפט וממשל|הפרקליט|כתב.עת/.test(hebrewText) && /ספר|בתוך/.test(hebrewText)) return 'article_in_book';
  if (/מאמר|עיוני משפט|משפטים|משפט וממשל|הפרקליט/.test(hebrewText)) return 'article';
  if (/https?:\/\//.test(text)) return 'internet';
  if (/ספר|כרך|מהדורה/.test(hebrewText)) return 'book';
  
  // Religious sources
  if (/תלמוד|משנה|גמרא|שו"ת|מקרא|בראשית|שמות|ויקרא|במדבר|דברים/.test(hebrewText)) return 'religious';
  
  return 'unknown';
}

// Source type labels in Hebrew
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  case_law_published: 'פסיקה (דפוס)',
  case_law_database: 'פסיקה (מאגר)',
  primary_legislation: 'חקיקה ראשית',
  basic_law: 'חוק יסוד',
  secondary_legislation: 'חקיקת משנה',
  bill: 'הצעת חוק',
  book: 'ספר',
  article: 'מאמר בכתב עת',
  article_in_book: 'מאמר שפורסם בספר',
  internet: 'מקור מרשתת',
  religious: 'מקור דתי',
  foreign: 'מקור לועזי',
  unknown: 'לא מזוהה',
};

// Rule references per source type
export const RULE_REFERENCES: Record<SourceType, string> = {
  case_law_published: 'כלל 18 – פסיקה שפורסמה בדפוס',
  case_law_database: 'כלל 19 – פסיקה ממאגר מידע',
  primary_legislation: 'כלל 2 – חקיקה ראשית',
  basic_law: 'כלל 4 – חוק יסוד',
  secondary_legislation: 'כלל 6 – חקיקת משנה',
  bill: 'כלל 8 – הצעות חוק',
  book: 'כלל 23 – ספרים',
  article: 'כלל 25 – מאמרים',
  article_in_book: 'כלל 26 – מאמר שפורסם בספר',
  internet: 'כלל 30 – מקורות מהמרשתת',
  religious: 'כלל 32 – מקורות דתיים',
  foreign: 'כלל 36 – מקורות לועזיים (Bluebook)',
  unknown: '',
};
