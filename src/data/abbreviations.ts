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
  | 'internet_comment'      // תגובה במרשתת (כלל 34.2.9)
  | 'religious'             // מקור דתי
  | 'treaty'                // כתבי אמנה
  | 'regulation'            // תקנון (כלל 13.1)
  | 'government_decision'   // החלטות גופים שלטוניים (כלל 15)
  | 'expert_opinion'        // חוות דעת (כלל 16)
  | 'planning_plan'         // תכנית תכנון ובנייה (כלל 17.1)
  | 'collective_agreement'  // הסכם קיבוצי (כלל 17.2)
  | 'court_pleading'        // כתב טענות (כלל 22.2)
  | 'encyclopedia_entry'    // ערך במילון/אנציקלופדיה (כלל 25)
  | 'academic_work'         // עבודה אקדמית (כלל 26)
  | 'correspondence'        // התכתבות (כלל 32.1)
  | 'interview'             // ריאיון (כלל 32.2)
  | 'lecture'               // הרצאה (כלל 32.3)
  | 'press_release'         // הודעה לתקשורת (כלל 32.4)
  | 'film'                  // סרט (כלל 33.1)
  | 'tv_show'               // תוכנית טלוויזיה (כלל 33.2)
  | 'radio'                 // רדיו/תסכית (כלל 33.3)
  | 'foreign'                  // לועזי – fallback (כלל 36)
  | 'foreign_constitution'     // חוקה לועזית (כלל 36.1)
  | 'foreign_statute_us'       // חוק אמריקני (כלל 36.2)
  | 'foreign_statute_uk'       // חוק אנגלי (כלל 36.3)
  | 'foreign_case_us'          // פסיקה אמריקנית (כלל 36.4)
  | 'foreign_case_other'       // פסיקה ממדינות אחרות (כלל 36.5)
  | 'foreign_book'             // ספר לועזי (כלל 36.6)
  | 'foreign_journal_article'  // מאמר בכתב עת לועזי (כלל 36.7)
  | 'foreign_book_chapter'     // מאמר בספר לועזי (כלל 36.8)
  | 'foreign_internet'         // מקור מרשתת לועזי (כלל 36.9)
  | 'other'                 // אחר (דברי כנסת וכו')
  | 'unknown';

