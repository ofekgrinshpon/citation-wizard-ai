# ReLex V2 — Judgment Identity False-Negative Fix

Scope: acquisition-time judgment identity only. No change to discovery breadth,
evidence admission, support verification, temporal logic, sufficiency, drafting,
citation rendering or acquisition budgets. No source allowlists, no trust
domains, no "official host is proof" rule.

## 1. Diagnosis

Three distinct mechanisms rejected readable, genuine judgment bodies.

| # | Mechanism | Effect |
|---|-----------|--------|
| 1 | Proceeding-type table missing labour/administrative forms (`ע"ע`, `עב"ל`, `עס"ק`, `ס"ק`, `סע"ש`, `ע"ב`, `עמ"נ`, `עמ"ש`) and the judgment-form classifier only knowing `בבית המשפט` openers | A National Labour Court judgment was not recognizable as a judgment at all → `judgment_body_form_absent` |
| 2 | `לעבודה` listed as a lower-court marker | The National Labour Court (`בית הדין הארצי לעבודה`, the apex labour instance) was read as a lower court → `docket_court_level_mismatch` |
| 3 | Absence of a proceeding token next to the docket treated identically to a *conflicting* proceeding token; caption probe line-structured only | Old-format bodies (`תיק 135/75`) and flattened PDF extractions, where the whole caption survives as one long line, could never self-identify |

## 2. Changes

**`vendor/docketDetection.ts`** — added the eight corpus/benchmark-attested
proceeding prefixes above plus their no-quote aliases. Exported
`PROCEEDING_TOKENS` so corroboration can distinguish a *different* proceeding
type from *no* proceeding type. `authorityKeyOf` is untouched: authority keys
remain number-based and compatible with persisted state.

**`vendor/judgmentBodyForm.ts`**
- opener recognition extended to `בבית הדין` / `בית הדין הארצי|האזורי לעבודה`;
  decision headers tolerate hyphenated `פסק-דין`; labour party terms added.
  No existing signal was removed or made optional.
- flattened-caption fallback: when the line-shaped caption probe finds nothing,
  a bounded raw window around the same early docket hit is read. The bar is
  **raised**, not lowered — three distinct structural signals instead of two,
  a strong (party-bearing) signal still mandatory.
- `assessHeadStructure()`: bounded 4,000-character head analysis, used only by
  the structured-metadata path below.

**`tools/authorityCorroboration.ts`**
- a docket occurrence carrying a *different known* proceeding token is still a
  hard `docket_proceeding_type_mismatch`; a docket occurrence with *no*
  proceeding token no longer short-circuits — the judgment-form and caption
  gates must carry the identity instead.
- proceeding token may sit up to three tokens before the number, so a court
  descriptor (`ע"ע (ארצי) 478/09`) no longer breaks the match.
- `isLowerCourtContext()`: `לעבודה` alone no longer implies a lower court when
  the same context says `ארצי`. Only the labour courts are affected.
- new basis `structured_docket_metadata_corroborated` (local corpus only).
  Stored `case_number` may supply identity a dropped PDF caption lost, but only
  when **all** hold: exact normalized docket match; body classified
  `substantive_judgment_body`; judicial caption structure in the head including
  a party-bearing signal; no competing docket in the head. Metadata alone never
  binds anything.

**`tools/lookupAuthority.ts`** — the expected identity now preserves the full
case identity (proceeding type, explicit court qualifier, number) instead of
bare digits. The stable authority key is unchanged.

**`tools/fetch.ts`** — local-corpus acquisitions pass the stored `case_number`
into corroboration. HTTP bodies cannot reach that path.

## 3. Tests

`src/test/judgmentIdentityFalseNegative.test.ts` — 19 deterministic tests.

Accept: labour-court judgment; labour judgment with `(ארצי)` descriptor;
regional labour judgment with its own qualifier; old-format judgment with no
proceeding token; flattened one-line PDF caption; metadata-rescued judgment with
a lost docket line.

Reject: metadata + article; metadata + summary; metadata + competing docket in
head; mismatched metadata; wrong proceeding type, same number; wrong court
level; a judgment merely citing the requested case; law-firm commentary;
search/listing page; newsletter header card; metadata-only stub.

Full suite: **867 passed, 0 failed** (77 files). `tsgo` clean. One pre-existing
assertion in `rawWebSearch.test.ts` was widened: a bare digit mention is still
refused, now as `judgment_body_form_absent` rather than
`docket_proceeding_type_mismatch`. Both are hard refusals; no behaviour relaxed.

## 4. Validation — Q23, Q25, Q28, Q30 (sequential, deployed build)

| Q | run_id | verified claims | footnotes | central covered | identity rejections | unresolved authorities |
|---|--------|-----------------|-----------|-----------------|---------------------|------------------------|
| Q23 | 0af07689 | 2 | 1 | true | 0 | case:2098/97, case:55758/05 |
| Q25 | 515d498b | 3 | 2 | true | 0 | case:7829/03 |
| Q28 | f7a81f0b | 5 | 1 | true | 0 | case:5168/93 |
| Q30 | 60445913 | 6 | 2 | true | 0 | statute:חוק זכויות הסטודנט |

An earlier Q23 run (`de50f5cd`) was launched together with a stray duplicate
caused by an import side effect in the launcher; the launcher was fixed and Q23
was rerun alone, and the solo run is the one reported.

Acceptance baseline (batch 3) recorded **six** identity rejections of obtained
bodies across these four questions: Q23 case:2098/97; Q25 case:4855/02,
case:6339/18, case:6222/97; Q28 case:478/09; Q30 case:73/53. Post-fix, five of
those six no longer appear as unresolved, and the entire ledger across all four
runs contains **zero** identity-rejection reasons — remaining failures are
network-edge (`http_403`, `http_471`), extraction (`pdf_extract_failed`),
or `too_short_for_a_document`. Q30 in particular moved from four unresolved
temporal claims and score 45 to 6 verified claims, 0 temporal unresolved.

## 5. Safety comparison

| Check | Result |
|-------|--------|
| Unsupported core claims | 0 in all four runs |
| Invariant errors | 0 |
| Evidence still rejected on merit | yes — 4 `support_does_not_support` / `span_not_found` rejections across Q23/Q25/Q28 |
| Any binding via metadata alone | none observed; the path requires body form + caption structure |
| Discovery breadth, budgets, prompts | unchanged |
| V1 / legacy code | untouched |

## 6. Residual

`case:2098/97` (Q23) and `case:5168/93`, `case:7829/03` remain unresolved, now
through network-edge and extraction failures rather than identity. Source and
citation quality issues recorded in the acceptance report are unchanged and out
of scope here.

JUDGMENT IDENTITY FALSE-NEGATIVE FIX SHIPPED — TARGETED VALIDATION PASSED
