
# Repeated-Citation Short Forms — Occurrence Footnotes (conservative v1, approved)

Deterministic post-processor in the drafter. No LLM, no drafter prompt change, no marker movement, no prose rewrite, no retrieval/verifier/source-selection changes, no DB schema change, no frontend rendering change, no sources-only change.

## 1. Conceptual model

- `used_sources[]` — unique verified sources (unchanged).
- `footnotes[]` — becomes **occurrence-indexed**: one entry per body-marker occurrence, numbered chronologically `1..K`. Each entry resolves back to a `used_sources` row via `source_number`.
- Repeated body markers get **new** occurrence numbers. The footnote list uses `שם.` (ibid) or `<short>, לעיל ה״ש N.` (supra).

## 2. Hard preconditions (both must hold to apply Phase 3)

Run on the **post-cleanup** answer, before any rewrite.

1. **No adjacent superscript clusters.** If `/[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/u` matches anywhere → skip Phase 3 entirely. Record `phase3.discarded_reason = "ambiguous_adjacent_markers"` + up to 5 cluster snippets. Reason: `²³` → `¹²` is forbidden — visually indistinguishable from footnote 12.
2. **K < 10.** Count distinct marker occurrences in the answer. If `K >= 10` → skip Phase 3 entirely. Record `phase3.discarded_reason = "multi_digit_occurrences_require_boundary_tokens"`. Reason: a legitimate `¹⁰` occurrence marker is visually indistinguishable from adjacent single-digit markers without an explicit boundary token; v1 refuses to ship in that regime.

When either precondition fails, legacy outputs (`answer`, `used_sources`, `footnotes`) are preserved unchanged.

Additionally, a **post-expansion guard** re-scans the rewritten answer for `/[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/u`. Any hit → full rollback, `phase3.discarded_reason = "would_create_ambiguous_markers"`. (Defense in depth; with K<10 + no-input-cluster, this should be unreachable.)

## 3. Schema (additive, `lib/types.ts`)

```ts
export interface Footnote {
  number: number;                       // occurrence index 1..K when phase3 applied; legacy unique number otherwise
  title: string;                        // full title OR short-form rendering ("שם." / "<short>, לעיל ה״ש N.")
  url: string | null;                   // null for short-form entries
  source_type?: string;
  source_number?: number;               // back-pointer into used_sources[].number (first-occurrence number)
  is_short_form?: boolean;
  short_form_kind?: "ibid" | "supra";
  back_ref_number?: number;             // first-occurrence footnote number for this source
  source_candidate_id?: string;         // debug only, never rendered
}
```

`UsedSource` unchanged. `used_sources[i].number` denotes the **first-occurrence footnote number** for that unique source after expansion, so `back_ref_number === used_sources[*].number` for the matching row.

`MarkerValidation` (all optional, additive):

```ts
occurrence_mode?: boolean;
occurrence_count?: number;              // K
unique_source_count?: number;
short_form_count?: number;
ibid_count?: number;
supra_count?: number;
every_marker_has_footnote?: boolean;    // hard gate
every_footnote_in_usable?: boolean;     // hard gate
no_adjacent_marker_clusters?: boolean;  // hard gate
```

`CitationCleanupReport.phase3`:

```ts
phase3: {
  applied: boolean;
  occurrence_count?: number;
  unique_source_count?: number;
  short_form_count?: number;
  ibid_count?: number;
  supra_count?: number;
  examples?: Array<{ marker_number: number; rendering: string }>;
  discarded_reason?:
    | "ambiguous_adjacent_markers"
    | "multi_digit_occurrences_require_boundary_tokens"
    | "would_create_ambiguous_markers"
    | "marker_validation_failed"
    | "footnote_resolution_failed"
    | "no_markers";
  cluster_examples?: string[];
};
```

## 4. Validation rules

Legacy invariants kept when `phase3.applied === false`:
- `footnote_count === used_sources.length`
- `markers_in_answer ⊆ used_sources.numbers`

