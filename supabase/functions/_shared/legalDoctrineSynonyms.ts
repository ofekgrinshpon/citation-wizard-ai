// Hand-curated dictionary of Hebrew legal doctrine triggers → lexical synonyms
// used for query expansion in the Legal QA retrieval pipeline.
//
// Each entry is keyed by a regex that matches a *trigger phrase* in the user's
// question or in the planner's mainIssue. When triggered, the synonyms are
// merged into the expanded query set used by vector + text retrieval.
//
// Rules:
// - Synonyms are PURELY LEXICAL. They do not change meaning; they widen recall
//   so that semantically related phrasing in the corpus is reached.
// - Never include URLs, citation markers, or court prefixes that could be
//   mistaken for primary authority. Just doctrine vocabulary.
// - Keep entries short (≤ 8 synonyms) so the expansion budget stays bounded.

export interface DoctrineSynonymEntry {
  /** Internal id for telemetry. */
  id: string;
  /** Regex tested against the question + mainIssue (combined, lowercased). */
  trigger: RegExp;
  /** Lexical synonyms added to the expanded query set. */
  synonyms: string[];
}

export const DOCTRINE_SYNONYMS: DoctrineSynonymEntry[] = [
  {
    id: "temporary_injunction",
    trigger: /(צו\s*מניעה\s*זמני|סעד\s*זמני|בקשה\s*לסעד\s*זמני|injunction)/i,
    synonyms: [
      "סעד זמני",
      "צו מניעה זמני",
      "מאזן הנוחות",
      "סיכויי ההליך",
      "ראיות לכאורה",
      "נזק בלתי הפיך",
      "שיקולי יושר",
      "תקנה 95",
    ],
  },
  {
    id: "basic_law_review",
    trigger: /(חוק[- ]?יסוד|פסקת\s*ההגבלה|ביקורת\s*שיפוטית|חוקתי)/,
    synonyms: [
      "פסקת ההגבלה",
      "חוק יסוד",
      "פגיעה בזכות",
      "תכלית ראויה",
      "מידתיות",
      "בטלות יחסית",
    ],
  },
  {
    id: "contract_frustration",
    trigger: /(סיכול\s*חוזה|כוח\s*עליון|נסיבות\s*משתנות)/,
    synonyms: [
      "סיכול חוזה",
      "כוח עליון",
      "סעיף 18 לחוק החוזים",
      "אי אפשרות קיום",
      "שינוי נסיבות",
    ],
  },
  {
    id: "search_seizure",
    trigger: /(חיפוש|תפיסה|פרטיות|הקלטה\s*סמויה)/,
    synonyms: [
      "חיפוש ותפיסה",
      "פסילת ראיות",
      "דוקטרינת הפסילה",
      "הזכות לפרטיות",
      "צו חיפוש",
    ],
  },
  {
    id: "extortion",
    trigger: /(סחיטה|איומים|כפייה)/,
    synonyms: [
      "סחיטה באיומים",
      "סעיף 427",
      "סעיף 428",
      "סעיף 192 לחוק העונשין",
      "חופש הרצון",
    ],
  },
  {
    id: "administrative_review",
    trigger: /(בג\"?ץ|רשות\s*מנהלית|שיקול\s*דעת|סבירות)/,
    synonyms: [
      "סבירות",
      "מידתיות",
      "שיקול דעת מנהלי",
      "ביקורת שיפוטית",
      "תקיפה ישירה",
    ],
  },
  {
    id: "tort_negligence",
    trigger: /(רשלנות|חובת\s*זהירות|נזיקין)/,
    synonyms: [
      "חובת זהירות",
      "הפרת חובה",
      "קשר סיבתי",
      "אשם תורם",
      "צפיות הנזק",
    ],
  },
  {
    // Legislative omission / duty to legislate / positive protection duties.
    // Bridges the doctrinal phrasing the *question* tends to use
    // ("מחדל חקיקתי", "חובות הגנה חיוביות") to the phrasing academic
    // *titles* tend to use ("חובה לחוקק", "סעד החובה לחוקק").
    id: "legislative_omission",
    trigger: /(מחדל\s*חקיקתי|חובה\s*לחוקק|חקיקה\s*לוקה\s*בחסר|אכיפה\s*חסרה|חובות\s*הגנה\s*חיוביות|חובה\s*אקטיבית|סעד\s*החובה\s*לחוקק)/,
    synonyms: [
      "מחדל חקיקתי",
      "מחדל חקיקתי חלקי",
      "חובה לחוקק",
      "סעד החובה לחוקק",
      "חקיקה לוקה בחסר",
      "חובות הגנה חיוביות",
      "חובה אקטיבית",
    ],
  },
  {
    // Right to life / personal security — bridges constitutional phrasings
    // ("הזכות לחיים", "הזכות לביטחון אישי") to statutory anchors that
    // academic literature uses interchangeably.
    id: "right_to_life_security",
    trigger: /(הזכות\s*לחיים|ביטחון\s*אישי|שלמות\s*הגוף|חובות\s*מדינה\s*לחיים)/,
    synonyms: [
      "הזכות לחיים",
      "הזכות לביטחון אישי",
      "שלמות הגוף",
      "חוק יסוד: כבוד האדם וחירותו",
      "סעיף 4 לחוק יסוד",
    ],
  },
];

export interface ExpandedTerms {
  /** All hits found (id list for telemetry). */
  hits: string[];
  /** Merged, deduped synonyms ready for retrieval. */
  synonyms: string[];
}

export function expandDoctrineTerms(text: string): ExpandedTerms {
  const haystack = (text || "").toLowerCase();
  const hits: string[] = [];
  const synonyms = new Set<string>();

  for (const entry of DOCTRINE_SYNONYMS) {
    if (entry.trigger.test(haystack)) {
      hits.push(entry.id);
      for (const s of entry.synonyms) synonyms.add(s);
    }
  }

  return { hits, synonyms: [...synonyms] };
}
