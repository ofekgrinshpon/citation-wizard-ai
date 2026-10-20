/**
 * Deterministic Bluebook 22 renderers (Milestone 1).
 *
 * The renderer — not the model — owns punctuation, ordering, reporter and
 * court placement, § vs §§, pinpoint placement, italics and small caps.
 *
 * Inline markers reuse the existing presentation pipeline:
 *   **bold**    ##italic##    ^^small caps^^
 * The markers are internal only and are never shown to the user.
 */

import type { ForeignPeriodicalFields } from "./types";
import { REPORTER_IMPLIES_COURT, normalizeJournalName } from "./tables";
import { citationTextOnly } from "@/lib/citationSegments";
import type {
  ForeignArticleFields,
  ForeignBookFields,
  ForeignCaseFields,
  ForeignChapterFields,
  ForeignConstitutionFields,
  ForeignInternetFields,
  ForeignStatuteFields,
  ForeignUnpublishedFields,
} from "./types";

export const SMALL_CAPS_OPEN = "^^";
export const SMALL_CAPS_CLOSE = "^^";

export const it = (s: string) => `##${s}##`;
export const sc = (s: string) => `^^${s}^^`;

/**
 * Case name in a FULL case citation (Bluebook 21 R2.1(a)): roman, including
 * "v."; only the procedural phrases "ex rel." and "In re" are italic.
 * Short forms and narrative mentions are styled by their own context.
 */
export function fullCitationCaseName(name: string): string {
  return name.replace(/(^|\s)(In re|ex rel\.)(?=\s|$)/g, (_m, pre: string, phrase: string) => `${pre}${it(phrase)}`);
}

const CAP_WORD = String.raw`[A-Z][\w.'’&-]*`;
const PARTY_CONNECTOR = String.raw`(?:of|the|for|&|ex rel\.)`;
const EMBEDDED_CASE = new RegExp(
  String.raw`((?:${CAP_WORD}\s+)*${CAP_WORD})\s+v\.\s+(${CAP_WORD}(?:\s+(?:${PARTY_CONNECTOR}\s+)*${CAP_WORD})*)`,
);

/**
 * Italic work title (article/chapter/web page). A case name inside an italic
 * title stays roman (R2.1(a)). The embedded name is reversed only when its
 * start is unambiguous: a single-word first party, or a party run that
 * follows a lowercase word / punctuation. Otherwise the title stays fully
 * italic and an honest warning asks for manual review.
 */
