// Comprehensive Israeli legislation database for autocomplete
// Based on כללי האזכור האחיד Rules 4.3-4.6

export interface LawEntry {
  name: string;
  hebrewYear: string;
  gregorianYear: number;
  collection: string; // ס"ח, ק"ת, etc.
  page?: number;
  isBasicLaw: boolean;
  isNewVersion?: boolean; // נוסח חדש
  isCombinedVersion?: boolean; // נוסח משולב
}

export const ISRAELI_LAWS: LawEntry[] = [
  // חוקי יסוד (Basic Laws) - Rule 4.3: hyphenated "חוק-יסוד"
  { name: "חוק-יסוד: כבוד האדם וחירותו", hebrewYear: "התשנ\"ב", gregorianYear: 1992, collection: "ס\"ח", page: 150, isBasicLaw: true },
  { name: "חוק-יסוד: חופש העיסוק", hebrewYear: "התשנ\"ד", gregorianYear: 1994, collection: "ס\"ח", page: 90, isBasicLaw: true },
  { name: "חוק-יסוד: הכנסת", hebrewYear: "התשי\"ח", gregorianYear: 1958, collection: "ס\"ח", page: 69, isBasicLaw: true },
  { name: "חוק-יסוד: מקרקעי ישראל", hebrewYear: "התש\"ך", gregorianYear: 1960, collection: "ס\"ח", page: 56, isBasicLaw: true },
  { name: "חוק-יסוד: נשיא המדינה", hebrewYear: "התשכ\"ד", gregorianYear: 1964, collection: "ס\"ח", page: 118, isBasicLaw: true },
  { name: "חוק-יסוד: הממשלה", hebrewYear: "התשס\"א", gregorianYear: 2001, collection: "ס\"ח", page: 158, isBasicLaw: true },
  { name: "חוק-יסוד: צבא-הגנה לישראל", hebrewYear: "התשל\"ו", gregorianYear: 1976, collection: "ס\"ח", page: 234, isBasicLaw: true },
  { name: "חוק-יסוד: השפיטה", hebrewYear: "התשמ\"ד", gregorianYear: 1984, collection: "ס\"ח", page: 78, isBasicLaw: true },
  { name: "חוק-יסוד: מבקר המדינה", hebrewYear: "התשמ\"ח", gregorianYear: 1988, collection: "ס\"ח", page: 30, isBasicLaw: true },
  // Exception: Rule 190-191 - no hyphen
  { name: "חוק יסוד: משק המדינה", hebrewYear: "התשל\"ה", gregorianYear: 1975, collection: "ס\"ח", page: 206, isBasicLaw: true },
  { name: "חוק-יסוד: ישראל – מדינת הלאום של העם היהודי", hebrewYear: "התשע\"ח", gregorianYear: 2018, collection: "ס\"ח", page: 898, isBasicLaw: true },
  { name: "חוק-יסוד: הפולקלור", hebrewYear: "התשמ\"א", gregorianYear: 1980, collection: "ס\"ח", isBasicLaw: true },
  { name: "חוק-יסוד: ירושלים בירת ישראל", hebrewYear: "התש\"ם", gregorianYear: 1980, collection: "ס\"ח", isBasicLaw: true },

  // חקיקה ראשית (Primary Legislation)
  { name: "חוק העונשין", hebrewYear: "התשל\"ז", gregorianYear: 1977, collection: "ס\"ח", page: 226, isBasicLaw: false },
  { name: "חוק החוזים (חלק כללי)", hebrewYear: "התשל\"ג", gregorianYear: 1973, collection: "ס\"ח", page: 118, isBasicLaw: false },
  { name: "חוק החוזים (תרופות בשל הפרת חוזה)", hebrewYear: "התשל\"א", gregorianYear: 1970, collection: "ס\"ח", page: 16, isBasicLaw: false },
  { name: "חוק המקרקעין", hebrewYear: "התשכ\"ט", gregorianYear: 1969, collection: "ס\"ח", page: 259, isBasicLaw: false },
  { name: "חוק הירושה", hebrewYear: "התשכ\"ה", gregorianYear: 1965, collection: "ס\"ח", page: 63, isBasicLaw: false },
  { name: "חוק הכשרות המשפטית והאפוטרופסות", hebrewYear: "התשכ\"ב", gregorianYear: 1962, collection: "ס\"ח", page: 120, isBasicLaw: false },
  { name: "חוק בתי המשפט", hebrewYear: "התשמ\"ד", gregorianYear: 1984, collection: "ס\"ח", page: 198, isBasicLaw: false, isNewVersion: true },
  { name: "חוק הנזיקין האזרחיים", hebrewYear: "התשכ\"ח", gregorianYear: 1968, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק השליחות", hebrewYear: "התשכ\"ה", gregorianYear: 1965, collection: "ס\"ח", page: 220, isBasicLaw: false },
  { name: "חוק עשיית עושר ולא במשפט", hebrewYear: "התשל\"ט", gregorianYear: 1979, collection: "ס\"ח", page: 130, isBasicLaw: false },
  { name: "חוק החברות", hebrewYear: "התשנ\"ט", gregorianYear: 1999, collection: "ס\"ח", page: 189, isBasicLaw: false },
  { name: "חוק ניירות ערך", hebrewYear: "התשכ\"ח", gregorianYear: 1968, collection: "ס\"ח", page: 234, isBasicLaw: false },
  { name: "חוק הבנקאות (רישוי)", hebrewYear: "התשמ\"א", gregorianYear: 1981, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק הגנת הפרטיות", hebrewYear: "התשמ\"א", gregorianYear: 1981, collection: "ס\"ח", page: 128, isBasicLaw: false },
  { name: "חוק איסור לשון הרע", hebrewYear: "התשכ\"ה", gregorianYear: 1965, collection: "ס\"ח", page: 240, isBasicLaw: false },
  { name: "חוק זכויות החולה", hebrewYear: "התשנ\"ו", gregorianYear: 1996, collection: "ס\"ח", page: 327, isBasicLaw: false },
  { name: "חוק הביטוח הלאומי", hebrewYear: "התשנ\"ה", gregorianYear: 1995, collection: "ס\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "חוק בית הדין לעבודה", hebrewYear: "התשכ\"ט", gregorianYear: 1969, collection: "ס\"ח", page: 70, isBasicLaw: false },
  { name: "חוק הפיקוח על שירותים פיננסיים (ביטוח)", hebrewYear: "התשמ\"א", gregorianYear: 1981, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק המכר", hebrewYear: "התשכ\"ח", gregorianYear: 1968, collection: "ס\"ח", page: 100, isBasicLaw: false },
  { name: "חוק המכר (דירות)", hebrewYear: "התשל\"ג", gregorianYear: 1973, collection: "ס\"ח", page: 196, isBasicLaw: false },
  { name: "חוק השכירות והשאילה", hebrewYear: "התשל\"א", gregorianYear: 1971, collection: "ס\"ח", page: 158, isBasicLaw: false },
  { name: "חוק הערבות", hebrewYear: "התשכ\"ז", gregorianYear: 1967, collection: "ס\"ח", page: 44, isBasicLaw: false },
  { name: "חוק המתנה", hebrewYear: "התשכ\"ח", gregorianYear: 1968, collection: "ס\"ח", page: 102, isBasicLaw: false },
  { name: "חוק הפרשנות", hebrewYear: "התשמ\"א", gregorianYear: 1981, collection: "ס\"ח", page: 302, isBasicLaw: false },
  { name: "חוק יסודות התקציב", hebrewYear: "התשמ\"ה", gregorianYear: 1985, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק סדר הדין הפלילי", hebrewYear: "התשמ\"ב", gregorianYear: 1982, collection: "ס\"ח", isBasicLaw: false, isNewVersion: true, isCombinedVersion: true },
  { name: "חוק סדר הדין האזרחי", hebrewYear: "התשע\"ט", gregorianYear: 2018, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק העמותות", hebrewYear: "התש\"ם", gregorianYear: 1980, collection: "ס\"ח", page: 210, isBasicLaw: false },
  { name: "חוק הגנת הצרכן", hebrewYear: "התשמ\"א", gregorianYear: 1981, collection: "ס\"ח", page: 248, isBasicLaw: false },
  { name: "חוק רישום קבלנים לעבודות הנדסה בנאיות", hebrewYear: "התשכ\"ט", gregorianYear: 1969, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק התכנון והבנייה", hebrewYear: "התשכ\"ה", gregorianYear: 1965, collection: "ס\"ח", page: 307, isBasicLaw: false },
  { name: "חוק המקרקעין (חיזוק בתים משותפים מפני רעידות אדמה)", hebrewYear: "התשס\"ח", gregorianYear: 2008, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק הבוררות", hebrewYear: "התשכ\"ח", gregorianYear: 1968, collection: "ס\"ח", page: 44, isBasicLaw: false },
  { name: "חוק ההוצאה לפועל", hebrewYear: "התשכ\"ז", gregorianYear: 1967, collection: "ס\"ח", page: 116, isBasicLaw: false },
  { name: "חוק בתי דין דתיים (מניעת הפרעה)", hebrewYear: "התשכ\"ה", gregorianYear: 1965, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק יחסי ממון בין בני זוג", hebrewYear: "התשל\"ג", gregorianYear: 1973, collection: "ס\"ח", page: 267, isBasicLaw: false },
  { name: "חוק הכניסה לישראל", hebrewYear: "התשי\"ב", gregorianYear: 1952, collection: "ס\"ח", page: 354, isBasicLaw: false },
  { name: "חוק השבות", hebrewYear: "התש\"י", gregorianYear: 1950, collection: "ס\"ח", page: 159, isBasicLaw: false },
  { name: "חוק האזרחות", hebrewYear: "התשי\"ב", gregorianYear: 1952, collection: "ס\"ח", page: 146, isBasicLaw: false },
  { name: "חוק שירות המדינה (משמעת)", hebrewYear: "התשכ\"ג", gregorianYear: 1963, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק שוויון ההזדמנויות בעבודה", hebrewYear: "התשמ\"ח", gregorianYear: 1988, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק הגנת השכר", hebrewYear: "התשי\"ח", gregorianYear: 1958, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק שעות עבודה ומנוחה", hebrewYear: "התשי\"א", gregorianYear: 1951, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק חופשה שנתית", hebrewYear: "התשי\"א", gregorianYear: 1951, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק פיצויי פיטורים", hebrewYear: "התשכ\"ג", gregorianYear: 1963, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק הסכמים קיבוציים", hebrewYear: "התשי\"ז", gregorianYear: 1957, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק זכות יוצרים", hebrewYear: "התשס\"ח", gregorianYear: 2007, collection: "ס\"ח", page: 34, isBasicLaw: false },
  { name: "חוק הפטנטים", hebrewYear: "התשכ\"ז", gregorianYear: 1967, collection: "ס\"ח", page: 148, isBasicLaw: false },
  { name: "חוק עוולות מסחריות", hebrewYear: "התשנ\"ט", gregorianYear: 1999, collection: "ס\"ח", page: 378, isBasicLaw: false },
  { name: "חוק חוזה הביטוח", hebrewYear: "התשמ\"א", gregorianYear: 1981, collection: "ס\"ח", page: 40, isBasicLaw: false },
  { name: "חוק הגנת הסביבה", hebrewYear: "התשנ\"ח", gregorianYear: 1997, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק איסור הלבנת הון", hebrewYear: "התש\"ס", gregorianYear: 2000, collection: "ס\"ח", page: 293, isBasicLaw: false },
  { name: "חוק העונשין (תיקון מס' 39) (חלק מקדמי וחלק כללי)", hebrewYear: "התשנ\"ד", gregorianYear: 1994, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק חופש המידע", hebrewYear: "התשנ\"ח", gregorianYear: 1998, collection: "ס\"ח", page: 226, isBasicLaw: false },
  { name: "חוק הפיקוח על מצרכים ושירותים", hebrewYear: "התשי\"ח", gregorianYear: 1957, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק המחשבים", hebrewYear: "התשנ\"ה", gregorianYear: 1995, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק הגנת הדייר", hebrewYear: "התשי\"ד", gregorianYear: 1954, collection: "ס\"ח", isBasicLaw: false, isNewVersion: true, isCombinedVersion: true },
  { name: "חוק לתיקון דיני הרכישה לצורכי ציבור", hebrewYear: "התש\"ע", gregorianYear: 2010, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק הבחירות לכנסת", hebrewYear: "התשכ\"ט", gregorianYear: 1969, collection: "ס\"ח", isBasicLaw: false, isNewVersion: true, isCombinedVersion: true },
  { name: "חוק מיסוי מקרקעין (שבח ורכישה)", hebrewYear: "התשכ\"ג", gregorianYear: 1963, collection: "ס\"ח", isBasicLaw: false },
  { name: "חוק התחרות הכלכלית", hebrewYear: "התשמ\"ח", gregorianYear: 1988, collection: "ס\"ח", isBasicLaw: false },

  // פקודות (Ordinances)
  { name: "פקודת הנזיקין", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת החברות", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת הראיות", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת מס הכנסה", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת סדר הדין הפלילי (מעצר וחיפוש)", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת הפרשנות", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת בריאות העם", hebrewYear: "", gregorianYear: 1940, collection: "ע\"ר", isBasicLaw: false },
  { name: "פקודת העיריות", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת המועצות המקומיות", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false },
  { name: "פקודת השטרות", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת הקרקעות (רכישה לצורכי ציבור)", hebrewYear: "", gregorianYear: 1943, collection: "ע\"ר", isBasicLaw: false },
  { name: "פקודת המכס", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת הסמים המסוכנים", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת פשיטת הרגל", hebrewYear: "", gregorianYear: 0, collection: "נ\"ח", isBasicLaw: false, isNewVersion: true },
  { name: "פקודת הבנקאות", hebrewYear: "", gregorianYear: 1941, collection: "ע\"ר", isBasicLaw: false },
];

// Search/filter function for autocomplete
export function searchLaws(query: string): LawEntry[] {
  if (!query || query.length < 2) return [];
  const normalized = query.trim();
  return ISRAELI_LAWS.filter((law) =>
    law.name.includes(normalized)
  ).slice(0, 10);
}
