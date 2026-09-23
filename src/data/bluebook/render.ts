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
  missing: string[];
}

function finish(parts: string, warnings: string[], missing: string[]): RenderResult {
  let citation = parts.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  if (citation && !/[.]$/.test(citation)) citation += ".";
  return { citation, warnings, missing };
}

function miss(label: string) {
  return `[חסר: ${label}]`;
}

/** Page list: first page, then pinpoint — never conflated. */
function pageSpan(firstPage?: string, pinpoint?: string): string {
  if (!firstPage) return "";
  return pinpoint && pinpoint !== firstPage ? `${firstPage}, ${pinpoint}` : firstPage;
}

// ─── Cases ────────────────────────────────────────────────────────
export function renderUsCase(f: ForeignCaseFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  const name = f.caseName?.trim() || (missing.push("caseName"), miss("שם ההליך"));

  if (!f.reporter) missing.push("reporter");
  if (!f.volume) missing.push("volume");
  if (!f.firstPage) missing.push("firstPage");

  let core: string;
  if (f.volume && f.reporter && f.firstPage) {
    core = `${f.volume} ${f.reporter} ${pageSpan(f.firstPage, f.pinpoint)}`;
  } else if (f.databaseIdentifier) {
    core = `${f.docket ? `No. ${f.docket}, ` : ""}${f.databaseIdentifier}${
      f.pinpoint ? `, at *${f.pinpoint}` : ""
    }`;
  } else {
    core = `${miss("כרך/מאגר")} ${miss("מקור פרסום")} ${miss("עמוד")}`;
    warnings.push("לא אותר מקור פרסום (reporter) — אין להשלים מידע שאינו מאומת.");
  }

  if (f.paragraph) core += ` ¶ ${f.paragraph}`;

  const impliesCourt = f.reporter ? REPORTER_IMPLIES_COURT.has(f.reporter) : false;
  const courtPart = !impliesCourt && f.court ? f.court : "";
  if (!f.year) {
    missing.push("year");
    warnings.push("חסרה שנת ההחלטה.");
  }
  const paren = [courtPart, f.year || miss("שנה")].filter(Boolean).join(" ");

  return finish(`${it(name)}, ${core} (${paren})`, warnings, missing);
}

export function renderUkCase(f: ForeignCaseFields): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  const name = f.caseName?.trim() || (missing.push("caseName"), miss("שם ההליך"));
  const bits: string[] = [it(name)];
  if (f.neutral && f.year) {
    bits.push(`[${f.year}] ${f.neutral}`);
  } else if (f.year) {
    bits.push(`[${f.year}]`);
  } else {
    missing.push("year");
  }
  if (f.reporter && f.firstPage) {
    bits.push(`, [${f.volume || f.year}] ${f.reporter} ${pageSpan(f.firstPage, f.pinpoint)}`);
  }
  let out = bits.join(" ").replace(/\s+,/g, ",");
  if (f.paragraph) out += ` [${f.paragraph}]`;
  if (!f.neutral && !f.reporter) {
    warnings.push("לא אותר אזכור ניטרלי או דיווח רשמי לפסק הדין האנגלי.");
  }
  return finish(out, warnings, missing);
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
  if (f.section) out += `, § ${f.section}`;
  if (f.clause) out += `, cl. ${f.clause}`;
  return finish(out, warnings, missing);
}

// ─── Statutes ────────────────────────────────────────────────────
export function renderUsStatute(
  f: ForeignStatuteFields & { multi?: boolean },
): RenderResult {
  const warnings: string[] = [];
  const missing: string[] = [];
  if (!f.titleNumber) missing.push("titleNumber");
  if (!f.code) missing.push("code");
  if (!f.section) missing.push("section");

  const sections = f.sections?.length ? f.sections.join(", ") : f.section || "";
  const multi = !!f.multi || (f.sections?.length ?? 0) > 1 || /[–]/.test(sections);
  const sign = multi ? "§§" : "§";
  const sectionText = sections
    ? `${sign} ${sections}${f.subsection ? `(${f.subsection.replace(/^[()]|[()]$/g, "")})` : ""}`
    : miss("סעיף");

  const head = f.statuteName ? `${f.statuteName}, ` : "";
  const body = `${f.titleNumber || miss("title")} ${f.code || miss("קודקס")} ${sectionText}`;
  const tail = f.year ? ` (${f.year})` : "";
  return finish(`${head}${body}${tail}`, warnings, missing);
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
  return finish(out, warnings, missing);
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
  const pages = f.firstPage ? pageSpan(f.firstPage, f.pinpoint) : miss("עמוד");
  const year = f.year || miss("שנה");
  return finish(`${authors}, ${it(title)}, ${vol} ${sc(journal)} ${pages} (${year})`, warnings, missing);
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
  const paren = [
    f.editors ? `${f.editors} ed${f.editors.includes("&") ? "s" : ""}.` : "",
    f.translators ? `${f.translators} trans.` : "",
    f.edition ? `${f.edition} ed.` : "",
    f.year || miss("שנה"),
  ]
    .filter(Boolean)
    .join(", ");
  const pin = f.pinpoint ? ` ${f.pinpoint}` : "";
  return finish(`${head}${pin} (${paren})`, warnings, missing);
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
    f.edition ? `${f.edition} ed.` : "",
    f.year || miss("שנה"),
  ]
    .filter(Boolean)
    .join(", ");
  return finish(
    `${f.authors || miss("מחבר")}, ${it(f.chapterTitle || miss("שם הפרק"))}, in ${sc(
      f.bookTitle || miss("שם הספר"),
    )} ${pages} (${paren})`,
    warnings,
    missing,
  );
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
  return finish(`${head}${title}${site}${date}, ${url}`, warnings, missing);
}

/** Strip every internal marker — used for plain-text fallbacks. */
export function stripMarkers(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/gs, "$1").replace(/##(.*?)##/gs, "$1").replace(/\^\^(.*?)\^\^/gs, "$1");
}
