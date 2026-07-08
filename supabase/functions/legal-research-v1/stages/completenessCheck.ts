// Deterministic content-completeness check for drafterV2 output.
// String/block inspection only — no model call.
//
// Purpose: catch cases where the structured JSON validates but the visible
// answer ends mid-word or with an obviously incomplete fragment because the
// model's completion tokens ran out mid-generation.

import type { StructuredBlock, StructuredDraft } from "./structuredValidation.ts";

export type CompletenessSignalStrength = "strong" | "weak";

export interface CompletenessSignal {
  code: string;
  strength: CompletenessSignalStrength;
  detail?: string;
}

export interface CompletenessReport {
  truncated: boolean;
  reasons: string[];
  signals: CompletenessSignal[];
  last_block_kind: string;
  last_block_excerpt: string;
}

// Hebrew fragments that almost never end a sentence on their own.
// Multi-letter fragments (very high-confidence truncation markers).
const HEBREW_FRAGMENT_TOKENS = new Set<string>([
  "דו",
  "של",
  "כי",
  "אשר",
  "או",
  "גם",
  "לא",
  "על",
  "אל",
  "אם",
  "כפי",
  "לפי",
  "בין",
  "עם",
  "עד",
  "אך",
  "אף",
  "רק",
  "כמו",
  "בעת",
]);

// Single Hebrew letters used as inseparable prefixes — a final token of just
// one of these is almost certainly a cut-off word.
const HEBREW_PREFIX_LETTERS = new Set<string>([
  "ו", "ב", "ל", "מ", "ה", "ש", "כ",
]);

// Characters a completed Hebrew legal paragraph is expected to end with.
const TERMINAL_PUNCT = new Set<string>([".", "?", "!", "׃", "׳", "״"]);

// Characters that indicate an unfinished clause when they are the last char.
const MID_CLAUSE_PUNCT = new Set<string>([",", ";", ":", "-", "–", "—"]);

// Opening quotes / parens — if the paragraph ends on one of these, it's
// clearly mid-thought.
const OPENING_MARKS = new Set<string>(["(", "[", "{", "\"", "'", "״", "׳", "«", "‟", "„"]);

function stripTrailingClosers(s: string): string {
  // Allow closing punctuation/quotes after the terminal mark.
  return s.replace(/[)\]\}"'״׳»”’]+$/u, "");
}

function lastNonEmptyBlock(draft: StructuredDraft): StructuredBlock | undefined {
  for (let i = draft.blocks.length - 1; i >= 0; i--) {
    const b = draft.blocks[i];
    if (b.kind === "paragraph" || b.kind === "list_item") {
      if (b.text && b.text.trim().length > 0) return b;
    }
  }
  return undefined;
}

export function checkCompleteness(draft: StructuredDraft): CompletenessReport {
  const last = lastNonEmptyBlock(draft);
  if (!last) {
    return {
      truncated: false,
      reasons: [],
      signals: [],
      last_block_kind: "none",
      last_block_excerpt: "",
    };
  }

  const text = last.text.trim();
  const excerpt = text.length > 120 ? "…" + text.slice(-120) : text;

  const signals: CompletenessSignal[] = [];

  // Strip trailing closers so we look at the "real" final character.
  const coreEnd = stripTrailingClosers(text);
  const lastChar = coreEnd.slice(-1);

  // ── Strong signal: mid-clause punctuation as final char ────────────────
  if (MID_CLAUSE_PUNCT.has(lastChar)) {
    signals.push({
      code: "mid_clause_punct",
      strength: "strong",
      detail: `ends with '${lastChar}'`,
    });
  }

  // ── Strong signal: ends on an opening quote/paren ──────────────────────
  if (OPENING_MARKS.has(lastChar)) {
    signals.push({
      code: "opening_mark",
      strength: "strong",
      detail: `ends with '${lastChar}'`,
    });
  }

  // ── Strong signal: last whitespace-delimited token is a Hebrew fragment ─
  const tokens = coreEnd.split(/\s+/).filter(Boolean);
  const lastToken = tokens[tokens.length - 1] ?? "";
  // Trim any trailing punctuation off the token before comparing.
  const cleanToken = lastToken.replace(/[.,;:!?׃״׳)\]\}"'»”’\-–—]+$/u, "");

  if (cleanToken && HEBREW_FRAGMENT_TOKENS.has(cleanToken)) {
    signals.push({
      code: "hebrew_fragment_token",
      strength: "strong",
      detail: `last token '${cleanToken}'`,
    });
  } else if (cleanToken && cleanToken.length === 1 && HEBREW_PREFIX_LETTERS.has(cleanToken)) {
    signals.push({
      code: "hebrew_prefix_letter",
      strength: "strong",
      detail: `last token '${cleanToken}'`,
    });
  }

  // ── Weak signal: no natural terminal punctuation ───────────────────────
  const endsWithTerminal = TERMINAL_PUNCT.has(lastChar);
  if (!endsWithTerminal) {
    signals.push({
      code: "no_final_punct",
      strength: "weak",
      detail: `ends with '${lastChar}'`,
    });
  }

  // ── Strong signal: very short final paragraph with no terminal punct ───
  // (Model closed the block before writing a real sentence.)
  if (!endsWithTerminal && text.length < 20) {
    signals.push({
      code: "very_short_unterminated_final",
      strength: "strong",
      detail: `len=${text.length}`,
    });
  }

  const strongHits = signals.filter((s) => s.strength === "strong");
  const weakHits = signals.filter((s) => s.strength === "weak");

  // Retry gating:
  //   • any strong signal → truncated
  //   • multiple weak signals together → truncated
  //   • lone weak signal (e.g. `no_final_punct` only) → NOT truncated
  const truncated = strongHits.length > 0 || weakHits.length >= 2;

  return {
    truncated,
    reasons: signals.map((s) => (s.detail ? `${s.code}(${s.detail})` : s.code)),
    signals,
    last_block_kind: last.kind,
    last_block_excerpt: excerpt,
  };
}
