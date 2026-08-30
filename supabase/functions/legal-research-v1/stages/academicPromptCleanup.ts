// academic_drafter_prompt_conflict_cleanup_v1
// Prompt-only cleanup for the academic_writing drafting path.
//
// The system prompt is shared by every answer mode. For academic drafts a few
// of its blocks actively fight the academic style guide:
//   * the evidence/hedging contract mandates retrieval-process phrases
//     ("מן המקורות עולה בזהירות כי") that the style guide bans;
//   * three broken-Hebrew blacklists feed the model ~25 invented compounds as
//     negative exemplars, which primes nearby coinages;
//   * the "bottom line first" rule (חדות משפטית #1) is written for
//     case_holding / definition / list shapes and is wrong for a chapter
//     introduction;
//   * rule #3 hands out four canned attribution formulas that become a
//     recognizable house style.
//
// This module removes those paragraphs for academic runs and substitutes
// academic-specific replacements. It never touches source safety, citation
// rules, the structured-output contract or any non-academic run.

import type { AcademicGenre } from "./academicPresentationHygiene.ts";

/** Genres whose opening must be framing/tension, not a legal bottom line. */
export const BOTTOM_LINE_EXEMPT_GENRES: AcademicGenre[] = [
  "introduction",
  "theoretical_background",
  "topic_presentation",
  "generic_academic",
];

export const ACADEMIC_HEDGE_RULE_HE =
  `כיול ודאות בטקסט אקדמי (מחליף את חוזה הראיות הגנרי):
- רמת הביטחון עדיין נגזרת מהתמיכה בפועל: מקור בתמיכה direct מאפשר ניסוח ברור; תמיכה partial/mixed מחייבת ניסוח מסויג.
- אבל בטקסט אקדמי הזהירות מתבטאת בניסוח דוקטרינרי טבעי — "ניתן לטעון", "נראה כי", "יש להבחין", "הדיון מחייב זהירות" — ולא בדיווח על תהליך איתור המקורות.
- אין לנסח הסתייגות כדיווח על החיפוש או על מאגר המקורות, ואין לפתוח פסקה בדיווח כזה. הסתייגות מנוסחת ביחס לדין ולטיעון, לא ביחס למה שנמצא או לא נמצא.
- קביעות רחבות (רפורמה, חוקתיות, מגמת הפסיקה הכוללת, השפעה מעשית) עדיין אסורות בלשון חזקה ללא תמיכה direct ספציפית.
- לשון של דין מחייב — "בית המשפט קבע כי", "ההלכה היא", "החוק קובע", "הדין הוא", "נפסק כי" — מותרת אך ורק כאשר בפניך מקור ראשוני שנקרא במלואו (פסק דין או נוסח חוק) התומך באותה קביעה. אחרת נסח את הטענה בלשון אקדמית זהירה: "בספרות ניתן למסגר", "הדיון הדוקטרינרי מציג", "המקורות המשניים מתארים", "ניתן לטעון כי", "הטיוטה מניחה כנקודת מוצא".
- טענה הנשענת על ספרות בלבד אינה מנוסחת כתוצאה של פסק דין מסוים ואינה מיוחסת לנוסח חוק.`;

export const ACADEMIC_REGISTER_RULE_HE =
  `עברית משפטית־אקדמית (מחליף את רשימות הצירופים הפסולים):
- כתוב בעברית משפטית־אקדמית טבעית, שמרנית ובהירה. העדף מונחים משפטיים ישראליים מקובלים ופעלים פשוטים על פני צירופים מומצאים, תרגום מילולי מאנגלית או שמות עצם מופשטים שנשמעים מרשימים אך אינם טבעיים.
- שמות חוקים רשמיים נכתבים בדיוק כלשונם (למשל "חוק-יסוד: כבוד האדם וחירותו"), על נקודתיים, יידוע ונטיות במדויק.
- תוויות בעלי דין לפי סוג ההליך: אזרחי — תובע/נתבע; פלילי — המאשימה/נאשם; מנהלי — עותר/משיב.
- אם אינך בטוח שצירוף קיים בעברית משפטית — נסח אותו מחדש במשפט פשוט.`;

