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

import { REPORTER_IMPLIES_COURT, normalizeJournalName } from "./tables";
import type {
  ForeignArticleFields,
  ForeignBookFields,
  ForeignCaseFields,
  ForeignChapterFields,
  ForeignConstitutionFields,
  ForeignInternetFields,
  ForeignStatuteFields,
} from "./types";

export const SMALL_CAPS_OPEN = "^^";
export const SMALL_CAPS_CLOSE = "^^";

export const it = (s: string) => `##${s}##`;
export const sc = (s: string) => `^^${s}^^`;

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

  if (!f.reporter) missing.push("reporter");
  if (!f.volume) missing.push("volume");
  if (!f.firstPage) missing.push("firstPage");

  // Database-only path (M2A): an alternative publication identifier — never a
  // reporter/volume/page. Requires docket, court and exact decision date.
  const isDbOnly = !(f.volume && f.reporter && f.firstPage) && !!f.databaseIdentifier;
  if (isDbOnly) {
    const dbMissing: string[] = [];
    if (!f.docket) dbMissing.push("docket");
    if (!f.court) dbMissing.push("court");
    if (!f.decisionDate) dbMissing.push("decisionDate");
    if (f.caseName?.trim() && dbMissing.length === 0) {
      const star = f.starPinpoint ?? (f.pinpoint ? f.pinpoint : undefined);
      const core = `No. ${f.docket}, ${f.databaseIdentifier}${star ? `, at *${star}` : ""}`;
      reportExtraFields(f, ["caseName", "docket", "databaseIdentifier", "starPinpoint", "pinpoint", "court", "decisionDate", "year"], warnings, unrep);
      const out = appendRemainder(`${it(name)}, ${core} (${f.court} ${f.decisionDate})`, f.unparsedRemainder, warnings, unrep);
      return finish(out, warnings, [], unrep);
    }
    missing.push(...dbMissing);
  }

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
  const parallelImpliesCourt = !!f.parallel && [...REPORTER_IMPLIES_COURT].some((reporter) =>
    f.parallel?.startsWith(`${f.parallel.split(" ")[0]} ${reporter} `));
  // Only the original decision parenthetical at the end of an unparsed suffix
  // counts as supplied: never derive a year from procedural history or prose.
  const suppliedYearInSuffix = !f.year && !!f.unparsedRemainder &&
    /^[^()]*\([^()]*\b(?:17|18|19|20)\d{2}\)$/.test(f.unparsedRemainder.trim());
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
  const out = appendRemainder(`${it(name)}, ${core} (${paren})`, f.unparsedRemainder, warnings, unrep);
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
      `${it(name)} [${f.year}] ${vol}${f.reporter} ${pageSpan(f.firstPage, f.pinpoint)}${court}`,
      f.unparsedRemainder, warnings, unrep,
    );
    return finish(out, warnings, missing, unrep);
  }
  const bits: string[] = [it(name)];
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
  const out = appendRemainder(`${authors}, ${it(title)}, ${vol} ${sc(journal)} ${pages} (${year})`, f.unparsedRemainder, warnings, unrep);
  return finish(out, warnings, missing, unrep);
}

export function renderBook(f: ForeignBookFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  if (!f.authors) missing.push("authors");
  if (!f.bookTitle) missing.push("bookTitle");
  if (!f.year) missing.push("year");

  const head =
    (f.volume ? `${f.volume} ` : "") +
    sc(`${f.authors || miss("מחבר")}, ${f.bookTitle || miss("שם הספר")}`);
  // Bluebook: contributors are comma-separated; edition and year are not.
  const paren = [
    f.editors ? `${f.editors} ed${f.editors.includes("&") ? "s" : ""}.` : "",
    f.translators ? `${f.translators} trans.` : "",
    [f.edition ? `${f.edition} ed.` : "", f.year || miss("שנה")].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const pin = f.pinpoint ? ` ${f.pinpoint}` : "";
  const unrep: string[] = [];
  reportExtraFields(f, ["authors", "bookTitle", "volume", "edition", "editors", "translators", "pinpoint", "year"], warnings, unrep);
  return finish(`${head}${pin} (${paren})`, warnings, missing, unrep);
}

export function renderBookChapter(f: ForeignChapterFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  for (const k of ["authors", "chapterTitle", "bookTitle", "firstPage", "year"] as const) {
    if (!f[k]) missing.push(k);
  }
  const pages = f.firstPage ? pageSpan(f.firstPage, f.pinpoint) : miss("עמוד");
  const paren = [
    f.editors ? `${f.editors} ed${/(&|,)/.test(f.editors) ? "s" : ""}.` : "",
    [f.edition ? `${f.edition} ed.` : "", f.year || miss("שנה")].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return finish(
    `${f.authors || miss("מחבר")}, ${it(f.chapterTitle || miss("שם הפרק"))}, in ${sc(
      f.bookTitle || miss("שם הספר"),
    )} ${pages} (${paren})`,
    warnings,
    missing,
    chapterUnrep(f, warnings),
  );
}

function chapterUnrep(f: ForeignChapterFields, warnings: string[]): string[] {
  const unrep: string[] = [];
  reportExtraFields(f, ["authors", "chapterTitle", "bookTitle", "firstPage", "pinpoint", "editors", "edition", "year"], warnings, unrep);
  return unrep;
}

export function renderInternet(f: ForeignInternetFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  if (!f.title) missing.push("title");
  if (!f.url) missing.push("url");
  const head = f.author ? `${f.author}, ` : "";
  const title = it(f.title || miss("כותרת"));
  const site = f.site ? `, ${sc(f.site)}` : "";
  const date = f.date ? ` (${f.date})` : "";
  const url = f.url || miss("URL");
  const unrep: string[] = [];
  reportExtraFields(f, ["author", "title", "site", "date", "url"], warnings, unrep);
  return finish(`${head}${title}${site}${date}, ${url}`, warnings, missing, unrep);
}

/** Strip every internal marker — used for plain-text fallbacks. */
export function stripMarkers(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/gs, "$1").replace(/##(.*?)##/gs, "$1").replace(/\^\^(.*?)\^\^/gs, "$1");
}
