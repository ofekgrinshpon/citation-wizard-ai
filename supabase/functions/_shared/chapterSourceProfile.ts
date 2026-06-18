// =========================================================================
// chapterSourceProfile.ts — per-chapter academic-search profile + query
// builder used by legal-qa's write_chapter pipeline.
//
// The chapter writer pre-fetches a source pool (via the same engine as the
// "חיפוש מקורות" / sources_only mode) before drafting prose. The profile
// returned here shapes the retrieval (which source classes to weight, do
// we allow foreign-language scholarship, how many sources to keep) and the
// query string is a focused Hebrew search built from the research question,
// thesis, chapter title and the flow tag (הדין המצוי / ניתוח ביקורתי /
// משפט משווה / הדין הראוי).
//
// Intro / סיכום / תקציר chapters do NOT call this — they synthesize from
// already-written body chapters.
// =========================================================================

export type ChapterFlowTag =
  | "הדין המצוי"
  | "ניתוח ביקורתי"
  | "משפט משווה"
  | "הדין הראוי"
  | "";

export interface ChapterSourceProfile {
  /** Loose tag for telemetry / logging. */
  kind: "doctrinal" | "critical" | "comparative" | "normative" | "default";
  /** Allow English-language scholarship + foreign jurisdictions. */
  allowForeign: boolean;
  /** Include statutes / regulations as primary sources. */
  includeLegislation: boolean;
  /** Include case law (binding + persuasive). */
  includeCaseLaw: boolean;
  /** Include academic books + journal articles. */
  includeScholarship: boolean;
  /** Include government reports / committee reports. */
  includeReports: boolean;
  /** Cap on total sources to feed into the chapter prompt. */
  maxSources: number;
  /** Cap on the foreign-language slice (subset of maxSources). 0 if !allowForeign. */
  maxForeign: number;
  /** Short Hebrew label for SSE stage detail. */
  label: string;
}

function normalizeFlowTag(raw: string | null | undefined): ChapterFlowTag {
  if (!raw) return "";
  const s = raw.trim().replace(/^[–\-]+\s*/, "").trim();
  if (/הדין\s+המצוי/.test(s)) return "הדין המצוי";
  if (/ניתוח\s+ביקורתי|ביקורתי/.test(s)) return "ניתוח ביקורתי";
  if (/משפט\s+משווה|השוואתי|השוואה/.test(s)) return "משפט משווה";
  if (/הדין\s+הראוי|הצעה\s+נורמטיבית|נורמטיב/.test(s)) return "הדין הראוי";
  return "";
}

export function profileForFlowTag(flowTagRaw: string | null | undefined): ChapterSourceProfile {
  const tag = normalizeFlowTag(flowTagRaw);
  switch (tag) {
    case "הדין המצוי":
      return {
        kind: "doctrinal",
        allowForeign: false,
        includeLegislation: true,
        includeCaseLaw: true,
        includeScholarship: true,
        includeReports: false,
        maxSources: 14,
        maxForeign: 0,
        label: "מקורות ראשוניים — חקיקה ופסיקה מחייבת",
      };
    case "ניתוח ביקורתי":
      return {
        kind: "critical",
        allowForeign: false,
        includeLegislation: false,
        includeCaseLaw: true,
        includeScholarship: true,
        includeReports: true,
        maxSources: 14,
        maxForeign: 0,
        label: "ספרות מלומדים ופסיקה רלוונטית",
      };
    case "משפט משווה":
      return {
        kind: "comparative",
        allowForeign: true,
        includeLegislation: true,
        includeCaseLaw: true,
        includeScholarship: true,
        includeReports: false,
        maxSources: 14,
        maxForeign: 8,
        label: "מקורות זרים — ספרות וחקיקה משווה",
      };
    case "הדין הראוי":
      return {
        kind: "normative",
        allowForeign: true,
        includeLegislation: false,
        includeCaseLaw: false,
        includeScholarship: true,
        includeReports: true,
        maxSources: 14,
        maxForeign: 5,
        label: "מלומדים ודוחות ועדה",
      };
    default:
      return {
        kind: "default",
        allowForeign: false,
        includeLegislation: true,
        includeCaseLaw: true,
        includeScholarship: true,
        includeReports: true,
        maxSources: 14,
        maxForeign: 0,
        label: "מקורות מעורבים",
      };
  }
}

export interface BuildQueryInput {
  researchQuestion: string;
  thesis?: string;
  chapterTitle: string;
  flowTag: string | null | undefined;
  chapterExpansion?: string;
}

/** Build a focused Hebrew search query for one chapter. */
export function buildChapterQuery(input: BuildQueryInput): string {
  const rq = (input.researchQuestion || "").trim();
  const th = (input.thesis || "").trim();
  const title = (input.chapterTitle || "").trim();
  const flow = normalizeFlowTag(input.flowTag);
  const exp = (input.chapterExpansion || "").trim().slice(0, 400);

  const parts: string[] = [];
  if (title) parts.push(title);
  if (flow) parts.push(flow);
  if (rq) parts.push(rq);
  if (th) parts.push(`טענה: ${th}`);
  if (exp) parts.push(exp);
  return parts.join(" — ").slice(0, 800);
}

/**
 * Parse the outline string emitted by propose_outline and return per-chapter
 * `{ title, flowTag, expansion }` records. The outline format is fixed by
 * the propose_outline prompt — see legal-qa/index.ts.
 */
export interface ParsedOutlineChapter {
  title: string;
  flowTag: string;
  expansion: string;
}

export function parseOutlineChapters(outline: string | null | undefined): ParsedOutlineChapter[] {
  if (!outline) return [];
  const chaptersMatch = outline.match(/\*\*רשימת הפרקים\*\*([\s\S]*?)(?:\*\*סיכום ומסקנות|$)/);
  if (!chaptersMatch) return [];
  const block = chaptersMatch[1];
  const lines = block.split("\n");
  const out: ParsedOutlineChapter[] = [];
  let cur: ParsedOutlineChapter | null = null;
  // matches "1. **title** – flowTag"
  const headerRe = /^\s*\d+\.\s*\*\*(.+?)\*\*\s*[–\-]?\s*(.*)$/;
  const expansionRe = /^\s*-\s*הרחבה\s*:\s*(.*)$/;
  for (const raw of lines) {
    const headerMatch = raw.match(headerRe);
    if (headerMatch) {
      if (cur) out.push(cur);
      cur = { title: headerMatch[1].trim(), flowTag: (headerMatch[2] || "").trim(), expansion: "" };
      continue;
    }
    const expMatch = raw.match(expansionRe);
    if (expMatch && cur) {
      cur.expansion = expMatch[1].trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Extract the thesis line from a parsed outline string. */
export function extractThesis(outline: string | null | undefined): string {
  if (!outline) return "";
  const m = outline.match(/התזה\s+המרכזית[^\n:]*[:\-]\s*(.+)/);
  return m ? m[1].trim() : "";
}

/**
 * Look up the chapter at `chapterIndex` in display order (תקציר → מבוא →
 * body chapters → סיכום) and return its parsed outline entry, or null when
 * the index lies in a special chapter (which we don't auto-search for).
 */
export function findOutlineChapterByTitle(
  outline: string | null | undefined,
  title: string,
): ParsedOutlineChapter | null {
  if (!title) return null;
  const list = parseOutlineChapters(outline);
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const target = norm(title);
  return list.find((c) => norm(c.title) === target) || null;
}
