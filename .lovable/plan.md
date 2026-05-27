
# Citation Cleanup Plan — legal-research-v1 (revised, deterministic-only)

Scope this round: **Phase 1 (chronological renumbering) + Phase 2
(punctuation normalization) + cluster telemetry only**. No thin-space
separation, no marker movement across words, no Rule-37 body rewrite, no
repeated-citation short forms, no LLM calls. Stops after the validation
report.

Untouched: retrieval, Perplexity, verifier, candidate pool, source
selection, drafter prose, sources-only mode, DB schema, frontend.

## Where the code lives

- `supabase/functions/legal-research-v1/stages/drafter.ts`
  - Existing helpers: `toSuperscript`, `SUP_TO_DIGIT`, `extractMarkers`,
    `runMarkerValidation`, `deterministicRepair` (~lines 580–656).
  - `deterministicRepair` today runs **only on marker_validation failure**
    (called at lines 800 and 876). This plan promotes it to an always-on
    normalization step and adds a punctuation pass + cluster counter
    immediately after it.
- `supabase/functions/legal-research-v1/lib/telemetry.ts` — no edits;
  new fields ride on the existing `metadata` blob.
- No new files. No frontend changes.

---

## Phase 1 — Chronological renumbering (always on)

**Edits in `drafter.ts`:**

1. Add a thin wrapper `normalizeNumbering(answer, used)` that calls the
   existing `deterministicRepair` and, when markers are already 1..k in
   first-appearance order, returns the input unchanged (instead of `null`)
   so the caller never has to special-case "no-op".
2. After the initial parse (~line 795) and again after escalation
   (~line 874), call it unconditionally on `parsed.ok` paths, then re-run
   `runMarkerValidation`:
   ```ts
   const before = answer;
   const norm = normalizeNumbering(answer, used);
   const candidate = norm ?? { answer_markdown: answer, used_sources: used };
   const m2 = runMarkerValidation(candidate.answer_markdown, candidate.used_sources);
   if (m2.ok) {
     answer = candidate.answer_markdown;
     used   = candidate.used_sources;
     marker = { ...m2, repaired: m2 !== marker };
     cleanup.phase1 = { applied: true, changed: before !== answer };
   } else {
     cleanup.phase1 = { applied: false, discarded_reason: "marker_validation_failed" };
   }
   ```
3. Keep all existing failure-path fallbacks (C# scrub, escalation) as-is.

**Telemetry:** `metadata.citation_cleanup.phase1 = { applied, changed,
discarded_reason?, before_order, after_order }`.

**Acceptance:** chronological markers; `footnote_count === used_sources.length`;
`used_sources ⊆ verifier.usable`; no internal-id leaks; only marker digit
characters change; if validation fails, original output is preserved.

---

## Phase 2 — Punctuation normalization

Runs immediately after Phase 1, on the same `answer` string.

**Transform (single regex, iterated to fixed-point):**

```ts
const PUNCT = /([⁰-⁹])([.,;:?!])/u;   // ASCII terminal/clause punctuation
let punctSwaps = 0;
let prev: string;
do {
  prev = answer;
  answer = answer.replace(new RegExp(PUNCT, "gu"), (_m, sup, p) => {
    punctSwaps++;
    return p + sup;
  });
} while (answer !== prev);
```

Rules enforced by construction:
- Marker must be **immediately** before the punctuation char (no space) →
  `קוראים¹ לי אופק.` is left alone (space between `¹` and `לי`).
- Hops exactly one punctuation character; never crosses a word boundary or
  sentence boundary.
- Punctuation set kept conservative: `. , ; : ? !` (ASCII forms; Hebrew
  legal text uses ASCII for these). Hebrew gershayim/geresh (`״`, `׳`)
  are **excluded** — they're typographic marks inside words, not clause
  terminators, and including them would create false positives.
- Marker count, marker digits, footnote list, and `used_sources` are
  untouched. Verified by re-running `runMarkerValidation`; if it fails for
  any reason, the punctuation pass is rolled back to the Phase-1 output.

**Telemetry:** `metadata.citation_cleanup.phase2 = { applied, punct_swaps,
discarded_reason? }`.

**Acceptance examples:**
- `טקסט¹.` → `טקסט.¹`, `טקסט²,` → `טקסט,²`, `טקסט³;` → `טקסט;³`,
  `טקסט⁴?` → `טקסט?⁴`, `טקסט⁵!` → `טקסט!⁵`
- `קוראים¹ לי אופק.` unchanged
- `אחריות¹²³⁴.` → `אחריות¹²³.⁴` (only the last marker hops the dot —
  cluster handling is out of scope for Phase 2 by design; reported via
  telemetry below)

---

## Cluster telemetry (detection only)

After Phase 2, scan the final `answer` for adjacent superscript runs:

```ts
const CLUSTER = /[⁰-⁹]{2,}/gu;
const clusters: Array<{ run: string; index: number; context: string }> = [];
for (const m of answer.matchAll(CLUSTER)) {
  clusters.push({
    run: m[0],
    index: m.index!,
    context: answer.slice(Math.max(0, m.index! - 12), m.index! + m[0].length + 12),
  });
}
```

Record `metadata.citation_cleanup.clusters = { count: clusters.length,
examples: clusters.slice(0, 5) }`. No mutation, no markers moved, no
spaces inserted, no merges.

---

## Tests (unit, in drafter test file or new `drafter.cleanup.test.ts`)

- Phase 1: drafter emits `...²...¹...³` → renumbered to `...¹...²...³`
  with reordered `used_sources`; pass-through when already sorted.
- Phase 1 rollback: synthetic case where renumbering would yield a
  `marker_validation` failure → original answer/used preserved,
  `discarded_reason === "marker_validation_failed"`.
- Phase 2 hops: `.,;:?!` each swap once; iterated form handles
  `טקסט¹.` and confirms idempotence on a second pass.
- Phase 2 non-hop: space between marker and punctuation prevents swap;
  `קוראים¹ לי אופק.` unchanged.
- Cluster telemetry: `¹²³⁴` produces one cluster of length 4 in metadata,
  answer unchanged.
- Marker-count invariant under Phase 1 + Phase 2 across all of the above.

---

## Validation harness

Reuse `eval/legal-research-v1/fixtures.json` (L1–L6) plus 5 real questions
captured from `qa_logs` flagged as clustered or out-of-order in earlier
phaseB runs. New runner: `scripts/legal-research-v1-citation-cleanup-runner.ts`
mirroring the existing p7-phase runners; report at
`reports/legal-research-v1-citation-cleanup.json` + a short `.md` summary.

Per fixture report:
- `marker_validation.ok` (must be true)
- `internal_id_leak` (must be false)
- `footnote_count === used_sources.length`
- `used_sources ⊆ verifier.usable`
- chronological numbering before/after (markers strictly increasing on
  first appearance)
- `punct_swaps` count
- `cluster_count` before / after with up to 5 example contexts
- `runtime_delta_ms` vs the equivalent phaseE5 baseline (target ≈ 0)
- `cleanup_discarded` flag + reason when validation forced rollback

## Out of scope (explicit)

- No thin-space or comma-separated marker rendering.
- No movement of markers across words or sentences.
- No LLM-based placement repair.
- No Rule-37 body-marker rewrite.
- No repeated-citation short forms (deferred Phase 3).
- No retrieval / verifier / drafter / source-selection changes.
- No frontend changes.
- No DB schema changes.

Stop after the Phase 1 + punctuation-normalization report.
