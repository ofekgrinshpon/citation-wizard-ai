# footnote_density_v1_part_a_per_occurrence_emission — acceptance report

## What changed (code)

| file | change |
|---|---|
| `stages/perOccurrenceFootnotes.ts` (new) | Pure planner: Hebrew sentence split, per-occurrence group planning, guardrails (`MAX_SOURCES_PER_BLOCK=3`, `MAX_MARKERS_PER_SENTENCE=2`), clean multi-source label builder. |
| `stages/footnoteBuilder.ts` | Emission is now per occurrence group, not per block. Each block is planned once (`planBlock`), markers are placed on the sentence the source supports. Compound footnotes survive only when the block is a single sentence. Compound labels use `A; כן ראו: B` instead of a joined title string. Emits `footnote_density_emission`. |
| `stages/drafterV2.ts` | Prompt line 195 no longer tells the model that multiple refs in a block collapse into one compound footnote; it now says each ref gets its own marker next to the sentence it supports. Telemetry plumbed to the drafter report. |
| `index.ts` | `footnote_density_emission` recorded in run telemetry (`drafter.footnote_density_emission`). |
| `stages/footnoteBuilder.density.test.ts` (new) | Split, compound-label, no-revival and guardrail tests. |

No retrieval, admission, CSM, Rule D/E, alignment, integrity or prose change.

## Tests

- Deno builder suites: 10 passed (density 4, invariant 3, adjacency 3).
- Vitest project suite: 25 files / 253 tests passed.

## Live validation

Non-academic (fresh runs, post-deploy):

| run | sources passed to drafter | used | rendered footnotes | compound footnotes | garbled compound label | latency |
|---|---|---|---|---|---|---|
| Q1 (85a6568f) | 11 | 2 | 2 (baseline 0) | 0 (was 0) | none | 236s |
| Q1 rerun (8db58359) | 16 | 1 | 1 | 0 | none | 150s |
| Q2 (f8de3b2f) | 1 | 1 | 1 | 0 (baseline 1, garbled) | none | 108s |
| Q2 rerun (dcce07f1) | 5 | 2 | 2 | 0 | none | 148s |
| Q3 (66c454fd) | 2 | 0 | 0 (baseline 2) | 0 | none | 81s |

Academic smoke:

| run | passed | used | footnotes | compound | latency |
|---|---|---|---|---|---|
| AW4 (6d59bead) | 12 | 4 | 4 (same as previous track) | 0 | 189s |
| AW9 (e23681db) | 0 | 0 | 0 — retrieval returned no drafter-admitted source (pre-existing variance) | – | 252s |
| AW7 (95d39b4b) | 13 | 1 | 1 (baseline 0) | 0 | 135s |

Latency is inside the historical band (81–252s); the change is pure rendering and adds no network work.

## Compound before/after

- Baseline Q2 rendered one merged label: `חוק כי סבור אני אף השני המידתיות ,הנשיא חברי דברי על אוסיף ולא` + two more titles concatenated with `; `.
- After: zero compound footnotes across all six live runs; `unrelated_compound_companions_pruned = 1` on the Q2 rerun (a weak companion dropped rather than merged).
- Where a compound is still legitimate (single-sentence block, same claim), the label is `A; כן ראו: B` — a list of distinct sources, never a merged title.

## Split examples (unit-level, deterministic)

Block: `המשפט הראשון קובע כלל. המשפט השני מוסיף חריג.` with approved refs `s1,s2`
→ before: one marker at end of block, `source_type: "compound"`.
→ after: `…קובע כלל.¹ …מוסיף חריג.²`, two numbered rows, `split_count=1`, `compound_after=0`.

Block: `כלל אחד בלבד נקבע בפסיקה` with refs `s1,s2` (one sentence, same claim)
→ compound preserved, one row with two nested sources, clean label.

In the live runs the drafter emitted at most one ref per block, so `split_count = 0` everywhere: the structural ceiling is removed, but current density is now bound by upstream ref availability (CSM Rule D/E), which is Part B.

## Safety

`safety_revived_refs_count = 0` by construction: `planBlock` consumes exactly the output of `resolveBlockSources`, i.e. the same post-CSM / post-alignment / post-integrity / statute-deduped list the compound marker would have rendered. The only allowed direction is *fewer* sources (block cap of 3 → `dropped_weak_companions`). Regression test `no ref is revived: only approved refs render` asserts this. Footnote 1:1 invariant, adjacency invariant and hierarchy ordering are unchanged and still pass.

## Residual defects (not in scope of this track)

- Display-title hygiene for some court PDFs is still garbled at the *single-source* level (Q1 rerun footnote 1: `חוק הצעת של)בג" ץ`).
- Density remains ref-limited: 16 sources passed → 1 rendered on the Q1 rerun. Part B (Rule D/E precision pass) is the next lever.
- AW9 retrieval variance (0 drafter sources on this run).
