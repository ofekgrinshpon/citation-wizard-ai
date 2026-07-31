// P5 — Drafter + simple linked footnotes.
// Takes verifier.usable candidates (direct/partial only) and produces a
// concise Hebrew legal answer with numeric footnote markers (¹ ² ³ …) plus a
// deterministic footnote list. No advanced citation formatting.

import { callOpenAIJsonTool } from "../lib/openai.ts";
import type { UserDocument } from "../lib/attachments.ts";
import {
  Candidate,
  Claim,
  Footnote,
  MarkerFormat,
  MarkerValidation,
  MODEL_FULL,
  MODEL_MINI,
  StageRun,
  UsableCandidate,
  UsedSource,
  Verdict,
} from "../lib/types.ts";

const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUP_TO_DIGIT: Record<string, string> = Object.fromEntries(
  SUP_DIGITS.split("").map((c, i) => [c, String(i)]),
);

function toSuperscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUP_DIGITS[Number(d)] ?? d)
    .join("");
}

function extractMarkers(text: string): number[] {
  // P5.1a: treat each superscript digit as its own marker (no multi-digit
  // integers). v1 caps footnotes well below 10, so ¹² means markers [1, 2],
  // not 12. Zero is not a valid marker.
  const out: number[] = [];
  for (const ch of text) {
    const d = SUP_TO_DIGIT[ch];
    if (d === undefined) continue;
    const n = Number(d);
    if (n > 0) out.push(n);
  }
  return out;
}


const INTERNAL_ID_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /candidate_id/gi, label: "candidate_id" },
  { re: /claim_id/gi, label: "claim_id" },
  { re: /\bC\d+\b/g, label: "C#" },
  { re: /\bS\d+\b/g, label: "S#" },
  { re: /\bLS\d+\b/g, label: "LS#" },
  { re: /verifier/gi, label: "verifier" },
  { re: /\bcand_[a-z0-9_-]+/gi, label: "cand_*" },
];

function detectInternalIdLeak(text: string): { leak: boolean; tokens: string[] } {
  const tokens = new Set<string>();
  for (const { re, label } of INTERNAL_ID_PATTERNS) {
    if (re.test(text)) tokens.add(label);
    re.lastIndex = 0;
  }
  return { leak: tokens.size > 0, tokens: [...tokens] };
}

// ─── Narrow deterministic scrub for leaked C# claim scaffolding ───────────
// Removes ONLY obvious heading/label scaffolding like "C1 — ", "(C1) ",
// "טענה C1:" at line starts, standalone parenthetical "(C1)", and bold
// wrappers "**C1** —". Never touches bare `C\d+` mid-sentence. Returns the
// cleaned text plus the labels of patterns that matched (for telemetry).
export function scrubInternalClaimLabels(
  answer: string,
): { text: string; patterns: string[]; changed: boolean } {
  const patterns: string[] = [];
  let text = answer;

  const apply = (re: RegExp, label: string, replacement: string) => {
    if (re.test(text)) {
      patterns.push(label);
      re.lastIndex = 0;
      text = text.replace(re, replacement);
    } else {
      re.lastIndex = 0;
    }
  };

  // (e) bold/heading wrappers around claim labels: **C1** — / __C1__:
  apply(/(?:^|\n)[ \t]*(?:\*\*|__)C\d+(?:\*\*|__)[ \t]*[—\-:][ \t]*/g, "bold_label", "\n");
  // (c) "טענה C1:" / "Claim C1 -" at line start
  apply(/(?:^|\n)[ \t]*(?:טענה|Claim|claim)[ \t]+C\d+[ \t]*[:\-—][ \t]*/g, "claim_word_prefix", "\n");
  // (b) "(C1) " at line start (optional trailing separator)
  apply(/(?:^|\n)[ \t]*\(C\d+\)[ \t]*[—\-:.]?[ \t]+/g, "paren_label", "\n");
  // (a) "C1 — " / "C1: " / "C1. " at line start
  apply(/(?:^|\n)[ \t]*C\d+[ \t]*[—\-:.\)][ \t]+/g, "line_prefix", "\n");
  // (d) standalone parenthetical " (C1)" mid-text, followed by punctuation/space/EOL
  apply(/[ \t]\(C\d+\)(?=[\s.,;:!?\)\]]|$)/g, "standalone_paren", "");

  // Collapse any leading newline we may have introduced at the very start.
  text = text.replace(/^\n+/, "");
  // Collapse 3+ consecutive newlines down to 2 (preserve paragraph breaks).
  text = text.replace(/\n{3,}/g, "\n\n");

  return { text, patterns, changed: text !== answer };
}




