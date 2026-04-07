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
