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
  "1.9": { title: "הפרדה בפסיק", description: "אם שני מספרים עוקבים זה אחרי זה או שתי מילים עוקבות זו אחרי זו, ואי אפשר להבחין ביניהם באמצעות הדגשה או מירכאות, יש להפריד ביניהם בפסיק. דוגמות: בין כרך ומספר עמוד שבאים שניהם באותיות או במספרים; בין מספרי עמודים; בין פרטים ביבליוגרפיים שונים בסוגריים (מהדורה, עורך, מתרגם, שנה)." },
  "1.10": { title: "טווחי מספרים", description: "בעברית: טווח מספרים/אותיות נכתב מימין לשמאל – הנמוך מימין לקו המפריד והגבוה משמאל (למשל: 37–40, כה–כז, 474–478). בלועזית: לפי כללי שפת המקור. באזכור חוזר בעברית של מקור לועזי: מימין לשמאל (למשל: 2364–2372)." },
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
    example: 'חוק העונשין, התשל"ז-1977, ס"ח 226.',
    components: [
      { field: "lawName", rule: "2.1", description: "שם החוק המלא כפי שמופיע בכותרתו", required: true, format: "plain" },
      { field: "hebrewYear", rule: "2.4", description: "שנה עברית (למשל: התשל\"ז)", required: true, format: "plain" },
      { field: "gregorianYear", rule: "2.4", description: "שנה לועזית מחוברת במקף (למשל: -1977)", required: true, format: "plain" },
      { field: "collection", rule: "2.5", description: 'קובץ פרסום: ס"ח או ק"ת', required: true, format: "plain" },
      { field: "firstPage", rule: "2.6", description: "המספר היחיד שנכתב אחרי ס\"ח/ק\"ת: העמוד הראשון שבו מופיע החיקוק (ולא מספר החוברת)", required: true, format: "plain" },
      { field: "specificPage", rule: "2.6", description: "עמוד ספציפי מופניה (עם פסיק)", required: false, format: "plain" },
      { field: "section", rule: "2.8", description: 'הפניה לסעיף ספציפי: ס\' X, סס\' X-Y', required: false, format: "plain" },
    ],
    notes: [
      'כלל 2.2: "פקודה" – שם ישן לחוק; אותם כללי אזכור.',
      "כלל 2.3: תיקוני חקיקה – לציין את מספר התיקון בסוגריים.",
      'כלל 2.7: אם אין שנה עברית (פקודות מנדט) – מציינים שנה לועזית בלבד.',
      'כלל 2.8: אחרי ס"ח/ק"ת כותבים מספר אחד בלבד — העמוד הראשון שבו מופיע החיקוק, ולא מספר החוברת. דוגמאות: ס"ח 63 (נכון), לא ס"ח 446; ס"ח 226 (נכון), לא ס"ח 864.',
    ],
  },

  // ─── חוק יסוד (Basic Law) ──────────────────────────────────
  basic_law: {
    primaryRule: "4",
    ruleTitle: "כלל 4 – חוק יסוד",
    template: "חוק-יסוד: {lawName}, {collection} {firstPage}.",
    example: 'חוק-יסוד: כבוד האדם וחירותו, ס"ח 150.',
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
    template: "{regulationName}, {hebrewYear}-{gregorianYear}, {collection} {number}.",
    example: 'תקנות התעבורה, התשכ"א-1961, ק"ת 1128.',
    components: [
      { field: "regulationName", rule: "6.1", description: "שם התקנות המלא", required: true, format: "plain" },
      { field: "hebrewYear", rule: "6.2", description: "שנה עברית", required: true, format: "plain" },
      { field: "gregorianYear", rule: "6.2", description: "שנה לועזית", required: true, format: "plain" },
      { field: "collection", rule: "6.3", description: 'ק"ת – קובץ התקנות', required: true, format: "plain" },
    ],
  },

  // ─── הצעות חוק (Bills) ─────────────────────────────────────
  bill: {
    primaryRule: "8",
    ruleTitle: "כלל 8 – הצעות חוק",
    template: 'הצעת חוק {billName}, {hebrewYear}-{gregorianYear}, ה"ח [הכנסת/הממשלה/ריק] {billNumber}.',
    example: 'הצעת חוק העונשין (תיקון מס\' 137), התשע"ח-2018, ה"ח הממשלה 1234.',
    components: [
      { field: "billName", rule: "8.1", description: "שם הצעת החוק", required: true, format: "plain" },
      { field: "hebrewYear", rule: "8.2", description: "שנה עברית", required: true, format: "plain" },
      { field: "gregorianYear", rule: "8.2", description: "שנה לועזית", required: true, format: "plain" },
      { field: "billType", rule: "8.3", description: 'סוג הצעת חוק (הכנסת / הממשלה / ריק) – אופציונלי', required: false, format: "plain" },
      { field: "billNumber", rule: "8.3", description: 'מספר חוברת ה"ח', required: true, format: "plain" },
    ],
  },

  // ─── הצעות חוק יסוד (Basic Law Bills) ─────────────────────
  basic_law_bill: {
    primaryRule: "8",
    ruleTitle: "כלל 8 – הצעות חוק יסוד",
    template: 'הצעת חוק-יסוד: {billName}, {hebrewYear}, ה"ח [הכנסת/הממשלה/ריק] {billNumber}.',
    example: 'הצעת חוק-יסוד: כבוד האדם וחירותו (תיקון), התשפ"ג, ה"ח הכנסת 456.',
    components: [
      { field: "billName", rule: "8.1", description: "שם הצעת חוק היסוד", required: true, format: "plain" },
      { field: "hebrewYear", rule: "8.2", description: "שנה עברית בלבד (ללא שנה לועזית)", required: true, format: "plain" },
      { field: "billType", rule: "8.3", description: 'סוג הצעת חוק (הכנסת / הממשלה / ריק) – אופציונלי', required: false, format: "plain" },
      { field: "billNumber", rule: "8.3", description: 'מספר חוברת ה"ח', required: true, format: "plain" },
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
      { field: "database", rule: "19.1", description: "שם המאגר (נבו, תקדין, אר\u05F4ש, פדאור, דינים, פסקדין)", required: true, format: "plain" },
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
    template: "{author} **{bookTitle}** {volume} {firstPage} ({edition}, {editor}, {translator}, {year}).",
    example: 'אהרן ברק **פרשנות במשפט** כרך ג 150 (מהדורה שנייה, 2006).',
    components: [
      { field: "author", rule: "23.2", description: "שם המחבר – שם פרטי ואחריו שם משפחה כפי שמופיע במקור (כלל 23.2.1). קיצורי שמות בגרש/גרשיים, לא בנקודות (כלל 1.7). ללא תארים (כלל 23.2.3). מוסד כמחבר אם אין אדם (כלל 23.2.4).", required: true, format: "plain" },
      { field: "bookTitle", rule: "23.3", description: "שם הספר – מודגש", required: true, format: "bold" },
      { field: "volume", rule: "23.4", description: "מספר כרך – תמיד לציין, כפי שמופיע בספר, ללא הדגשה, ללא גרש אחרי אות. דוגמות: כרך שני, כרך א, כרך ב", required: false, format: "plain" },
      { field: "firstPage", rule: "23.5", description: "הפניה ספציפית – עמוד (ללא 'בעמ''), פרק/סעיף (עם תווית), § אם מספור רצוף, ה\"ש/טבלה (עמוד, פסיק, פריט+מספר). אין פסיק בין שם הספר/כרך להפניה אלא לפי כלל 1.9.", required: false, format: "plain" },
      { field: "edition", rule: "23.6", description: "מהדורה – רק אם 2+ מהדורות. תיאור כמו במקור. פסיק לפני פריט הבא רק לפי כלל 1.9.", required: false, format: "plain" },
      { field: "editor", rule: "23.7", description: "שם העורך + עורך/עורכת/עורכים/עורכות (או תואר אחר מהמקור). פסיק לפי כלל 1.9.", required: false, format: "plain" },
      { field: "translator", rule: "23.8", description: "שם המתרגם + מתרגם/מתרגמת/מתרגמים/מתרגמות. אין לציין שפת מקור. פסיק לפי כלל 1.9.", required: false, format: "plain" },
      { field: "year", rule: "23.9", description: "שנת פרסום: עברית בלבד → עברית (עם ה', ללא גרש); לועזית בלבד → לועזית; שתיהן → לועזית בלבד. מהדורה חדשה → שנת המהדורה החדשה.", required: true, format: "plain" },
    ],
    notes: [
      'כלל 23.1: הנוסחה: [שם המחבר] [שם הספר] [מספר הכרך] [הפניה ספציפית] ([המהדורה] [שם העורך] [שם המתרגם] [שנת פרסום הספר]).',
      'כלל 23.2.1: שם פרטי ושם משפחה כפי שמופיעים במקור. קיצורי שמות בגרש/גרשיים (לא בנקודות). דוגמה: שניאור ז\' חשין.',
      'כלל 23.2.2: שני מחברים – ו"ו חיבור לפני השני. שלושה – פסיקים + ו"ו לפני האחרון. ארבעה ומעלה – אפשר שם ראשון + "ואח\'".',
      'כלל 23.2.3: אין לציין תואר אקדמי, צבאי או אחר של המחבר.',
      'כלל 23.2.4: מוסד כמחבר – ציין את שם המוסד/הגוף בלבד. דוחות ועדות – שם הגוף המפרסם בלבד, ללא שמות חברים.',
      'כלל 23.3: שם הספר יודגש.',
      'כלל 23.4: מספר הכרך תמיד מצוין (גם אם העמודים ממשיכים), כפי שבספר, ללא הדגשה, ללא גרש אחרי אות.',
      'כלל 23.5.2: הפניה לעמוד – מספר כפי שבספר (אותיות או ספרות). אין "בעמ\'". דוגמה: כרך א 154–161.',
      'כלל 23.5.3: הפניה לפרק/סעיף – תווית לפני המספר ("פרק", "ס\'", §). § רק אם מספור רצוף.',
      'כלל 23.5.4: ה"ש/טבלה/תרשים – עמוד, פסיק, כינוי הפריט ומספרו. דוגמה: 158, ה"ש 69.',
      'כלל 23.6: מהדורה רק אם 2+. תיאור כמו במקור. דוגמה: מהדורה שלישית מורחבת ומתוקנת.',
      'כלל 23.7: עורכים לפי כלל 23.2. אחריהם: עורך/עורכת/עורכים/עורכות או תואר אחר. פסיק לפי 1.9.',
      'כלל 23.8: מתרגמים לפי כלל 23.2. אחריהם: מתרגם/מתרגמת/מתרגמים/מתרגמות. אין לציין שפת מקור. פסיק לפי 1.9.',
      'כלל 23.9: שנה עברית בלבד → עברית (עם ה\', ללא גרש: התשמ"ז). לועזית בלבד → לועזית. שתיהן → לועזית בלבד. מהדורה חדשה → שנת המהדורה.',
      'כלל 1.9: פסיק מפריד בין שני מספרים עוקבים או שתי מילים עוקבות כשאין הדגשה/מירכאות להבחין. דוגמה: כרך א, ז–ח; מהדורה שישית, חנן מוניץ עורך 2016.',
    ],
  },

  // ─── מאמרים בכתבי עת / עיתונות יומית (כלל 24) ─────────────
  article: {
    primaryRule: "24",
    ruleTitle: "כלל 24 – מאמרים",
    template: '{author} "{articleTitle}" **{journalName}** {volume}{notebook} {firstPage}[, {specificReference}] ({year}).',
    example: 'רונית לוין-שנור "הפרטה, הפרדה והפליה" **עיוני משפט** לד 183 (2011).',
    components: [
      { field: "author", rule: "24.2", description: "שם המחבר – לפי כלל 23.2 (שם פרטי + משפחה, ללא תארים, 2 = ו\"ו, 3 = פסיקים + ו\"ו, 4+ = ואח')", required: true, format: "plain" },
      { field: "articleTitle", rule: "24.3.1", description: "שם המאמר – במירכאות, כפי שמופיע בכותרת. שם משני מופרד בנקודתיים (24.3.3) אלא אם מופרד במקור אחרת או החלק הראשון מסתיים בפיסוק", required: true, format: "quotes" },
      { field: "journalName", rule: "24.4", description: "שם כתב העת – מודגש. עיתון יומי עם חלק: **שם:חלק** (שניהם והנקודתיים מודגשים)", required: true, format: "bold" },
      { field: "volume", rule: "24.5", description: "מספר כרך – לא מודגש, כפי שבמקור (אותיות או מספרים)", required: false, format: "plain" },
      { field: "notebook", rule: "24.6", description: "מספר חוברת – בסוגריים עגולים ללא רווח אחרי הכרך, רק אם כל חוברת מתחילה מעמוד 1. דוגמה: ה(2)", required: false, format: "plain" },
      { field: "firstPage", rule: "24.7.1", description: "עמוד תחילת המאמר – חובה, למעט חריגי כלל 24.7.2", required: true, format: "plain" },
      { field: "specificReference", rule: "24.8", description: "הפניה ספציפית (עמוד, פרק, ה\"ש, טבלה) – אחרי פסיק. ללא 'בעמ''. דוגמה: 569, 584–586", required: false, format: "plain" },
      { field: "year", rule: "24.9", description: "שנת פרסום – רק אם לא הופיעה ככרך. עברית בלבד → עברית (עם ה'). לועזית בלבד → לועזית. שתיהן → לועזית בלבד", required: true, format: "plain" },
    ],
    notes: [
      'כלל 24.1: הנוסחה: [שם המחבר] "[שם המאמר]" [שם כתב העת] [כרך][(חוברת)] [עמוד תחילת המאמר][, הפניה ספציפית] ([שנה]).',
      'כלל 24.2: שמות מחברים לפי כלל 23.2 (שם פרטי + משפחה, ללא תארים, 2 מחברים = ו"ו, 3 = פסיקים + ו"ו, 4+ = ואח\').',
      'כלל 24.3.1: שם המאמר במירכאות. כלל 24.3.2: כפי שמופיע בכותרת.',
      'כלל 24.3.3: שם משני מופרד בנקודתיים, אלא אם מופרד במקור בדרך אחרת או שהחלק הראשון מסתיים בפיסוק. אפשר להשמיט שם משני אם אין חשיבות.',
      'כלל 24.4: שם כתב העת מודגש. עיתון יומי עם חלק: **שם:חלק** (הכל מודגש). דוגמה: **מעריב: עסקים**, **ידיעות אחרונות: 7 ימים**.',
      'כלל 24.5.1: כרך לא מודגש. כלל 24.5.2: כפי שבמקור (אותיות או מספרים).',
      'כלל 24.6: חוברת בסוגריים ללא רווח אחרי הכרך, רק אם כל חוברת מתחילה מעמוד 1. דוגמה: ה(2) 27. אם במקור בדרך אחרת – כמו במקור, למשל ט/4.',
      'כלל 24.7.1: עמוד תחילת המאמר חובה. כלל 24.7.2: אין עמוד ראשון אם: (1) גיליון עם מאמר יחיד, (2) כל המאמרים מעמוד 1, (3) אין מספרי עמודים.',
      'כלל 24.8: הפניה ספציפית אחרי פסיק (עמוד, פרק, ה"ש, טבלה, תרשים). דוגמה: 569, 584–586. או: 509, חלקים ד(3)–(4). אם אין עמוד ראשון – פסיק אחרי הכרך.',
      'כלל 24.9.1: שנה רק אם לא הופיעה ככרך. כלל 24.9.2: לפי החוברת – עברית בלבד → עברית (עם ה\'). לועזית בלבד → לועזית. שתיהן → לועזית.',
      'כלל 24.10: מאמרים בכתבי עת מקוונים – לפי אותם כללים של מודפסים.',
      'כלל 24.12.1: "משפט, חברה ותרבות" – לפני 2018 = מאמר בספר (24.11). אחרי 2018 = מאמר בכתב עת. אפשר לציין שם כרך אחרי מספר הכרך.',
      'כלל 24.12.2: "פרשת השבוע" – ציון פרשת השבוע לפני השנה. אין עמוד ראשון (24.7.2). דוגמה: פרשת השבוע 398 (פרשת וירא התשע"ב).',
    ],
  },

  // ─── מאמר בספר (כלל 24.11) ────────────────────────────────
  article_in_book: {
    primaryRule: "24.11",
    ruleTitle: "כלל 24.11 – מאמר שפורסם בספר",
    template: '{author} "{articleTitle}" {bookAuthor} **{bookTitle}** {volume} {firstPage}[, {specificReference}] ([{edition}] [{editor}] [{translator}] {year}).',
    example: 'אייל גרוס "בריאות בישראל: בין זכות למצרך" **זכויות כלכליות, חברתיות ותרבותיות בישראל** 437 (יורם רבין ויובל שני עורכים 2004).',
    components: [
      { field: "author", rule: "24.2", description: "שם מחבר המאמר – לפי כלל 23.2", required: true, format: "plain" },
      { field: "articleTitle", rule: "24.3", description: "שם המאמר – במירכאות (לפי 24.3.1–24.3.3)", required: true, format: "quotes" },
      { field: "bookAuthor", rule: "23.2", description: "שם מחבר הספר – אם זהה למחבר המאמר, אין לחזור על השם", required: false, format: "plain" },
      { field: "bookTitle", rule: "23.3", description: "שם הספר – מודגש", required: true, format: "bold" },
      { field: "volume", rule: "23.4", description: "מספר כרך – כפי שבספר, ללא הדגשה", required: false, format: "plain" },
      { field: "firstPage", rule: "24.7", description: "עמוד תחילת המאמר בספר", required: true, format: "plain" },
      { field: "specificReference", rule: "24.8", description: "הפניה ספציפית – אחרי פסיק", required: false, format: "plain" },
      { field: "edition", rule: "23.6", description: "מהדורה – רק אם 2+", required: false, format: "plain" },
      { field: "editor", rule: "23.7", description: "שם העורך + עורך/עורכת/עורכים/עורכות", required: false, format: "plain" },
      { field: "translator", rule: "23.8", description: "שם המתרגם + מתרגם/מתרגמת", required: false, format: "plain" },
      { field: "year", rule: "23.9", description: "שנת פרסום הספר", required: true, format: "plain" },
    ],
    notes: [
      'כלל 24.11: הנוסחה: [מחבר מאמר] "[שם המאמר]" [מחבר ספר] [שם הספר] [כרך] [עמוד תחילת] [, הפניה ספציפית] ([מהדורה] [עורך] [מתרגם] [שנה]).',
      'רכיבי המאמר לפי כללים 24.2, 24.3, 24.7, 24.8. רכיבי הספר לפי כללים 23.2–23.4, 23.6–23.9.',
      'אם למאמר ולספר אותו מחבר באותו סדר – אין לחזור על השם לפני שם הספר. דוגמה: אהרן ברק "עוולת הרשלנות" **מבחר כתבים** כרך ב 1083 (חיים ה\' כהן ויצחק זמיר עורכים 2000).',
    ],
  },

  // ─── מקורות מרשתת (Internet Sources – Rule 34.2) ──────────
  internet: {
    primaryRule: "34.2",
    ruleTitle: "כלל 34.2 – מקורות מהמרשתת",
    template: '{author} "{title}" {contentType} **{siteName}** {specificReference} ({fullDate}) {url}.',
    example: 'טובה צימוקי "פתרון לסחבת במערכת המשפט" **ynet** (21.12.2017) https://www.ynet.co.il/articles/0,7340,L-5060004,00.html.',
    components: [
      { field: "author", rule: "34.2.2", description: "שם המחבר – רק אם הופיע. מדיה חברתית: שם משתמש בסוגריים. שם בעברית ובשפות נוספות – די בעברית", required: false, format: "plain" },
      { field: "title", rule: "34.2.3", description: "שם העמוד/התוכן – רק אם הופיע. עמוד ראשי – ללא כותרת. מדיה חברתית – אופציונלי", required: false, format: "quotes" },
      { field: "contentType", rule: "34.2.4", description: "סוג תוכן – רק אם אינו בסיסי (שרשור, סטורי)", required: false, format: "plain" },
      { field: "siteName", rule: "34.2.5", description: "שם האתר – מודגש. מדיה חברתית בעברית (טוויטר, פייסבוק, אינסטגרם, יוטיוב)", required: false, format: "bold" },
      { field: "specificReference", rule: "34.2.6", description: "הפניה ספציפית (כותרת, פסקה, זמן בתוכן חזותי/שמעי)", required: false, format: "plain" },
      { field: "fullDate", rule: "34.2.7", description: "תאריך לועזי מלא ביותר שמופיע. אם אין – עברי. אם אין כלל – ללא. מדיה חברתית – אפשר שעה", required: false, format: "plain" },
      { field: "url", rule: "34.2.8", description: "כתובת URL מלאה כולל http://. אפשר לקצר", required: true, format: "plain" },
    ],
    notes: [
      'כלל 34.2.1: נוסחה: [שם המחבר] "[שם העמוד או התוכן]" [סוג התוכן] [שם האתר] [הפניה ספציפית] ([תאריך]) [כתובת]. חלה על אתרים, עמודים, מדיה חברתית, מאמרים באתרי עיתונים. לא חלה על כתבי עת מקוונים (24.10) או תגובות (34.2.9).',
      'כלל 34.2.2: שם מחבר רק אם הופיע בעמוד. לצד שם מחבר של מדיה חברתית – שם משתמש בסוגריים. שם בעברית ובשפות נוספות – די בעברית.',
      'כלל 34.2.3: כותרת רק אם הופיעה. עמוד ראשי – ללא כותרת. מדיה חברתית – כותרת אופציונלית.',
      'כלל 34.2.4: סוג תוכן רק אם אינו הסוג הבסיסי (למשל שרשור בטוויטר, סטורי באינסטגרם).',
      'כלל 34.2.5: שם אתר מודגש. שם כפי שמופיע באתר. מדיה חברתית בעברית: טוויטר, פייסבוק, אינסטגרם, יוטיוב.',
      'כלל 34.2.6: הפניה ספציפית (כותרת, פסקה, זמן). כתובת מדויקת עדיפה. דוגמה: חלק 5, או 16:09.',
      'כלל 34.2.7: תאריך לועזי מלא ביותר. אם אין – עברי. אם אין כלל – ללא. מדיה חברתית – אפשר שעה.',
      'כלל 34.2.8: כתובת URL מלאה כולל http://. אם ארוכה – אפשר לקצר באמצעות שירותי קיצור.',
      'דוגמות: טובה צימוקי "פתרון לסחבת במערכת המשפט" **ynet** (21.12.2017) https://www.ynet.co.il/articles/0,7340,L-5060004,00.html. | "הסיוע המשפטי" **משרד המשפטים** (2020) https://www.justice.gov.il/Units/SiuaMishpaty/Pages/Default.aspx. | נעמה כרמי **קרוא וכתוב** https://naama-carmi.com. | רות גביזון (ruthgavizon@) **פייסבוק** (20.10.2019) https://www.facebook.com/ruthgavison/posts/3237367343000319. | Birnhack( Michael Birnhack@) שרשור **טוויטר** (22.4.2020, 8:12) https://twitter.com/Birnhack/status/1252827512599572482.',
    ],
  },

  // ─── תגובות במרשתת (Internet Comments – Rule 34.2.9) ──────
  internet_comment: {
    primaryRule: "34.2.9",
    ruleTitle: "כלל 34.2.9 – תגובות במרשתת",
    template: '{commentAuthor} "{title}" תגובה {commentNumber} {commentDate} ל{originalSourceDetails}.',
    example: 'קרן ילין-מור, תגובה מ-5.12.2013, 22:45 לנועם זמיר "האם רשאי בית המשפט של הערעור להיעזר בנט המשפט?" **הטרקלין** (5.12.2013) https://israelaw.wordpress.com/2013/12/05/net-hamishpat/.',
    components: [
      { field: "commentAuthor", rule: "34.2.2", description: "שם מחבר התגובה – לפי כלל 34.2.2", required: false, format: "plain" },
      { field: "title", rule: "34.2.9", description: "כותרת התגובה – רק אם מופיעה במקור", required: false, format: "quotes" },
      { field: "commentNumber", rule: "34.2.9", description: "מספר התגובה (אם ממוספרת)", required: false, format: "plain" },
      { field: "commentDate", rule: "34.2.9", description: 'תאריך התגובה (אחרי "מ-")', required: false, format: "plain" },
      { field: "originalSourceDetails", rule: "34.2.9", description: "פרטי המקור לפי כללים 34.2.2–34.2.8", required: true, format: "plain" },
      { field: "url", rule: "34.2.8", description: "כתובת התגובה (עדיפה) או כתובת המקור", required: true, format: "plain" },
    ],
    notes: [
      'כלל 34.2.9: נוסחה: [שם מחבר התגובה] "[כותרת]" תגובה [פרטי תגובה] ל[פרטי המקור].',
      'על שם מחבר התגובה יחול כלל 34.2.2. כותרת רק אם מופיעה במקור.',
      'פרטי התגובה: מספרה (אם ממוספרת) ותאריך (אחרי "מ-") אם מופיע.',
      'פרטי המקור לפי כללים 34.2.2–34.2.8. כתובת התגובה עדיפה על כתובת המקור.',
      'דוגמות: usabach( Uri@) תגובה לאגודה לזכויות האזרח (acrionline@) **אינסטגרם** (28.8.2018) https://www.instagram.com/p/BnBSOyygw1K. | קרן ילין-מור, תגובה מ-5.12.2013, 22:45 לנועם זמיר "האם רשאי בית המשפט של הערעור להיעזר בנט המשפט?" **הטרקלין** (5.12.2013) https://israelaw.wordpress.com/2013/12/05/net-hamishpat/. | רחובותית, תגובה 1 מ-5.1.2017, 11:37 ליותם טולוב "זאת לא השפה: חברי הכנסת מפגרים מאחור" **וואלה!** (26.12.2016) https://news.walla.co.il/item/3025997.',
    ],
  },

  religious: {
    primaryRule: "28",
    ruleTitle: "כללים 28–30 – מקורות דתיים",
    template: "(רב-נוסחאות – ראה notes)",
    example: "בראשית ג 19. | בבלי, ברכות ב, ע\"א. | משנה, בבא מציעא א, ד.",
    components: [
      { field: "source", rule: "28", description: "שם המקור/חיבור (שם ספר תנ\"ך, שם מסכת, שם חיבור רבני, סורה וכו')", required: true, format: "plain" },
      { field: "location", rule: "28", description: "הפניה ספציפית (פרק, פסוק, דף, עמוד, הלכה, סימן, סעיף, ד\"ה)", required: true, format: "plain" },
      { field: "edition", rule: "28.6", description: "מהדורה (לספרות חז\"ל/רבנית – מהדורת X עמוד)", required: false, format: "plain" },
    ],
    notes: [
      'כלל 28.2 – תנ"ך: {שם הספר} {פרק באותיות ללא גרש/גרשיים} {פסוק בספרות}. ספר שמסתיים באות (כמו מלכים ב) – פסיק לפני מספר הפרק. פסוקים באותו פרק מופרדים בפסיק; הפניות מפרקים שונים מופרדות בנקודה-פסיק. דוגמות: שמואל א, א 19. | בראשית ג 19; ח 3–7, 17.',
      'כלל 28.3 – משנה: משנה, {מסכת} {פרק}, {משנה}. דוגמה: משנה, בבא מציעא א, ד.',
      'כלל 28.4 – תלמוד בבלי: בבלי, {מסכת} {דף}, {עמוד}. דוגמה: בבלי, ברכות ב, ע"א.',
      'כלל 28.5 – תלמוד ירושלמי: ירושלמי, {מסכת} {פרק}, {הלכה}. דוגמה: ירושלמי, גיטין ד, א.',
      'כלל 28.6 – ספרות חז"ל ורבנית: {שם חיבור}, {הפניה} (מהדורת {שם} {עמוד}). דוגמות: מכילתא דרבי ישמעאל, שירה ד (מהדורת הורוביץ-רבין 129–132). | שמות רבה ד, ד (מהדורת שנאן 151). | אוצר הגאונים, תענית, חלק התשובות (מהדורת לוין 26).',
      'כלל 28.6.1 – שם חיבור מלא. שו"ת בראשי תיבות אם מקובל. חיבורים בשם זהה מזוהים לפי מחבר. דוגמות: שולחן ערוך, אורח חיים, סימן א, סעיף ג. | שו"ת הרשב"א, סימן א. | ספר הישר לר"ת, סימן קכה (מהדורת שלזינגר 92–93).',
      'כלל 28.6.2 – הפניה לפי חלוקה מסורתית: ספר, פרק, הלכה, פרשה, סימן, סעיף. פירושים – ד"ה. דוגמות: משנה תורה, נחלות, פרק י, הלכה ד. | ארבעה טורים, אורח חיים, סימן ב, סעיף ב. | רש"י, ברכות ב, ע"א, ד"ה "מאימתי".',
      'כלל 29 – ברית חדשה: מאוזכרת כמו תנ"ך (כלל 28.2). דוגמה: הבשורה על פי יוחנן א 1.',
      'כלל 30 – קוראן: שלוש נוסחות מקובלות: (1) הקוראן, סורת {שם} {פסוק}. (2) הקוראן, סורה {מספר באותיות} {פסוק}. (3) הקוראן, סורה {מספר בספרות}, {פסוק}. יש לבחור אחת ולנקוט עקבית. דוגמות: הקוראן, סורת חזון הנשים 8. | הקוראן, סורה ד 8. | הקוראן, סורה 4, 8.',
    ],
  },

  // ─── כתבי אמנה (Treaties – Rule 9) ────────────────────────
  treaty: {
    primaryRule: "9",
    ruleTitle: "כלל 9 – כתבי אמנה",
    template: '[הפניה ספציפית] [ל]{treatyName}, כ"א {volume}, {firstPage}, {specificPage} ({signingDetails}).',
    example: 'אמנה בינלאומית בדבר זכויות אזרחיות ומדיניות, כ"א 31, 269 (נפתחה לחתימה ב-1966).',
    components: [
      { field: "section", rule: "9.1", description: 'הפניה ספציפית (ס\' X ל...)', required: false, format: "plain" },
      { field: "treatyName", rule: "9.1", description: "שם האמנה בעברית", required: true, format: "plain" },
      { field: "volume", rule: "9.1", description: 'מספר כרך בכתבי אמנה (כ"א)', required: true, format: "plain" },
      { field: "notebook", rule: "9.1", description: "מספר חוברת (בסוגריים אחרי הכרך, אם העמודים לא רציפים)", required: false, format: "plain" },
      { field: "firstPage", rule: "9.1", description: "מספר העמוד הראשון", required: true, format: "plain" },
      { field: "specificPage", rule: "9.1", description: "מספר העמוד הספציפי (אם יש הפניה ספציפית)", required: false, format: "plain" },
      { field: "signingType", rule: "9.1", description: 'סוג חתימה: "נפתחה לחתימה ב-" (רב-צדדית) או "נחתמה ב-" (דו-צדדית)', required: true, format: "plain" },
      { field: "signingYear", rule: "9.1", description: "שנת החתימה הלועזית", required: true, format: "plain" },
      { field: "ratification", rule: "9.2", description: "מידע נוסף: שנת אשרור, כניסה לתוקף (בסוגריים נפרדים)", required: false, format: "plain" },
    ],
    notes: [
      'כלל 9.1: אמנה רב-צדדית – "נפתחה לחתימה ב-{שנה}" (ללא רווח בין הקו לשנה).',
      'כלל 9.1: אמנה דו-צדדית – "נחתמה ב-{שנה}" (ללא רווח בין הקו לשנה).',
      'כלל 9.1: אם העמודים בכרך אינם ממוספרים ברציפות – יש לציין מספר חוברת בסוגריים אחרי מספר הכרך, למשל כ"א 51(1415).',
      'כלל 9.2: אפשר להוסיף מידע רלוונטי נוסף בסוגריים בסוף האזכור, כגון "(אושררה ונכנסה לתוקף ב-1991)".',
    ],
  },

  // ─── תקנונים (Bylaws/Regulations – Rule 13.1) ─────────────
  regulation: {
    primaryRule: "13.1",
    ruleTitle: "כלל 13.1 – תקנונים",
    template: "[הפניה ספציפית] ל{regulationName} ({fullDate}).",
    example: 'ס\' 141 לתקנון הכנסת (30.4.2019).',
    components: [
      { field: "section", rule: "13.1", description: 'הפניה ספציפית (ס\' X, פס\' X)', required: false, format: "plain" },
      { field: "regulationName", rule: "13.1", description: "שם התקנון או קיצורו", required: true, format: "plain" },
      { field: "fullDate", rule: "13.1", description: "תאריך לועזי מדויק של גרסת התקנון (DD.MM.YYYY)", required: true, format: "plain" },
    ],
    notes: [
      "כלל 13.1: יש לציין את התאריך הלועזי המדויק של גרסת התקנון המאוזכרת.",
      "אם מדובר בתקנון מעודכן – תאריך התיקון האחרון (או קבלתו אם לא תוקן).",
      'תיקונים לתקנון הכנסת מתפרסמים ב"ילקוט הפרסומים" – אפשר להפנות לשם.',
      'דוגמה לתיקון: תיקון תקנון הכנסת, י"פ התשע"ב 5730, 5744.',
    ],
  },

  // ─── החלטות גופים שלטוניים (Government Decisions – Rule 15) ─
  government_decision: {
    primaryRule: "15.1",
    ruleTitle: "כלל 15 – החלטות גופים שלטוניים",
    template: 'החלטה {decisionNumber} של {decidingBody} "{decisionName}" ({fullDate}).',
    example: 'החלטה 1666 של הממשלה ה-30 "מינוי המועצה הישראלית לתרבות ואמנות" (14.3.2004).',
    components: [
      { field: "decisionNumber", rule: "15.1", description: "מספר ההחלטה (אופציונלי לפי כלל 15.2)", required: false, format: "plain" },
      { field: "decidingBody", rule: "15.1", description: "שם הגוף המחליט (כולל מספר ממשלה לפי כלל 15.3)", required: true, format: "plain" },
      { field: "decisionName", rule: "15.1", description: "שם ההחלטה – במירכאות", required: true, format: "quotes" },
      { field: "fullDate", rule: "15.1", description: "תאריך לועזי מלא (DD.MM.YYYY)", required: true, format: "plain" },
    ],
    notes: [
      'כלל 15.2: אם אין מספר להחלטה – אין מציינים אותו.',
      'כלל 15.3: אם הגוף המחליט הוא הממשלה או ועדת שרים – יש לציין את מספר הממשלה (למשל: הממשלה ה-30).',
      'כלל 15.4: אם אין תאריך לועזי מלא – יש לציין את פרטי התאריך הקיימים; אם אין תאריך לועזי כלל – תאריך עברי.',
      'כלל 15.7: החלטות רשם הפטנטים – נוסחה מיוחדת: [סוג ההליך] מס\' [מספר] [שמות צדדים] ([תיאור הליך ביניים]) ([תאריך]).',
      'כלל 15.8: החלטות ועדות ערר לתכנון ובנייה – מאוזכרות כפסקי דין (כללים 18–20).',
    ],
  },

  // ─── חוות דעת (Expert Opinions – Rule 16) ──────────────────
  expert_opinion: {
    primaryRule: "16.1",
    ruleTitle: "כלל 16 – חוות דעת",
    template: '"[שם חוות הדעת]" (חוות דעת של [זהות נותן חוות הדעת] [תאריך לועזי מלא]).',
    example: '"הצעת חוק איסור התערבות גנטית (שיבוט אדם ושינוי בתנאי רבייה) (תיקון), התשס"ד–2004" (חוות דעת של נציב הדורות הבאים 22.3.2004).',
    components: [
      { field: "opinionName", rule: "16.1", description: "שם חוות הדעת – במירכאות", required: true, format: "quotes" },
      { field: "opinionAuthor", rule: "16.1", description: "זהות נותן חוות הדעת (תפקיד או שם + תואר)", required: true, format: "plain" },
      { field: "fullDate", rule: "16.1", description: "תאריך לועזי מלא (DD.MM.YYYY)", required: true, format: "plain" },
      { field: "opinionNumber", rule: "16.4", description: "מספר חוות הדעת (לנציבות תלונות הציבור על שופטים)", required: false, format: "plain" },
    ],
    notes: [
      'כלל 16.2: חוות דעת במילוי תפקיד – מציינים תפקיד בלבד. חוות דעת פרטית – שם + תואר רלוונטי. אם השם מופיע בשם חוות הדעת – אין צורך לחזור עליו בסוגריים.',
      'כלל 16.3: תאריך לועזי מלא. אם אין – תאריך חלקי או עברי.',
      'כלל 16.4: נציבות תלונות הציבור על שופטים – נוסחה מיוחדת: חוות דעת [מספר] של נציבות תלונות הציבור על שופטים "[שם]" [פרטי פרסום] ([תאריך]). דוגמה: חוות דעת 10/06 של נציבות תלונות הציבור על שופטים "התבטאות בפסק דין, הסתייגות חלק משופטי הרכב מקטע ממנו וקשר עם התקשורת" דין וחשבון שנתי לשנת 2006 193 (3.9.2006).',
    ],
  },

  // ─── תכניות תכנון ובנייה (Planning Plans – Rule 17.1) ─────
  planning_plan: {
    primaryRule: "17.1",
    ruleTitle: "כלל 17.1 – תכניות תכנון ובנייה",
    template: 'תכנית מפורטת {planNumber} של {decidingBody} "{decisionName}" ({fullDate}).',
    example: 'תכנית מפורטת 2549א\' של הוועדה המקומית לתכנון ולבניה תל-אביב–יפו "מתחם רח\' יפת, רח\' רבי פנחס" (2003).',
    components: [
      { field: "planNumber", rule: "17.1", description: "מספר התכנית", required: true, format: "plain" },
      { field: "decidingBody", rule: "17.1", description: "שם הוועדה (הגוף המחליט)", required: true, format: "plain" },
      { field: "decisionName", rule: "17.1", description: "שם התכנית – במירכאות", required: true, format: "quotes" },
      { field: "fullDate", rule: "17.1", description: "שנה או תאריך מלא", required: true, format: "plain" },
    ],
    notes: [
      'כלל 17.1: תכניות של ועדות לתכנון ובנייה מאוזכרות בדומה להחלטות של גופים שלטוניים (כלל 15).',
    ],
  },

  // ─── הסכמים קיבוציים (Collective Agreements – Rule 17.2) ───
  collective_agreement: {
    primaryRule: "17.2",
    ruleTitle: "כלל 17.2 – הסכמים קיבוציים",
    template: 'הסכם קיבוצי מס\' {agreementNumber} בין {party1} ל{party2} בעניין {agreementSubject} ({fullDate}).',
    example: 'הסכם קיבוצי מס\' 2008/7033 בין הסתדרות העובדים הכללית החדשה ללשכת התאום של הארגונים הכלכליים בעניין עקרונות מוסכמים וכלי שימוש במחשב ובתיבת דואר אלקטרוני במקום העבודה (25.6.2008).',
    components: [
      { field: "agreementNumber", rule: "17.2", description: "מספר ההסכם הקיבוצי", required: true, format: "plain" },
      { field: "party1", rule: "17.2", description: "צד א' להסכם", required: true, format: "plain" },
      { field: "party2", rule: "17.2", description: "צד ב' להסכם", required: true, format: "plain" },
      { field: "agreementSubject", rule: "17.2", description: 'נושא ההסכם (אחרי "בעניין")', required: true, format: "plain" },
      { field: "fullDate", rule: "17.2", description: "תאריך ההסכם (DD.MM.YYYY)", required: true, format: "plain" },
    ],
    notes: [
      'כלל 17.2: אם צד כולל יותר מגורם אחד, אפשר לציין את הגורם הראשון בלבד ואחריו "ואח\'" אם אין חשיבות מיוחדת לציון יתר הגורמים.',
    ],
  },

  // ─── כתבי טענות (Court Pleadings – Rule 22.2) ──────────────
  court_pleading: {
    primaryRule: "22.2",
    ruleTitle: "כלל 22.2 – כתבי טענות",
    template: "[הפניה ספציפית] ל{pleadingTitle} ב{caseType} {caseNumber} {party1} נ' {party2} ({fullDate}).",
    example: 'כתב ערעור בע"א 751/10 דיין נ\' ר\' (15.2.2010).',
    components: [
      { field: "specificReference", rule: "22.2", description: "הפניה ספציפית (ס' X, פס' X) – אופציונלי", required: false, format: "plain" },
      { field: "pleadingTitle", rule: "22.2", description: "כותרת כתב הטענות (כתב ערעור, טיעונים משלימים מטעם העותרים וכו')", required: true, format: "plain" },
      { field: "caseType", rule: "22.2", description: "סוג ההליך (ע\"א, בג\"ץ וכו')", required: true, format: "plain" },
      { field: "caseNumber", rule: "22.2", description: "מספר התיק", required: true, format: "plain" },
      { field: "party1", rule: "22.2", description: "צד א'", required: true, format: "plain" },
      { field: "party2", rule: "22.2", description: "צד ב'", required: true, format: "plain" },
      { field: "fullDate", rule: "22.2", description: "תאריך כתב הטענות (DD.MM.YYYY)", required: true, format: "plain" },
      { field: "court", rule: "22.2", description: "פרטי ערכאה (אופציונלי)", required: false, format: "plain" },
      { field: "database", rule: "22.2", description: "שם מאגר (אופציונלי)", required: false, format: "plain" },
    ],
    notes: [
      'כלל 22.2: הפניה ספציפית (ס\' X) מופיעה בתחילת האזכור, לפני כותרת כתב הטענות.',
      'כותרת כתב הטענות כוללת את סוג המסמך ואופציונלית את הצד שמטעמו הוגש ("מטעם העותרים").',
      'אם כתב הטענות מצוטט ממאגר – שם המאגר מופיע לפני התאריך בסוגריים.',
    ],
  },

  // ─── ערכים במילונים/אנציקלופדיות (Rule 25) ─────────────────
  encyclopedia_entry: {
    primaryRule: "25",
    ruleTitle: "כלל 25 – ערכים במילונים ובאנציקלופדיות",
    template: '"{articleTitle}" {bookAuthor} **{bookTitle}** {firstPage} ({editor} {year}).',
    example: '"דין" אברהם אבן-שושן **מלון אבן-שושן המרכז: מחדש ומעודכן לשנות האלפים** 182 (משה אזר עורך ראשי 2004).',
    components: [
      { field: "articleTitle", rule: "25", description: "שם הערך – במירכאות", required: true, format: "quotes" },
      { field: "bookAuthor", rule: "23.2", description: "שם מחבר המילון/אנציקלופדיה", required: false, format: "plain" },
      { field: "bookTitle", rule: "23.3", description: "שם המילון/אנציקלופדיה – מודגש", required: true, format: "bold" },
      { field: "volume", rule: "23.4", description: "מספר כרך (אם יש)", required: false, format: "plain" },
      { field: "firstPage", rule: "24.7", description: "עמוד תחילת הערך", required: true, format: "plain" },
      { field: "editor", rule: "23.7", description: "שם העורך + עורך/עורכת/עורכים/עורכות", required: false, format: "plain" },
      { field: "year", rule: "23.9", description: "שנת פרסום", required: true, format: "plain" },
    ],
    notes: [
      'כלל 25: ערכים במילונים, באנציקלופדיות ובפרסומים כיוצא באלו מאוזכרים בדומה למאמר בספר (כלל 24.11).',
      'שם הערך מופיע במירכאות בתחילת האזכור.',
    ],
  },

  // ─── עבודות אקדמיות (Rule 26) ──────────────────────────────
  academic_work: {
    primaryRule: "26",
    ruleTitle: "כלל 26 – עבודות אקדמיות",
    template: '{author} **{bookTitle}** {specificReference} ({workType}, {institution} {year}).',
    example: 'אושרה קנצפולסקי **תרופות חוקתיות לתופעה של פגיעה על ידי המשטרה בזכויות חשודים: גישה אמפירית** (חיבור לשם קבלת תואר "דוקטור למשפטים", אוניברסיטת חיפה 2014).',
    components: [
      { field: "author", rule: "23.2", description: "שם המחבר – לפי כלל 23.2", required: true, format: "plain" },
      { field: "bookTitle", rule: "23.3", description: "שם העבודה – מודגש", required: true, format: "bold" },
      { field: "specificReference", rule: "23.5", description: "הפניה ספציפית (עמוד, פרק)", required: false, format: "plain" },
      { field: "workType", rule: "26", description: "סוג העבודה כפי שהופיע במקור", required: true, format: "plain" },
      { field: "institution", rule: "26", description: "שם המוסד האקדמי", required: true, format: "plain" },
      { field: "courseName", rule: "26", description: 'שם הקורס (לעבודה בקורס – "בקורס {שם}")', required: false, format: "plain" },
      { field: "year", rule: "23.9", description: "שנת הגשה", required: true, format: "plain" },
    ],
    notes: [
      'כלל 26: על מרכיבי הנוסחה יחולו הכללים שחלים על המרכיבים המקבילים בנוסחת אזכור הספרים (כלל 23).',
      'סוג העבודה יצוין כפי שהופיע במקור.',
      'לגבי עבודה שהוגשה בקורס יש לציין לאחר סוג העבודה את המילה "בקורס" ואת שם הקורס.',
    ],
  },

  // ─── התכתבויות (Correspondence – Rule 32.1) ────────────────
  correspondence: {
    primaryRule: "32.1",
    ruleTitle: "כלל 32.1 – התכתבויות",
    template: "{correspondenceType} מ{senderName}[, {senderRole},] ל{recipientName}[, {recipientRole},] {subject} ({fullDate}).",
    example: 'מכתב מנאור כהן, סגן שר ההגנה, לטל גולדברג, היועצת המשפטית למשרד הפיתוח, בעניין תקציב לניסויים חקלאיים (20.7.2015).',
    components: [
      { field: "correspondenceType", rule: "32.1.1", description: "סוג ההתכתבות (מכתב, מזכר, דואר אלקטרוני וכו')", required: true, format: "plain" },
      { field: "senderName", rule: "32.1.2", description: "שם הכותב כפי שמופיע במסמך", required: true, format: "plain" },
      { field: "senderRole", rule: "32.1.2", description: "תפקיד הכותב (אופציונלי)", required: false, format: "plain" },
      { field: "recipientName", rule: "32.1.2", description: "שם הנמען כפי שמופיע במסמך", required: true, format: "plain" },
      { field: "recipientRole", rule: "32.1.2", description: "תפקיד הנמען (אופציונלי)", required: false, format: "plain" },
      { field: "subject", rule: "32.1", description: 'נושא ההתכתבות (אחרי "בעניין")', required: false, format: "plain" },
      { field: "fullDate", rule: "32.1", description: "תאריך הכתיבה הלועזי (DD.MM.YYYY)", required: true, format: "plain" },
    ],
    notes: [
      'כלל 32.1.1: יש לציין אם מדובר במכתב, במזכר, בדואר אלקטרוני וכדומה.',
      'כלל 32.1.2: שם הכותב, תפקיד הכותב, שם הנמען ותפקיד הנמען יופיעו כפי שהם מופיעים במסמך.',
      'דוגמה עם שעה: דואר אלקטרוני מאור זמיר, הזואולוגית המחוזית, לאלון זוסמן, דיקן הפקולטה לביולוגיה, ואשר לוין, ראש החוג לאבולוציה (5.8.2018, 11:57:36).',
    ],
  },

  // ─── ראיונות (Interviews – Rule 32.2) ──────────────────────
  interview: {
    primaryRule: "32.2",
    ruleTitle: "כלל 32.2 – ראיונות",
    template: "{interviewType} [של {interviewerName}] עם {intervieweeName}[, {intervieweeRole}] ({fullDate}).",
    example: 'ריאיון עם מסעודה גולני, מנהלת מחלקת הטלוויזיה בעיריית שדרות (4.11.1993).',
    components: [
      { field: "interviewType", rule: "32.2", description: "סוג הריאיון (ריאיון, ריאיון טלפוני וכו')", required: false, format: "plain" },
      { field: "interviewerName", rule: "32.2", description: "שם המראיין (אופציונלי)", required: false, format: "plain" },
      { field: "intervieweeName", rule: "32.2", description: "שם המרואיין", required: true, format: "plain" },
      { field: "intervieweeRole", rule: "32.2", description: "תפקיד המרואיין (אופציונלי)", required: false, format: "plain" },
      { field: "fullDate", rule: "32.2", description: "תאריך הריאיון הלועזי", required: true, format: "plain" },
    ],
    notes: [
      'שלוש צורות: (1) ריאיון עם X (ללא מראיין). (2) ריאיון טלפוני עם X. (3) ריאיון של X עם Y (עם מראיין).',
      'דוגמות: ריאיון עם מסעודה גולני, מנהלת מחלקת הטלוויזיה בעיריית שדרות (4.11.1993). | ריאיון טלפוני עם עו"ד עמית דנציגר, בא כוח העותרות (19.5.1987). | ריאיון של מני זמורה עם אסף שמגר (1.2.2020–15.3.2020).',
    ],
  },

  // ─── הרצאות (Lectures – Rule 32.3) ─────────────────────────
  lecture: {
    primaryRule: "32.3",
    ruleTitle: "כלל 32.3 – הרצאות",
    template: '{author} "{articleTitle}" (הרצאה ב{eventName}, {eventLocation} {fullDate}).',
    example: 'איסי רוזן-צבי "שלטי חוצות: בין משפט ופוליטיקה" (הרצאה ביום עיון בנושא "שלטי פרסום במרחב הציבורי", הפקולטה למשפטים, אוניברסיטת תל אביב 19.6.2008).',
    components: [
      { field: "author", rule: "32.3", description: "שם הדובר", required: true, format: "plain" },
      { field: "articleTitle", rule: "32.3", description: "שם ההרצאה – במירכאות", required: true, format: "quotes" },
      { field: "eventName", rule: "32.3", description: "שם האירוע שבו נישאה ההרצאה", required: true, format: "plain" },
      { field: "eventLocation", rule: "32.3", description: "מקום האירוע", required: false, format: "plain" },
      { field: "fullDate", rule: "32.3", description: "תאריך ההרצאה", required: true, format: "plain" },
    ],
    notes: [
      'שם ההרצאה במירכאות. שם האירוע מופיע אחרי "הרצאה ב".',
    ],
  },

  // ─── הודעות לתקשורת (Press Releases – Rule 32.4) ───────────
  press_release: {
    primaryRule: "32.4",
    ruleTitle: "כלל 32.4 – הודעות לתקשורת",
    template: '{author} "{articleTitle}" ({releaseDescription} {fullDate}).',
    example: 'רשות המסים "פרויקט \'חינוך למסים\' יוצא לדרך" (הודעת דוברות 27.1.2013).',
    components: [
      { field: "author", rule: "32.4", description: "שם המודיע", required: true, format: "plain" },
      { field: "articleTitle", rule: "32.4", description: "כותרת ההודעה – במירכאות", required: true, format: "quotes" },
      { field: "releaseDescription", rule: "32.4", description: 'תיאור ההודעה (הודעה לתקשורת/הודעת דוברות וכו\')', required: false, format: "plain" },
      { field: "fullDate", rule: "32.4", description: "תאריך ההודעה", required: true, format: "plain" },
    ],
    notes: [
      'תיאור ההודעה יהיה כפי שהופיע בה: הודעה לתקשורת, הודעה לעיתונות וכדומה. אם לא הופיע תיאור במקור, יש לכתוב "הודעה לתקשורת".',
    ],
  },

  // ─── סרטים (Films – Rule 33.1) ─────────────────────────────
  film: {
    primaryRule: "33.1",
    ruleTitle: "כלל 33.1 – סרטים",
    template: "{filmName} ({director} במאי/ת {year}).",
    example: 'אפס ביחסי אנוש (טליה לביא במאית 2010).',
    components: [
      { field: "filmName", rule: "33.1", description: "שם הסרט", required: true, format: "plain" },
      { field: "director", rule: "33.1", description: 'שם הבמאי – לפי כלל 23.2. אחרי השמות: "במאי"/"במאית"/"במאים"/"במאיות"', required: true, format: "plain" },
      { field: "year", rule: "33.1", description: "שנת צאת הסרט", required: true, format: "plain" },
    ],
    notes: [
      'על שם הבמאי יחול כלל 23.2 (שמות מחברים). לאחר שמות הבמאים יבואו "במאי", "במאית", "במאים" או "במאיות" לפי העניין.',
    ],
  },

  // ─── תוכניות טלוויזיה (TV Shows – Rule 33.2) ──────────────
  tv_show: {
    primaryRule: "33.2",
    ruleTitle: "כלל 33.2 – תוכניות טלוויזיה",
    template: '"{showName}[: {episodeName}]" ([{creator} יוצר/ת,] {channel} {fullDate}).',
    example: '"רמזור: שם לתינוק" (אדיר מילר יוצר, ערוץ 2, 10.9.2011).',
    components: [
      { field: "showName", rule: "33.2", description: "שם התוכנית – במירכאות", required: true, format: "quotes" },
      { field: "episodeName", rule: "33.2", description: "שם הפרק (אופציונלי, אחרי נקודתיים)", required: false, format: "plain" },
      { field: "creator", rule: "33.2", description: 'שם יוצר התוכנית + "יוצר"/"יוצרת" וכו\' – לפי כלל 23.2 (אופציונלי)', required: false, format: "plain" },
      { field: "channel", rule: "33.2", description: "ערוץ הטלוויזיה", required: true, format: "plain" },
      { field: "fullDate", rule: "33.2", description: "תאריך לועזי מלא של השידור", required: true, format: "plain" },
      { field: "timeReference", rule: "33.5", description: "הפניית זמן (דקה:שנייה) – לפני הסוגריים", required: false, format: "plain" },
    ],
    notes: [
      'אם אין שם לפרק, יצוין רק שם התוכנית.',
      'על שם היוצר יחול כלל 23.2. לאחר שמות היוצרים: "יוצר"/"יוצרת"/"יוצרים"/"יוצרות". אם אין לתוכנית יוצר – לא יצוין.',
      'דוגמה ללא יוצר: "מבט" (ערוץ 1, 22.1.1997).',
      'כלל 33.5: אפשר להפנות לחלק מסוים לפי זמן תחילתו או תחילתו וסופו. הזמן לפני הסוגריים. דוגמה: "סליחה על השאלה: אסירים משוחררים" 19:19–21:17 (כאן 11, 13.11.2018).',
    ],
  },

  // ─── רדיו/תסכיתים (Radio – Rule 33.3) ─────────────────────
  radio: {
    primaryRule: "33.3",
    ruleTitle: "כלל 33.3 – רדיו ותסכיתים",
    template: '"{showName}[: {episodeName}]" ({radioStation} {fullDate}).',
    example: '"האוניברסיטה המשודרת: מבוא לעבודה: עבדות מודרנית וסחר בבני אדם עם הד"ר הילה שמיר" (גלי צה"ל 21.7.2020).',
    components: [
      { field: "showName", rule: "33.3", description: "שם התוכנית או התסכית – במירכאות", required: true, format: "quotes" },
      { field: "episodeName", rule: "33.3", description: "שם הפרק (אופציונלי, אחרי נקודתיים)", required: false, format: "plain" },
      { field: "radioStation", rule: "33.3", description: "תחנת הרדיו", required: true, format: "plain" },
      { field: "fullDate", rule: "33.3", description: "תאריך לועזי מלא של השידור", required: true, format: "plain" },
      { field: "timeReference", rule: "33.5", description: "הפניית זמן (דקה:שנייה) – לפני הסוגריים", required: false, format: "plain" },
    ],
    notes: [
      'אם אין שם לפרק, יצוין רק שם התוכנית.',
      'כלל 33.5: הפניית זמן לפני הסוגריים. דוגמות: "סליחה על השאלה: אסירים משוחררים" 19:19 (כאן 11, 13.11.2018). | "דנה בסוגיה" (קול ברמה 19.11.2019).',
    ],
  },

  // ─── חוקה לועזית (כלל 36.1) ────────────────────────────────
  foreign_constitution: {
    primaryRule: "36.1",
    ruleTitle: "כלל 36.1 – חוקות (ארצות הברית)",
    template: "{jurisdiction} CONST. {division} {section}.",
    example: "U.S. CONST. amend. XV, § 1.",
    components: [
      { field: "jurisdiction", rule: "36.1", description: 'תחום השיפוט (U.S./N.Y.) – ברישיות מוקטנות', required: true, format: "plain" },
      { field: "division", rule: "36.1", description: 'amend. (תיקון), art. (סעיף ראשי) וכו\'', required: true, format: "plain" },
      { field: "section", rule: "36.1", description: 'מספר/§ של הסעיף המאוזכר', required: true, format: "plain" },
    ],
    notes: [
      'יש לציין אם החוקה פדרלית או מדינתית. קיצור "חוקה" וציון תחום השיפוט יבואו ברישיות מוקטנות (small caps).',
      'דוגמות: U.S. CONST. amend. XV, § 1. | N.Y. CONST. art. I, § 8.',
    ],
  },

  // ─── חוקים לועזיים – ארה"ב (כלל 36.2) ─────────────────────
  foreign_statute_us: {
    primaryRule: "36.2",
    ruleTitle: "כלל 36.2 – חוקים (ארצות הברית)",
    template: "[{statuteName}, ]{title} {code} § {section} ({year}).",
    example: "Sherman Act, 15 U.S.C. §§ 1–7.",
    components: [
      { field: "statuteName", rule: "36.2", description: "שם החוק (אופציונלי, לפני מיקום הסעיפים)", required: false, format: "plain" },
      { field: "title", rule: "36.2", description: 'מספר ה-title בקודקס (לדוגמה: 15, 18)', required: true, format: "plain" },
      { field: "code", rule: "36.2", description: 'שם הקודקס (U.S.C. וכו\')', required: true, format: "plain" },
      { field: "section", rule: "36.2", description: '§ של הסעיף; לטווח – §§', required: true, format: "plain" },
      { field: "year", rule: "36.2", description: "שנת הקודקס בסוגריים – אם הנוסח אינו עדכני", required: false, format: "plain" },
    ],
    notes: [
      'תמיד יש לציין את מיקום הסעיפים בקודקס ואחר כך בסוגריים את שנת הקודקס.',
      'אם ההפניה לנוסח העדכני – אין צורך לציין את שנת הקוד.',
      'לטווח סעיפים – שני סימני סעיף (§§). דוגמה: 15 U.S.C. §§ 1–7.',
      'אם יש לחוק שם מיוחד אפשר לציין אותו לפני מיקום הסעיפים. דוגמה: Sherman Act, 15 U.S.C. §§ 1–7.',
    ],
  },

  // ─── חוקים לועזיים – אנגליה (כלל 36.3) ────────────────────
  foreign_statute_uk: {
    primaryRule: "36.3",
    ruleTitle: "כלל 36.3 – חוקים (אנגליה)",
    template: "{statuteName} {year}, [{regnalYear} {monarch} ]c. {chapter}[, § {section}].",
    example: "Habeas Corpus Act 1679, 31 Car. 2 c. 2.",
    components: [
      { field: "statuteName", rule: "36.3", description: "שם החוק (אם השנה לא מופיעה בשם – תצוין בסוגריים בסוף)", required: true, format: "plain" },
      { field: "year", rule: "36.3", description: "שנת החוק", required: true, format: "plain" },
      { field: "regnalYear", rule: "36.3", description: "שנת המלכות – חובה לחוקים שנחקקו עד 1962", required: false, format: "plain" },
      { field: "monarch", rule: "36.3", description: "קיצור שם המלך/ה (Car. 2 וכו') – חובה לחוקים שנחקקו עד 1962", required: false, format: "plain" },
      { field: "chapter", rule: "36.3", description: 'מספר הפרק (c.) – המספר הסודר של החוק באותה שנה', required: true, format: "plain" },
      { field: "section", rule: "36.3", description: "הפניה לסעיף (§) – אופציונלי", required: false, format: "plain" },
    ],
    notes: [
      'יש לציין את שם החוק, את השנה ואת מספר הפרק (chapter).',
      'חוקים שנחקקו עד 1962 – חובה לציין שנת מלכות וקיצור שם המלך/ה לפני מספר הפרק.',
      'אם שנת החוק אינה מופיעה בשמו – יש לציינה בסוגריים בסוף האזכור.',
      'דוגמות: Habeas Corpus Act 1679, 31 Car. 2 c. 2. | Human Rights Act 1998, c. 42, § 4.',
    ],
  },

  // ─── פסיקה לועזית – ארה"ב (כלל 36.4) ──────────────────────
  foreign_case_us: {
    primaryRule: "36.4",
    ruleTitle: "כלל 36.4 – פסקי דין (ארצות הברית)",
    template: "[##{procPrefix}## ]{party1} v. {party2}, {volume} {reporter} {firstPage}[, {pinpoint}] ([{court} ]{year}).",
    example: "Atkins v. Virginia, 536 U.S. 304, 317–21 (2002).",
    components: [
      { field: "procPrefix", rule: "36.4", description: 'תחילית הליך (Ex parte / In re / ex rel.) – באותיות מוטות. לא חל על "v."', required: false, format: "italic" },
      { field: "party1", rule: "36.4", description: "שם הצד הראשון – ללא הדגשה באזכור המקורי", required: true, format: "plain" },
      { field: "party2", rule: "36.4", description: "שם הצד השני – ללא הדגשה באזכור המקורי", required: true, format: "plain" },
      { field: "volume", rule: "36.4", description: "מספר הכרך (לפני קיצור הסדרה)", required: true, format: "plain" },
      { field: "reporter", rule: "36.4", description: "קיצור סדרת הפרסום (U.S., F.2d, N.E. וכו') – לפי נספח ט", required: true, format: "plain" },
      { field: "firstPage", rule: "36.4", description: "מספר העמוד הראשון של פסק הדין", required: true, format: "plain" },
      { field: "pinpoint", rule: "36.4", description: "הפניה ספציפית בפסק הדין (אחרי פסיק)", required: false, format: "plain" },
      { field: "court", rule: "36.4", description: "פרטי הערכאה – אין לציין לעליון הפדרלי או לערכאה הגבוהה במדינה", required: false, format: "plain" },
      { field: "year", rule: "36.4", description: "שנת מתן פסק הדין", required: true, format: "plain" },
    ],
    notes: [
      'באזכור מקורי – שמות הצדדים לא יודגשו (כללי אזכור חוזר בכלל 37.9).',
      'ביטויים הקשורים להליך (Ex parte, In re, ex rel.) – באותיות מוטות. המפריד "v." בין הצדדים – לא מוטה.',
      'יש להעדיף פרסום רשמי על לא רשמי, ופרסום אזורי (N.E., P. וכו\') על מדינתי.',
      'אין צורך לציין את בית המשפט העליון הפדרלי ואת הערכאה הגבוהה ביותר במדינה.',
      'אם אין מפנים לפרסום מדינתי – יש לציין את המדינה לפני שם הערכאה.',
      'דוגמות: Atkins v. Virginia, 536 U.S. 304, 317–21 (2002). | United States v. Van Fossan, 899 F.2d 636 (7th Cir. 1990). | Gleason v. McKay, 134 Mass. 419 (1883). | Palsgraf v. Long Island R.R. Co., 162 N.E. 99 (N.Y. 1928). | Fernandez v. United Acceptance Corp., 610 P.2d 461 (Ariz. Ct. App. 1980).',
    ],
  },

  // ─── פסיקה לועזית – מדינות אחרות (כלל 36.5) ───────────────
  foreign_case_other: {
    primaryRule: "36.5",
    ruleTitle: "כלל 36.5 – פסקי דין (מדינות אחרות)",
    template: "{party1} v. {party2} {volumeOrYear} {reporter} {firstPage}[, {pinpoint}] ({courtAndJurisdiction}).",
    example: "Young v. Bristol Aeroplane Co. [1944] KB 718 (CA).",
    components: [
      { field: "party1", rule: "36.5", description: "שם הצד הראשון", required: true, format: "plain" },
      { field: "party2", rule: "36.5", description: "שם הצד השני", required: true, format: "plain" },
      { field: "volumeOrYear", rule: "36.5", description: "כרך או שנה בסוגריים מרובעים [YYYY]", required: true, format: "plain" },
      { field: "reporter", rule: "36.5", description: "קיצור הסדרה (לפי נספח י לסדרות אנגליות)", required: true, format: "plain" },
      { field: "firstPage", rule: "36.5", description: "עמוד ראשון של פסק הדין", required: true, format: "plain" },
      { field: "pinpoint", rule: "36.5", description: "הפניה ספציפית", required: false, format: "plain" },
      { field: "courtAndJurisdiction", rule: "36.5", description: "ערכאה ותחום שיפוט – חובה אם שם הסדרה אינו מצביע עליהם", required: true, format: "plain" },
    ],
    notes: [
      'העקרונות דומים לכלל 36.4, אלא אם נקבע אחרת לגבי המדינה.',
      'אם אי אפשר להבין משם הסדרה באיזו ערכאה ניתן פסק הדין – יש לציינה.',
      'לעיתים יש לציין מאיזה מחוז הגיע פסק הדין (Eng., Scot. וכו\').',
      'באוסטרליה אין נקודה לאחר ה-v. ושמות הצדדים מוטים.',
      'דוגמות: M\'Naghten\'s Case (1843) 8 Eng. Rep. 718 (HL) (appeal taken from Eng.). | R (Miller) v. Prime Minister [2020] AC 373 (SC) (appeals taken from Eng. & Scot.). | Young v. Bristol Aeroplane Co. [1944] KB 718 (CA). | Haaretz.com v. Goldhar, [2018] 2 S.C.R. 3. | Williams v Commonwealth [No. 2] (2014) 252 CLR 416, 467–69.',
    ],
  },

  // ─── ספר לועזי (כלל 36.6) ──────────────────────────────────
  foreign_book: {
    primaryRule: "36.6",
    ruleTitle: "כלל 36.6 – ספרים לועזיים",
    template: "[{volume} ]##{authors}##, ##{bookTitle}##[: ##{subtitle}##][ {pinpoint}] ([{edition}, ][{editor} eds., ][{translator} trans., ][{publisher} ]{year}).",
    example: "HAZEL GENN, JUDGING CIVIL JUSTICE (2010).",
    components: [
      { field: "volume", rule: "36.6", description: "מספר הכרך – לפני שם המחבר", required: false, format: "plain" },
      { field: "authors", rule: "36.6", description: "שמות המחברים – ברישיות מוקטנות (small caps)", required: true, format: "italic" },
      { field: "bookTitle", rule: "36.6", description: "שם הספר – ברישיות מוקטנות", required: true, format: "italic" },
      { field: "subtitle", rule: "36.6", description: "שם משני (אחרי נקודתיים)", required: false, format: "italic" },
      { field: "pinpoint", rule: "36.6", description: "הפניה ספציפית – לפני הסוגריים", required: false, format: "plain" },
      { field: "edition", rule: "36.6", description: "פרטי מהדורה (3d ed. וכו')", required: false, format: "plain" },
      { field: "editor", rule: "36.6", description: "שם העורך – לפני eds.", required: false, format: "plain" },
      { field: "translator", rule: "36.6", description: "שם המתרגם – לפני trans.", required: false, format: "plain" },
      { field: "publisher", rule: "36.6", description: "מוציא לאור – רק אם פורסם לפני 1900 או על ידי גורם שאינו המוציא לאור המקורי", required: false, format: "plain" },
      { field: "year", rule: "36.6", description: "שנת פרסום הספר", required: true, format: "plain" },
    ],
    notes: [
      'יש להדגיש את שמות המחברים ואת שם הספר ברישיות מוקטנות (small caps).',
      'בין שמות המחברים לשם הספר יבוא פסיק.',
      'שם משני מופרד בנקודתיים, אלא אם הופרד במקור בדרך אחרת.',
      'באנגלית – כל המילים באותיות גדולות, למעט מילות יידוע/חיבור/יחס בנות פחות מחמש אותיות שאינן בתחילת השם או לאחר נקודתיים.',
      'מוציא לאור יצוין רק אם הספר יצא לפני 1900 או על ידי מי שאינו המוציא לאור המקורי.',
      'מספר הכרך – בתחילת האזכור, לפני שם המחבר. הפניה ספציפית – לפני הסוגריים.',
      'דוגמות: HAZEL GENN, JUDGING CIVIL JUSTICE (2010). | DAVID KRETZMER, THE OCCUPATION OF JUSTICE: THE SUPREME COURT OF ISRAEL AND THE OCCUPIED TERRITORIES (2002). | ETHAN KATSH & ORNA RABINOVICH-EINY, DIGITAL JUSTICE (2017). | R.P. MEAGHER, W.M.C. GUMMOW & J.R.F. LEHANE, EQUITY, DOCTRINES, AND REMEDIES (3d ed. 1992). | PROPORTIONALITY: NEW FRONTIERS, NEW CHALLENGES (Vicki C. Jackson & Mark Tushnet eds., 2017). | 5 FRIEDRICH KARL VON SAVIGNY, SYSTEM DES HEUTIGEN RÖMISCHEN RECHTS §§ 206–09 (Berlin, Beit und Comp. 1841).',
    ],
  },

  // ─── מאמר בכתב עת לועזי (כלל 36.7) ────────────────────────
  foreign_journal_article: {
    primaryRule: "36.7",
    ruleTitle: "כלל 36.7 – מאמרים בכתבי עת לועזיים",
    template: "{authors}, ##{articleTitle}##[: ##{subtitle}##], {volume} ##{journal}## {firstPage}[, {pinpoint}] ({year}).",
    example: "Ruth Gavison, Privacy and the Limits of Law, 89 YALE L.J. 421 (1980).",
    components: [
      { field: "authors", rule: "36.7", description: "שמות המחברים – לא מודגשים, כפי שמופיעים במאמר", required: true, format: "plain" },
      { field: "articleTitle", rule: "36.7", description: "שם המאמר – באותיות מוטות (italics)", required: true, format: "italic" },
      { field: "subtitle", rule: "36.7", description: "שם משני (אחרי נקודתיים)", required: false, format: "italic" },
      { field: "volume", rule: "36.7", description: "מספר הכרך – לפני שם כתב העת", required: true, format: "plain" },
      { field: "journal", rule: "36.7", description: "שם כתב העת או קיצורו – ברישיות מוקטנות", required: true, format: "italic" },
      { field: "firstPage", rule: "36.7", description: "מספר העמוד הראשון של המאמר", required: true, format: "plain" },
      { field: "pinpoint", rule: "36.7", description: "הפניה ספציפית (אחרי פסיק)", required: false, format: "plain" },
      { field: "year", rule: "36.7", description: "שנת פרסום בסוגריים – אלא אם מופיעה ככרך", required: true, format: "plain" },
    ],
    notes: [
      'שמות המחברים לא יודגשו ויופיעו כפי שבמאמר. שם המאמר באותיות מוטות.',
      'מילים שהוטו במקור בשם המאמר – לא יוטו באזכור.',
      'באנגלית – כל המילים באותיות גדולות למעט מילות יידוע/חיבור/יחס בנות פחות מחמש אותיות שאינן בתחילת השם או לאחר נקודתיים.',
      'שם כתב העת או קיצורו – ברישיות מוקטנות (רשימות הקיצורים ב-Bluebook).',
      'מספר הכרך – לפני שם כתב העת. עמוד תחילת המאמר חובה.',
      'קיצורים נפוצים: American–Am.; And–&; British–Br.; Bulletin–Bull.; Business–Bus.; Comparative–Compar.; Constitutional–Const.; Criminal–Crim.; Economic/Economics/Economy–Econ.; European–Eur.; Historical/History–Hist.; Human–Hum.; Interdisciplinary–Interdisc.; International–Int\'l; Journal–J.; Jurisprudence–Juris.; Justice–Just.; Law–L. (במלואה אם המילה הראשונה); Magazine–Mag.; Medical/Medicine–Med.; Philosophical/Philosophy–Phil.; Policy–Pol\'y; Political/Politics–Pol.; Psychology–Psych.; Public–Pub.; Quarterly–Q.; Research–Rsch.; Review–Rev.; Rights–Rts.; School–Sch.; Science/Scientific–Sci.; Social–Soc.; Society–Soc\'y; Sociology/Sociological–Socio.; Studies–Stud.; Taxation–Tax\'n; Technology–Tech.; University–Univ.; Yearbook/Year Book–Y.B.',
      'דוגמות: Ruth Gavison, Privacy and the Limits of Law, 89 YALE L.J. 421 (1980). | Richard A. Posner, The Path Away from the Law, 110 HARV. L. REV. 1039, 1041–42 (1997). | Robert Cooter, Constitutional Consequentialism: Bargain Democracy Versus Median Democracy, 3 THEORETICAL INQUIRIES IN L. 1 (2002). | Suzanna Sherry, The Unmaking of a Precedent, 2003 SUP. CT. REV. 231.',
    ],
  },

  // ─── מאמר שפורסם בספר לועזי (כלל 36.8) ────────────────────
  foreign_book_chapter: {
    primaryRule: "36.8",
    ruleTitle: "כלל 36.8 – מאמרים שפורסמו בספרים לועזיים",
    template: "{authors}, ##{articleTitle}##, in ##{bookTitle}## {firstPage}[, {pinpoint}] ({editor} eds., {year}).",
    example: "Ayelet Shachar, Constituting Citizens: Oaths, Gender, Religious Attire, in CANADA IN THE WORLD: COMPARATIVE PERSPECTIVES ON THE CANADIAN CONSTITUTION 123 (Richard Albert & David R. Cameron eds., 2018).",
    components: [
      { field: "authors", rule: "36.8", description: "שמות המחברים – כללי 36.7", required: true, format: "plain" },
      { field: "articleTitle", rule: "36.8", description: "שם המאמר – באותיות מוטות (כלל 36.7)", required: true, format: "italic" },
      { field: "bookTitle", rule: "36.8", description: "שם הספר – ברישיות מוקטנות (כלל 36.6)", required: true, format: "italic" },
      { field: "firstPage", rule: "36.8", description: "עמוד תחילת המאמר בספר", required: true, format: "plain" },
      { field: "pinpoint", rule: "36.8", description: "הפניה ספציפית (אחרי פסיק)", required: false, format: "plain" },
      { field: "editor", rule: "36.8", description: "שמות עורכי הספר", required: false, format: "plain" },
      { field: "year", rule: "36.8", description: "שנת פרסום הספר", required: true, format: "plain" },
    ],
    notes: [
      'הכללים בדבר שמות המחברים ושם המאמר זהים לכללי כלל 36.7.',
      'פרטי הספר לפי כלל 36.6.',
      'לפני שם הספר יבואו פסיק לא מוטה והמילה in באותיות מוטות.',
      'לאחר שם הספר חובה לציין את עמוד תחילת המאמר.',
    ],
  },

  // ─── מקור מרשתת לועזי (כלל 36.9) ───────────────────────────
  foreign_internet: {
    primaryRule: "36.9",
    ruleTitle: "כלל 36.9 – מקורות במרשתת לועזיים",
    template: "[{author} ([@{handle}]), ]##{title}##, [{contentType} ]##{site}## ({date}), {url}.",
    example: "Katy Barnett, News: Vexatious litigants and the High Court, OPINIONS ON HIGH (Mar. 22, 2019), https://shorturl.at/ersHN.",
    components: [
      { field: "author", rule: "36.9", description: "שם המחבר – אם קיים. לא מודגש", required: false, format: "plain" },
      { field: "handle", rule: "36.9", description: "שם משתמש במדיה חברתית (@username) – בסוגריים אחרי שם המחבר", required: false, format: "plain" },
      { field: "title", rule: "36.9", description: "שם העמוד – באותיות מוטות (כלל 36.7)", required: true, format: "italic" },
      { field: "contentType", rule: "36.9", description: "סוג תוכן (שרשור וכו') – אופציונלי", required: false, format: "plain" },
      { field: "site", rule: "36.9", description: "שם האתר – ברישיות מוקטנות", required: true, format: "italic" },
      { field: "date", rule: "36.9", description: "תאריך בתבנית 'Mar. 22, 2019' (אפשר שעה במדיה חברתית)", required: false, format: "plain" },
      { field: "pinpoint", rule: "36.9", description: "הפניה ספציפית", required: false, format: "plain" },
      { field: "url", rule: "36.9", description: "כתובת URL מלאה או מקוצרת", required: true, format: "plain" },
    ],
    notes: [
      'מקור שמוסדר בכלל אחר ומופיע גם במרשתת – יאוזכר לפי הכלל שחל עליו, ובסוף האזכור אפשר להוסיף פסיק וכתובת URL.',
      'מקור שאינו מוסדר בכלל אחר: שמות מחברים (אם יש), שם העמוד ושם האתר – מופרדים בפסיקים.',
      'שם המחבר לא מודגש ויופיע כפי שבמקור. שם העמוד באותיות מוטות (כלל 36.7).',
      'שם האתר או קיצורו – ברישיות מוקטנות.',
      'התאריך בסוגריים – שם החודש במילה או בקיצור, היום בחודש, פסיק והשנה. דוגמה: (Mar. 22, 2019).',
      'במדיה חברתית – שם משתמש בסוגריים אחרי שם המחבר; אפשר להוסיף שעה.',
      'דוגמות: Katy Barnett, News: Vexatious litigants and the High Court, OPINIONS ON HIGH (Mar. 22, 2019), https://shorturl.at/ersHN. | Know Your Rights, AM. C.L. UNION (2020), https://www.aclu.org/know-your-rights. | Adam Wagner (@AdamWagner1), TWITTER (Jan. 25, 2018, 12:34 PM), https://twitter.com/AdamWagner1/status/956475282071973889. | Harv. L. Sch. (@harvardlaw), INSTAGRAM (Sept. 4, 2019), https://www.instagram.com/p/B1_xZ3cgN-I.',
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
    notes: [
      'דברי כנסת (כלל 8): ד"כ {תאריך לועזי מלא}, {עמוד}. דוגמה: ד"כ 13.6.1950, 1743.',
      'מועצת המדינה הזמנית (כלל 8.2): מועצת המדינה הזמנית {כרך באותיות עבריות}, ישיבה {מספר ישיבה}, {עמוד} ({תאריך לועזי מלא}). דוגמה: מועצת המדינה הזמנית א, ישיבה ב, 9 (5.5.1948).',
    ],
  },
};

// ─── Repeated Citations (אזכור חוזר) — Rule 37 ───────────────

export const REPEATED_CITATION_RULES = {
  "37.1": {
    title: "מהות אזכור חוזר",
    description:
      "אזכור חוזר הוא אזכור מקוצר של מקור שאזכורו המלא נמצא במקום אחר במסמך. די בשם המקור או בכינוי מקוצר שלו.",
  },
  "37.2": {
    title: "שם המקור",
    legislation: "שם החיקוק בלבד (ללא שנה / ס\"ח / [נוסח חדש]).",
    caseLaw:
      "עניין/פרשת/הלכת + שם צד אחד מזהה (אדם > תאגיד > גוף שלטוני; להימנע משמות נפוצים כמו 'מדינת ישראל', 'פלוני', 'היועץ המשפטי').",
    literature:
      "שם משפחה של המחבר; להוסיף שם יצירה אם יש מחברים בעלי שם זהה או שני כתבים של אותו מחבר.",
    formatting:
      "שמות צדדים וספרים — מודגשים (**X**); שמות מאמרים — במירכאות (\"X\"); 'עניין/פרשת/הלכת' ושמות מחברים — ללא הדגשה וללא מירכאות.",
  },
  "37.3": {
    title: "כינוי מקוצר",
    description:
      'אפשר לכנות את המקור בכינוי שונה משם המקור. את הכינוי קובעים בעת האזכור הראשון בסוגריים: "(להלן: עניין X)" / "(להלן: חוק התובענות, או החוק)". אסור לתת כינוי זהה לשני מקורות.',
  },
  "37.4": {
    title: "נוסחת אזכור חוזר",
    template: "[שם המקור / כינוי מקוצר], לעיל ה\"ש [N], [הפניה ספציפית].",
  },
  "37.5": {
    title: "אזכור חוזר של תחיקה",
    description:
      "באזכור חוזר של חוק/פקודה/תקנה אין להשתמש ב\"לעיל ה\"ש N\". במקום זאת — ההפניה הספציפית (סעיף) באה לפני שם החיקוק.",
    template: "ס' [N] ל[שם החיקוק].",
    examples: ["ס' 6 לחוק-יסוד: כבוד האדם וחירותו.", "ס' 13 לפקודת הראיות.", "תק' 500 לתקנות סד\"א."],
  },
  "37.6": {
    title: "מאמרים בספר משותף",
    description:
      "כשמפנים למאמר נוסף מאותו ספר שכבר אוזכר — חובה לציין את עמוד הפתיחה של המאמר אחרי ההפניה לספר, ואז להוסיף הפניה ספציפית.",
  },
  "37.7": {
    title: "שם / לעיל",
    rules: [
      "אזכור באותה הערה ללא מקור אחר ביניים → 'שם'.",
      "אזכור באותה הערה עם מקור אחר ביניים → '[שם המקור], שם'.",
      "אזכור בהערה הקודמת מיד ללא מקור אחר ביניים → 'שם'.",
      "בכל מקרה אחר → '[שם], לעיל ה\"ש N, בעמ' X'.",
    ],
  },
  "37.8": {
    title: "הפניה ספציפית",
    rules: [
      "חובה להשתמש באות שימוש בי\"ת לפני ההפניה הספציפית: בעמ', בפס', בס'.",
      "אם 'שם' מצביע על אותה הפניה במקור הקודם — לכתוב 'שם' בלבד (לא 'שם, שם').",
      "אם 'שם' של חיקוק והפניה לסעיף אחר — 'שם, בס' [N]'.",
    ],
  },
  "37.9": {
    title: "מקורות לועזיים",
    description:
      "שם המקור בשפת המקור; שמות צדדים בלועזית מוטים (במערכת: ##X##); 'לעיל ה\"ש N' תמיד בעברית.",
    examples: [
      "הלכת Brown, לעיל ה\"ש 39.",
      "עניין ##Donoghue v. Stevenson##, לעיל ה\"ש 52, בעמ' 580.",
    ],
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
