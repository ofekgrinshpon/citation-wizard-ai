/**
 * no_negative_doctrine_existence_from_retrieval_failure_v1
 *
 * Deterministic guardrail: the pipeline may report that retrieval did not find
 * sufficient grounding for a named doctrine/הלכה, but it must never assert —
 * or imply — that the doctrine itself does not exist, unless an affirmative
 * authoritative source says so.
 *
 * This module is text-only. No retrieval, sufficiency, routing or citation
 * behaviour is touched: it rewrites negative-existence phrasing in the final
 * answer into source-scoped phrasing ("במקורות שאותרו לא נמצא עיגון מספק...").
 */

export interface NegativeExistenceScrubResult {
  text: string;
  changed: boolean;
  patterns: string[];
}

interface Rule {
  id: string;
  re: RegExp;
  to: string;
}

// Each rule maps an absolute non-existence claim to a retrieval-scoped one.
const RULES: Rule[] = [
  {
    id: "no_recognized_halacha_named",
    // "לא נמצאה הלכה מוכרת בשם X" / "לא קיימת הלכה מוכרת בשם X"
    re: /(?:לא\s+(?:נמצאה|קיימת|ידועה)|אין)\s+(?:כיום\s+)?(?:הלכה|דוקטרינה|תורה)\s+(?:מוכרת|ידועה|כזו|כזאת)?\s*(?:בשם|הנקראת|הידועה\s+בשם)/g,
    to: "במקורות שאותרו לא נמצא עיגון מספק למונח",
  },
  {
    id: "no_recognized_halacha_bare",
    // "אין הלכה מוכרת" / "לא קיימת הלכה מוכרת" (no name follows)
    re: /(?:אין|לא\s+(?:קיימת|נמצאה|ידועה))\s+(?:כיום\s+)?(?:הלכה|דוקטרינה)\s+(?:מוכרת|ידועה)(?!\s*(?:בשם|הנקראת))/g,
    to: "במקורות שאותרו לא נמצא עיגון מספק להלכה",
  },
  {
    id: "doctrine_does_not_exist",
    // "הדוקטרינה/ההלכה אינה קיימת" / "לא קיימת" / "איננה קיימת"
    re: /(ה(?:דוקטרינה|הלכה|לכה|עקרון|כלל)[^\n.,;]{0,40}?)\s*(?:אינה|איננה|אינו|איננו|לא)\s+קיי(?:מת|ם)(?:\s+בדין(?:\s+הישראלי)?)?/g,
    to: "$1 לא אותרה במקורות שנסקרו",
  },
  {
    id: "no_such_halacha",
    // "לא קיימת הלכה כזו" / "אין הלכה כזו" / "אין דוקטרינה כזו"
    re: /(?:אין|לא\s+(?:קיימת|נמצאה))\s+(?:הלכה|דוקטרינה|עקרון|כלל)\s+(?:כזו|כזאת|כזה|בשם\s+זה)/g,
    to: "לא אותר במקורות עיגון מספק להלכה בשם זה",
  },
  {
    id: "doctrine_not_recognized_in_law",
    // "אינה מוכרת בדין/בפסיקה הישראלית"
    re: /(?:אינה|איננה|אינו|איננו|לא)\s+מוכרת?\s+ב(?:דין|פסיקה|משפט)(?:\s+הישראלי(?:ת)?)?/g,
    to: "לא אותרה כמונח מוכר במקורות שנסקרו",
  },
];

export function scrubNegativeExistenceClaims(
  text: string,
): NegativeExistenceScrubResult {
  if (!text) return { text, changed: false, patterns: [] };
  let out = text;
  const patterns: string[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    if (!rule.re.test(out)) continue;
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, rule.to);
    patterns.push(rule.id);
  }
  return { text: out, changed: patterns.length > 0, patterns };
}

/** Prompt-level instruction appended to every drafter user message. */
export const NEGATIVE_EXISTENCE_PROMPT_RULE =
  'כלל מוחלט — איסור קביעת אי-קיום: מחסור במקורות אינו ראיה לאי-קיום. אין לכתוב או לרמוז שדוקטרינה/הלכה "אינה קיימת", ש"אין הלכה מוכרת בשם זה" או ש"לא קיימת הלכה כזו", אלא אם קיים מקור סמכותי מפורש שקובע זאת. במקום זאת נסח תמיד במונחי המקורות: "במקורות שאותרו לא נמצא עיגון מספק ל…" או "לא אותר במקורות טקסט התומך ב…", והבהר שייתכן שקיימת פסיקה שלא אותרה בחיפוש זה.';
