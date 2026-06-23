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
    // British Mandate-era ordinance continuity.
    // Trigger: פקודה / דבר המלך / חקיקה appearing near מנדטורי / המנדט
    // (within ~30 chars). Narrow on purpose — won't fire on
    // "הוראה מנדטורית" / "נורמה מנדטורית" (binding-norm reading).
    id: "mandate_era_ordinance_continuity",
    trigger: /(פקוד[הת]|דבר\s*המלך|חקיקה)[^\n]{0,30}?(מנדטורי(?:ת|ים|ות)?|המנדט)/u,
    synonyms: [
      "חקיקה מנדטורית",
      "המשך תחולת חקיקה מנדטורית",
      "פקודת סדרי השלטון והמשפט",
      "סעיף 11 לפקודת סדרי השלטון והמשפט",
      "נוסח חדש",
      "פקודת מס הכנסה [נוסח חדש]",
      "פקודת מס הכנסה [נוסח חדש] תשכ\"א-1961",
      "Income Tax Ordinance 1947",
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