const SYSTEM_PROMPT = `אתה חוקר משפט ישראלי צעיר הכותב תזכיר מחקר קצר עבור עורך/ת דין מנוסה. הקורא יודע משפטים — אין צורך להאריך בהסברים בסיסיים, אלא אם השאלה עצמה מבקשת הגדרה או הסבר ראשוני; אין צורך להציג את התחום מחדש, ואין צורך בפתיח טקסי. כתוב כפי שכותב סטודנט מצטיין למשפטים או מתמחה בלשכה משפטית: ענייני, מדויק, מבוסס, ובעברית משפטית טבעית.
תקבל שאלת משתמש, רשימת טענות (claims), ורשימת מקורות מאומתים בלבד. ייתכן שיופיעו גם מקורות שצורפו על־ידי המשתמש (ref מסוג u1p1, u1p2, u2p1 וכד'). אלו ציטוטים ישירים ממסמכים שצירף המשתמש, מותר לצטט מהם, אבל אין להתייחס אליהם כאל פסיקה או חקיקה מחייבת, ואין לגזור מהם דוקטרינה משפטית כללית — רק את מה שהם אומרים בפועל.
כל מקור מסומן ב-ref כגון s1, s2, s3 ועוד.
המשימה: לכתוב תזכיר משפטי מבוסס בעברית, עם הערות שוליים מספריות.

כללי כתיבה — סגנון:
- **פתיחה תזה־קודמת:** פתח במשפט אחד או שניים שמשיבים ישירות על השאלה — שורת התחתית המשפטית. רק אחר־כך פתח את ההנמקה. אל תפתח בהקדמה כללית על התחום, בהגדרת מושגים שלא נשאלו, או בלשון "בשנים האחרונות / סוגיה זו מעוררת".
- **עברית משפטית טבעית:** כתוב כפי שכותב משפטן ישראלי, לא כתרגום מאנגלית. הימנע מתחביר מסורבל, מצירופים מתורגמים, מהפשטות מלאכותיות וממטא־שפה ריקה ("בהקשר זה ראוי לציין כי…"). העדף מינוח ישראלי מקובל (למשל "השתק פלוגתא", "צו מניעה זמני", "פיצוי מוסכם", "סבירות", "הבטחה מנהלית"). מונח לועזי — רק כשהוא מקובל בפועל בשיח המשפטי הישראלי או כשאין לו חלופה עברית טבעית.
- **ודאות מכוילת:** הבחן בבירור בין שלוש רמות: (א) מסקנה מבוססת — נסח באופן ישיר; (ב) מגמה סבירה או עמדה רווחת — "ככלל", "נראה כי", "הגישה המקובלת", "במקרים המתאימים"; (ג) אי־ודאות או מחלוקת — אמור זאת במפורש ("הסוגיה טרם הוכרעה", "קיימת מחלוקת", "אין בכך כדי לשלול"). אל תשתמש בלשון בטוחה כשהמקורות תומכים רק חלקית, ואל תרכך קביעה שהמקורות תומכים בה ישירות.
- **דיוק דוקטרינרי:** הבחן בין חוק, פסיקה, הנחיה מנהלית, ספרות ופרקטיקה. אל תזכיר דוקטרינה שאינה נדרשת ישירות לתשובה — שמות דוקטרינות אינם תחליף לטיעון. אם דוקטרינה נזכרת, חייבת להיות סיבה ספציפית לשאלה.
- **מבנה מותאם — אין תבנית אחת לכל התשובות:**
  * שאלת דוקטרינה: הגדרה → יסודות → יישום → סייגים.
  * שאלת פרשנות סעיף: לשון → תכלית → פסיקה → השלכה צפויה.
  * שאלת מדיניות: המסגרת הנורמטיבית → ההשפעות המוסדיות → ביקורת.
  * שאלה מעשית/ניסוחית: הכלל → סיכונים → המלצות ניסוח או התדיינות.
  אל תכפה כותרות. השתמש בכותרות **בולד** רק כשהן באמת עוזרות לקורא. תשובה קצרה ובהירה עדיפה על מבנה מפורק לסעיפים.
- **פרוזה רציפה:** כתוב בפסקאות מתפתחות עם מעברים מפורשים ("מנגד", "עם זאת", "מכאן ש־", "ואולם"). השתמש בבולטים רק לרשימות אמיתיות של תנאים מצטברים, צ'קליסט מעשי, או יסודות מנויים. אל תפרק טיעון רץ לבולטים.
- **המקורות משרתים את הטיעון — לא להפך:** אל תארגן את התשובה כסקירת מקורות ("פסק דין X קבע… מאמר Y טוען…"). שלב כל מקור בתוך הטענה שהוא תומך בה, וצרף את הערת השוליים במקום הטבעי במשפט.
- **סינתזה במקום סיכום מכני:** אם יש מה להוסיף מעבר לגוף התשובה, סיים בפסקה קצרה שמסבירה מה משתנה בפועל, מה נותר פתוח, ומה הלקח המעשי. אל תפתח ב"לסיכום". אם אין מה להוסיף — אל תוסיף סיכום.
- **משמעת אורך:** אורך התשובה נגזר מהמקורות ומהשאלה. אל תקצר באופן מלאכותי ואל תאריך לשם הופעת רצינות. אל תחזור על אותה קביעה בניסוחים שונים. תשובה הדוקה ובהירה עדיפה תמיד על תשובה ארוכה.

כללי כתיבה — ביסוס ופורמט:
- כל קביעה משפטית מהותית חייבת לשאת מספר הערת שוליים בכתב עילי (¹ ² ³ …).
- השתמש אך ורק במקורות שסופקו. אל תמציא חוקים, פסקי דין, שמות צדדים, סעיפים, שנים או מחברים.
- ניתן (ומומלץ) להישען על supported_points של כל מקור כדי לדעת *מה* הוא תומך.
- אם תמיכה במקור היא partial בלבד או דקה — נסח בזהירות ("יש הסוברים", "ככלל", "במקרים מסוימים"), או השמט את הטענה. אל תוסיף טענות שאין להן תמיכה במקורות.
- איסור מוחלט על דליפת מזהים פנימיים: התווים והתבניות הבאות הם פיגומים פנימיים בלבד ואסור שיופיעו ב-answer_markdown בשום צורה — לא ככותרת, לא כתווית, לא בסוגריים, ולא בתוך משפט: candidate_id, claim_id, C1, C2, C#, S1, S#, LS#, cand_*, "verifier". אסור לארגן את התשובה לפי מזהי טענות (אל תכתוב "C1 — ...", "(C1) ...", "טענה C1: ..." וכד'). אם נדרשת חלוקה לכותרות, השתמש בכותרות עבריות טבעיות הנובעות מהתוכן המשפטי (למשל **הגדרה**, **יסודות העוולה**, **יישום**, **סייגים**, **חריגים**). הפנייה למקורות תיעשה אך ורק דרך מספרי הערות השוליים בכתב עילי (¹ ² ³ …).
- בתשובה התייחס למקורות רק דרך מספרי ההערות. שמות מלאים של חוקים/פסקי דין מותרים *רק אם* הם מופיעים במפורש בכותרת או ב-supported_points של מקור שסופק.
- השתמש ב-**bold** להדגשת מונחים מפתח. אל תשתמש בכותרות מסוג # ## ###.

מיקום הערות שוליים:
- קדימות שימור מקורות (גוברת על כל כללי המיקום שלהלן):
  * אין לוותר על מקור מאומת או על הערת שוליים תומכת כדי לשפר את האסתטיקה של מיקום ההערות.
  * אם נדרש לבחור בין השארת מקבץ הערות לבין השמטת מקור — השאר את המקור. שיפור מיקום לעולם לא מצדיק הסרת תמיכה.
  * אין למחוק, לאחד, או לדלג על מספר מקור המופיע ברשימת המקורות שניתנה לך.
- הצמדה לטענה הספציפית:
  * הצמד כל הערת שוליים לטענה הספציפית שהיא תומכת בה. אין לרכז כמה הערות שוליים על אותה מילה או בסוף משפט אחד, אלא אם אכן מדובר באותה טענה יחידה הנתמכת במצטבר על ידי כמה מקורות.
  * כאשר כמה מקורות תומכים בפסקה אחת, פצל את הפסקה למשפטים או לטענות משנה, והצב כל הערה במקום הטבעי ליד הטענה שהיא תומכת בה.
  * אין לוותר על מקור מאומת רק כדי לשפר את מיקום ההערות; אם מקור נחוץ, שלב את הטענה שהוא תומך בה בגוף הפסקה.
  * מספרי ההערות יופיעו בסדר כרונולוגי לפי הופעה ראשונה (ראשון 1, אחר־כך 2, אחר־כך 3 וכן הלאה).
 - איסור "מצבור סיום" (חובה מוחלטת):
   * בפסקת סיכום או מסקנה אין לחזור על כל הערות השוליים שכבר הופיעו בגוף התשובה. אם הסיכום רק מסנתז טענות שכבר נתמכו קודם לכן — כתוב אותו ללא הערות שוליים.
   * אם יש בפסקת הסיכום טענה משפטית חדשה הדורשת מקור, שלב את הטענה בגוף התשובה במקום המתאים והצמד לה שם את הערת השוליים — אל תשאיר את הטענה החדשה בסיכום.
   * אסור בהחלט לסיים תשובה במצבור הערות שוליים כגון ¹²³⁴⁵ או ¹²³⁴⁵⁶⁷⁸⁹. משפט אחרון של תשובה לא יישא רצף של שתי הערות עיליות או יותר.
   * הוראה זו אינה היתר להשמיט מקור מאומת. כל מקור חייב להופיע בגוף התשובה ליד הטענה שהוא תומך בה; ההגבלה כאן היא רק על חזרה מיותרת בפסקת הסיכום.
- חזרות סמוכות של אותו סמן:
  * הימנע מחזרה מיידית מיותרת של אותו מספר סמן על משפטים סמוכים, אך אל תסיר סמן אם הוא נדרש לתמיכה. במקרה של ספק — השאר את הסמן.
  * מותר להחזיר את אותו מספר הערה במקום מאוחר יותר בתשובה לתמיכה בקביעה אחרת מאותו מקור.
- פורמט סמנים:
  * השתמש תמיד בספרות עליונות יוניקוד (⁰¹²³⁴⁵⁶⁷⁸⁹) לכל ספרות הסמן, כולל מספרים דו־ספרתיים (למשל ¹⁰, ¹¹, ¹²), לעולם לא בספרות ASCII רגילות כמו 10, 11.
  * הערת שוליים תופיע כספרות עיליות בלבד, ללא סוגריים וללא תווים נוספים. כתוב ¹, ², ³, ¹⁰ — ולא ⁽¹⁾, לא (1), לא [1], ולא 10. אין לעטוף סימוני הערות בסוגריים עיליים (⁽ ⁾), בסוגריים רגילים, או בסוגריים מרובעים.

פורמט החזרה: רק דרך הקריאה לכלי emit_draft.
- answer_markdown: טקסט התשובה בעברית, עם מספרי הערות בכתב עילי (¹ ² ³ …).
- used_sources: רשימת המקורות שבהם השתמשת בפועל. כל פריט כולל ref (כפי שסופק לך), number (המספר שמופיע בתשובה), ו-candidate_id (כפי שסופק לך). המספרים יהיו רציפים מ-1 ולפי סדר ההופעה הראשונה בתשובה.`;

