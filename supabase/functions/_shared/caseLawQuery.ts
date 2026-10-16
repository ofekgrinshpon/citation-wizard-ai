// Court-aware case-number search prompts for citation-chat.
// פ"ד (פסקי דין) is the printed series of the Supreme Court only, so the
// "check פ"ד first" instruction is sent only for Supreme dockets.

export type DocketCourt = "supreme" | "lower" | "district_historic" | "unknown";

/** Any non-Supreme trial/appeal court (modern or historic). פ"ד never applies. */
export const isLowerCourt = (c: DocketCourt) => c === "lower" || c === "district_historic";

// Magistrate-only prefixes: never printed in פ"מ.
const MAGISTRATE_ONLY = ['תא"מ', 'תא"ק', 'ת"ק'];

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
  if (LOW.has(t)) {
    // Two-part docket filed before 2007 may be a district judgment printed in פ"מ.
    const m = caseNum.match(/^\s*\d+\s*\/\s*(\d{2}|\d{4})\s*$/);
    if (m && !new Set(MAGISTRATE_ONLY.map(norm)).has(t)) {
      const y = m[1].length === 4 ? +m[1] : (+m[1] >= 40 ? 1900 + +m[1] : 2000 + +m[1]);
      if (y < 2007) return "district_historic";
    }
    return "lower";
  }
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
  if (court === "district_historic") {
    return `מצא את פסק הדין הישראלי ${ref}.${bare} זהו תיק ישן של ערכאה דיונית — הוא אינו מתפרסם בפד"י (סדרת העליון בלבד). אם ניתן בבית משפט מחוזי, בדוק תחילה האם פורסם בפ"מ (פסקי דין מחוזיים) — חפש את מספר התיק יחד עם "פ"מ" וכרך. אם לא פורסם בפ"מ, ציין באיזה מאגר אלקטרוני (נבו/תקדין/פסקדין). ציין: 1) שמות הצדדים (שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים), 2) תאריך מתן פסק הדין (יום.חודש.שנה), 3) שם בית המשפט, 4) סוג ההליך (caseType) בקיצור הרשמי, 5) פרסום בפ"מ (כרך, חלק, עמוד) או שם המאגר. ענה בעברית בלבד.`;
  }
  if (court === "supreme") {
    return `מצא את פסק הדין הישראלי ${ref}.${bare} זהה את פסק הדין לפי מספר התיק המדויק, ואז בדוק האם פורסם בפד"י (פסקי דין של בית המשפט העליון); אם לא פורסם בפד"י, ציין באיזה מאגר אלקטרוני (נבו/תקדין/פסקדין). ציין: 1) שמות הצדדים (שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים), 2) תאריך מתן פסק הדין (יום.חודש.שנה), 3) שם בית המשפט, 4) סוג ההליך (caseType) בקיצור הרשמי, 5) פרסום בפד"י: כרך, חלק ועמוד ראשון. ענה בעברית בלבד.`;
  }
  // unknown — legacy wording, unchanged
  return `מצא את פסק הדין הישראלי ${ref}.${bare} חשוב מאוד: בדוק קודם כל האם פסק הדין פורסם בפד"י (פסקי דין של בית המשפט העליון). חפש את מספר התיק יחד עם המילה "פ"ד" וכרך. רק אם וידאת שהוא לא מופיע בפד"י, ציין באיזה מאגר (נבו/תקדין/פסקדין). ציין: 1) שמות הצדדים (שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים), 2) תאריך מתן פסק הדין (יום.חודש.שנה), 3) שם בית המשפט, 4) סוג ההליך (caseType) בקיצור הרשמי, 5) פרסום בפד"י: כרך, חלק ועמוד ראשון. ענה בעברית בלבד.`;
}

// No site-specific search tip: the old lite.takdin hint funnelled the model to
// generic search-landing pages and starved case-specific results.
const SYS_HEAD = `אתה עוזר מחקר משפטי ישראלי. החזר תשובה בפורמט JSON בלבד.`;
const SYS_PADI = `
חשוב ביותר: עדיפות ראשונה היא לבדוק פרסום בפד"י (פסקי דין). רוב פסקי הדין של בית המשפט העליון פורסמו בפד"י. אל תסתמך רק על מאגרי מידע אלקטרוניים - חפש במיוחד אם יש ציון "פ"ד" עם כרך ועמוד.
סמן isPublished: false רק אם חיפשת במפורש פרסום בפד"י ווידאת שהוא לא קיים.`;
const SYS_LOWER = `
זהו תיק של ערכאה דיונית: פד"י הוא סדרת פסקי הדין של בית המשפט העליון בלבד, ולכן isPublished תמיד false ושדות padi ריקים. חפש את המאגר האלקטרוני (נבו/תקדין/פסקדין) ואת תאריך מתן פסק הדין.`;
const SYS_DISTRICT_HISTORIC = `
זהו תיק ישן של ערכאה דיונית: פד"י הוא סדרת העליון בלבד, ולכן isPublished תמיד false ושדות padi ריקים. אם פסק הדין מחוזי ופורסם בפ"מ (פסקי דין מחוזיים), כתוב ב-databaseName את ההפניה המלאה, למשל: פ"מ התשנ"ה(2) 89. רק אם ראית במפורש "פ"מ" עם כרך ועמוד יחד עם מספר התיק. אחרת — שם המאגר האלקטרוני (נבו/תקדין/פסקדין).`;
const SYS_TAIL = `
הפורמט:
{"found":true/false,"caseType":"קיצור סוג ההליך","party1":"שם צד א","party2":"שם צד ב","date":"DD.MM.YYYY","court":"בית המשפט","isPublished":true/false,"padi_volume":"כרך","padi_part":"חלק","padi_page":"עמוד","databaseName":"שם מאגר","year":"YYYY","confidence":"high/low"}
שמות צדדים: שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים. ללא תארים.
caseType: הקיצור הרשמי של סוג ההליך לפי כללי האזכור האחיד (בג"ץ, ע"א, רע"א, ע"פ, עת"מ וכו'). אם לא אומת — השאר ריק.
אסור להחזיר פסק דין שמספר התיק שלו שונה ממספר התיק שהתבקש. אם לא מצאת את מספר התיק המדויק — החזר found:false.
תוצאת חיפוש שבה מופיע מספר התיק המדויק יחד עם שמות הצדדים (גם באתר שאינו מאגר משפטי, למשל מאמר או קובץ PDF) נחשבת זיהוי של התיק — חלץ ממנה את הפרטים, החזר found:true וסמן confidence:"low".
confidence: "high" אם מצאת מידע מפורש ומוסכם ממקורות רבים, "low" אם יש ספק או מקור יחיד.
חשוב: שדה year/date חייב להיות תאריך/שנת מתן פסק הדין על ידי בית המשפט, ולא שנת הוצאת כרך פ"ד.`;

