/**
 * legal-research-v2 — source display grouping for source-search mode.
 *
 * Ported (concept + heuristics) from V1 `lib/sourcesOnly.ts::classifyDisplayGroup`.
 * Pure presentation classification: it never affects evidence admission,
 * verification or the normal answer pipeline.
 */

export type SourceGroupKey =
  | "legislation"
  | "case_law"
  | "scholarship"
  | "legislative_process"
  | "institutional"
  | "other";

export const SOURCE_GROUP_ORDER: SourceGroupKey[] = [
  "legislation",
  "case_law",
  "scholarship",
  "legislative_process",
  "institutional",
  "other",
];

export const SOURCE_GROUP_LABELS_HE: Record<SourceGroupKey, string> = {
  legislation: "חקיקה",
  case_law: "פסיקה",
  scholarship: "ספרות אקדמית",
  legislative_process: "הליכי חקיקה",
  institutional: "דוחות / מקורות מוסדיים",
  other: "אחר",
};

function host(url?: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url?: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

const COURT_SUFFIX = "court.gov.il";
const KNESSET_SUFFIX = "knesset.gov.il";
const SCHOLARSHIP_HOSTS = [
  "idi.org.il",
  "heinonline.org",
  "jstor.org",
  "ssrn.com",
  "papers.ssrn.com",
  "academia.edu",
  "cambridge.org",
  "tandfonline.com",
  "oup.com",
];
const ACADEMIC_SUFFIX = [".ac.il", ".edu"];

const DOCKET_RE =
  /\b(?:בג"?ץ|בג״ץ|דנג"?ץ|רע"?א|רע״א|דנ"?א|בש"?פ|ע"?א|ע״א|ע"?פ|ע״פ|בע"?מ|בע״מ|ת"?א|ה"?פ|ב"?ל)\s*\d{1,5}\/\d{2,4}\b/;
const STATUTE_TITLE_RE = /^(?:\s*)(?:חוק[- ]יסוד|חוק\b|תקנות\b|פקודת\b|פקודה\b|צו\b)/;
const BILL_RE = /(הצעת\s+חוק|פרוטוקול|ועדת|דברי\s+הסבר|קריאה\s+(?:ראשונה|שניה|שנייה)|טרומית)/;

export function classifySourceGroup(args: {
  title: string;
  url?: string | null;
  identity?: { dockets: string[]; statutes: string[] } | null;
}): SourceGroupKey {
  const title = (args.title || "").trim();
  const h = host(args.url);
  const p = pathOf(args.url);
  const hasDocket = DOCKET_RE.test(title) || (args.identity?.dockets?.length ?? 0) > 0;

  // Scholarship is decided before the docket heuristic: an academic article
  // cites judgments, so its extracted identity routinely carries dockets.
  const isScholarshipHost = SCHOLARSHIP_HOSTS.some((s) => h === s || h.endsWith(`.${s}`)) ||
    ACADEMIC_SUFFIX.some((s) => h.endsWith(s)) ||
    /law[-_]?review|mishpatim|hapraklit|iyunei|mehkarei|lawreview/.test(`${h}${p}`);

  if (h.endsWith(COURT_SUFFIX) || h === "versa.cardozo.yu.edu") return "case_law";
  if (isScholarshipHost) return "scholarship";
  if (hasDocket) return "case_law";

  const looksLikeLaw = STATUTE_TITLE_RE.test(title) ||
    /\/law(_html|_word)?\//.test(p) ||
    /\/legislation\//.test(p);
  const isBill = BILL_RE.test(title);
  if (looksLikeLaw && !isBill) return "legislation";

  if (h === KNESSET_SUFFIX || h.endsWith(`.${KNESSET_SUFFIX}`)) {
    return looksLikeLaw && !isBill ? "legislation" : "legislative_process";
  }
  if (isBill) return "legislative_process";


  if (h === "gov.il" || h.endsWith(".gov.il") || h === "mevaker.gov.il") return "institutional";

  return "other";
}

export function sourceTypeLabelHe(group: SourceGroupKey): string {
  switch (group) {
    case "legislation":
      return "חקיקה";
    case "case_law":
      return "פסיקה";
    case "scholarship":
      return "ספרות אקדמית";
    case "legislative_process":
      return "הליך חקיקה";
    case "institutional":
      return "מקור מוסדי";
    default:
      return "מקור";
  }
}