// Required fields per source type (for gap analysis)
export const REQUIRED_FIELDS: Record<SourceType, string[]> = {
  case_law_published: ['caseType', 'caseNumber', 'party1', 'party2', 'series', 'volume', 'firstPage', 'year'],
  case_law_database: ['caseType', 'caseNumber', 'party1', 'party2', 'database', 'fullDate'],
  primary_legislation: ['lawName', 'hebrewYear', 'gregorianYear', 'collection', 'firstPage'],
  basic_law: ['lawName', 'hebrewYear', 'gregorianYear', 'collection'],
  secondary_legislation: ['regulationName', 'hebrewYear', 'gregorianYear', 'collection'],
  bill: ['billName', 'billNumber', 'hebrewYear', 'gregorianYear'],
  regulation: ['regulationName', 'fullDate'],
  government_decision: ['decidingBody', 'decisionName', 'fullDate'],
  expert_opinion: ['opinionName', 'opinionAuthor', 'fullDate'],
  planning_plan: ['planNumber', 'decidingBody', 'decisionName', 'fullDate'],
  collective_agreement: ['agreementNumber', 'party1', 'party2', 'agreementSubject', 'fullDate'],
  court_pleading: ['pleadingTitle', 'caseType', 'caseNumber', 'party1', 'party2', 'fullDate'],
  book: ['author', 'bookTitle', 'year'],
  article: ['author', 'articleTitle', 'journalName', 'volume', 'firstPage', 'year'],
  article_in_book: ['author', 'articleTitle', 'bookTitle', 'firstPage', 'year'],
  encyclopedia_entry: ['articleTitle', 'bookAuthor', 'bookTitle', 'firstPage', 'year'],
  academic_work: ['author', 'bookTitle', 'workType', 'institution', 'year'],
  internet: ['url'],
  internet_comment: ['url'],
  religious: ['source', 'location'],
  correspondence: ['correspondenceType', 'senderName', 'recipientName', 'fullDate'],
  interview: ['intervieweeName', 'fullDate'],
  lecture: ['author', 'articleTitle', 'eventName', 'fullDate'],
  press_release: ['author', 'articleTitle', 'fullDate'],
  film: ['filmName', 'director', 'year'],
  tv_show: ['showName', 'channel', 'fullDate'],
  radio: ['showName', 'radioStation', 'fullDate'],
  treaty: ['treatyName', 'volume', 'firstPage', 'signingType', 'signingYear'],
  foreign: ['citation'],
  foreign_constitution: ['jurisdiction', 'division', 'section'],
  foreign_statute_us: ['title', 'code', 'section'],
  foreign_statute_uk: ['statuteName', 'year', 'chapter'],
  foreign_case_us: ['party1', 'party2', 'volume', 'reporter', 'firstPage', 'year'],
  foreign_case_other: ['party1', 'party2', 'volumeOrYear', 'reporter', 'firstPage', 'courtAndJurisdiction'],
  foreign_book: ['authors', 'bookTitle', 'year'],
  foreign_journal_article: ['authors', 'articleTitle', 'volume', 'journal', 'firstPage', 'year'],
  foreign_book_chapter: ['authors', 'articleTitle', 'bookTitle', 'firstPage', 'year'],
  foreign_internet: ['title', 'site', 'url'],
  other: [],
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
  treatyName: 'שם האמנה',
  signingType: 'סוג חתימה (נפתחה/נחתמה)',
  signingYear: 'שנת חתימה',
  notebook: 'מספר חוברת',
  decisionNumber: 'מספר החלטה',
  decidingBody: 'הגוף המחליט',
  decisionName: 'שם ההחלטה',
  opinionName: 'שם חוות הדעת',
  opinionAuthor: 'נותן חוות הדעת',
  opinionNumber: 'מספר חוות הדעת',
  planNumber: 'מספר תכנית',
  agreementNumber: 'מספר הסכם',
  agreementSubject: 'נושא ההסכם',
  pleadingTitle: 'כותרת כתב הטענות',
  specificReference: 'הפניה ספציפית',
  workType: 'סוג העבודה',
  institution: 'מוסד אקדמי',
  courseName: 'שם הקורס',
  correspondenceType: 'סוג התכתבות',
  senderName: 'שם הכותב',
  senderRole: 'תפקיד הכותב',
  recipientName: 'שם הנמען',
  recipientRole: 'תפקיד הנמען',
  subject: 'נושא ההתכתבות',
  intervieweeName: 'שם המרואיין',
  interviewerName: 'שם המראיין',
  intervieweeRole: 'תפקיד המרואיין',
  interviewType: 'סוג ריאיון',
  eventName: 'שם האירוע',
  eventLocation: 'מקום האירוע',
  releaseDescription: 'תיאור ההודעה',
  filmName: 'שם הסרט',
  director: 'שם הבמאי',
  showName: 'שם התוכנית',
  episodeName: 'שם הפרק',
  channel: 'ערוץ',
  creator: 'יוצר התוכנית',
  radioStation: 'תחנת רדיו',
  timeReference: 'הפניית זמן',
  contentType: 'סוג התוכן',
  socialUsername: 'שם משתמש',
  commentAuthor: 'מחבר התגובה',
  commentDate: 'תאריך התגובה',
  commentNumber: 'מספר התגובה',
  originalSourceDetails: 'פרטי המקור המקורי',
  title: 'כותרת',
  // Foreign (Bluebook – Rule 36)
  jurisdiction: 'תחום שיפוט',
  division: 'חלוקה (amend./art.)',
  code: 'קוד (U.S.C.)',
  chapter: 'פרק (chapter)',
  regnalYear: 'שנת מלכות',
  monarch: 'קיצור שם המלך/ה',
  reporter: 'שם הסדרה (reporter)',
  procPrefix: 'תחילית הליך (Ex parte/In re)',
  volumeOrYear: 'כרך/שנה',
  courtAndJurisdiction: 'ערכאה ותחום שיפוט',
  subtitle: 'שם משני',
  publisher: 'מוציא לאור',
  handle: 'שם משתמש (@)',
  site: 'שם האתר',
  pinpoint: 'הפניה ספציפית',
  statuteName: 'שם החוק',
  authors: 'שמות המחברים',
  journal: 'שם כתב העת',
};

