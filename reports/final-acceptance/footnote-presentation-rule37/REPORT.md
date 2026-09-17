# Footnote Presentation + Rule 37 Repeat Citations

Scope: presentation / citation rendering only. No research, retrieval,
verification, identity, source-selection, claim-support, model, prompt or
budget behaviour was touched.

This report covers both stages of the track:

1. occurrence numbering, superscripts, punctuation placement, duplicate list
   removal (shipped earlier);
2. the compound-marker fix (this change).

---

## 1. Root causes

| Defect | Cause |
| --- | --- |
| `[^1]` visible to users | `drafting/render.ts` emitted markdown markers |
| Footnotes shown twice | definitions were appended to `answer_markdown` while the UI also rendered the structured list |
| One number reused for one source | numbering was keyed by `source_id` instead of by citation occurrence |
| **Adjacent markers `.²³`** | **a block with `source_ids = [S1, S2]` emitted one marker per source and concatenated them, so two footnote numbers collided into what reads as footnote 23** |

## 2. Data-model change (compound citation points)

`supabase/functions/_shared/footnoteOccurrences.ts` now works on **citation
points**, not single sources:

```ts
type CitationOccurrenceGroup = CitationOccurrence[];   // one textual point

interface OccurrenceFootnote {
  index: number;                    // one number per point
  sources: FootnoteSourceEntry[];   // one or more verified sources
  source_ids: string[];
  citation: string;                 // "Source A; Source B."
  ...
}

buildCompoundFootnotes(groups, { offset })   // new primary API
buildOccurrenceFootnotes(list, { offset })   // wrapper: each source is its own point
```

Repeat metadata (`repeat_kind`, `first_occurrence`, `full_citation`,
`locator`) is tracked **per source inside the point**, so rule 37 is evaluated
independently for each authority. First-occurrence tracking is global per
source id and is unaffected by whether the first appearance was inside a
compound footnote.

## 3. Rule 37 semantics for compounds

- Each source in a compound footnote gets its own repeat text and they are
  joined with `; `, the group ending in a single period:
  `עניין כהן, לעיל ה"ש 1; עניין שר הפנים, לעיל ה"ש 2.`
- Locators are preserved per source
  (`…לעיל ה"ש 1, בעמ' 110; …לעיל ה"ש 2, בפס' 5.`) and are never fabricated.
- Legislation keeps rule 37.5 inside a compound: a statute renders as
  `ס' 25 לחוק הירושה.` even when the judgment beside it uses `לעיל ה"ש`.

### Strict שם rule

`שם` is emitted only when **all** of these hold:

1. the current citation point has exactly one source;
2. the immediately preceding citation point had exactly one source;
3. both are the same verified source id.

Consequences, all covered by tests: `A + B → A + B` is not `שם`;
`A + B → A` is not `שם`; `A → A + B` repeats A explicitly and states B in
full; `A → A` still yields `שם.`

## 4. V2 renderer

`legal-research-v2/drafting/render.ts`: one block = one citation point = one
superscript marker = one footnote row. Unverified source ids are still
rejected into `invariant_errors`. New invariant: the number of footnote rows
must equal the number of citation points, and no `[^n]` may survive in the
body. Nothing in the pass can add, drop or move a source — the group is
exactly `block.source_ids` after the verification filter.

`types.ts`: `Footnote` gained optional `source_ids` and `sources[]`
(internal bookkeeping; internal ids are never rendered).

`beta/job.ts`: one UI footnote row per marker, with its sub-sources in
`sources[]`; `used_sources` remains the distinct-source analytics view keyed
on each authority's first occurrence.

## 5. V1 attachment path

`legal-research-v1/stages/occurrenceFootnotes.ts`: a marker run such as `¹²`
is now read as **one** citation point carrying the approved source group, and
is re-rendered as a single marker with a compound footnote row. Numbering,
`used_sources` remapping and rule 37 text go through the same shared engine.
V1 research, source selection, CSM/alignment and integrity gates are
untouched.

## 6. UI and copy

