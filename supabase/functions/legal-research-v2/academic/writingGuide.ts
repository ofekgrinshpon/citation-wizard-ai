/**
 * legal-research-v2 — Academic-Writing-only body-chapter guide.
 *
 * Applied ONLY when a request arrives as an academic body chapter. Normal
 * legal research never sees it. Qualitative only: no length targets, no
 * citation-density quotas, no phrase banks, no forced formulations.
 */

export const ACADEMIC_BODY_GUIDE_VERSION = "body-v1";

export type AcademicChapterRole = "body" | "introduction" | "conclusion" | "abstract";

/** Opening line per chapter role; the rest of the guide is role-independent. */
const ROLE_OPENING: Record<AcademicChapterRole, string> = {
  body:
    "אתה כותב פרק גוף בעבודה אקדמית משפטית ישראלית, לא תשובה לשאלה.",
  introduction:
    "אתה כותב פרק מבוא בעבודה אקדמית משפטית ישראלית, לא תשובה לשאלה. תפקיד המבוא: להציג את הרקע ואת הבעיה המשפטית, למקם אותה בהקשר הנורמטיבי וההשוואתי, לנסח את שאלת המחקר ואת חשיבותה ולשרטט את מהלך העבודה — בלי להכריע בה.",
  conclusion:
    "אתה כותב פרק סיכום בעבודה אקדמית משפטית ישראלית, לא תשובה לשאלה. תפקיד הסיכום: לאסוף את קווי הטיעון שכבר בוססו, להשיב על שאלת המחקר ולהצביע על מגבלות ועל המשך אפשרי — בלי להכניס מקורות או טענות חדשים שלא בוססו.",
  abstract:
    "אתה כותב תקציר של עבודה אקדמית משפטית ישראלית, לא תשובה לשאלה. התקציר תמציתי, מציג את הבעיה, את שאלת המחקר, את הטיעון המרכזי ואת המסקנה.",
};

export function buildAcademicWritingGuide(role: AcademicChapterRole = "body"): string {
  return `${ROLE_OPENING[role]}${ACADEMIC_GUIDE_BODY}`;
}

const ACADEMIC_GUIDE_BODY =
  ` סגנון: פרוזה אקדמית עברית רהוטה ומדודה, בגוף שלישי, ללא פנייה לקורא וללא דיווח על תהליך המחקר או על החיפוש.




- לכל פסקה טענה מזוהה אחת המנוסחת במשפט פותח, ואחריה פיתוח וביסוס.
- בנה טיעון מתמשך המקדם את שאלת המחקר של העבודה, ולא רשימת מקורות או תקצירי פסיקה זה אחר זה. חבר בין מקורות: הצבע על הסכמה, מתח או התפתחות ביניהם.
- הבחן במפורש בין תיאור הדין המצוי לבין ניתוח נורמטיבי או ביקורתי משלך.
- הצג עמדות מתחרות בהגינות לפני שאתה מעריך אותן.
- מעברים בין פסקאות יהיו ענייניים ונובעים מהטיעון, לא מילות קישור ריקות.
- הימנע מניסוח מנופח, מהכללות חגיגיות וממשפטי סיכום שאין להם תוכן.
- קשור את הפרק להקשר העבודה שסופק, בלי להסתמך עליו כמקור ובלי לחזור על מה שכבר נקבע בפרקים קודמים.`;

/** Back-compatible alias: the body-chapter guide. */
export const ACADEMIC_BODY_CHAPTER_GUIDE = buildAcademicWritingGuide("body");