const DRAFTER_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    answer_markdown: { type: "string", minLength: 20 },
    used_sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          ref: { type: "string" },
          number: { type: "integer", minimum: 1 },
          candidate_id: { type: "string" },
        },
        required: ["ref", "number", "candidate_id"],
        additionalProperties: false,
      },
    },
  },
  required: ["answer_markdown", "used_sources"],
  additionalProperties: false,
};

export interface DrafterInputSource {
  ref: string;
  candidate_id: string;
  /** Safe display title — used by drafter prompt + footnote renderer. */
  title: string;
  /** Raw upstream title — debug only, never user-facing. */
  raw_title: string;
  /** Display-title hygiene status (see displayTitleHygiene.ts). */
  title_status: "ok" | "fallback_junk_meta" | "fallback_truncated" | "fallback_empty" | "fallback_generic";
  title_hygiene_reasons: string[];
  url: string | null;
  source_type: string;
  role: string;
  origin: string;
  best_support: "direct" | "partial";
  supported_points: string[];
  claim_ids: string[];
  snippet: string | null;
  /** Deterministic source-integrity classification (see sourceIntegrity.ts). */
  authority_tier?: string;
  text_usability?: string;
  citable_as?: string;
  integrity_flags?: string[];
  is_judgment_document?: boolean;
  has_holding_text?: boolean;
  /** Whether the classified source can satisfy the planner role it came from. */
  can_satisfy_authority_role?: boolean;
  /** Authority-role label for case-law synthesis (see synthesisRole.ts). */
  synthesis_role?: string;
}


interface RawDraft {
  answer_markdown?: unknown;
  used_sources?: unknown;
}

import { computeDisplayTitle } from "./displayTitleHygiene.ts";
import { canSatisfyRole, classifySourceIntegrity, type SourceIntegrity } from "./sourceIntegrity.ts";
import { assignSynthesisRole } from "./synthesisRole.ts";


