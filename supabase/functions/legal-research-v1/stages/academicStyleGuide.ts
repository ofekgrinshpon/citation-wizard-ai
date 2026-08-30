// academic_style_model_v1
// Genre-sliced adaptation of the deleted legal-qa "Academic Style Guide v1"
// (v1.0-final, ~11KB) for the legal-research-v1 academic_writing path.
//
// Scope: STYLE ONLY. This module never affects retrieval, sufficiency,
// identity, citation rendering or source selection. It emits a small
// prompt block (~2-4KB) with the 2-4 sections relevant to the current genre.
//
// Two hard adaptations relative to the old guide:
//  1. Footnote-density guidance is gated — on a thin pack it is replaced by a
//     restraint rule so the model is never pushed to invent citations.
//  2. The old guide's canned Hebrew phrase lists are NOT reproduced. Sections
//     describe the rhetorical function and explicitly demand varied phrasing,
//     so answers do not converge on a recognizable house template.

import type { AcademicGenre } from "./academicPresentationHygiene.ts";

export const ACADEMIC_STYLE_MODEL_VERSION = "v1.0-lr1";

export const ACADEMIC_STYLE_GUIDE_ENABLED_DEFAULT = true;

export function styleGuideFlagEnabled(): boolean {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  const raw = String(env?.get?.("ACADEMIC_STYLE_GUIDE_ENABLED") ?? "").trim().toLowerCase();
  if (!raw) return ACADEMIC_STYLE_GUIDE_ENABLED_DEFAULT;
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}


export type StyleSectionId =
  | "paragraph_rhythm"
  | "topic_sentences"
  | "transitions"
  | "argument_structure"
  | "register"
  | "anti_patterns"
  | "citation_density"
  | "citation_restraint"
  | "brevity";

const SECTIONS: Record<StyleSectionId, string> = {
  paragraph_rhythm:
    `**קצב פסקה ומשפט**
- פסקה אקדמית יכולה להתפתח בכמה משפטים סביב טענה אחת, אך אין צורך לנפח אותה; אל תעבור בדרך כלל 7 משפטים בפסקה. פסקה של משפט בודד אינה פסקה אקדמית.
- העדף משפטים בהירים וקצרים יחסית; אין יעד מספרי לאורך משפט, ואין להאריך משפט כדי שיישמע אקדמי.
- מעבר בין פסקאות = מעבר בין טענות, לא רק המשך זרימה.`,

  topic_sentences:
    `**משפט פותח (topic sentence)**
- כל פסקה נפתחת במשפט שממקם את הטענה או את המישור הנדון (דוקטרינרי / נורמטיבי / השוואתי).
- אין לפתוח פסקה במילת קישור פנים־פסקתית ("לכן", "לפיכך", "כך").
- אין הכרזות־על ריקות על מה שייכתב בהמשך; מסגור מותר רק אם הוא נושא תוכן.`,

  transitions:
    `**מהלכי קישור**
- הקישור בין פסקאות הוא מהלך מסוג מוגדר: הסכמה־עם־הסתייגות, חידוד, פיווט דוקטרינרי, מהלך השוואתי, או סינתזה. הקורא צריך לדעת איזה מהלך נעשה.
- אסור לשרשר "בנוסף" / "כמו כן" כמילות מעבר נטולות תוכן.
- גוון את הניסוח: אל תחזור על אותה נוסחת מעבר יותר מפעם אחת באותו טקסט, ואל תשתמש בתבנית ניסוח קבועה.`,

  argument_structure:
    `**מבנה טיעון וטיעון נגד**
- מבנה: טענה → הטיעון הנגדי החזק ביותר בניסוחו המיטבי → אבחנה מדויקת → הכרעה או הודאה מפורשת בקושי שנותר.
- אסור להציג טיעון נגד בגרסתו החלשה, ואסור לבטלו במשפט אחד.
- ההכרעה חייבת להישען על אבחנה משפטית, לא על הצהרת עמדה.`,

  register:
    `**רגיסטר**
- לשון אקדמית משפטית עברית, עקבית לאורך הטקסט (אל תערבב גוף ראשון יחיד ורבים).
- אסור: "אני חושב ש…", "לדעתי האישית", סלנג, ומילים לועזיות כשיש מקבילה עברית מקובלת.
- מונח זר: בעברית עם הלעז בסוגריים בהופעה הראשונה, ובעברית בלבד לאחר מכן.
- פסיקה נכתבת בגוף שלישי ענייני ("בית המשפט קבע"), לא כדמות.`,

  anti_patterns:
    `**אנטי־דפוסים**
- אין פרוזה שהיא רשימה מוסווית (משפטים קצרים מקבילים שכל אחד פותח נושא חדש).
- אין מילות חיזוק ריקות ("ברור ש…", "אין ספק ש…", "מובן מאליו").
- אין קלישאות סיום ("ימים יגידו", "עתיד לתת").
- אין לשון דיווח על תהליך החיפוש או על המקורות שאותרו; זהו טקסט אקדמי, לא דוח מחקר.
- אין צירופים מלאכותיים או תרגום מילולי מאנגלית; אם צירוף נשמע מוזר בעברית — נסח מחדש.
- אין מטא־שיח על מבנה הטקסט מעבר להכרחי.`,

  citation_density:
    `**צפיפות אסמכתאות (לפי אופי הפסקה)**
- פסקה דוקטרינרית: כל קביעה קונקרטית נסמכת על מקור שסופק לך.
- פסקה נורמטיבית (טיעון הכותב): מעט אסמכתאות או ללא, ורק לספרות תומכת או חולקת.
- פסקת סיכום: לרוב ללא אסמכתאות.
- אסור לפזר אסמכתאות באופן אחיד כקישוט.`,

  citation_restraint:
    `**אסמכתאות — מצב מקורות דל**
- מאגר המקורות כאן דל. אין להוסיף אסמכתאות כדי לעמוד ביעד צפיפות כלשהו.
- הסתמך אך ורק על המקורות שסופקו; היכן שאין תמיכה — נסח בלשון תיאורטית זהירה בלי לייחס קביעה למקור.
- אין להמציא שמות פסקי דין, מספרי הליכים, מחברים או פרסומים.`,

  brevity:
    `**בהירות לפני צפיפות**
- זהו פלט קצר. עדיף ניסוח נקי, ישיר ושמיש על פני צפיפות של מאמר שפיט.
- אל תאריך את הטקסט רק כדי שיישמע אקדמי; אורך נוסף מוצדק רק אם הוא מוסיף תוכן.
- שמור על תזה ברורה במשפט הראשון.`,
};