New invariants when `phase3.applied === true` (checked by `validateOccurrenceFootnotes`, AND-ed into `marker_validation.ok`):
- Pre-expansion preconditions held (no adjacent clusters; `K < 10`).
- `markers_in_answer` is exactly `[1..K]` in order of first appearance (single-digit only by precondition #2).
- `footnotes.length === K`; each `footnotes[i].number === i+1` in order.
- For every footnote `f`: `f.source_number ∈ used_sources.map(u => u.number)`.
- For every `used_sources[u]`: `u.candidate_id ∈ verifier.usable.map(v => v.candidate_id)` (unchanged).
- Source-set equality: the set of `source_number` values present in `footnotes[]` equals the set of `used_sources[*].number` (no source added, no source dropped).
- `internal_id_leak === false` (unchanged).
- `no_adjacent_marker_clusters === true` on the rewritten answer.
- `stripSup(rewritten) === stripSup(input)` (prose byte-equal except superscript digits).

`index.ts` telemetry adds `unique_source_count` alongside the existing `footnote_count` (which equals K when applied, equals unique count when skipped).

## 5. Algorithm — `applyOccurrenceFootnotes(answer, used, footnotes_pre)`

Pure-string, deterministic, idempotent. Runs in `drafter.ts` between `applyCitationCleanup(...)` and `validatePlacement(...)`. Env gate: `LEGAL_RESEARCH_V1_OCCURRENCE_FOOTNOTES` (default `on`).

1. **Precondition #1 (clusters).** If `/[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/u` matches → record reason `ambiguous_adjacent_markers` (+ up to 5 cluster examples) and return inputs unchanged.
2. **Marker walk + precondition #2 (K).** Walk `/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/u` left→right. Precondition #1 guarantees every run is length 1, but we still parse each run as a number for safety. Count occurrences `K`. If `K === 0` → reason `no_markers`, return unchanged. If `K >= 10` → reason `multi_digit_occurrences_require_boundary_tokens`, return unchanged.
3. **Source resolution.** For each marker at value `N`, look up `used.find(u => u.number === N)`. Lookup failure → reason `footnote_resolution_failed`, return unchanged.
4. **Assign occurrence numbers `1..K`** in walk order. Build rewritten answer by splicing the superscript encoding of each new occurrence number at the exact original positions; all non-marker characters untouched.
5. **Post-expansion guard.** Re-scan rewritten answer for `/[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/u` → rollback if hit, reason `would_create_ambiguous_markers`.
6. **Build occurrence `footnotes[]` of length K.** Track `firstSeen: Map<originalSourceNumber, occurrenceIndex>` and `prevSourceNumber`.
   - First time seeing source `S` at occurrence `i`: full footnote `{ number: i, title: S.title, url: S.url, source_type: S.source_type, source_number: i, is_short_form: false }`. Record `firstSeen[S.number_original] = i`. Update the matching `used_sources` row so its `number` becomes `i`.
   - Else if `prevSourceNumber === S` (immediately preceding occurrence is same source): ibid → `{ number: i, title: "שם.", url: null, is_short_form: true, short_form_kind: "ibid", back_ref_number: firstSeen[S], source_number: firstSeen[S] }`.
   - Else: supra → `{ number: i, title: <short>(S) + ", לעיל ה״ש " + firstSeen[S] + ".", url: null, is_short_form: true, short_form_kind: "supra", back_ref_number: firstSeen[S], source_number: firstSeen[S] }`.
7. **Validate.** Run existing `runMarkerValidation` on rewritten answer + updated `used_sources`, then `validateOccurrenceFootnotes`. Any failure → full rollback, reason `marker_validation_failed`.
8. **Prose-invariance assertion.** `stripSup(rewritten) === stripSup(input)`. Mismatch → rollback.

## 6. `shortenTitle(source)` — deterministic, no LLM

Used only for `supra`. Pure string heuristics over `source.title` + `source.source_type`:

- **case**: substring up to the first comma; if title contains ` נ' `, take `"<plaintiff> נ' <defendant>"` up to the next comma.
- **statute / regulation**: strip trailing `, התש"…—NNNN` and any trailing parenthetical; keep law name.
- **academic**: author surname (token before first comma), then quoted/«…» title truncated to ~6 Hebrew words.
- **report / other / unknown**: first 8 words of the title, ellipsis if longer.

Fallback when extraction yields empty: `title.slice(0, 80)`. Unit-tested.

## 7. Files touched

- `supabase/functions/legal-research-v1/lib/types.ts` — additive fields.
- `supabase/functions/legal-research-v1/stages/drafter.ts` — new exported `applyOccurrenceFootnotes`, `validateOccurrenceFootnotes`, `shortenTitle`; wired between `applyCitationCleanup` and `validatePlacement`; env-gated.
- `supabase/functions/legal-research-v1/stages/drafter.cleanup.test.ts` — extend with the cases below.
- `supabase/functions/legal-research-v1/index.ts` — add `unique_source_count` to telemetry next to `footnote_count`.
- `scripts/legal-research-v1-occurrence-footnotes-runner.ts` — new validation harness.
- `reports/legal-research-v1-occurrence-footnotes-*.json` + `.md`.

**Untouched**: retrieval, verifier, candidate pool, sources-only (`lib/sourcesOnly.ts`), frontend rendering (`FootnotesSection.tsx`, `footnoteRerender.ts`), DB schema, RLS, drafter prompt.

## 8. Unit tests (`drafter.cleanup.test.ts`)

- Separated repeat (A, A): `אחריות³ ... השפעה³` → `אחריות¹ ... השפעה²`; footnote 2 = `שם.`, `back_ref_number = 1`.
- A, B, A: `…³ …⁴ …³` → `…¹ …² …³`; footnote 3 = `"<short A>, לעיל ה״ש 1."`.
- A, A, B, A: ibid at 2, full B at 3, supra-to-1 at 4.
- **Cluster guard:** input containing `²³` → skip, `phase3.discarded_reason === "ambiguous_adjacent_markers"`, outputs byte-equal to input.
- **Cluster guard (longer):** input containing `¹²³` → same skip.
- **K-guard:** synthetic input with 10 separated markers (each on its own word, no clusters) → skip, `phase3.discarded_reason === "multi_digit_occurrences_require_boundary_tokens"`.
- **K-guard boundary:** 9 separated markers → applies normally; 10 → skips.
- Prose invariance: `stripSup(out) === stripSup(in)` on every successful expansion.
- Idempotency: running expansion twice on a successful output is a no-op.
- `shortenTitle`: statute, case, academic, report cases.

## 9. Production validation harness

`scripts/legal-research-v1-occurrence-footnotes-runner.ts`, modelled on `legal-research-v1-cluster-prevention-runner.ts`. Fixtures: L1–L6 + PROT + 3 ad-hoc citation-heavy questions designed to induce same-source repeats.

Per fixture capture:
- hard gates: `marker_validation.ok`, `internal_id_leak === false`, `every_marker_has_footnote`, `every_footnote_in_usable`, `no_adjacent_marker_clusters`, `unique_source_count` unchanged vs baseline.
- counts: `phase3.applied`, `phase3.discarded_reason`, `occurrence_count` (K), `unique_source_count`, `short_form_count`, `ibid_count`, `supra_count`.
- examples: up to 5 short-form footnotes verbatim with surrounding body context.
- prose-diff: `stripSup` byte-equal before/after on every applied fixture.
- runtime: total_ms vs cluster-prevention baseline.

Summary report aggregates explicitly:
- # fixtures with Phase 3 applied;
- # skipped due to `ambiguous_adjacent_markers`;
- # skipped due to `multi_digit_occurrences_require_boundary_tokens`;
- examples of `שם` and `לעיל ה״ש`;
- runtime delta;
- proof of prose invariance;
- proof of zero source drops;
- proof of no footnote-mapping regression.

## 10. Acceptance gates

- All existing hard grounding gates remain green on every fixture.
- No ambiguous marker rendering anywhere (`no_adjacent_marker_clusters === true` on all shipped answers).
- Every applied fixture has `K < 10`.
- For every applied fixture:
  - body markers strictly `[1..K]` in order of appearance;
  - every marker has exactly one footnote;
  - every footnote's `source_number ∈ used_sources[*].number`;
  - `unique_source_count` unchanged vs baseline (no source dropped, no source added);
  - repeat patterns produce `שם` / `לעיל ה״ש` correctly on spot-checks;
  - `stripSup` byte-equal before/after.
- For skipped fixtures: legacy outputs ship unchanged; legacy invariants still hold; reason is one of the two preconditions.
- Runtime delta within noise.

If any fixture fails hard gates while `phase3.applied === true`, the run stops and reports. No LLM repair, retry, or expansion of the preconditions will be added without further approval.

## Out of scope (explicit)

LLM repair, drafter prompt changes, marker movement across words/sentences, retrieval/verifier/selection/DB/sources-only/frontend changes, expansion of adjacent clusters (`²³` → `¹²`), multi-digit occurrence support (`K >= 10`), explicit marker-boundary tokens, Rule 37 body rewrites beyond occurrence numbering.