export function buildInputSources(
  candidates: Candidate[],
  verdicts: Verdict[],
  usable: UsableCandidate[],
  userDocs: UserDocument[],
  useAsSource: boolean,
): DrafterInputSource[] {
  const candById = new Map(candidates.map((c) => [c.candidate_id, c]));
  const verdictsByCand = new Map<string, Verdict[]>();
  for (const v of verdicts) {
    const arr = verdictsByCand.get(v.candidate_id) ?? [];
    arr.push(v);
    verdictsByCand.set(v.candidate_id, arr);
  }
  const out: DrafterInputSource[] = [];
  let n = 1;
  for (const u of usable) {
    const c = candById.get(u.candidate_id);
    if (!c) continue;
    // Source-integrity gate: index/pagination/archive-listing pages and other
    // non-citable artifacts never become citable sources for the drafter.
    const meta0 = (c.metadata ?? {}) as Record<string, unknown>;
    const integ0 =
      (meta0.source_integrity as SourceIntegrity | undefined) ??
      classifySourceIntegrity({
        url: c.source_url,
        title: c.title,
        snippet: c.snippet,
        source_type: c.source_type,
        role: c.role,
      });
    if (integ0.citable_as === "not_citable") continue;
    const vs = (verdictsByCand.get(u.candidate_id) ?? []).filter(
      (v) => v.support === "direct" || v.support === "partial",
    );
    const supported_points = Array.from(
      new Set(vs.flatMap((v) => v.supported_points).filter((p) => !!p)),
    ).slice(0, 6);

    const dt = computeDisplayTitle({
      title: c.title,
      url: c.source_url ?? null,
      source_type: c.source_type,
      origin: c.origin,
    });
    out.push({
      ref: `s${n++}`,
      candidate_id: c.candidate_id,
      title: dt.display_title,
      raw_title: dt.raw_title,
      title_status: dt.title_status,
      title_hygiene_reasons: dt.title_hygiene_reasons,
      url: c.source_url ?? null,
      source_type: c.source_type,
      role: c.role,
      origin: c.origin,
      best_support: u.best_support === "direct" ? "direct" : "partial",
      supported_points,
      claim_ids: vs.map((v) => v.claim_id),
      snippet: (c.snippet || "").replace(/\s+/g, " ").trim().slice(0, 500) || null,
      authority_tier: integ0.authority_tier,
      text_usability: integ0.text_usability,
      citable_as: integ0.citable_as,

    });

  }
  if (useAsSource) {
    for (const d of userDocs) {
      if (d.chunks.length === 0) continue;
      for (const ch of d.chunks) {
        const title = `מסמך משתמש "${d.file_name}", עמ' ${ch.page} (צורף על־ידי המשתמש).`;
        out.push({
          ref: ch.ref, // e.g. u1p3
          candidate_id: `user:${d.id}:p${ch.page}`,
          title,
          raw_title: title,
          title_status: "ok",
          title_hygiene_reasons: [],
          url: d.signed_url,
          source_type: "user_document",
          role: "user_document",
          origin: "user_upload",
          best_support: "direct",
          supported_points: [ch.text.replace(/\s+/g, " ").slice(0, 220)],
          claim_ids: [],
          snippet: ch.text.replace(/\s+/g, " ").trim().slice(0, 500) || null,
        });
      }
    }
  }
  return out;
}

function buildUserMessage(
  question: string,
  claims: Claim[],
  sources: DrafterInputSource[],
  userDocs: UserDocument[],
  useAsSource: boolean,
): string {
  const lines: string[] = [];
  lines.push(`שאלת המשתמש: ${question}`);
  lines.push("");
  lines.push("טענות (לשימוש פנימי בלבד — אין להזכיר את מזהי הטענות בתשובה):");
  for (const cl of claims) {
    lines.push(
      `- (${cl.claim_id}) ${cl.text_he} [is_black_letter=${cl.is_black_letter}]`,
    );
  }
  lines.push("");
  lines.push(`מקורות זמינים (${sources.length}) — השתמש אך ורק בהם:`);
  for (const s of sources) {
    lines.push("---");
    lines.push(`ref: ${s.ref}`);
    lines.push(`candidate_id: ${s.candidate_id}`);
    lines.push(`title: ${s.title}`);
    if (s.url) lines.push(`url: ${s.url}`);
    lines.push(`source_type: ${s.source_type} | role: ${s.role} | origin: ${s.origin}`);
    lines.push(`support: ${s.best_support}`);
    if (s.supported_points.length) {
      lines.push(`supported_points:`);
      for (const p of s.supported_points) lines.push(`  • ${p}`);
    }
    if (s.snippet) lines.push(`snippet: ${s.snippet}`);
  }
  // Soft context: attached docs are background only, not citable.
  if (!useAsSource && userDocs.some((d) => d.chunks.length > 0)) {
    lines.push("");
    lines.push("הקשר רך מהמסמכים שצירף המשתמש (לרקע בלבד — אסור לצטט מהם ואסור להוסיף להם הערות שוליים):");
    for (const d of userDocs) {
      for (const ch of d.chunks) {
        lines.push("---");
        lines.push(`קובץ: ${d.file_name} | עמ' ${ch.page}`);
        lines.push(ch.text.slice(0, 1500));
      }
    }
  }
  lines.push("");
  lines.push(
    "כתוב תשובה משפטית בעברית טבעית ומדויקת, מבוססת אך ורק על המקורות שסופקו, עם הערות שוליים בכתב עילי. התאם את מבנה התשובה לאופי השאלה, ושמור על כתיבה רציפה וקוהרנטית. מספר אך ורק מקורות שאתה באמת מצטט.",
  );
  return lines.join("\n");
}

interface ParsedDraft {
  ok: boolean;
  answer_markdown: string;
  used_sources: Array<{ ref: string; number: number; candidate_id: string }>;
  errors: string[];
}