export function buildCaseSystemPrompt(court: DocketCourt): string {
  return SYS_HEAD + (court === "lower" ? SYS_LOWER : court === "district_historic" ? SYS_DISTRICT_HISTORIC : SYS_PADI) + SYS_TAIL;
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

/** Unanchored follow-up needs two real (≥2 char) candidate party names. */
export function shouldRunUnanchoredFollowup(c: { party1: string; party2: string } | null | undefined): boolean {
  if (!c) return false;
  const ok = (s: string) => typeof s === "string" && s.trim().length >= 2;
  return ok(c.party1) && ok(c.party2);
}

export function buildPartyFollowupQuery(caseType: string, caseNum: string, party1: string, party2: string, court: DocketCourt): string {
  const ref = `${caseType} ${caseNum}`.trim();
  const where = court === "district_historic"
    ? `האם פורסם בפ"מ (פסקי דין מחוזיים; כרך, חלק, עמוד) ואם לא — באיזה מאגר אלקטרוני (נבו/תקדין/פסקדין)`
    : court === "lower"
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
  if (!isLowerCourt(court) && !parsed.isPublished && extra.isPublished === true && s(extra.padi_volume)) {
    parsed.isPublished = true;
    parsed.padi_volume = s(extra.padi_volume);
    parsed.padi_part = s(extra.padi_part);
    parsed.padi_page = s(extra.padi_page);
    filled.push("padi");
  }
  return filled;
}

/** Source label used when facts are proven only by an exact non-trusted snippet. */
/** True when databaseName holds a printed פ"מ reference (must not be replaced by URL normalisation). */
export const isPrintedDistrictRef = (v: unknown) => typeof v === "string" && /^\s*פ["\u05F4]מ\s/.test(v);

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
  // Normalised matching: real snippets vary in case ("storck kG"), quote
  // style (בע"מ / בע״מ) and corporate suffixes. The docket anchor itself
  // stays exact; only party-name comparison is normalised.
  const n = (s: unknown) => (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
  const normTxt = (s: string) =>
    n(s).normalize("NFKC")
      .replace(/[״“”"]/g, '"').replace(/[׳‘’']/g, "'")
      .toLowerCase();
  const partyCore = (s: string) =>
    normTxt(s)
      .replace(/בע["']מ/g, " ")
      .replace(/\b(kg|gmbh|ltd|llc|inc|co)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const variants = (p: string): string[] => {
    const full = normTxt(p);
    const core = partyCore(p);
    return core.length >= 4 && core !== full ? [full, core] : [full];
  };
  // RTL pages often reverse Latin word order ("KG Storck August"), so a party
  // also matches when EVERY significant token of its core appears in the
  // window, regardless of order. The exact-docket anchor keeps this safe.
  const tokens = (p: string): string[] =>
    partyCore(p).split(" ").filter((t) => t.length >= 2);
  const v1 = variants(party1).filter((v) => v.length >= 3);
  const v2 = variants(party2).filter((v) => v.length >= 3);
  const t1 = tokens(party1), t2 = tokens(party2);
  if ((!v1.length && !t1.length) || (!v2.length && !t2.length)) return null;
  const hasParty = (win: string, vs: string[], ts: string[]) =>
    vs.some((v) => win.includes(v)) || (ts.length > 0 && ts.every((t) => win.includes(t)));
  for (const r of results) {
    if (typeof r.url !== "string") continue;
    const raw = `${n(r.title)} ${n(r.snippet)}`;
    const txt = normTxt(raw);
    for (const at of matchDocket(raw)) {
      // Recompute the window in the normalised text around the docket: the
      // docket pattern is separator-tolerant, so locate it again in txt.
      const winRaw = raw.slice(Math.max(0, at - windowChars), at + windowChars + 40);
      const win = normTxt(winRaw);
      if (hasParty(win, v1, t1) && hasParty(win, v2, t2)) return r.url;
    }
    // Docket may normalize differently (quote chars); also try matching in txt.
    if (matchDocket(raw).length === 0) {
      for (const at of matchDocket(txt)) {
        const win = txt.slice(Math.max(0, at - windowChars), at + windowChars + 40);
        if (hasParty(win, v1, t1) && hasParty(win, v2, t2)) return r.url;
      }
    }
  }
  return null;
}
