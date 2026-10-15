// Court-aware case-number search prompts for citation-chat.
// פ"ד (פסקי דין) is the printed series of the Supreme Court only, so the
// "check פ"ד first" instruction is sent only for Supreme dockets.

export type DocketCourt = "supreme" | "lower" | "unknown";

const norm = (s: string) => s.replace(/[\u05F4\u201C\u201D]/g, '"').replace(/[\u05F3\u2018\u2019]/g, "'").replace(/\s+/g, "").trim();

const SUPREME = ['ע"א', 'בג"ץ', 'בגץ', 'רע"א', 'ע"פ', 'רע"פ', 'דנ"א', 'דנ"פ', 'בש"א', 'בש"פ', 'עע"מ', 'רע"ב', 'בר"ם', 'דנג"ץ', 'ע"ב', 'רע"ע', 'בע"מ', 'עב"י', 'עש"מ', 'מ"ח', 'עמ"ה', 'ע"ע"א'];
const LOWER = ['עש"א', 'ת"א', 'תא"ק', 'תא"מ', 'ת"פ', 'תפ"ח', 'ע"מ', 'עמ"נ', 'עת"מ', 'עמ"ש', 'סע"ש', 'ס"ע', 'סע"ק', 'ע"ח', 'ה"פ', 'תמ"ש', 'תה"ס', 'פש"ר', 'פר"ק', 'צ"א', 'ת"ק', 'ב"ש', 'ע"ת', 'עפ"ת', 'עפ"ג', 'עא"ח', 'תנ"ג', 'ת"צ', 'בל"מ', 'ק"ג'];
const SUP = new Set(SUPREME.map(norm));
const LOW = new Set(LOWER.map(norm));

/** Three-part numbers (NUM-MM-YY) are always lower-court; otherwise decide by prefix. */
export function classifyDocketCourt(caseType: string, caseNum: string): DocketCourt {
  if (/^\s*\d+\s*[-\u2013/_]\s*\d{1,2}\s*[-\u2013/_]\s*\d{2,4}\s*$/.test(caseNum)) return "lower";
  const t = norm(caseType || "");
  if (!t) return "unknown";
  if (LOW.has(t)) return "lower";
  if (SUP.has(t)) return "supreme";
  return "unknown";
}

const BARE_PREFIX_NOTE = (caseNum: string) =>
  ` מספר התיק הוא ${caseNum} וסוג ההליך (הקידומת) לא צוין — עליך לזהות את סוג ההליך המדויק (למשל בג"ץ, ע"א, רע"א, ע"פ) עבור מספר תיק זה בדיוק. אסור להחזיר פסק דין אחר עם מספר תיק אחר.`;

export function buildCaseNumberQuery(caseType: string, caseNum: string, court: DocketCourt): string {
  const ref = `${caseType} ${caseNum}`.trim();
  const bare = caseType ? "" : BARE_PREFIX_NOTE(caseNum);
  if (court === "lower") {
    return `מצא את פסק הדין הישראלי ${ref}.${bare} זהו תיק של ערכאה דיונית (בית משפט מחוזי/שלום/בית דין) — הוא אינו מתפרסם בפד"י. ציין: 1) שמות הצדדים (שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים), 2) תאריך מתן פסק הדין (יום.חודש.שנה), 3) שם בית המשפט, 4) סוג ההליך (caseType) בקיצור הרשמי, 5) באיזה מאגר אלקטרוני הוא פורסם (נבו/תקדין/פסקדין). ענה בעברית בלבד.`;
  }
  if (court === "supreme") {
    return `מצא את פסק הדין הישראלי ${ref}.${bare} בדוק האם פסק הדין פורסם בפד"י (פסקי דין של בית המשפט העליון) — חפש את מספר התיק יחד עם "פ"ד" וכרך. אם לא פורסם בפד"י, ציין באיזה מאגר אלקטרוני (נבו/תקדין/פסקדין). ציין: 1) שמות הצדדים (שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים), 2) תאריך מתן פסק הדין (יום.חודש.שנה), 3) שם בית המשפט, 4) סוג ההליך (caseType) בקיצור הרשמי, 5) פרסום בפד"י: כרך, חלק ועמוד ראשון. ענה בעברית בלבד.`;
  }
  // unknown — legacy wording, unchanged
  return `מצא את פסק הדין הישראלי ${ref}.${bare} חשוב מאוד: בדוק קודם כל האם פסק הדין פורסם בפד"י (פסקי דין של בית המשפט העליון). חפש את מספר התיק יחד עם המילה "פ"ד" וכרך. רק אם וידאת שהוא לא מופיע בפד"י, ציין באיזה מאגר (נבו/תקדין/פסקדין). ציין: 1) שמות הצדדים (שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים), 2) תאריך מתן פסק הדין (יום.חודש.שנה), 3) שם בית המשפט, 4) סוג ההליך (caseType) בקיצור הרשמי, 5) פרסום בפד"י: כרך, חלק ועמוד ראשון. ענה בעברית בלבד.`;
}

