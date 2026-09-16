# Footnote Presentation + Rule 37 Repeat Citations

Scope: presentation / citation rendering only. No research, retrieval,
verification, identity, source-selection, claim-support, model, prompt or
budget behaviour was touched.

## 1. Root cause

Three independent defects in the user-facing citation layer:

| Defect | Cause |
| --- | --- |
| `[^1]` visible to users | `drafting/render.ts` emitted markdown footnote markers instead of superscripts |
| Footnotes shown twice | `render.ts` appended `[^n]: citation` definitions to `answer_markdown`, while `toBetaResult()` also returned a structured `footnotes` array that the UI rendered as a separate card |
| Same number reused for one source | `render.ts` kept an `indexBySource` map: a footnote number belonged to a *source*, not to a *citation occurrence*, so rule 37 (`שם` / `לעיל ה"ש`) could never be expressed |

Markers were also emitted before terminal punctuation in some segments.

## 2. Shared rule 37 engine

New pure, import-free module: `supabase/functions/_shared/footnoteOccurrences.ts`.

- `toSuperscript(n)` — deterministic digit map, multi-digit safe (`12 → ¹²`).
- `placeMarkerAfterPunctuation(text, marker)` — punctuation belongs to the
  sentence; the marker follows it. Missing terminal punctuation → a period is
  added first (`הטענה נתמכת במקור.¹`).
- `buildOccurrenceFootnotes(occurrences)` — occurrence → chronological number,
  with repeat text decided at creation time:
  - first appearance → full citation;
  - previous occurrence is the same `source_id` → `שם.` / `שם, בעמ' X.`;
  - earlier but non-adjacent → `<short label>, לעיל ה"ש N[, בעמ' X].`;
  - legislation → rule 37.5: `ס' X ל<שם החוק>.`, never a case-law
    `לעיל ה"ש` label.
- `normalizeAnswerForDisplay()` — legacy compatibility (see §6).

Legal semantics are ported verbatim from `src/lib/footnoteRepeatRules.ts`
(`withBetPrefix`, `extractShortSourceLabel`, legislation handling). The only
deliberate difference: repeated authorities are identified by the deterministic
verified `source_id`, never by fuzzy title text. No second, contradictory legal
rule implementation exists, and no cross-runtime import was introduced — the
browser keeps its own copy of the *display-only* helpers in
`src/lib/legalQa/footnoteDisplay.ts`.

## 3. V2 renderer changes (`legal-research-v2/drafting/render.ts`)

Three deterministic passes:

1. collect citation occurrences in strict body-traversal order (unverified
   source ids are still rejected into `invariant_errors`);
2. `buildOccurrenceFootnotes()` assigns chronological numbers and rule 37 text
   (`footnote_offset` for Academic Writing chapters is preserved);
3. render the body with superscript markers only, placed after punctuation.

`answer_markdown` no longer contains any footnote definition. A new invariant
fails the render if `[^n]` ever reappears in user-facing text.

`Footnote` now carries `full_citation`, `first_occurrence`, `repeat_kind`
(`full | ibid | supra`) and `locator` alongside the existing public fields.
Internal ids are never exposed.

## 4. Beta result mapping (`beta/job.ts`)

`footnotes` stays occurrence-based — one row per marker, never deduplicated by
source. `used_sources` became the distinct-source analytics view, carrying each
authority's first-occurrence number and its full citation. Repeat rows carry no
URL (a `שם.` row must not render a link of its own).

## 5. UI (`LegalResearchV1Panel.tsx`)

Body card and copy both run `normalizeAnswerForDisplay()`; the footnote card is
the single footnote list. Copy output is: body (superscripts after punctuation)
→ blank line → `הערות שוליים` → exactly one chronological list.

## 6. Legacy / history compatibility

`normalizeAnswerForDisplay()` strips a trailing `[^n]: ...` definition block and
converts leftover `[^n]` markers to superscripts at display/copy time only.
Persisted historical records are never mutated, so history replay renders once
and correctly.

