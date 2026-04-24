#!/usr/bin/env node
/**
 * Standalone regression test for the Stage 5e statute-name detection regex.
 *
 * Mirrors the regex + post-filters in
 * `supabase/functions/legal-qa/index.ts` (around the STATUTE_RE block).
 * Keep this file in sync when the regex changes.
 *
 * Run: `node eval/regex-statute-name.test.mjs`
 * Exits 0 on all-pass, 1 on any failure.
 *
 * Why standalone: the production regex lives inside an edge function we
 * can't import directly into vitest (Deno-only deps). Duplication is
 * acceptable here because (a) the regex is small, (b) it's the authoritative
 * way to lock down behavior, and (c) drift is caught immediately when one
 * file is updated without the other.
 */

// ────────────────────────────────────────────────────────────────────────
// MIRROR of the production regex + filters
// ────────────────────────────────────────────────────────────────────────
const HEB = "[\\u05D0-\\u05EA]";
const DEFINITE_HEAD = `ה${HEB}{2,}`;
const CONSTRUCT_HEAD = `${HEB}{2,}\\s+ה${HEB}{2,}`;
const HEAD = `(?:${CONSTRUCT_HEAD}|${DEFINITE_HEAD})`;
const PAREN_QUAL = `(?:\\s*\\([^)]{2,40}\\))?`;
const YEAR_CLAUSE = `(?:\\s*,?\\s*הת?ש${HEB}{0,3}["״׳']?${HEB}?["״׳']?\\s*[-–]\\s*\\d{4})?`;
const STATUTE_RE = new RegExp(
  `(חוק[- ]יסוד\\s*:\\s*${HEB}[^,.\\n\\[\\]()]{2,80}` +
  `|חוק\\s+${HEAD}(?:\\s+${HEAD})?${PAREN_QUAL}${YEAR_CLAUSE}` +
  `|פקודת\\s+${HEAD}(?:\\s+${HEAD})?${PAREN_QUAL}${YEAR_CLAUSE}` +
  `|תקנות\\s+${HEAD}(?:\\s+${HEAD})?${PAREN_QUAL}${YEAR_CLAUSE})`,
  "g",
);
const RULE37_ANCHOR = /ס["״]ח|ק["״]ת|נ["״]ח|ע["״]ר|פ["״]ד|סעיף\s+\d|ס['׳]\s*\d|תק['׳]\s*\d/;
const PREP_TAIL = /\s[לבמכ]$/;

function extractKept(body) {
  const kept = [];
  let m;
  STATUTE_RE.lastIndex = 0;
  while ((m = STATUTE_RE.exec(body)) !== null) {
    let name = m[1].replace(/\s+/g, " ").trim().replace(/[,;:.]+$/, "");
    name = name.replace(/\s*\([^)]*$/, "").trim();
    if (PREP_TAIL.test(name) && !/\d{4}/.test(name)) continue;
    const after = name.replace(/^(חוק[- ]יסוד\s*:\s*|חוק\s+|פקודת\s+|תקנות\s+)/, "");
    const tokens = after.split(/\s+/).filter(Boolean);
    const hasYear = /\d{4}/.test(name);
    const hasParen = /\([^)]+\)/.test(name);
    if (tokens.length <= 2 && !hasYear && !hasParen) {
      const wStart = Math.max(0, m.index - 120);
      const wEnd = Math.min(body.length, m.index + name.length + 120);
      const window = body.slice(wStart, wEnd);
      if (!RULE37_ANCHOR.test(window)) continue;
    }
    kept.push(name);
  }
  return kept;
}

// ────────────────────────────────────────────────────────────────────────
// Test cases
// ────────────────────────────────────────────────────────────────────────
const POSITIVES = [
  // [body, expected substring(s) that MUST be in kept output]
  [
    'הוראות חוק העונשין, התשל"ז-1977, ס"ח 226, חלות על המקרה.',
    ["חוק העונשין"],
  ],
  [
    'יש לעיין בחוק-יסוד: כבוד האדם וחירותו, ס"ח 150.',
    ["חוק-יסוד: כבוד האדם וחירותו"],
  ],
  [
    'ראו תקנות התעבורה, התשכ"א-1961, ק"ת 1128.',
    ["תקנות התעבורה"],
  ],
  [
    'חוק סדר הדין הפלילי [נוסח משולב], התשמ"ב-1982, ס"ח 43.',
    ["חוק סדר הדין הפלילי"],
  ],
  [
    'פקודת הראיות [נוסח חדש], התשל"א-1971, נ"ח 421.',
    ["פקודת הראיות"],
  ],
  [
    'הוראת סעיף 2 לחוק יסודות המשפט, התש"ם-1980, ס"ח 163.',
    ["חוק יסודות המשפט"],
  ],
  [
    // Short name, no year, but anchored by ס"ח nearby — should keep
    'חוק החוזים, ס"ח 12.',
    ["חוק החוזים"],
  ],
  [
    // Short name, no year, but anchored by pinpoint (סעיף N) — should keep
    'הוראות חוק החוזים מחייבות. ראו סעיף 1 לחוק החוזים.',
    ["חוק החוזים"],
  ],
];

const NEGATIVES = [
  // Drafter prose containing "חוק" as a verb/object — must NOT be captured
  'החוק קובע כי על המשיב לפצות את התובע.',
  'חוק זה מסדיר את היחסים בין הצדדים.',
  'תקנות אלו אינן רלוונטיות לעניינו.',
  'יש להחיל חוק יעילה על כל המקרים.',  // "חוק יעיל[ה]" – descriptor
  'נדרש חוק חדש בנושא זה.',             // "חוק חדש" – descriptor
  'מדובר בחוק מתאים לנסיבות.',          // "חוק מתאים" – descriptor
  'פקודת ל...',                          // dangling preposition + no year
  'תקנות של המנהל קובעות זאת.',         // "תקנות של" – preposition, no year
  // Short name + no year + no anchor in surrounding ±120 chars
  'הזכיר את חוק החוזים בהקשר זה. הצדדים לא הסכימו על שום דבר נוסף בעניין הסכסוך.',
];

let pass = 0, fail = 0;
const failures = [];

for (const [body, expected] of POSITIVES) {
  const kept = extractKept(body);
  const ok = expected.every((exp) => kept.some((k) => k.includes(exp)));
  if (ok) pass++;
  else { fail++; failures.push(`POS FAIL: "${body}" → kept=${JSON.stringify(kept)} expected to contain ${JSON.stringify(expected)}`); }
}

for (const body of NEGATIVES) {
  const kept = extractKept(body);
  if (kept.length === 0) pass++;
  else { fail++; failures.push(`NEG FAIL: "${body}" → unexpectedly kept ${JSON.stringify(kept)}`); }
}

console.log(`\nStatute-name regex test: ${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
process.exit(0);