// Normalize abbreviations in free text
export function normalizeAbbreviations(text: string): string {
  let result = normalizeQuotes(text);
  
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

// Normalize Hebrew quote marks (gershayim ״/׳) to ASCII equivalents
function normalizeQuotes(text: string): string {
  return text
    .replace(/\u05F4/g, '"')   // ״ → "
    .replace(/\u05F3/g, "'")   // ׳ → '
    .replace(/[\u201C\u201D\u201E]/g, '"')  // smart double quotes
    .replace(/[\u2018\u2019\u201A]/g, "'"); // smart single quotes
}

// ---------------------------------------------------------------------------
// Statute-signal strength helpers
//
// A statute marker (חוק / פקודת / תקנות) at the START of the input is a STRONG
// legislation signal, even without a Hebrew year or official formatting
// ("חוק הלאום", "חוק יסוד הלאום", "פקודת הנזיקין").
// The same word appearing mid-title is WEAK — it is usually part of a
// scholarship title ("אורי אהרונסון חוק הלאום בראי חוקי היסוד האחרים").
// ---------------------------------------------------------------------------

/** Hebrew statute year, e.g. התשל"ג-1973 / תש"ן-1990. */
const STATUTE_YEAR_RE = /הת?ש[\u05D0-\u05EA]{0,3}["'׳״]?[\u05D0-\u05EA]?["'׳״]?\s*[-–־]\s*\d{4}/;
/** Input opens with a statute marker (leading quotes/brackets ignored). */
const STATUTE_START_RE = /^[\s"'״׳(\[]*(חוק|פקודת|פקודה|תקנות)(?=[\s\-־:,(\[]|$)/;
const NUSACH_RE = /נוסח\s+(?:חדש|משולב)/;

/** True when the input starts with a statute marker such as חוק / פקודת / תקנות. */
export function startsWithStatuteMarker(text: string): boolean {
  return STATUTE_START_RE.test(normalizeQuotes(text).trim());
}

/**
 * Strong statute signal: leading statute marker, a Hebrew statute year, or a
 * נוסח חדש/משולב qualifier. Strong matches are never overridden by the LLM.
 */
export function hasStrongStatuteSignal(text: string): boolean {
  const t = normalizeQuotes(text).trim();
  return startsWithStatuteMarker(t) || STATUTE_YEAR_RE.test(t) || NUSACH_RE.test(t);
}

/**
 * Literature shape: Hebrew personal name (2–3 words) followed by a longer
 * descriptive title, with no docket, no statute year, no URL, and no leading
 * statute marker. Signals scholarship even when "חוק" appears in the title.
 */
export function looksLikeLiteratureShape(text: string): boolean {
  const t = normalizeQuotes(text).trim();
  if (!t) return false;
  if (startsWithStatuteMarker(t)) return false;
  if (STATUTE_YEAR_RE.test(t) || NUSACH_RE.test(t)) return false;
  if (/\d+\/\d+/.test(t)) return false;              // docket
  if (/https?:\/\//.test(t)) return false;           // url
  if (/נ['׳]|נגד/.test(t)) return false;             // case caption
  const stripped = t.replace(/["'״׳`]/g, "");
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  // First two tokens look like a personal name (pure Hebrew, no statute marker)
  const nameLike = /^[\u05D0-\u05EA]{2,}$/;
  if (!nameLike.test(words[0]) || !nameLike.test(words[1])) return false;
  if (/^(חוק|פקודת|פקודה|תקנות|הצעת)$/.test(words[0])) return false;
  return true;
}

const LEGISLATION_TYPES: SourceType[] = [
  "primary_legislation",
  "basic_law",
  "secondary_legislation",
];

/**
 * detectSourceType + a strength flag for legislation guesses.
 * `weak` means the legislation type came only from a mid-title statute word.
 */
export function detectSourceTypeWithStrength(text: string): {
  sourceType: SourceType;
  strength: "strong" | "weak";
} {
  const sourceType = detectSourceType(text);
  if (!LEGISLATION_TYPES.includes(sourceType)) {
    return { sourceType, strength: "strong" };
  }
  return { sourceType, strength: hasStrongStatuteSignal(text) ? "strong" : "weak" };
}

// Detect source type from free text
export function detectSourceType(text: string): SourceType {
  const normalized = text.toLowerCase();
  const hebrewText = normalizeQuotes(text);
  // Scholarship title that merely mentions a statute mid-title → not legislation.
  const literatureShape = looksLikeLiteratureShape(text) && !hasStrongStatuteSignal(text);

  
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
  if (/נ['׳'']|נגד/.test(hebrewText) && /\d+\/\d+/.test(hebrewText)) {
    return 'case_law_database';
  }
  // Party names without case number (e.g., "מדינת ישראל נגד זדורוב" or "X נ׳ Y")
  if (/[\u0590-\u05FF]+\s+(?:נגד|נ['׳''])\s+[\u0590-\u05FF]+/.test(hebrewText) && !/חוק|פקוד|תקנ|הצעת|אמנ|ספר|מהדורה/.test(hebrewText)) {
    return 'case_law_database';
  }
  
  // Check for court pleadings (Rule 22.2) – before case law checks
  if (/כתב\s+(?:ערעור|תביעה|הגנה|טענות)|טיעונים\s+(?:משלימים|מטעם)|סיכומים\s+(?:מטעם|של)|בקשה\s+(?:מטעם|של)/.test(hebrewText)) return 'court_pleading';

  // Check for expert opinions (Rule 16)
  if (/חוות\s+דעת/.test(hebrewText)) return 'expert_opinion';

  // Check for planning committee plans (Rule 17.1)
  if (/תכנית\s+מפורטת|תכנית\s+(?:בניין|בנין)\s+עיר|תב"ע|תכנית\s+מתאר/.test(hebrewText)) return 'planning_plan';

  // Check for collective agreements (Rule 17.2)
  if (/הסכם\s+קיבוצי/.test(hebrewText)) return 'collective_agreement';

  // Check for governmental body decisions (Rule 15)
  if (/החלטה\s+\d|החלטה\s+של|החלטה\s+חכ|תמצית\s+החלטה/.test(hebrewText)) return 'government_decision';
  if (/רשם\s+הפטנטים|בקשה\s+לביטול\s+תיקון|בקשת\s+עיצוב|התנגדות\s+לרישום\s+סימן|בקשות\s+מתחרות/.test(hebrewText)) return 'government_decision';
  if (/ועדת\s+ערר\s+לתכנון/.test(hebrewText)) return 'government_decision';

  // Check for legislation (skipped when the input is scholarship-shaped and the
  // statute word only appears mid-title)
  if (!literatureShape) {
    if (/חוק[- ־]?\s?יסוד/.test(hebrewText)) return 'basic_law';
    if (/תקנות/.test(hebrewText)) return 'secondary_legislation';
  }
  if (/הצעת חוק/.test(hebrewText)) return 'bill';
  if (/ד["״]כ|דברי הכנסת|דברי כנסת|מועצת המדינה(?:\s+הזמנית)?/.test(hebrewText)) return 'other';
  if (/אמנה|אמנת|הסכם.+(?:ממלכ|מדינ)|כ["״]א\s+\d/.test(hebrewText)) return 'treaty';
  if (/תקנון/.test(hebrewText)) return 'regulation';
  if (!literatureShape && /חוק |פקודת /.test(hebrewText)) return 'primary_legislation';

  
  // Check for correspondence (Rule 32.1)
  if (/מכתב מ|דואר אלקטרוני מ|מזכר מ/.test(hebrewText)) return 'correspondence';

  // Check for interviews (Rule 32.2)
  if (/ריאיון\s+(עם|של|טלפוני)/.test(hebrewText)) return 'interview';

  // Check for lectures (Rule 32.3)
  if (/הרצאה ב/.test(hebrewText)) return 'lecture';

  // Check for press releases (Rule 32.4)
  if (/הודעה ל(?:תקשורת|עיתונות)|הודעת דובר/.test(hebrewText)) return 'press_release';

  // Check for films (Rule 33.1)
  if (/במאי[תם]?\s|סרט\s/.test(hebrewText)) return 'film';

  // Check for TV shows (Rule 33.2) – quoted name + channel
  if (/ערוץ\s+\d/.test(hebrewText) && /"[^"]+"/.test(hebrewText)) return 'tv_show';

  // Check for radio (Rule 33.3)
  if (/גלי צה"ל|קול ברמה|רדיו|תסכית|תחנת\s/.test(hebrewText)) return 'radio';

  // Check for academic works (Rule 26) – before general literature
  if (/עבודת\s+גמר|חיבור\s+לשם|עבודה\s+סמינריונית|דוקטור.*תואר|מוסמך.*תואר|תזה|דיסרטציה|עבודת\s+דוקטורט/.test(hebrewText)) return 'academic_work';

  // Check for encyclopedia/dictionary entries (Rule 25)
  if (/מילון|אנציקלופד|ערך\s+"/.test(hebrewText)) return 'encyclopedia_entry';

  // Check for literature
  // Article in book: pattern like "author "title" book-name" (quoted article + book context)
  if (/"[^"]+".+(?:ספר|בתוך|עורך)/.test(hebrewText) || /".+"\s+.{5,}/.test(hebrewText) && !/עיוני משפט|משפטים|משפט וממשל|הפרקליט|כתב.עת/.test(hebrewText) && /ספר|בתוך/.test(hebrewText)) return 'article_in_book';
  if (/מאמר|עיוני משפט|משפטים|משפט וממשל|הפרקליט/.test(hebrewText)) return 'article';
  // Check for internet comments (Rule 34.2.9) before general internet
  if (/תגובה\s+(ל|מ-?\d)/.test(hebrewText) && /https?:\/\//.test(text)) return 'internet_comment';
  if (/https?:\/\//.test(text)) return 'internet';
  
  // Natural language case law references (e.g., "פסק הדין", "פס"ד") — BEFORE book heuristics
  if (/פסק\s+(?:ה)?דין|פס["״]ד/.test(hebrewText) && 
      !/חוק|פקוד|תקנ|הצעת|ספר/.test(hebrewText)) {
    return 'case_law_database';
  }
  
  if (/ספר|מהדורה/.test(hebrewText)) return 'book';
  
  // Heuristic: Hebrew name (2+ words) followed by a title (3+ additional words) → likely a book
  const strippedForBook = hebrewText.trim().replace(/['׳"״`]/g, '');
  if (/^[\u0590-\u05FF]+\s+[\u0590-\u05FF]+\s+[\u0590-\u05FF]/.test(strippedForBook) && 
      hebrewText.trim().split(/\s+/).length >= 4 &&
      !/נ['']|נגד|חוק|פקוד|תקנ|הצעת|אמנ|ד["״]כ|חוות\s+דעת|הסכם\s+קיבוצי/.test(hebrewText)) {
    return 'book';
  }
  
  // Religious sources (Rules 28–30)
  if (/תלמוד|משנה|גמרא|שו"ת|מקרא|בראשית|שמות|ויקרא|במדבר|דברים|בבלי|ירושלמי|שולחן ערוך|מכילתא|רש"י|רמב"ם|משנה תורה|טורים|קוראן|סורת|סורה|הבשורה על פי|האיגרת אל|שמות רבה|בראשית רבה|ויקרא רבה|אוצר הגאונים|ספר הישר/.test(hebrewText)) return 'religious';
  
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
  internet_comment: 'תגובה במרשתת',
  religious: 'מקור דתי',
  correspondence: 'התכתבות',
  interview: 'ריאיון',
  lecture: 'הרצאה',
  press_release: 'הודעה לתקשורת',
  film: 'סרט',
  tv_show: 'תוכנית טלוויזיה',
  radio: 'רדיו/תסכית',
  regulation: 'תקנון',
  government_decision: 'החלטות גופים שלטוניים',
  expert_opinion: 'חוות דעת',
  planning_plan: 'תכנית תכנון ובנייה',
  collective_agreement: 'הסכם קיבוצי',
  court_pleading: 'כתב טענות',
  encyclopedia_entry: 'ערך במילון/אנציקלופדיה',
  academic_work: 'עבודה אקדמית',
  treaty: 'כתבי אמנה',
  foreign: 'מקור לועזי',
  foreign_constitution: 'חוקה לועזית (36.1)',
  foreign_statute_us: 'חוק אמריקני (36.2)',
  foreign_statute_uk: 'חוק אנגלי (36.3)',
  foreign_case_us: 'פסיקה אמריקנית (36.4)',
  foreign_case_other: 'פסיקה לועזית אחרת (36.5)',
  foreign_book: 'ספר לועזי (36.6)',
  foreign_journal_article: 'מאמר לועזי בכתב עת (36.7)',
  foreign_book_chapter: 'מאמר לועזי בספר (36.8)',
  foreign_internet: 'מקור מרשתת לועזי (36.9)',
  other: 'אחר',
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
  article: 'כלל 24 – מאמרים',
  article_in_book: 'כלל 24.11 – מאמר שפורסם בספר',
  internet: 'כלל 34.2 – מקורות מהמרשתת',
  internet_comment: 'כלל 34.2.9 – תגובות במרשתת',
  religious: 'כללים 28–30 – מקורות דתיים',
  correspondence: 'כלל 32.1 – התכתבויות',
  interview: 'כלל 32.2 – ראיונות',
  lecture: 'כלל 32.3 – הרצאות',
  press_release: 'כלל 32.4 – הודעות לתקשורת',
  film: 'כלל 33.1 – סרטים',
  tv_show: 'כלל 33.2 – תוכניות טלוויזיה',
  radio: 'כלל 33.3 – רדיו ותסכיתים',
  regulation: 'כלל 13.1 – תקנונים',
  government_decision: 'כלל 15 – החלטות גופים שלטוניים',
  expert_opinion: 'כלל 16 – חוות דעת',
  planning_plan: 'כלל 17.1 – תכניות תכנון ובנייה',
  collective_agreement: 'כלל 17.2 – הסכמים קיבוציים',
  court_pleading: 'כלל 22.2 – כתבי טענות',
  encyclopedia_entry: 'כלל 25 – ערכים במילונים ובאנציקלופדיות',
  academic_work: 'כלל 26 – עבודות אקדמיות',
  treaty: 'כלל 9 – כתבי אמנה',
  foreign: 'כלל 36 – מקורות לועזיים (Bluebook)',
  foreign_constitution: 'כלל 36.1 – חוקות לועזיות',
  foreign_statute_us: 'כלל 36.2 – חוקים (ארה"ב)',
  foreign_statute_uk: 'כלל 36.3 – חוקים (אנגליה)',
  foreign_case_us: 'כלל 36.4 – פסיקה (ארה"ב)',
  foreign_case_other: 'כלל 36.5 – פסיקה (מדינות אחרות)',
  foreign_book: 'כלל 36.6 – ספרים לועזיים',
  foreign_journal_article: 'כלל 36.7 – מאמרים בכתבי עת לועזיים',
  foreign_book_chapter: 'כלל 36.8 – מאמרים שפורסמו בספרים לועזיים',
  foreign_internet: 'כלל 36.9 – מקורות במרשתת לועזיים',
  other: 'כלל 8 – אחר (דברי כנסת וכו׳)',
  unknown: '',
};