## 7. V1 attachment path

`src/config/researchPipeline.ts` still routes attachments to V1, so V1 was
brought to presentation parity by a new pass,
`legal-research-v1/stages/occurrenceFootnotes.ts`, applied at the very end of
`buildFootnotedAnswer()` (after the existing marker/row invariant rebuild):

- markers are walked in textual order; each occurrence gets the next number;
- repeats render rule 37 text through the same shared engine;
- `used_sources` is remapped onto first-occurrence numbers.

Source selection, CSM, alignment, hierarchy and integrity gates are untouched —
the pass only reads already-approved occurrences. It cannot create a source
relationship: footnote rows are derived exclusively from the marker stream that
already existed.

## 8. Tests

New: `src/test/footnoteOccurrenceRule37.test.ts` (17 tests) — superscripts
incl. multi-digit; punctuation-before-marker for `.` `,` `;` `?`; missing
punctuation; the exact `A, A, B, A, B, B, B, C, A` sequence (numbers, rule 37
texts, marker order, no `[^`); three consecutive same-source; `A → B → A`;
locator handling (`שם, בעמ' 105.`, `לעיל ה"ש 1, בעמ' 110`); legislation rule
37.5; 12-footnote run; no source relationship added or removed; legacy-answer
display normalisation; V1 occurrence parity incl. `used_sources` remap.

Updated expectations in `src/test/legalResearchV2.render.test.ts` and
`src/test/academicChapterV2.test.ts` (offset numbering now superscript).

Full suite: **909 passed / 909, 80 files**. `tsgo --noEmit` clean.
`legal-research-v2` and `legal-research-v1` deployed.

## 9. Validation snippets

**Example A**

Body:

```
טענה 1.¹ טענה 2.² טענה 3.³ טענה 4.⁴
```

Footnotes:

```
1. ע"א 1000/92 בבלי נ' כהן
2. שם.
3. בג"ץ 5678/10 לוי נ' שר הפנים
4. עניין כהן, לעיל ה"ש 1.
```

**Example B — A, A, B, A, B, B, B, C, A**

```
1. ע"א 1000/92 בבלי נ' כהן
2. שם.
3. בג"ץ 5678/10 לוי נ' שר הפנים
4. עניין כהן, לעיל ה"ש 1.
5. עניין שר הפנים, לעיל ה"ש 3.
6. שם.
7. שם.
8. חוק הירושה, התשכ"ה-1965
9. עניין כהן, לעיל ה"ש 1.
```

Markers in the body: `¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹`, each after its punctuation.

**Example C — punctuation**

```
הכלל חל במקרה זה.¹    הכלל נקבע בפסיקה,²    האם זה נכון?⁴    טענה.¹²
```

never `הכלל חל במקרה זה¹.`

## 10. Regression

Deterministic regression is covered by the suite above, including the three
required shapes (one source used repeatedly, two alternating sources,
legislation + case law) and a 12-footnote answer.

**Not executed in this change:** live re-runs of three stored Legal Research
fixtures through the deployed pipeline, and a manual visual inspection of a
live answer. The renderer is deterministic and fully unit-covered, but the
end-to-end visual confirmation is still outstanding.

## 11. Remaining edge cases

- A block that cites two different sources produces two adjacent superscript
  runs (e.g. `.²³`). Numbers are parsed greedily elsewhere in V1; in V2 this is
  two distinct markers rendered together, as before the change.
- Locator comparison is textual: an identical locator restated differently
  (`עמ' 105` vs `בעמ' 105`) would be treated as a new locator.
- `שם` is computed from the immediately preceding occurrence, so an academic
  chapter boundary (footnote offset) can start a chapter with `שם.` if the same
  authority closed the previous chapter's render. Chapters render
  independently, so this cannot currently occur, but it is worth noting.

FOOTNOTE PRESENTATION + RULE 37 — PARTIAL / REVIEW

NO RESEARCH OR VERIFICATION BEHAVIOUR CHANGED.
