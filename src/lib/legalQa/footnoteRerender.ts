// Pure helpers for client-side citation review: re-render the answer text
// after the user edits/removes footnotes. Mirrors the greedy superscript
// parsing the backend uses, so adjacent multi-digit runs (¹², ³⁴) are split
// into the correct individual footnote numbers.

const SUPERS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
const SUPER_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
const SUPER_DIGIT_MAP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};

export function toSuperscript(n: number): string {
  return String(n).split("").map((d) => SUPERS[+d] ?? d).join("");
}

function supersToDigits(s: string): string {
  return s.split("").map((c) => SUPER_DIGIT_MAP[c] ?? c).join("");
}

/** Split a superscript digit run into a sequence of valid footnote numbers,
 *  greedily preferring the LONGEST match present in `validNumbers`. */
export function splitSuperRun(run: string, validNumbers: Set<number>): number[] {
  const digits = supersToDigits(run);
  const out: number[] = [];
  let i = 0;
  while (i < digits.length) {
    let matched = -1;
    let matchedLen = 0;
    // greedy: longest first
    for (let len = Math.min(digits.length - i, 4); len >= 1; len--) {
      const candidate = parseInt(digits.slice(i, i + len), 10);
      if (!Number.isFinite(candidate)) continue;
      if (validNumbers.has(candidate)) {
        matched = candidate;
        matchedLen = len;
        break;
      }
    }
    if (matched === -1) {
      // unknown: consume one digit and skip (will be dropped on rerender)
      out.push(-1);
      i += 1;
    } else {
      out.push(matched);
      i += matchedLen;
    }
  }
  return out;
}

export interface EditableFootnote {
  /** Original footnote number as it currently appears in the answer. */
  originalNumber: number;
  citation: string;
  source_type?: string;
  url?: string;
  source?: "local" | "perplexity" | "document";
  /** If true, this footnote will be dropped and its superscripts stripped. */
  removed?: boolean;
}

export interface RerenderResult {
  answer: string;
  footnotes: Array<{
    number: number;
    citation: string;
    source_type: string;
    url?: string;
    source?: "local" | "perplexity" | "document";
  }>;
}

/** Rebuild the rendered answer + footnote list after edits.
 *  - Surviving footnotes are renumbered in the order they first appear in the answer.
 *  - Removed footnotes are stripped from the text.
 *  - Adjacent superscript runs are split greedily using the original numbering. */
export function rerenderAnswer(
  originalAnswer: string,
  edits: EditableFootnote[],
): RerenderResult {
  const allOriginal = new Set(edits.map((e) => e.originalNumber));
  const surviving = new Map<number, EditableFootnote>();
  for (const e of edits) {
    if (!e.removed) surviving.set(e.originalNumber, e);
  }

  // Pass 1: walk text, decode each superscript run into individual orig numbers.
  type Token = { type: "text"; value: string } | { type: "fn"; original: number };
  const tokens: Token[] = [];
  let lastIdx = 0;
  for (const m of originalAnswer.matchAll(SUPER_RE)) {
    const idx = m.index ?? 0;
    if (idx > lastIdx) tokens.push({ type: "text", value: originalAnswer.slice(lastIdx, idx) });
    const nums = splitSuperRun(m[0], allOriginal);
    for (const n of nums) tokens.push({ type: "fn", original: n });
    lastIdx = idx + m[0].length;
  }
  if (lastIdx < originalAnswer.length) {
    tokens.push({ type: "text", value: originalAnswer.slice(lastIdx) });
  }

  // Pass 2: assign new sequential numbers in first-appearance order.
  const newNumberByOriginal = new Map<number, number>();
  let nextNum = 1;
  for (const t of tokens) {
    if (t.type === "fn" && t.original >= 0 && surviving.has(t.original) && !newNumberByOriginal.has(t.original)) {
      newNumberByOriginal.set(t.original, nextNum++);
    }
  }

  // Pass 3: rebuild text, merging consecutive fn tokens into one superscript run.
  let out = "";
  let pendingNums: number[] = [];
  const flush = () => {
    if (pendingNums.length === 0) return;
    out += pendingNums.map((n) => toSuperscript(n)).join("");
    pendingNums = [];
  };
  for (const t of tokens) {
    if (t.type === "text") {
      flush();
      out += t.value;
    } else {
      const newNum = newNumberByOriginal.get(t.original);
      if (typeof newNum === "number") pendingNums.push(newNum);
      // removed / unknown → drop the superscript entirely
    }
  }
  flush();

  // Build the new footnote list in the order they appear.
  const newFootnotes: RerenderResult["footnotes"] = [];
  // Sort surviving by their new number.
  const byNew: Array<{ newNum: number; orig: number }> = [];
  for (const [orig, newNum] of newNumberByOriginal.entries()) {
    byNew.push({ newNum, orig });
  }
  byNew.sort((a, b) => a.newNum - b.newNum);
  for (const { newNum, orig } of byNew) {
    const e = surviving.get(orig)!;
    newFootnotes.push({
      number: newNum,
      citation: e.citation,
      source_type: e.source_type ?? "unknown",
      url: e.url,
      source: e.source,
    });
  }

  // Append any surviving footnotes that the user kept but whose superscript no
  // longer appears in the text (e.g. text was edited externally). Numbered at end.
  for (const e of edits) {
    if (e.removed) continue;
    if (newNumberByOriginal.has(e.originalNumber)) continue;
    newFootnotes.push({
      number: nextNum++,
      citation: e.citation,
      source_type: e.source_type ?? "unknown",
      url: e.url,
      source: e.source,
    });
  }

  return { answer: out, footnotes: newFootnotes };
}

/** Detect which fields are visibly missing in a citation string. */
export function detectMissingFields(citation: string): string[] {
  if (!citation) return [];
  const missing: string[] = [];
  const placeholderRe = /\[חסר:\s*([^\]]+)\]/g;
  for (const m of citation.matchAll(placeholderRe)) {
    missing.push(m[1].trim());
  }
  // Common implicit signals
  if (/\(\s*\)/.test(citation)) missing.push("שנה");
  if (/לא נמצא[הת]?\s+שנת/i.test(citation)) missing.push("שנה");
  // dedupe
  return Array.from(new Set(missing));
}
