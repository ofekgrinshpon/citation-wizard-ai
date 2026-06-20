// Unit tests for the exact_authority confidence guard and Perplexity reservation.
// Run with: deno test supabase/functions/legal-research-v1/stages/exactAuthorityGuard.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyExactAuthorityGuard, stripLegalHead } from "./localRetrieval.ts";
import { buildCandidatePool } from "./candidatePool.ts";
import { Candidate } from "../lib/types.ts";

// ─── Guard: negative cases (malformed fragments must be skipped) ────────────

const NEGATIVES: Array<{ input: string; reason: string }> = [
  { input: "חוק יס", reason: "too_short" },        // 6 chars
  { input: "חוק הי", reason: "too_short" },
  { input: "חוק הס", reason: "too_short" },
  { input: "חוק ומ", reason: "too_short" },
  { input: "חוק ה",  reason: "too_short" },
  { input: "החוק",   reason: "too_short" },
];

for (const { input, reason } of NEGATIVES) {
  Deno.test(`guard skips fragment: "${input}" → ${reason}`, () => {
    const r = applyExactAuthorityGuard(input);
    assertEquals(r.exact_lookup_skipped, true, `expected skip for "${input}"`);
    assertEquals(r.skipped_reason, reason);
    assertEquals(r.title_tokens_for_ilike.length, 0,
      "skipped clue must contribute zero ilike tokens");
  });
}

// ─── Guard: positive cases (real law names must pass) ───────────────────────

const POSITIVES = [
  "חוק יסוד ישראל מדינת הלאום",
  "חוק יסוד: ישראל – מדינת הלאום של העם היהודי",
  "חוק יסוד משק המדינה",
  "חוק החוזים תרופות בשל הפרת חוזה",
  "חוק יסודות התקציב",
  "פקודת הנזיקין [נוסח חדש]",
];

for (const input of POSITIVES) {
  Deno.test(`guard accepts law name: "${input}"`, () => {
    const r = applyExactAuthorityGuard(input);
    assertEquals(r.exact_lookup_skipped, false, `expected accept for "${input}"`);
    assert(r.title_tokens_for_ilike.length >= 2,
      `expected >=2 ilike tokens, got ${r.title_tokens_for_ilike.length}`);
    for (const t of r.title_tokens_for_ilike) {
      assert(t.length >= 3, `token "${t}" must have length>=3`);
    }
    // Sanity: no 1–2 char fragments leak through.
    const bad = r.title_tokens_for_ilike.find((t) =>
      ["יס", "הי", "הס", "ומ"].includes(t)
    );
    assertEquals(bad, undefined, "no 1–2 char fragments in ilike tokens");
  });
}

Deno.test("stripLegalHead removes only known heads, anchored at start", () => {
  assertEquals(stripLegalHead("חוק-יסוד: ישראל"), ": ישראל");
  assertEquals(stripLegalHead("חוק יסוד משק המדינה"), "משק המדינה");
  assertEquals(stripLegalHead("חוק החוזים"), "החוזים");
  assertEquals(stripLegalHead("פקודת הנזיקין"), "הנזיקין");
  assertEquals(stripLegalHead("תקנות התעבורה"), "התעבורה");
  // No head match → unchanged.
  assertEquals(stripLegalHead("עילת הסבירות"), "עילת הסבירות");
});

// ─── Pool reservation: trusted Perplexity is retained ───────────────────────

function mkExact(i: number): Candidate {
  return {
    candidate_id: `ex-${i}`,
    claim_id: "c1",
    role: "primary_statute",
    origin: "local",
    retrieval_method: "exact_authority",
    title: `Statute ${i}`,
    document_id: `doc-ex-${i}`,
    source_type: "israeli_law",
    source_url: `https://example.org/law/${i}`,
    snippet: null,
    query_he: "q",
    score: 0.9,
  } as Candidate;
}

function mkPplx(i: number, opts: { trusted: boolean }): Candidate {
  return {
    candidate_id: `px-${i}`,
    claim_id: "c1",
    role: "scholarship",
    origin: "perplexity",
    retrieval_method: "perplexity",
    title: `Perplexity ${i} ${opts.trusted ? "trusted" : "weak"}`,
    source_type: "other",
    source_url: `https://example.com/px/${i}`,
    snippet: null,
    query_he: "q",
    score: opts.trusted ? 0.95 : 0.75,
    metadata: {
      classified_source_class: opts.trusted ? "scholarship" : "unknown",
    },
  } as Candidate;
}

Deno.test("pool reserves trusted Perplexity against exact_authority flood", () => {
  const all: Candidate[] = [
    ...Array.from({ length: 30 }, (_, i) => mkExact(i)),
    ...Array.from({ length: 10 }, (_, i) => mkPplx(i, { trusted: true })),
  ];
  const r = buildCandidatePool(all);
  const pplxKept = r.candidates.filter((c) => c.retrieval_method === "perplexity");
  assertEquals(pplxKept.length, 10, "all 10 trusted Perplexity must be retained");
  assertEquals(r.candidates.length, 30, "total capped at MAX_CANDIDATES=30");
});

Deno.test("pool does NOT force-reserve weak Perplexity merely because retrieval_method='perplexity'", () => {
  const all: Candidate[] = [
    ...Array.from({ length: 30 }, (_, i) => mkExact(i)),
    ...Array.from({ length: 10 }, (_, i) => mkPplx(i, { trusted: false })),
  ];
  const r = buildCandidatePool(all);
  const pplxKept = r.candidates.filter((c) => c.retrieval_method === "perplexity");
  // Weak Perplexity (score 0.75, class "unknown") does not satisfy the trusted
  // predicate → reservation pass admits zero, and tier ordering keeps the 30
  // exact_authority candidates ahead of them.
  assertEquals(pplxKept.length, 0,
    "weak Perplexity must not be reserved or admitted ahead of exact_authority");
  assertEquals(r.candidates.length, 30);
});
