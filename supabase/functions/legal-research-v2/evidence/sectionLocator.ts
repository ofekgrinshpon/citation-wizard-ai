/**
 * legal-research-v2 — deterministic in-body statute section locator.
 *
 * One job: given an already acquired statute body (kept server-side) and a
 * requested provision ("25", "סעיף 25(א)"), return a bounded window around
 * that provision — or say clearly that the body does not carry it, together
 * with the section range the body DOES cover, so the agent can pivot.
 *
 * No acquisition, no ranking, no fallback hierarchy.
 */

const HEB_LETTERS = "א-ת";

/** "סעיף 25(א)" / "s. 25" / "25." → "25(א)" / "25". */
export function normalizeSectionToken(raw: string): string | null {
  const t = String(raw ?? "").replace(/[\u200e\u200f]/g, "").trim();
  if (!t) return null;
  const m = t.match(/(\d{1,3}[א-ת]?)\s*(\(\s*[א-ת0-9]{1,3}\s*\))?/);
  if (!m) return null;
  const num = m[1];
  const sub = m[2]?.replace(/\s+/g, "");
  return sub ? `${num}${sub}` : num;
}

/** The bare section number part ("25(א)" → "25"). */
export function sectionNumberOf(token: string): string {
  return token.match(/^\d{1,3}[א-ת]?/)?.[0] ?? token;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regexes that mark the start of a numbered provision inside a statute body. */
function headingPatterns(num: string): RegExp[] {
  const n = escape(num);
  return [
    new RegExp(`(^|\\n)\\s*${n}\\s*\\.`, "u"),
    new RegExp(`(^|\\n)\\s*${n}\\s*\\(`, "u"),
    new RegExp(`סעיף\\s*${n}(?![0-9])`, "u"),
    new RegExp(`(^|\\n)\\s*${n}\\s+[${HEB_LETTERS}]`, "u"),
  ];
}

export interface SectionLocateResult {
  found: boolean;
  section: string;
  windows: string[];
  /** How the window was located, for telemetry only. */
  via?: "heading" | "reference";
  /** Sections detected in the body, ascending, for the pivot message. */
  coverage: { first: string | null; last: string | null; count: number };
  /** True when the stored body was clipped by the extraction ceiling. */
  truncated: boolean;
}

/** Numbered provisions the body actually contains. */
export function sectionCoverage(text: string): { first: string | null; last: string | null; count: number } {
  const nums = new Set<number>();
  const re = /(^|\n)\s*(\d{1,3})\s*[.(]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[2]);
    if (Number.isFinite(n) && n > 0 && n < 1000) nums.add(n);
  }
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    first: sorted.length ? String(sorted[0]) : null,
    last: sorted.length ? String(sorted[sorted.length - 1]) : null,
    count: sorted.length,
  };
}

/**
 * Locate a provision inside a body. Returns bounded windows only — the full
 * text never leaves the evidence store.
 */
export function locateSection(
  text: string,
  requested: string,
  opts: { window?: number; max?: number; truncated?: boolean } = {},
): SectionLocateResult {
  const windowChars = opts.window ?? 1_800;
  const max = opts.max ?? 2;
  const token = normalizeSectionToken(requested);
  const coverage = sectionCoverage(text);
  const base = {
    section: token ?? String(requested ?? "").trim(),
    coverage,
    truncated: !!opts.truncated,
  };
  if (!token || !text) return { ...base, found: false, windows: [] };

  const num = sectionNumberOf(token);
  const windows: string[] = [];
  let via: "heading" | "reference" | undefined;

  for (const re of headingPatterns(num)) {
    const m = re.exec(text);
    if (!m) continue;
    const idx = m.index;
    const start = Math.max(0, idx - 120);
    windows.push(text.slice(start, start + windowChars));
    via = /סעיף/.test(re.source) ? "reference" : "heading";
    if (windows.length >= max) break;
  }

  // Subsection request: prefer a window that actually shows the subsection.
  const sub = token.slice(num.length);
  if (sub && windows.length) {
    const preferred = windows.filter((w) => w.includes(sub));
    if (preferred.length) return { ...base, found: true, windows: preferred.slice(0, max), via };
  }

  if (windows.length) return { ...base, found: true, windows: windows.slice(0, max), via };
  return { ...base, found: false, windows: [] };
}

/** Deterministic Hebrew message telling the agent this source cannot serve the section. */
export function sectionMissingInstruction(res: SectionLocateResult, source_id: string): string {
  const range = res.coverage.first && res.coverage.last
    ? `הגוף השמור מכסה סעיפים ${res.coverage.first}–${res.coverage.last} בלבד`
    : "לא זוהו סעיפים ממוספרים בגוף השמור";
  const trunc = res.truncated ? " (הטקסט נחתך בתקרת החילוץ)" : "";
  return `סעיף ${res.section} אינו נמצא במקור ${source_id}. ${range}${trunc}. אל תמשיך לתשאל מקור זה על סעיף זה — פנה למקור אחר (נוסח משולב עדכני, אתר רשמי, או פרסום התיקון עצמו).`;
}
