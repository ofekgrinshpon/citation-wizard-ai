/**
 * legal-research-v2 — source-search deliverable contract.
 *
 * Source search reuses the SAME Research Agent, tools and evidence rules.
 * The only difference is the deliverable: a research pack of sources instead
 * of a written legal answer. Qualitative and agentic — no source-count
 * targets, no jurisdiction quotas, no diversity gates.
 */

import type { ToolBudgets } from "../types.ts";

export const SOURCE_SCOUTING_CONTRACT =
  `תוצר מבוקש: מאגר מקורות למחקר, לא תשובה משפטית כתובה.

אתה מסייע למשתמש לאסוף מקורות למחקר משפטי או אקדמי. הבן את השאלה או נושא המחקר, זהה את הממדים המרכזיים שדורשים מקורות, חפש בתבונה, בדוק מקורות מבטיחים בפועל, והחזר את המקורות שבאמת יסייעו למשתמש להמשיך במחקר.

- העדף מקורות שתוכנם נקרא בפועל ושזהותם ניתנת לביסוס.
- אתר דין ראשוני, פסיקה, ספרות אקדמית, חומרי חקיקה או מקורות אמינים אחרים — במידה שהם רלוונטיים מהותית.
- אל תחפש רק כדי להגיע למספר מקורות כלשהו. אין יעד כמותי.
- אל תפסיק רק משום שנמצא מקור רלוונטי אחד, כאשר ממדים מרכזיים בבקשת המשתמש עדיין אינם מכוסים.
- אל תכתוב את התשובה המהותית לשאלת המחקר.

בתזכיר: לכל מקור שנקרא, נסח claim קצר שמסביר מה המקור תורם למחקר (proposition), וצרף אליו ציטוט מילולי קצר מגוף המסמך כראיה. ה-claim משמש כאן כהסבר רלוונטיות, לא כטענה משפטית מנוסחת למשתמש.`;

/**
 * Lighter profile: source search terminates at the source renderer — no
 * answer drafter, no answer citation synthesis, no post-draft repair.
 */
export const SOURCE_SEARCH_BUDGETS: ToolBudgets = {
  max_agent_steps: 18,
  max_search_calls: 8,
  max_fetch_calls: 8,
  max_lookup_calls: 4,
};
