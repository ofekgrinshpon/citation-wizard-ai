// source_label_quality_v1 — near-duplicate display-title cleanup.
//
// OCR-corrupted variants of the same document ("עילת אי־הסבירות במשפט הממהלי*"
// vs "עילת אי־הסבירות במשפט המינהלי") reach the source list as two rows with
// two different labels. This pass collapses the *label*: the cleaner variant's
// title is adopted by its near-duplicates. Pure deterministic, no drops —
// hierarchy, refs and candidate ids are untouched.

export interface LabelledSource {
  title: string;
  url?: string | null;
  [k: string]: unknown;
}

const SUSPECT_CHARS = /[*\u0080-\u009F\uFFFD?~^`]/g;

function normalizeForCompare(s: string): string {
  return s
    .replace(/[\u0591-\u05C7]/g, "") // niqqud / cantillation
    .replace(/[\u05F3\u05F4'"״׳]/g, "")
    .replace(/[\u2013\u2014\u05BE־\-–—_.,:;()[\]{}*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1);
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 similarity of two titles after normalization. */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const maxLen = Math.max(x.length, y.length);
  if (maxLen > 300) return x === y ? 1 : 0; // guard: skip pathological lengths
  return 1 - levenshtein(x, y) / maxLen;
}

/** Higher is a cleaner label. */
function cleanliness(title: string): number {
  const suspects = (title.match(SUSPECT_CHARS) ?? []).length;
  const latinInHebrew = /[\u05D0-\u05EA]/.test(title) ? (title.match(/[A-Za-z]/g) ?? []).length : 0;
  return -(suspects * 10) - latinInHebrew + Math.min(title.trim().length, 120) / 100;
}

export interface NearDuplicateReport {
  near_duplicate_titles_collapsed: number;
  collapsed: Array<{ from: string; to: string; similarity: number }>;
}

/**
 * Collapse near-duplicate titles in place (mutates `title` only).
 * Threshold 0.88 normalized similarity.
 */
export function collapseNearDuplicateTitles<T extends LabelledSource>(
  sources: T[],
  threshold = 0.88,
): NearDuplicateReport {
  const report: NearDuplicateReport = { near_duplicate_titles_collapsed: 0, collapsed: [] };
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i];
      const b = sources[j];
      if (!a.title || !b.title || a.title === b.title) continue;
      const sim = titleSimilarity(a.title, b.title);
      if (sim < threshold) continue;
      const keepA = cleanliness(a.title) >= cleanliness(b.title);
      const winner = keepA ? a : b;
      const loser = keepA ? b : a;
      report.collapsed.push({ from: loser.title, to: winner.title, similarity: Number(sim.toFixed(3)) });
      report.near_duplicate_titles_collapsed += 1;
      loser.title = winner.title;
      const reasons = (loser.title_hygiene_reasons as string[] | undefined) ?? [];
      if (!reasons.includes("near_duplicate_title_collapsed")) {
        reasons.push("near_duplicate_title_collapsed");
      }
      (loser as Record<string, unknown>).title_hygiene_reasons = reasons;
    }
  }
  return report;
}