const SYS_HEAD = `אתה עוזר מחקר משפטי ישראלי. החזר תשובה בפורמט JSON בלבד.
טיפ חיפוש: ב-https://lite.takdin.co.il/search-results מוצגים בעמוד אחד שמות הצדדים, מספר התיק, בית המשפט, תאריך פסק הדין ופרסום בפ"ד — חפש שם קודם כדי לאתר את כל הנתונים במקום אחד.`;
const SYS_PADI = `
חשוב ביותר: עדיפות ראשונה היא לבדוק פרסום בפד"י (פסקי דין). רוב פסקי הדין של בית המשפט העליון פורסמו בפד"י. אל תסתמך רק על מאגרי מידע אלקטרוניים - חפש במיוחד אם יש ציון "פ"ד" עם כרך ועמוד.
סמן isPublished: false רק אם חיפשת במפורש פרסום בפד"י ווידאת שהוא לא קיים.`;
const SYS_LOWER = `
זהו תיק של ערכאה דיונית: פד"י הוא סדרת פסקי הדין של בית המשפט העליון בלבד, ולכן isPublished תמיד false ושדות padi ריקים. חפש את המאגר האלקטרוני (נבו/תקדין/פסקדין) ואת תאריך מתן פסק הדין.`;
const SYS_TAIL = `
הפורמט:
{"found":true/false,"caseType":"קיצור סוג ההליך","party1":"שם צד א","party2":"שם צד ב","date":"DD.MM.YYYY","court":"בית המשפט","isPublished":true/false,"padi_volume":"כרך","padi_part":"חלק","padi_page":"עמוד","databaseName":"שם מאגר","year":"YYYY","confidence":"high/low"}
שמות צדדים: שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים. ללא תארים.
caseType: הקיצור הרשמי של סוג ההליך לפי כללי האזכור האחיד (בג"ץ, ע"א, רע"א, ע"פ, עת"מ וכו'). אם לא אומת — השאר ריק.
אסור להחזיר פסק דין שמספר התיק שלו שונה ממספר התיק שהתבקש. אם לא מצאת את מספר התיק המדויק — החזר found:false.
confidence: "high" אם מצאת מידע מפורש ומוסכם ממקורות רבים, "low" אם יש ספק או מקור יחיד.
חשוב: שדה year/date חייב להיות תאריך/שנת מתן פסק הדין על ידי בית המשפט, ולא שנת הוצאת כרך פ"ד.`;

export function buildCaseSystemPrompt(court: DocketCourt): string {
  return SYS_HEAD + (court === "lower" ? SYS_LOWER : SYS_PADI) + SYS_TAIL;
}

/** Follow-up fires only when parties are confirmed for the exact docket but date or source is missing. */
export function shouldRunPartyFollowup(p: {
  docketAnchored: boolean;
  partyVerification: string;
  parsed: Record<string, unknown> | null | undefined;
  alreadyRan: boolean;
}): boolean {
  if (p.alreadyRan || !p.docketAnchored || !p.parsed || !p.parsed.found) return false;
  if (p.partyVerification !== "both" && p.partyVerification !== "caption_marker") return false;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (!s(p.parsed.party1) || !s(p.parsed.party2)) return false;
  const hasSource = !!s(p.parsed.databaseName) || (p.parsed.isPublished === true && !!s(p.parsed.padi_volume));
  return !s(p.parsed.date) || !hasSource;
}

export function buildPartyFollowupQuery(caseType: string, caseNum: string, party1: string, party2: string, court: DocketCourt): string {
  const ref = `${caseType} ${caseNum}`.trim();
  const where = court === "lower"
    ? `באיזה מאגר אלקטרוני הוא פורסם (נבו/תקדין/פסקדין)`
    : `האם פורסם בפד"י (כרך, חלק, עמוד) ואם לא — באיזה מאגר אלקטרוני (נבו/תקדין/פסקדין)`;
  return `"${caseNum}" ${ref} ${party1} נ' ${party2} — מתי ניתן פסק הדין (יום.חודש.שנה) ו${where}? אסור להחזיר פרטים של תיק עם מספר אחר. ענה בעברית בלבד.`;
}

/** Fill only empty fields from the follow-up; never overwrite confirmed ones. */
export function mergeFollowupFields(parsed: Record<string, unknown>, extra: Record<string, unknown>, court: DocketCourt): string[] {
  const filled: string[] = [];
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  for (const k of ["date", "year", "court", "databaseName"]) {
    if (!s(parsed[k]) && s(extra[k])) { parsed[k] = s(extra[k]); filled.push(k); }
  }
  if (court !== "lower" && !parsed.isPublished && extra.isPublished === true && s(extra.padi_volume)) {
    parsed.isPublished = true;
    parsed.padi_volume = s(extra.padi_volume);
    parsed.padi_part = s(extra.padi_part);
    parsed.padi_page = s(extra.padi_page);
    filled.push("padi");
  }
  return filled;
}

/** Source label used when facts are proven only by an exact non-trusted snippet. */
export const SNIPPET_EVIDENCE_DB_NAME = "אר\u05F4ש";

/**
 * Option B: a non-trusted search result proves the case details only when ONE
 * result's title+snippet contains the exact docket AND both party names, each
 * within `windowChars` of that docket occurrence. Returns the matching URL.
 */
export function strictSnippetEvidence(
  results: Array<Record<string, unknown>>,
  matchDocket: (text: string) => number[],
  party1: string,
  party2: string,
  windowChars = 300,
): string | null {
  const n = (s: unknown) => (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
  const p1 = n(party1), p2 = n(party2);
  if (p1.length < 3 || p2.length < 3) return null;
  for (const r of results) {
    if (typeof r.url !== "string") continue;
    const txt = `${n(r.title)} ${n(r.snippet)}`;
    for (const at of matchDocket(txt)) {
      const win = txt.slice(Math.max(0, at - windowChars), at + windowChars);
      if (win.includes(p1) && win.includes(p2)) return r.url;
    }
  }
  return null;
}