`LegalResearchV1Panel.tsx` already renders compound rows (one number, its
sources listed beneath) and copies them the same way, so no redesign was
needed. Body display and copy both pass through
`normalizeAnswerForDisplay()`, which strips legacy `[^n]:` definition blocks
and superscripts legacy markers for historical answers, without mutating
stored records. Copy output is body → blank line → `הערות שוליים` → exactly
one chronological list.

## 7. Tests

`src/test/footnoteOccurrenceRule37.test.ts` — 29 deterministic tests:

- superscripts incl. multi-digit; punctuation-before-marker (`.` `,` `;` `?`);
  missing punctuation;
- the single-source regression sequence **A, A, B, A, B, B, B, C, A** →
  `Full A / שם. / Full B / עניין כהן, לעיל ה"ש 1. / עניין שר הפנים, לעיל ה"ש 3. / שם. / שם. / Full C / עניין כהן, לעיל ה"ש 1.`, markers `¹…⁹` in textual order — unchanged;
- compound A–J: one sentence two sources (one marker, one row, both sources
  preserved); `A → B → A+B`; `A+B → A+B` (no bare שם); `A → A` (שם kept);
  `A+B → A`; `A → A+B`; per-source locators; legislation + judgment;
  23 citation points where the last marker is a genuine `²³` **and** carries
  three sources — proving the data model, not string heuristics, distinguishes
  "footnote 23" from "markers 2 and 3";
- no source relationship added or removed;
- V1 marker run `¹²` collapses to one number with a two-source row.

Full suite: **921 passed / 921, 80 files**. `tsgo --noEmit` clean.
`legal-research-v2` and `legal-research-v1` deployed.

## 8. Live validation

**Run 1 — Q21 (`bf1eff36…`, completed on the deployed build).** Body markers:
`¹ ² ³` — exactly one per citation point, each after the sentence period.
Footnotes:

```
1. ע"פ 5121-98 - טור' רפאל יששכרוב נ. התובע הצבאי הראשי  <url>
2. שם.
3. ע"פ 4988-08 - איתן פרחי נ. מדינת ישראל <url>; רע"פ 10141-09 - אברהם בן חיים נ. מדינת ישראל <url>.
```

This single run exercises three of the required cases at once: a repeated
single source rendering `שם.`, chronological numbering, and a **compound
citation point rendered as one number (³) containing two sources** — the
`.²³` defect is gone.

**Run 2 — Q24 (`a94c3396…`): launched sequentially on the same build and still
mid-flight after ~40 minutes (chunk 2, no error).** This is the pre-existing
long-run stall/resume behaviour recorded in earlier acceptance batches, not a
rendering fault; it was not resumed here because this task is
presentation-only.

**Not performed:** the alternating-sources run beyond what Q21 already shows,
the attached-PDF run through the V1 path, and a manual visual inspection of
the rendered UI and clipboard output in the browser. The V1 path change is
covered only by deterministic tests.

## 9. Remaining edge cases