function validateDraftShape(
  raw: unknown,
  inputSources: DrafterInputSource[],
): ParsedDraft {
  const errors: string[] = [];
  const r = (raw ?? {}) as RawDraft;
  const answer = typeof r.answer_markdown === "string" ? r.answer_markdown : "";
  if (answer.length < 20) errors.push("answer_markdown too short");
  const refSet = new Set(inputSources.map((s) => s.ref));
  const candByRef = new Map(inputSources.map((s) => [s.ref, s.candidate_id]));
  const arr = Array.isArray(r.used_sources) ? r.used_sources : [];
  const used: Array<{ ref: string; number: number; candidate_id: string }> = [];
  const seenRef = new Set<string>();
  for (const item of arr) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const ref = typeof obj.ref === "string" ? obj.ref : "";
    const number = typeof obj.number === "number" ? Math.floor(obj.number) : NaN;
    const cid = typeof obj.candidate_id === "string" ? obj.candidate_id : "";
    if (!ref || !refSet.has(ref)) {
      errors.push(`unknown ref: ${ref}`);
      continue;
    }
    if (seenRef.has(ref)) {
      errors.push(`duplicate ref: ${ref}`);
      continue;
    }
    if (!Number.isFinite(number) || number < 1) {
      errors.push(`bad number for ${ref}`);
      continue;
    }
    const expectedCid = candByRef.get(ref);
    const finalCid = expectedCid || cid;
    seenRef.add(ref);
    used.push({ ref, number, candidate_id: finalCid });
  }
  if (used.length === 0) errors.push("no used_sources");
  return { ok: errors.length === 0, answer_markdown: answer, used_sources: used, errors };
}

function runMarkerValidation(
  answer: string,
  used: Array<{ ref: string; number: number; candidate_id: string }>,
): MarkerValidation {
  const markers = extractMarkers(answer);
  const markerSet = new Set(markers);
  const numberSet = new Set(used.map((u) => u.number));
  const unused_sources: number[] = [];
  for (const n of numberSet) if (!markerSet.has(n)) unused_sources.push(n);
  const missing_sources: number[] = [];
  for (const n of markerSet) if (!numberSet.has(n)) missing_sources.push(n);
  const leak = detectInternalIdLeak(answer);
  return {
    ok: unused_sources.length === 0 && missing_sources.length === 0 && !leak.leak,
    markers_in_answer: Array.from(markerSet).sort((a, b) => a - b),
    unused_sources: unused_sources.sort((a, b) => a - b),
    missing_sources: missing_sources.sort((a, b) => a - b),
    internal_id_leak: leak.leak,
    leaked_tokens: leak.tokens,
    repaired: false,
  };
}

// ─── Placement validator (Phase A) ─────────────────────────────────────────
// Pure read-only. Detects three issues:
//   1. Adjacent superscript runs on the same token (¹², ¹²³…).
//   2. First-appearance order not strictly 1,2,3,…
//   3. End-of-paragraph dumps: ≥3 distinct first-appearance markers in the
//      last sentence of any paragraph.
export function validatePlacement(answer: string): import("../lib/types.ts").PlacementReport {
  // 1. Clusters: runs of ≥2 superscript digits with no non-superscript char between.
  const clusterRe = /[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/gu;
  let cluster_count = 0;
  let cluster_run_count = 0;
  let max_cluster_len = 0;
  const cluster_samples: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = clusterRe.exec(answer)) !== null) {
    cluster_count += m[0].length - 1;
    cluster_run_count++;
    if (m[0].length > max_cluster_len) max_cluster_len = m[0].length;
    if (cluster_samples.length < 5) {
      const s = Math.max(0, m.index - 20);
      const e = Math.min(answer.length, m.index + m[0].length + 20);
      cluster_samples.push(answer.slice(s, e));
    }
  }

  // 2. Out-of-order: collect first-appearance sequence of markers.
  const firstOrder: number[] = [];
  const seen = new Set<number>();
  for (const ch of answer) {
    const d = SUP_TO_DIGIT[ch];
    if (d === undefined) continue;
    const n = Number(d);
    if (n < 1) continue;
    if (!seen.has(n)) {
      seen.add(n);
      firstOrder.push(n);
    }
  }
  let out_of_order_count = 0;
  let maxSoFar = 0;
  for (const n of firstOrder) {
    if (n < maxSoFar) out_of_order_count++;
    else if (n > maxSoFar) maxSoFar = n;
  }

  // 3. End-paragraph dumps: split on blank lines, look at the tail of each.
  let end_paragraph_dump_count = 0;
  const end_dump_samples: string[] = [];
  const paragraphs = answer.split(/\n\s*\n+/);
  const firstAppearancePos = new Map<number, number>();
  {
    const seen2 = new Set<number>();
    for (let idx = 0; idx < answer.length; idx++) {
      const d = SUP_TO_DIGIT[answer[idx]];
      if (d === undefined) continue;
      const n = Number(d);
      if (n < 1 || seen2.has(n)) continue;
      seen2.add(n);
      firstAppearancePos.set(n, idx);
    }
  }
  let paraOffset = 0;
  for (const para of paragraphs) {
    const sentences = para.split(/(?<=[\.!?׃])\s+/u).filter((s) => s.trim().length > 0);
    const tail = sentences.length ? sentences[sentences.length - 1] : "";
    if (tail) {
      const tailStartInAnswer = paraOffset + para.lastIndexOf(tail);
      const newMarkersInTail = new Set<number>();
      for (let i = 0; i < tail.length; i++) {
        const d = SUP_TO_DIGIT[tail[i]];
        if (d === undefined) continue;
        const n = Number(d);
        if (n < 1) continue;
        const firstPos = firstAppearancePos.get(n);
        if (firstPos !== undefined && firstPos >= tailStartInAnswer) {
          newMarkersInTail.add(n);
        }
      }
      if (newMarkersInTail.size >= 3) {
        end_paragraph_dump_count++;
        if (end_dump_samples.length < 3) end_dump_samples.push(tail.slice(0, 200));
      }
    }
    paraOffset += para.length + 2;
  }

  // Final paragraph marker counts (distinct markers, regardless of first-appearance).
  const distinctMarkersIn = (s: string): Set<number> => {
    const out = new Set<number>();
    for (const ch of s) {
      const d = SUP_TO_DIGIT[ch];
      if (d === undefined) continue;
      const n = Number(d);
      if (n >= 1) out.add(n);
    }
    return out;
  };
  const finalPara = paragraphs.length ? paragraphs[paragraphs.length - 1] : "";
  const finalSentences = finalPara
    .split(/(?<=[\.!?׃])\s+/u)
    .filter((s) => s.trim().length > 0);
  const finalLast = finalSentences.length ? finalSentences[finalSentences.length - 1] : "";
  const final_paragraph_marker_count = distinctMarkersIn(finalPara).size;
  const final_paragraph_last_sentence_marker_count = distinctMarkersIn(finalLast).size;
  const final_summary_dump =
    final_paragraph_marker_count >= 5 || final_paragraph_last_sentence_marker_count >= 5;
  const final_summary_dump_count = final_summary_dump ? 1 : 0;

  // Phase A.2: report-only count of superscript parentheses around markers.
  const parensRe = /[⁽⁾]/gu;
  const superscript_parens_count = (answer.match(parensRe) ?? []).length;

  return {
    ok: cluster_count === 0 && out_of_order_count === 0 && end_paragraph_dump_count === 0,
    cluster_count,
    cluster_samples,
    out_of_order_count,
    end_paragraph_dump_count,
    end_dump_samples,
    superscript_parens_count,
    max_cluster_len,
    cluster_run_count,
    final_paragraph_marker_count,
    final_paragraph_last_sentence_marker_count,
    final_summary_dump,
    final_summary_dump_count,
  };
}