const GENRE_SECTIONS: Record<AcademicGenre, StyleSectionId[]> = {
  introduction: ["paragraph_rhythm", "topic_sentences", "transitions", "anti_patterns"],
  theoretical_background: ["paragraph_rhythm", "topic_sentences", "transitions", "anti_patterns"],
  // argument_paragraph: the drafter prompt already carries the one-paragraph
  // contract and the claim→counterargument structure. Stacking topic-sentence
  // and register pressure on top of a 150–300 word budget produced clipped,
  // formulaic compression, so this genre keeps structure + anti-patterns only.
  argument_paragraph: ["argument_structure", "anti_patterns"],
  topic_presentation: ["brevity", "topic_sentences", "register", "anti_patterns"],
  research_question: ["brevity", "register", "anti_patterns"],
  chapter_outline: ["brevity", "register", "anti_patterns"],
  generic_academic: ["paragraph_rhythm", "topic_sentences", "register", "anti_patterns"],
};

/** Genres that are short user-facing outputs — never add citation-density push. */
const SHORT_GENRES: AcademicGenre[] = ["research_question", "chapter_outline", "topic_presentation"];

export interface StyleGuideOptions {
  /** academic_limited_draft branch or otherwise thin source pack. */
  limitedDraft: boolean;
  /** Whether any footnote-bearing source is actually available. */
  hasFootnotes: boolean;
  /** Overrides the env flag (tests). */
  enabled?: boolean;
}

export interface AcademicStyleModelReport {
  enabled: boolean;
  version: string;
  genre: AcademicGenre;
  sections_used: StyleSectionId[];
  block_chars: number;
  limited_draft: boolean;
  has_footnotes: boolean;
}

const FENCE_HEADER =
  `כללי סגנון אקדמי — לא מקור לציטוט (גרסה ${ACADEMIC_STYLE_MODEL_VERSION})`;
const FENCE_BODY =
  `הבלוק הזה הוא הנחיית סגנון בלבד. אסור לצטט אותו, להפנות אליו, לראות בו סמכות משפטית או להעתיק ממנו פראזה כלשהי. כל קביעה משפטית חייבת להישען על בלוק המקורות בלבד. נסח בלשונך שלך וגוון בין תשובות.`;

/**
 * Builds the genre-sliced style block for the academic drafter prompt.
 * Returns an empty block when the feature flag is off.
 */
export function buildAcademicStyleGuideBlock(
  genre: AcademicGenre,
  options: StyleGuideOptions,
): { block: string; report: AcademicStyleModelReport } {
  const enabled = options.enabled ?? styleGuideFlagEnabled();
  const base: AcademicStyleModelReport = {
    enabled,
    version: ACADEMIC_STYLE_MODEL_VERSION,
    genre,
    sections_used: [],
    block_chars: 0,
    limited_draft: options.limitedDraft,
    has_footnotes: options.hasFootnotes,
  };
  if (!enabled) return { block: "", report: base };

  const ids = [...(GENRE_SECTIONS[genre] ?? GENRE_SECTIONS.generic_academic)];

  // Footnote-density guidance is gated: never on a thin pack, never when there
  // is nothing to cite, and never for the short genres.
  if (!SHORT_GENRES.includes(genre)) {
    if (options.limitedDraft || !options.hasFootnotes) {
      ids.push("citation_restraint");
    } else {
      ids.push("citation_density");
    }
  } else if (options.limitedDraft || !options.hasFootnotes) {
    ids.push("citation_restraint");
  }

  const body = ids.map((id) => SECTIONS[id]).join("\n\n");
  const block = `${FENCE_HEADER}\n${FENCE_BODY}\n\n${body}`;

  return {
    block,
    report: { ...base, sections_used: ids, block_chars: block.length },
  };
}