- A compound footnote whose two sources are the *same* authority cannot occur
  (a block's `source_ids` are distinct), so no duplicate entry logic is needed.
- Locator comparison is textual: `עמ' 105` vs `בעמ' 105` counts as a change.
- Academic chapters render independently, so an offset chapter could in theory
  open with `שם.`; not reachable today.
- Historical answers keep their stored text; compound presentation applies to
  newly rendered answers only.

FOOTNOTE PRESENTATION + RULE 37 — PARTIAL

NO RESEARCH OR VERIFICATION BEHAVIOUR CHANGED.

---

# 10. Final acceptance QA (read-only)

No code was changed in this pass.

## 10.1 Attached-PDF live run (V1 path)

- PDF built for the test (Hebrew lease agreement, 6 clauses), uploaded to
  `user-documents`, attached to a real query so `researchFunctionFor()` routed
  to `legal-research-v1`.
- run_id `39c8e761-4bc3-48b9-a270-8e76b0ddf9cb`, job_id
  `4abd04f9-bbcf-4d2b-a55e-493257f376cf`, status `done`,
  `marker_format: "superscript"`, 6 citation occurrences.

Body (excerpt):

```
… שלא הייתה תמורה כלל.¹
… אך הוא אינו מוחלט.²
… בעת כריתת החוזה.³
… את הסכום שנקבע בהסכם.⁴
… תום הלב בעת אכיפת ההסכם.⁵
… פער מהותי בין הסכום לנזק הצפוי.⁶
```

Footnotes: 1 full statute; 2 caselaw (compound); 3 `שם.`;
4 caselaw full; 5 `חוק החוזים (תרופות בשל הפרת חוזה), לעיל ה"ש 1.`;
6 `עניין אברהם רובינשטיין ושות' - חברה קבלנית, לעיל ה"ש 2.`

Checks: numbering chronological ✔; every marker after the terminal
punctuation ✔; exactly one marker per citation point ✔; one footnote list ✔;
no `[^1]` anywhere ✔; `לעיל ה"ש` used for non-adjacent repeats ✔.

## 10.2 Defect found — V1 compound point is collapsed into one synthetic source

Footnote 2 carries **two distinct verified sources**
(`candidate_id 9a3893eb…` caselaw and `39be49ed…` journal article — both
`number: 2` in `used_sources`), but the V1 path renders them as one merged
title string joined by `; כן ראו:` under a single `source_type: "compound"`
entry with only the first source's URL. Consequences in this run:

1. the second source's URL is not shown (link lost in UI and clipboard);
2. footnote 3 is a bare `שם.` although the preceding point is compound —
   the strict שם rule (one source on both sides) is satisfied only because
   the compound was flattened into one pseudo-identity;
3. footnote 4 restates the caselaw in **full** even though that same
   authority already appeared inside footnote 2; Rule 37 expects
   `…, לעיל ה"ש 2.`

This is a V1 pre-renderer labelling issue (`stages/perOccurrenceFootnotes.ts`
`compoundLabel()` merges titles before the shared occurrence engine sees
them), not a regression of the V2 compound model. V2 output is unaffected.
Left unfixed per the read-only scope of this task.

## 10.3 Browser visual inspection

Opened the completed run in the real app (`/app?job=4abd04f9…`), signed in,
1280×1800. Findings: body prose readable; superscripts render as genuine
raised markers, always after the punctuation; exactly one `הערות שוליים`
card, no duplicate list; `שם.` and `לעיל ה"ש 1/2` read naturally; compound
footnote 2 is one numbered item. Minor cosmetic issue: long `gov.il` URLs
wrap mid-string in the RTL list and can leave a single trailing character on
its own line (items 2 and 4) — layout is not broken, but URL wrapping is
untidy. No marker-ambiguity issue; this answer has fewer than 10 footnotes,
so the 10+ case rests on the deterministic multi-digit tests.

## 10.4 Clipboard

Clicked the real `העתק` button and read the clipboard. Output is body with
superscript markers → blank line → `הערות שוליים` → exactly one chronological
list (1–6), matching the body numbering. No `[^n]:` definitions, no duplicate
list, compound footnote stays a single numbered item, `שם.` / `לעיל ה"ש`
preserved. Same compound-merge limitation as 10.2 appears in the copied text.

## 10.5 Alternating sources

No extra long run was launched. The live run itself exercises the
non-adjacent repeat pattern (statute at 1 → other authority at 2 → statute
again at 5 as `לעיל ה"ש 1`), functionally equivalent to A → B → A. The exact
A → B → A sequence remains covered deterministically.

## 10.6 Acceptance

Attached-PDF V1 path renders markers, numbering, punctuation placement and a
single footnote list correctly, and the browser and clipboard checks pass.
One genuine citation-presentation defect was reproduced: V1 collapses a
multi-source citation point into a single merged label, losing a source URL
and mis-applying Rule 37 for the sources inside it.

FOOTNOTE PRESENTATION + RULE 37 — PARTIAL / REVIEW

NO RESEARCH OR VERIFICATION BEHAVIOUR CHANGED.