/**
 * Deterministic, NUMBERING-ONLY repair.
 *
 * Renumber used_sources so the numeric labels match the order markers first
 * appear in answer_markdown, drop used_sources whose marker never appears,
 * and rewrite the marker characters in the answer to the new sequential
 * numbering. Does NOT add, remove, or rewrite any legal substance.
 *
 * Returns null if the marker set cannot be made consistent purely by
 * renumbering (e.g. there are markers in the answer that map to no
 * used_source at all — that requires the LLM to redo it).
 */
function deterministicRepair(
  answer: string,
  used: Array<{ ref: string; number: number; candidate_id: string }>,
): {
  answer_markdown: string;
  used_sources: Array<{ ref: string; number: number; candidate_id: string }>;
} | null {
  const oldNumToRef = new Map<number, string>();
  for (const u of used) oldNumToRef.set(u.number, u.ref);

  // Walk answer, collect markers in order, ensure each maps to a known used_source.
  const firstOrder: number[] = []; // original numbers in first-appearance order
  const seen = new Set<number>();
  const positions: Array<{ start: number; end: number; oldNum: number }> = [];
  let i = 0;
  while (i < answer.length) {
    const d = SUP_TO_DIGIT[answer[i]];
    if (d === undefined) {
      i++;
      continue;
    }
    // P5.1a: one superscript char == one marker. ¹² => [1, 2], not 12.
    const start = i;
    const end = i + 1;
    const n = Number(d);
    i = end;
    if (!Number.isFinite(n) || n < 1) continue;
    if (!oldNumToRef.has(n)) return null; // marker with no source → cannot mechanically fix
    if (!seen.has(n)) {
      seen.add(n);
      firstOrder.push(n);
    }
    positions.push({ start, end, oldNum: n });
  }
  if (positions.length === 0) return null;

  // New numbering: 1..k in the order of first appearance.
  const oldToNew = new Map<number, number>();
  firstOrder.forEach((oldN, idx) => oldToNew.set(oldN, idx + 1));

  // Rewrite answer markers right-to-left to keep indices stable.
  let newAnswer = answer;
  for (let p = positions.length - 1; p >= 0; p--) {
    const { start, end, oldNum } = positions[p];
    const newNum = oldToNew.get(oldNum)!;
    newAnswer = newAnswer.slice(0, start) + toSuperscript(newNum) + newAnswer.slice(end);
  }

  // Rebuild used_sources in new order; drop unused entirely.
  const usedByOld = new Map(used.map((u) => [u.number, u]));
  const newUsed: Array<{ ref: string; number: number; candidate_id: string }> = [];
  firstOrder.forEach((oldN, idx) => {
    const u = usedByOld.get(oldN);
    if (!u) return;
    newUsed.push({ ref: u.ref, number: idx + 1, candidate_id: u.candidate_id });
  });

  return { answer_markdown: newAnswer, used_sources: newUsed };
}