export const ACADEMIC_SHARPNESS_RULE_HE =
  `חדות משפטית בטקסט אקדמי:
- טענה הנשענת על מקור בתמיכה ישירה תנוסח באופן ישיר וחד; הימנע מערפול מיותר.
- כאשר המקורות תומכים בדוקטרינה מוכרת — נקוב בשמה המקובל (למשל מבחן ההשתלבות, פיצויי הסתמכות, הרמת מסך) ואל תדלל אותה לתיאור גנרי.
- ייחוס משפטי ינוסח בלשונך שלך ובגיוון; אין תבנית ייחוס קבועה שיש לחזור עליה.`;

export const ACADEMIC_BOTTOM_LINE_RULE_HE =
  `פתיחה: המשפט המהותי הראשון חייב לומר את התשובה המשפטית עצמה. אין לפתוח במגבלות מקורות, בתיאור תהליך המחקר או בהסתייגות.`;

/**
 * Paragraph-level gates. Each entry identifies one paragraph of
 * SYSTEM_PROMPT_V2 by a stable opening substring.
 */
interface Gate {
  id: string;
  /** Unique substring at the start of the target paragraph. */
  anchor: string;
  /** Replacement text; empty string removes the paragraph. */
  replacement: string;
  kind: "hedge" | "blacklist" | "sharpness";
}

const GATES: Gate[] = [
  {
    id: "evidence_contract",
    anchor: "חוזה ראיות וכיול ודאות",
    replacement: ACADEMIC_HEDGE_RULE_HE,
    kind: "hedge",
  },
  {
    id: "broken_phrase_list",
    anchor: "אין לכלול בתשובה ביטויים שבורים או מומצאים כגון",
    replacement: "",
    kind: "blacklist",
  },
  {
    id: "language_quality_blacklist",
    anchor: "חיזוק איכות לשונית — עברית משפטית נקייה",
    replacement: ACADEMIC_REGISTER_RULE_HE,
    kind: "blacklist",
  },
  {
    id: "clean_hebrew_forms",
    anchor: "סגנון עברי משפטי נקי (חובה)",
    replacement: "",
    kind: "blacklist",
  },
  {
    id: "sharpness_block",
    anchor: "חדות משפטית (כללי ניסוח מחייבים)",
    replacement: ACADEMIC_SHARPNESS_RULE_HE,
    kind: "sharpness",
  },
];

export interface AcademicPromptCleanupReport {
  applied: boolean;
  genre: AcademicGenre;
  academic_hedge_contract_disabled: boolean;
  blacklist_blocks_disabled: number;
  bottom_line_rule_disabled: boolean;
  /** Gate anchors that no longer matched the prompt (drift alarm). */
  unmatched_gates: string[];
}

export function emptyAcademicPromptCleanupReport(
  genre: AcademicGenre = "generic_academic",
): AcademicPromptCleanupReport {
  return {
    applied: false,
    genre,
    academic_hedge_contract_disabled: false,
    blacklist_blocks_disabled: 0,
    bottom_line_rule_disabled: false,
    unmatched_gates: [],
  };
}

/**
 * Rewrites the shared system prompt for an academic_writing draft.
 * Non-academic callers must not use this — they get the prompt verbatim.
 */
export function applyAcademicPromptCleanup(
  systemPrompt: string,
  genre: AcademicGenre,
): { prompt: string; report: AcademicPromptCleanupReport } {
  const report = emptyAcademicPromptCleanupReport(genre);
  report.applied = true;

  const keepBottomLine = !BOTTOM_LINE_EXEMPT_GENRES.includes(genre);
  const paragraphs = systemPrompt.split(/\n\n/);

  for (const gate of GATES) {
    const idx = paragraphs.findIndex((p) => p.trimStart().startsWith(gate.anchor));
    if (idx === -1) {
      report.unmatched_gates.push(gate.id);
      continue;
    }
    let replacement = gate.replacement;
    if (gate.kind === "sharpness" && keepBottomLine) {
      replacement = `${ACADEMIC_BOTTOM_LINE_RULE_HE}\n${replacement}`;
    }
    paragraphs[idx] = replacement;
    if (gate.kind === "hedge") report.academic_hedge_contract_disabled = true;
    if (gate.kind === "blacklist") report.blacklist_blocks_disabled++;
    if (gate.kind === "sharpness") report.bottom_line_rule_disabled = !keepBottomLine;
  }

  const prompt = paragraphs.filter((p) => p.trim().length > 0).join("\n\n");
  return { prompt, report };
}