export function italicTitle(title: string, warnings: string[]): string {
  const m = title.match(EMBEDDED_CASE);
  if (!m || m.index === undefined) return it(title);
  const before = title.slice(0, m.index);
  const singleWordParty = !/\s/.test(m[1]);
  const anchored = before === ""
    ? singleWordParty
    : /(?:[:;,—–(]|\b[a-z][\w'’-]*)\s*$/.test(before);
  if (!anchored) {
    warnings.push("ייתכן שבכותרת מופיע שם פסק דין שצריך להופיע באותיות רגילות (R2.1(a)); לא ניתן לזהות בוודאות את גבולותיו — הכותרת נשמרה נטויה כולה ויש לבדוק ידנית.");
    return it(title);
  }
  const tail = title.slice(m.index + m[0].length);
  return `${before ? it(before) : ""}${m[0]}${tail ? it(tail) : ""}`;
}

export interface RenderResult {
  citation: string;
  warnings: string[];
  /** Required fields that were NOT supplied. */
  missing: string[];
  /**
   * Supplied information that the deterministic renderer does not structure
   * (distinct from `missing`). Either appended verbatim with a warning, or —
   * for structured fields — reported in a warning and listed here.
   */
  unrepresented?: string[];
}

function finish(parts: string, warnings: string[], missing: string[], unrepresented: string[] = []): RenderResult {
  let citation = parts.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  if (citation && !/[.]$/.test(citation)) citation += ".";
  return unrepresented.length ? { citation, warnings, missing, unrepresented } : { citation, warnings, missing };
}

/** Keep supplied-but-unstructured trailing text verbatim, with an honest warning. */
function appendRemainder(out: string, remainder: string | undefined, warnings: string[], unrep: string[]): string {
  const r = remainder?.trim();
  if (!r) return out;
  unrep.push(r.replace(/^[,;]\s*/, ""));
  warnings.push(`פרטים שסופקו נשמרו כפי שהוזנו, בלי עיצוב או אימות אוטומטי: "${r.replace(/^[,;]\s*/, "")}".`);
  return /^[,;]/.test(r) ? `${out}${r}` : `${out} ${r}`;
}

/** Report structured fields that were supplied but have no place in this template. */
function reportExtraFields(f: object, used: readonly string[], warnings: string[], unrep: string[]): void {
  const extra = Object.entries(f as Record<string, unknown>).filter(([k, v]) =>
    !used.includes(k) && k !== "multi" && k !== "unparsedRemainder" && v != null &&
    (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ""));
  if (!extra.length) return;
  const items = extra.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  unrep.push(...items);
  warnings.push(`פרטים שסופקו אינם נתמכים כרגע בתבנית זו ולא נכללו באזכור: ${items.join("; ")}.`);
}

function miss(label: string) {
  return `[חסר: ${label}]`;
}

/** Page list: first page, then pinpoint — never conflated. */
function pageSpan(firstPage?: string, pinpoint?: string): string {
  if (!firstPage) return "";
  // An explicitly supplied pinpoint is kept even when it equals the first page.
  return pinpoint ? `${firstPage}, ${pinpoint}` : firstPage;
}

// ─── Cases ────────────────────────────────────────────────────────
export function renderUsCase(f: ForeignCaseFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  const unrep: string[] = [];
  const name = f.caseName?.trim() || (missing.push("caseName"), miss("שם ההליך"));

  if (f.opinionFormat || (!(f.volume && f.reporter && f.firstPage) && f.databaseIdentifier)) {
    for (const key of ["docket", "court", "decisionDate"] as const) {
      if (!f[key]) { missing.push(key); warnings.push(`חסר פרט חובה לאזכור החלטה לא מדווחת: ${key}.`); }
    }
    const bits = [`No. ${f.docket || miss("מספר תיק")}`];
    if (f.databaseIdentifier) {
      bits.push(f.databaseIdentifier);
      // Lists and ranges have independent star prefixes; never reinterpret paragraphs.
      const star = f.starPinpoint;
      if (star) bits.push(`at ${star.split(/,\s*/).map((p) => `*${p.replace(/^\*/, "")}`).join(", ")}`);
    } else if (f.opinionFormat === "slip_nonseparate") {
      if (!f.firstPage) { missing.push("firstPage"); warnings.push("חסר עמוד פתיחה לחוות דעת ללא מספור נפרד."); }
      bits.push(`slip op. ${f.firstPage || miss("עמוד פתיחה")}${f.pinpoint ? `, ${f.pinpoint}` : ""}`);
    } else if (f.opinionFormat === "slip_separate") {
      bits.push(`slip op.${f.pinpoint ? ` at ${f.pinpoint}` : ""}`);
    }
    if (f.paragraph) bits.push(`${/[,–\-]/.test(f.paragraph) ? "¶¶" : "¶"} ${f.paragraph}`);
    const date = [f.dateMeaning, f.decisionDate || miss("תאריך מלא")].filter(Boolean).join(" ");
    reportExtraFields(f, ["caseName", "docket", "databaseIdentifier", "opinionFormat", "starPinpoint", "paragraph", "court", "decisionDate", "dateMeaning", "year",
      ...(f.opinionFormat?.startsWith("slip") ? ["firstPage", "pinpoint"] : [])], warnings, unrep);
    const out = appendRemainder(`${fullCitationCaseName(name)}, ${bits.join(", ")} (${f.court || miss("ערכאה")} ${date})`, f.unparsedRemainder, warnings, unrep);
    return finish(out, warnings, missing, unrep);
  }

  if (!f.reporter) missing.push("reporter");
  if (!f.volume) missing.push("volume");
  if (!f.firstPage) missing.push("firstPage");

  let core: string;
  const used = ["caseName", "volume", "reporter", "firstPage", "pinpoint", "paragraph", "court", "year", "parallel"];
  if (f.volume && f.reporter && f.firstPage) {
    core = `${f.volume} ${f.reporter} ${pageSpan(f.firstPage, f.pinpoint)}`;
    if (f.parallel) core += `, ${f.parallel}`;
  } else if (f.databaseIdentifier) {
    used.push("docket", "databaseIdentifier");
    core = `${f.docket ? `No. ${f.docket}, ` : ""}${f.databaseIdentifier}${
      f.pinpoint ? `, at *${f.pinpoint}` : ""
    }`;
  } else {
    core = `${miss("כרך/מאגר")} ${miss("מקור פרסום")} ${miss("עמוד")}`;
    warnings.push("לא אותר מקור פרסום (reporter) — אין להשלים מידע שאינו מאומת.");
  }

  if (f.paragraph) core += ` ¶ ${f.paragraph}`;

  const impliesCourt = f.reporter ? REPORTER_IMPLIES_COURT.has(f.reporter) : false;
  // An explicit parallel court-specific reporter can identify the same court.
  const parallelReporter = f.parallel?.replace(/^\d+\s+/, "");
  const parallelImpliesCourt = !!parallelReporter && [...REPORTER_IMPLIES_COURT].some((reporter) =>
    parallelReporter.startsWith(`${reporter} `));
  // Only the original decision parenthetical at the end of an unparsed suffix
  // counts as supplied: never derive a year from procedural history or prose.
  const suppliedYearInSuffix = !f.year && !!f.unparsedRemainder &&
    /^[\s,;\d.n–\-¶]*\([^()]*\b(?:17|18|19|20)\d{2}\)$/.test(f.unparsedRemainder.trim());
  if (!impliesCourt && !parallelImpliesCourt && !f.court && !suppliedYearInSuffix) {
    missing.push("court");
    warnings.push("חסרה ערכאה; מקור הפרסום אינו מזהה אותה לבדו.");
  }
  const courtPart = !impliesCourt && f.court ? f.court : "";
  if (!f.year && !suppliedYearInSuffix) {
    missing.push("year");
    warnings.push("חסרה שנת ההחלטה.");
  }
  const paren = [courtPart, f.year || (suppliedYearInSuffix ? "[לא עוצב: שנה שסופקה בהמשך]" : miss("שנה"))].filter(Boolean).join(" ");
  reportExtraFields(f, used, warnings, unrep);
  const out = appendRemainder(`${fullCitationCaseName(name)}, ${core} (${paren})`, f.unparsedRemainder, warnings, unrep);
  return finish(out, warnings, missing, unrep);
}

export function renderUkCase(f: ForeignCaseFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  const unrep: string[] = [];
  const name = f.caseName?.trim() || (missing.push("caseName"), miss("שם ההליך"));
  // Traditional Law Reports without a neutral citation (M2A).
  if (!f.neutral && f.reporter && f.firstPage && f.year) {
    const vol = f.reporterVolume ? `${f.reporterVolume} ` : "";
    const court = f.court ? ` (${f.court})` : "";
    reportExtraFields(f, ["caseName", "year", "reporterVolume", "reporter", "firstPage", "pinpoint", "court"], warnings, unrep);
    const out = appendRemainder(
      `${fullCitationCaseName(name)} [${f.year}] ${vol}${f.reporter} ${pageSpan(f.firstPage, f.pinpoint)}${court}`,
      f.unparsedRemainder, warnings, unrep,
    );
    return finish(out, warnings, missing, unrep);
  }
  const bits: string[] = [fullCitationCaseName(name)];
  if (f.neutral && f.year) {
    bits.push(`[${f.year}] ${f.neutral}`);
  } else if (f.year) {
    bits.push(`[${f.year}]`);
  } else {
    missing.push("year");
  }
  if (f.reporter && f.firstPage) {
    const rvol = f.reporterVolume ? `${f.reporterVolume} ` : "";
    bits.push(`, [${f.volume || f.year}] ${rvol}${f.reporter} ${pageSpan(f.firstPage, f.pinpoint)}`);
  }
  let out = bits.join(" ").replace(/\s+,/g, ",");
  if (f.paragraph) out += ` [${f.paragraph}]`;
  if (!f.neutral && !f.reporter) {
    warnings.push("לא אותר אזכור ניטרלי או דיווח רשמי לפסק הדין האנגלי.");
  }
  reportExtraFields(f, ["caseName", "year", "neutral", "volume", "reporterVolume", "reporter", "firstPage", "paragraph",
    ...(f.reporter && f.firstPage ? ["pinpoint"] : [])], warnings, unrep);
  out = appendRemainder(out, f.unparsedRemainder, warnings, unrep);
  return finish(out, warnings, missing, unrep);
}

// ─── Constitution ────────────────────────────────────────────────
export function renderConstitution(f: ForeignConstitutionFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  const jur = f.jurisdiction || (missing.push("jurisdiction"), "U.S.");
  const parts = [sc(`${jur} Const.`)];
  if (f.division) parts.push(`${f.division}${f.number ? ` ${f.number}` : ""}`);
  else if (f.number) parts.push(`art. ${f.number}`);
  let out = parts.join(" ");
  const unrep: string[] = [];
  if (f.section) out += `, ${/[–,]/.test(f.section) ? "§§" : "§"} ${f.section}`;
  if (f.clause) out += `, cl. ${f.clause}`;
  reportExtraFields(f, ["jurisdiction", "division", "number", "section", "clause"], warnings, unrep);
  out = appendRemainder(out, f.unparsedRemainder, warnings, unrep);
  return finish(out, warnings, missing, unrep);
}

// ─── Statutes ────────────────────────────────────────────────────
export function renderUsStatute(
  f: ForeignStatuteFields & { multi?: boolean },
): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  if (!f.titleNumber) missing.push("titleNumber");
  if (!f.code) missing.push("code");
  const sections = f.sections?.length ? f.sections.join(", ") : f.section || "";
  if (!sections) missing.push("section");
  const multi = !!f.multi || (f.sections?.length ?? 0) > 1 || /[–]/.test(sections);
  const sign = multi ? "§§" : "§";
  const sectionText = sections
    ? `${sign} ${sections}${f.subsection ? `(${f.subsection.replace(/^[()]|[()]$/g, "")})` : ""}`
    : miss("סעיף");

  const head = f.statuteName ? `${f.statuteName}, ` : "";
  const body = `${f.titleNumber || miss("title")} ${f.code || miss("קודקס")} ${sectionText}`;
  const tail = f.year ? ` (${f.year})` : "";
  const unrep: string[] = [];
  reportExtraFields(f, ["statuteName", "titleNumber", "code", "section", "sections", "subsection", "year"], warnings, unrep);
  return finish(`${head}${body}${tail}`, warnings, missing, unrep);
}

export function renderUkStatute(f: ForeignStatuteFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  if (!f.statuteName) missing.push("statuteName");
  const nameHasYear = f.statuteName && f.year && f.statuteName.includes(f.year);
  let out = f.statuteName || miss("שם החוק");
  if (f.year && !nameHasYear) out += ` ${f.year}`;
  if (f.regnalYear && f.monarch) out += `, ${f.regnalYear} ${f.monarch}`;
  if (f.chapter) out += `, c. ${f.chapter}`;
  if (f.section) out += `, § ${f.section}`;
  const unrep: string[] = [];
  reportExtraFields(f, ["statuteName", "year", "regnalYear", "monarch", "chapter", "section"], warnings, unrep);
  return finish(out, warnings, missing, unrep);
}

// ─── Secondary literature ────────────────────────────────────────
export function renderJournalArticle(f: ForeignArticleFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  for (const k of ["authors", "articleTitle", "volume", "journal", "firstPage", "year"] as const) {
    if (!f[k]) missing.push(k);
  }
  const authors = f.authors || miss("מחבר");
  const title = f.articleTitle || miss("שם המאמר");
  const journal = normalizeJournalName(f.journal) || miss("כתב עת");
  const vol = f.volume || miss("כרך");
  const pages = f.firstPage ? pageSpan(f.firstPage, f.pinpoint) : [miss("עמוד"), f.pinpoint].filter(Boolean).join(", ");
  const year = f.year || miss("שנה");
  const unrep: string[] = [];
  // doi/sourceUrl are identity evidence handled by the article adapter, not citation content.
  reportExtraFields(f, ["authors", "articleTitle", "volume", "journal", "firstPage", "pinpoint", "year", "doi", "sourceUrl"], warnings, unrep);
  const out = appendRemainder(`${authors}, ${f.articleTitle ? italicTitle(title, warnings) : it(title)}, ${vol} ${sc(journal)} ${pages} (${year})`, f.unparsedRemainder, warnings, unrep);
  return finish(out, warnings, missing, unrep);
}

const plural = (names: string) => /&|,|\sand\s/.test(names);

/** R15.2–15.4(a) parenthetical: editors, translators, [non-original publisher] [edition] year. */
function bookParen(f: ForeignBookFields | ForeignChapterFields, warnings: string[], unrep: string[]): string {
  let publisher = "";
  if (f.publisher) {
    if (f.publisherStatus === "non-original") publisher = f.publisher;
    else {
      unrep.push(`publisher: ${f.publisher}`);
      warnings.push(f.publisherStatus === "original"
        ? `המו״ל שסופק (${f.publisher}) לא נכלל: במהדורה המקורית אין לציין מו״ל (R15.4).`
        : `המו״ל שסופק (${f.publisher}) לא נכלל: לא צוין אם זו מהדורה שאינה של המו״ל המקורי.`);
    }
  }
  const paren = [
    f.editors ? `${f.editors} ed${plural(f.editors) ? "s" : ""}.` : "",
    f.translators ? `${f.translators} trans.` : "",
    [publisher, f.edition ? `${f.edition} ed.` : "", f.year || miss("שנה")].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  return `(${paren})${f.originalYear ? ` (${f.originalYear})` : ""}`;
}

const BOOK_USED = ["authors", "bookTitle", "heading", "volume", "edition", "editors", "translators", "pinpoint", "year", "publisher", "publisherStatus", "originalYear"];

export function renderBook(f: ForeignBookFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  // Editor-only works begin with the title; an absent author is not missing.
  if (!f.authors && !f.heading && !f.editors) missing.push("authors");
  if (!f.bookTitle && !f.heading) missing.push("bookTitle");
  if (!f.year) missing.push("year");
  const unrep: string[] = [];
  const titleText = f.heading ?? (f.authors ? `${f.authors}, ${f.bookTitle || miss("שם הספר")}` : f.bookTitle || miss("שם הספר"));
  const head = (f.volume ? `${f.volume} ` : "") + sc(titleText);
  // A title ending in a numeral takes ", at" before a page pinpoint (R3.2(a)).
  const pin = !f.pinpoint ? "" : /^[§¶]/.test(f.pinpoint) || !/\d$/.test(titleText) ? ` ${f.pinpoint}` : `, at ${f.pinpoint}`;
  const paren = bookParen(f, warnings, unrep);
  reportExtraFields(f, BOOK_USED, warnings, unrep);
  return finish(appendRemainder(`${head}${pin} ${paren}`, f.unparsedRemainder, warnings, unrep), warnings, missing, unrep);
}

export function renderBookChapter(f: ForeignChapterFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  for (const k of ["authors", "chapterTitle", "bookTitle", "firstPage", "year"] as const) {
    if (!f[k]) missing.push(k);
  }
  const unrep: string[] = [];
  // A missing first page stays missing; a supplied pinpoint is never promoted.
  const pages = `${f.firstPage || miss("עמוד")}${f.pinpoint ? `, ${f.pinpoint}` : ""}`;
  const paren = bookParen(f, warnings, unrep);
  reportExtraFields(f, ["authors", "chapterTitle", "bookTitle", "firstPage", "pinpoint", "editors", "edition", "year", "volume", "translators", "publisher", "publisherStatus", "originalYear"], warnings, unrep);
  // R15.5.1(a) / Israeli 36.8: roman comma outside the italic title, italic "in".
  const out = `${f.authors || miss("מחבר")}, ${f.chapterTitle ? italicTitle(f.chapterTitle, warnings) : it(miss("שם הפרק"))}, ${it("in")} ${f.volume ? `${f.volume} ` : ""}${sc(
    f.bookTitle || miss("שם הספר"),
  )} ${pages} ${paren}`;
  return finish(appendRemainder(out, f.unparsedRemainder, warnings, unrep), warnings, missing, unrep);
}

export function renderInternet(f: ForeignInternetFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  if (!f.title) missing.push("title");
  if (!f.url) missing.push("url");
  const head = f.author ? `${f.author}, ` : "";
  const title = f.title ? italicTitle(f.title, warnings) : it(miss("כותרת"));
  const site = f.site ? `, ${sc(f.site)}` : "";
  const date = f.date ? ` (${f.date})` : "";
  const url = f.url || miss("URL");
  const unrep: string[] = [];
  reportExtraFields(f, ["author", "title", "site", "date", "url"], warnings, unrep);
  return finish(`${head}${title}${site}${date}, ${url}`, warnings, missing, unrep);
}

/** Strip every internal marker — used for plain-text fallbacks. */
export function stripMarkers(text: string): string {
  return citationTextOnly(text);
}

/**
 * Stage 5 batch 2 — Bluebook 21 R17.2.1 (unpublished manuscript) and R17.2.2
 * (dissertation/thesis). Roman typography throughout; all supplied text is
 * kept verbatim. Missing required details are reported, never invented.
 */
export function renderUnpublishedWork(kind: "unpublished_manuscript" | "thesis", f: ForeignUnpublishedFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  if (!f.authors) missing.push("authors");
  if (!f.title) missing.push("title");
  if (!f.date) missing.push("date");
  let workType = f.workType;
  if (!workType && kind === "unpublished_manuscript" && f.typeFromSelection) {
    workType = "unpublished manuscript";
    warnings.push("סוג העבודה (unpublished manuscript) נקבע לפי הסיווג שבחרתם ולא הופיע בקלט.");
  }
  if (!workType) missing.push("workType");
  if (kind === "thesis" && !f.institution) missing.push("institution");
  if (f.ambiguousTrailingNumber) warnings.push("מספר בסוף הכותרת עשוי להיות חלק מהכותרת או עמוד מצוטט; הוא נשמר בכותרת כפי שסופק.");
  const typeParen = kind === "thesis"
    ? `${workType || miss("סוג העבודה/התואר")}, ${f.institution || miss("המוסד המעניק")}`
    : workType || miss("סוג העבודה");
  let out = `${f.authors || miss("מחבר")}, ${f.title || miss("כותרת")}${f.pinpoint ? ` ${f.pinpoint}` : ""} (${f.date || miss("תאריך")}) (${typeParen})`;
  if (f.location) out += ` (${f.location})`;
  if (f.unparsedRemainder) {
    out += f.unparsedRemainder.startsWith(",") ? f.unparsedRemainder : ` ${f.unparsedRemainder}`;
    warnings.push(/https?:\/\//.test(f.unparsedRemainder)
      ? "קישור או פרט נוסף נשמר כפי שסופק; הקישור והמאגר לא נבדקו ולא אומתו."
      : "חלק מהקלט לא זוהה במבנה הנתמך ונשמר כפי שסופק.");
  }
  if (missing.length) warnings.push("חסרים פרטים בסיסיים; לא הושלמו או נוחשו.");
  const unrep: string[] = [];
  reportExtraFields(f, ["authors", "title", "pinpoint", "date", "workType", "institution", "location", "typeFromSelection", "ambiguousTrailingNumber"], warnings, unrep);
  return finish(out, warnings, missing, unrep);
}

// ─── Stage 5 batch 3: R16.5 nonconsecutive / R16.6(a),(b) print newspaper ───

export function renderNonconsecutiveArticle(f: ForeignPeriodicalFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  // An unsigned work starts with its title: no author is not missing data.
  if (!f.title) missing.push("title");
  if (!f.periodical) missing.push("periodical");
  if (!f.date && !f.issue) missing.push("date");
  if (!f.firstPage) missing.push("firstPage");
  if (f.issue) warnings.push("לא סופק תאריך כריכה; מספר הגיליון נשמר כפי שסופק.");
  const unrep: string[] = [];
  reportExtraFields(f, ["authors", "title", "periodical", "volume", "date", "issue", "firstPage", "pinpoint", "nonconsecutive"], warnings, unrep);
  const head = `${f.authors ? `${f.authors}, ` : ""}${f.title ? italicTitle(f.title, warnings) : miss("כותרת")}`;
  const at = `at ${f.firstPage || miss("עמוד")}${f.pinpoint ? `, ${f.pinpoint}` : ""}`;
  const out = appendRemainder(`${head}, ${f.volume && !f.date ? `${f.volume} ` : ""}${sc(f.periodical || miss("כתב עת"))}, ${f.date || f.issue || miss("תאריך")}, ${at}`, f.unparsedRemainder, warnings, unrep);
  return finish(out, warnings, missing, unrep);
}

export function renderNewspaper(f: ForeignPeriodicalFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  if (!f.title && !f.designation) missing.push("title");
  if (!f.periodical) missing.push("periodical");
  if (!f.date) missing.push("date");
  if (!f.firstPage) missing.push("firstPage");
  const unrep: string[] = [];
  if (f.pinpoint) {
    unrep.push(`pinpoint: ${f.pinpoint}`);
    warnings.push(`עמוד מצוטט שסופק (${f.pinpoint}) לא נכלל: בעיתון מודפס מציינים את עמוד הפתיחה בלבד.`);
  }
  reportExtraFields(f, ["authors", "designation", "title", "periodical", "place", "date", "section", "firstPage", "pinpoint"], warnings, unrep);
  const lead = [f.authors, f.designation].filter(Boolean).join(", ");
  const title = f.title ? italicTitle(f.title, warnings) : f.designation ? "" : miss("כותרת");
  const head = [lead, title].filter(Boolean).join(", ");
  const paper = `${sc(f.periodical || miss("עיתון"))}${f.place ? ` (${f.place})` : ""}`;
  const date = `${f.date || miss("תאריך")}${f.section ? ` (${f.section})` : ""}`;
  const out = appendRemainder(`${head}, ${paper}, ${date}, at ${f.firstPage || miss("עמוד")}`, f.unparsedRemainder, warnings, unrep);
  return finish(out, warnings, missing, unrep);
}