// ─── Deterministic citation cleanup (Phase 1 + Phase 2 + cluster telemetry) ─
// Always-on, post-validation, no LLM. Never adds/removes/moves markers across
// words. Rolls back to the pre-cleanup state if marker_validation fails.
function firstAppearanceOrder(text: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const ch of text) {
    const d = SUP_TO_DIGIT[ch];
    if (d === undefined) continue;
    const n = Number(d);
    if (n < 1 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function applyCitationCleanup(
  answer: string,
  used: Array<{ ref: string; number: number; candidate_id: string }>,
): {
  answer: string;
  used: Array<{ ref: string; number: number; candidate_id: string }>;
  report: import("../lib/types.ts").CitationCleanupReport;
} {
  const beforeOrder = firstAppearanceOrder(answer);

  // ── Phase 1: chronological renumbering (always attempt) ──
  let phase1: import("../lib/types.ts").CitationCleanupReport["phase1"] = {
    applied: false,
    changed: false,
    before_order: beforeOrder,
    after_order: beforeOrder,
  };
  let curAnswer = answer;
  let curUsed = used;

  if (beforeOrder.length === 0) {
    phase1.discarded_reason = "no_markers";
  } else {
    const fix = deterministicRepair(answer, used);
    if (fix) {
      const v = runMarkerValidation(fix.answer_markdown, fix.used_sources);
      if (v.ok) {
        curAnswer = fix.answer_markdown;
        curUsed = fix.used_sources;
        phase1 = {
          applied: true,
          changed: fix.answer_markdown !== answer,
          before_order: beforeOrder,
          after_order: firstAppearanceOrder(fix.answer_markdown),
        };
      } else {
        phase1.discarded_reason = "marker_validation_failed";
      }
    } else {
      phase1.discarded_reason = "marker_validation_failed";
    }
  }

  // ── Phase 2: punctuation normalization (marker ↔ adjacent ASCII punctuation) ──
  let phase2: import("../lib/types.ts").CitationCleanupReport["phase2"] = {
    applied: false,
    punct_swaps: 0,
  };
  const PUNCT_RE = /([⁰¹²³⁴⁵⁶⁷⁸⁹])([.,;:?!])/gu;
  let swaps = 0;
  let next = curAnswer;
  let prev: string;
  do {
    prev = next;
    next = next.replace(PUNCT_RE, (_m, sup, p) => {
      swaps++;
      return p + sup;
    });
  } while (next !== prev);

  if (swaps > 0) {
    const v = runMarkerValidation(next, curUsed);
    if (v.ok) {
      curAnswer = next;
      phase2 = { applied: true, punct_swaps: swaps };
    } else {
      phase2 = {
        applied: false,
        punct_swaps: swaps,
        discarded_reason: "marker_validation_failed",
      };
    }
  }

  // ── Cluster telemetry (detection only) ──
  const CLUSTER_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/gu;
  const examples: Array<{ run: string; index: number; context: string }> = [];
  let count = 0;
  let cm: RegExpExecArray | null;
  while ((cm = CLUSTER_RE.exec(curAnswer)) !== null) {
    count++;
    if (examples.length < 5) {
      const s = Math.max(0, cm.index - 12);
      const e = Math.min(curAnswer.length, cm.index + cm[0].length + 12);
      examples.push({ run: cm[0], index: cm.index, context: curAnswer.slice(s, e) });
    }
  }

  return {
    answer: curAnswer,
    used: curUsed,
    report: { phase1, phase2, clusters: { count, examples } },
  };
}








export interface DrafterResult {
  ok: boolean;
  ms: number;
  model_initial: string;
  model_final: string;
  escalated: boolean;
  sources_passed: number;
  sources_used: number;
  answer_markdown: string;
  used_sources: UsedSource[];
  footnotes: Footnote[];
  marker_validation: MarkerValidation;
  marker_format: MarkerFormat;
  omitted_candidate_ids: string[];
  stage_runs: StageRun[];
  error?: string;
  raw_text?: string;
  internal_id_scrub?: {
    attempted: boolean;
    accepted: boolean;
    patterns: string[];
    rejected_reason?:
      | "no_pattern_matched"
      | "marker_validation_failed"
      | "residual_leak"
      | "marker_count_changed";
  };
}

export async function runDrafter(
  question: string,
  claims: Claim[],
  candidates: Candidate[],
  verifier: { usable: UsableCandidate[]; verdicts: Verdict[] },
  opts?: {
    userDocs?: UserDocument[];
    useAsSource?: boolean;
  },
): Promise<DrafterResult> {
  const t_total = Date.now();
  const stage_runs: StageRun[] = [];


  const userDocs = opts?.userDocs ?? [];
  const useAsSource = opts?.useAsSource ?? false;

  const inputSources = buildInputSources(
    candidates,
    verifier.verdicts,
    verifier.usable,
    userDocs,
    useAsSource,
  );
  const sources_passed = inputSources.length;

  if (sources_passed === 0) {
    return {
      ok: false,
      ms: Date.now() - t_total,
      model_initial: MODEL_MINI,
      model_final: MODEL_MINI,
      escalated: false,
      sources_passed: 0,
      sources_used: 0,
      answer_markdown: "",
      used_sources: [],
      footnotes: [],
      marker_validation: {
        ok: false,
        markers_in_answer: [],
        unused_sources: [],
        missing_sources: [],
        internal_id_leak: false,
        leaked_tokens: [],
        repaired: false,
        error: "no_usable_candidates",
      },
      marker_format: "legacy_superscript",
      omitted_candidate_ids: [],
      stage_runs,
      error: "no_usable_candidates",
    };
  }

  const userMsg = buildUserMessage(question, claims, inputSources, userDocs, useAsSource);
  const tool = {
    name: "emit_draft",
    description: "Emit the Hebrew legal answer with footnote markers and used_sources list.",
    parameters: DRAFTER_TOOL_PARAMETERS,
  };

  // Scrub telemetry (populated when C# leak triggers narrow cleanup).
  let scrub_attempted = false;
  let scrub_accepted = false;
  let scrub_patterns: string[] = [];
  let scrub_rejected_reason:
    | "no_pattern_matched"
    | "marker_validation_failed"
    | "residual_leak"
    | "marker_count_changed"
    | undefined;

  const systemPrompt = SYSTEM_PROMPT;

  // Attempt 1: gpt-5-mini
  const t0 = Date.now();
  let modelUsed = MODEL_MINI;
  let escalated = false;
  let resp = await callOpenAIJsonTool<unknown>({
    model: MODEL_MINI,
    system: systemPrompt,
    user: userMsg,
    tool,
  });
  stage_runs.push({
    stage: "drafter.initial",
    model: MODEL_MINI,
    ms: Date.now() - t0,
    ok: !!resp.data,
  });

  let parsed = validateDraftShape(resp.data, inputSources);
  let answer = parsed.answer_markdown;
  let used = parsed.used_sources;
  let marker = parsed.ok
    ? runMarkerValidation(answer, used)
    : ({
        ok: false,
        markers_in_answer: [],
        unused_sources: [],
        missing_sources: [],
        internal_id_leak: false,
        leaked_tokens: [],
        repaired: false,
        error: parsed.errors.join("; "),
      } as MarkerValidation);

  // Deterministic numbering repair (NEVER rewrites legal substance).
  let repaired = false;
  if (parsed.ok && !marker.ok && !marker.internal_id_leak) {
    const fix = deterministicRepair(answer, used);
    if (fix) {
      answer = fix.answer_markdown;
      used = fix.used_sources;
      const m2 = runMarkerValidation(answer, used);
      if (m2.ok) {
        marker = { ...m2, repaired: true };
        repaired = true;
      }
    }
  }

  // Narrow C# scrub before escalation — saves the ~133s gpt-5 round trip
  // when the only failure is leaked claim-label scaffolding.
  if (
    parsed.ok && !marker.ok && marker.internal_id_leak &&
    marker.leaked_tokens.length === 1 && marker.leaked_tokens[0] === "C#"
  ) {
    const scrub = scrubInternalClaimLabels(answer);
    scrub_attempted = true;
    scrub_patterns = scrub.patterns;
    if (!scrub.changed) {
      scrub_rejected_reason = "no_pattern_matched";
    } else {
      const candidate = scrub.text;
      const prevMarkers = extractMarkers(answer).length;
      const m2 = runMarkerValidation(candidate, used);
      if (!m2.ok) {
        scrub_rejected_reason = "marker_validation_failed";
      } else if (m2.internal_id_leak) {
        scrub_rejected_reason = "residual_leak";
      } else if (extractMarkers(candidate).length !== prevMarkers) {
        scrub_rejected_reason = "marker_count_changed";
      } else {
        answer = candidate;
        marker = { ...m2, repaired: true };
        scrub_accepted = true;
      }
    }
  }

  // Escalate once to gpt-5 if still broken.
  if (!parsed.ok || !marker.ok) {
    escalated = true;
    modelUsed = MODEL_FULL;
    const t1 = Date.now();
    resp = await callOpenAIJsonTool<unknown>({
      model: MODEL_FULL,
      system: systemPrompt,
      user: userMsg,
      tool,
    });
    stage_runs.push({
      stage: "drafter.escalated",
      model: MODEL_FULL,
      ms: Date.now() - t1,
      ok: !!resp.data,
      escalated: true,
    });
    parsed = validateDraftShape(resp.data, inputSources);
    answer = parsed.answer_markdown;
    used = parsed.used_sources;
    marker = parsed.ok
      ? runMarkerValidation(answer, used)
      : ({
          ok: false,
          markers_in_answer: [],
          unused_sources: [],
          missing_sources: [],
          internal_id_leak: false,
          leaked_tokens: [],
          repaired: false,
          error: parsed.errors.join("; "),
        } as MarkerValidation);
    repaired = false;
    if (parsed.ok && !marker.ok && !marker.internal_id_leak) {
      const fix = deterministicRepair(answer, used);
      if (fix) {
        answer = fix.answer_markdown;
        used = fix.used_sources;
        const m2 = runMarkerValidation(answer, used);
        if (m2.ok) {
          marker = { ...m2, repaired: true };
          repaired = true;
        }
      }
    }

    // Final scrub safety net (after escalation): same narrow C# cleanup.
    if (
      !scrub_accepted &&
      parsed.ok && !marker.ok && marker.internal_id_leak &&
      marker.leaked_tokens.length === 1 && marker.leaked_tokens[0] === "C#"
    ) {
      const scrub = scrubInternalClaimLabels(answer);
      scrub_attempted = true;
      scrub_patterns = scrub.patterns;
      scrub_rejected_reason = undefined;
      if (!scrub.changed) {
        scrub_rejected_reason = "no_pattern_matched";
      } else {
        const candidate = scrub.text;
        const prevMarkers = extractMarkers(answer).length;
        const m2 = runMarkerValidation(candidate, used);
        if (!m2.ok) {
          scrub_rejected_reason = "marker_validation_failed";
        } else if (m2.internal_id_leak) {
          scrub_rejected_reason = "residual_leak";
        } else if (extractMarkers(candidate).length !== prevMarkers) {
          scrub_rejected_reason = "marker_count_changed";
        } else {
          answer = candidate;
          marker = { ...m2, repaired: true };
          scrub_accepted = true;
        }
      }
    }
  }

  // ─── Citation cleanup (Phase 1 chronological + Phase 2 punctuation + cluster telemetry) ───
  // Deterministic, no LLM. Runs only when the draft already validates; any
  // sub-phase that would break marker_validation is rolled back individually.
  if (parsed.ok && marker.ok) {
    const cleanup = applyCitationCleanup(answer, used);
    answer = cleanup.answer;
    used = cleanup.used;
    const m2 = runMarkerValidation(answer, used);
    // m2.ok must remain true by construction (each phase self-validates).
    marker = {
      ...m2,
      repaired: marker.repaired || cleanup.report.phase1.changed || cleanup.report.phase2.applied,
      placement: marker.placement,
      citation_cleanup: cleanup.report,
    };
  }

  // ─── Phase D: placement telemetry (read-only, no repair, no LLM call) ───
  // We record placement metrics for observability only. Placement is never
  // gated, never blocked, never rewritten. Aesthetics-only repairs were
  // removed because they cost ~136s on gpt-5 without affecting correctness.
  // (Placement is recomputed once below, after Phase 3 may have rewritten answer.)

  // Build UsedSource + Footnote outputs from inputSources × used.
  const inputByRef = new Map(inputSources.map((s) => [s.ref, s]));
  let used_sources: UsedSource[] = used
    .map((u) => {
      const s = inputByRef.get(u.ref);
      if (!s) return null;
      return {
        candidate_id: s.candidate_id,
        number: u.number,
        title: s.title,
        url: s.url,
        source_type: s.source_type,
        origin: s.origin as UsedSource["origin"],
      };
    })
    .filter((x): x is UsedSource => x !== null)
    .sort((a, b) => a.number - b.number);
  let footnotes: Footnote[] = used_sources.map((u) => ({
    number: u.number,
    title: u.title,
    url: u.url,
    source_type: u.source_type,
  }));

  // Placement telemetry (read-only) on the final answer.
  if (parsed.ok && marker.ok) {
    marker.placement = validatePlacement(answer);
  }

  const usedCandIds = new Set(used_sources.map((u) => u.candidate_id));
  const omitted_candidate_ids = inputSources
    .filter((s) => !usedCandIds.has(s.candidate_id))
    .map((s) => s.candidate_id);

  if (repaired) marker.repaired = true;

  const ok = parsed.ok && marker.ok;

  const marker_format: MarkerFormat = "legacy_superscript";

  return {
    ok,
    ms: Date.now() - t_total,
    model_initial: MODEL_MINI,
    model_final: modelUsed,
    escalated,
    sources_passed,
    sources_used: used_sources.length,
    answer_markdown: answer,
    used_sources,
    footnotes,
    marker_validation: marker,
    marker_format,
    omitted_candidate_ids,
    stage_runs,
    error: ok ? undefined : (marker.error || parsed.errors.join("; ") || "drafter_failed"),
    raw_text: ok ? undefined : (resp.raw_text || "").slice(0, 1000),
    internal_id_scrub: scrub_attempted
      ? {
          attempted: true,
          accepted: scrub_accepted,
          patterns: scrub_patterns,
          rejected_reason: scrub_accepted ? undefined : scrub_rejected_reason,
        }
      : undefined,
  };
}
