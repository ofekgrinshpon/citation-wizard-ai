# citation_rendering_and_source_label_quality_v1 — diagnosis (read-only)

Evidence: `reports/facet-validation/{F01,F02,F05,F06,N02}.json` (answer + used_source_titles + counts),
code: `stages/footnoteBuilder.ts`, `stages/drafterV2.ts`, `stages/displayTitleHygiene.ts`,
`stages/sourceIntegrity.ts`, `stages/verifier.ts`, `stages/drafter.ts`.

## Measured mismatch

| run | markers in answer | footnotes | used_sources rows |
|-----|------------------|-----------|-------------------|
| F01 | 1..3 | 3 | 3 |
| F02 | 1..5 | 5 | 6 |
| F05 | 1..5 | 5 | **4** |
| F06 | 1..8 | 8 | 8 |
| N02 | 1..8 | 8 | 8 |

---

## Defect 1 — dangling footnote marker (F05: marker ⁵, 4 rows in the list)

**Where introduced:** `stages/footnoteBuilder.ts`, `used_sources` assembly (lines ~309–332), not the
drafter, not the renderer, not pruning.

Numbering is allocated **per footnote entry** (one entry per distinct *set* of candidate ids), but
`used_sources` is built with a global `usedSeen` de-dup **per candidate_id**:

```ts
for (const e of entriesInOrder)
  for (const s of e.source_inputs) {
    if (usedSeen.has(s.candidate_id)) continue;   // ← collapses the 2nd appearance
    used_sources.push({ ...s, number: e.number });
  }
```

So when one source is cited both alone and inside a compound footnote (F05: the חוק החברות /
commentary source recurs across entries), footnote N exists but contributes **no row** to
`used_sources`. The user-visible "source list" is rendered from `used_sources`, therefore
`footnotes_count (5) > used_sources_count (4)` and marker ⁵ has nothing to point at.
The reverse case (F02: 6 rows / 5 footnotes) is the same asymmetry seen from the other side — a
compound footnote contributes two rows under one number.

**Narrow fix (recommended):** render the user-facing source list from `footnotes` (one row per
footnote number, sub-sources listed inside), and keep `used_sources` as the de-duped analytics
array. One display change in the renderer + one invariant in the builder
(`max(marker) === footnotes.length` and every footnote number is representable in the list).

---

## Defect 2 — bad source labels / type misclassification

Two independent causes; neither is "renderer choosing raw filename" in the UI — the bad string is
already in `title` when it leaves `buildDrafterInputSources`.

**2a. Title recovery / hygiene coverage gap** (`displayTitleHygiene.ts`).
`computeDisplayTitle` only rejects: exact junk list, `source_\d+`-style patterns, mid-word Hebrew
truncation, and <4-char non-Hebrew. It therefore passes through:
- `25_lst_2970619.docx` (N02) — no filename/extension rule; length ≥ 4, so it is "ok".
- `בית המשפט העליון` (N02) — a site/nav title; valid Hebrew, so "ok". No rule that a bare
  institution name is not a document title, and no fallback to docket + parties.
- `עילת אי־הסבירות במשפט הממהלי*` vs `עילת אי־הסבירות במשפט המינהלי` (N02) — OCR-corrupted
  near-duplicate. De-dup exists only by URL key and `statuteIdentityKey` (statutes only), so two
  copies of the same article both reach the list.

**2b. `citable_as` misclassification** (`sourceIntegrity.ts`) — host/phrase heuristics, no
document-level signal:
- `STATUTE`/authority is inferred from OFFICIAL_HOSTS, which includes bare `gov.il`; any gov.il PDF
  (an academic Knesset research paper, `25_lst_*.docx`, `עילת הסבירות בהיבט השוואתי`) is labelled
  **statute**.
- `JUDGMENT_PHRASE_RE` contains `בית המשפט העליון` / `פסק דין`; a commentary article *about* a
  judgment ("פסק דין הסבירות: עיונים ראשונים") is labelled **judgment**, while the actual
  בג"ץ 5658/23 page (title contains no matched cue in the right position) is labelled
  **commentary** — the exact swap seen in N02.

This is a labelling defect, not a hierarchy defect: `sourceHierarchy.ts` faithfully derives tiers
from `citable_as`, so wrong labels propagate into footnote ordering too.

**Narrow fix (recommended):** one deterministic label-quality pass applied where drafter input
sources are built — (i) extend `displayTitleHygiene` with filename/extension and
bare-institution rejection plus a docket/statute-name fallback from URL+snippet, and (ii) add a
"title-and-shape overrides host" rule in `sourceIntegrity`: a gov.il/knesset document whose title
carries scholarship shape (author name, `מרכז המחקר והמידע`, `.docx/.pdf` research paths) cannot be
`statute`, and `citable_as: judgment` requires a docket in the title/URL, not just courtroom
vocabulary. Add near-duplicate title collapse (normalized-Levenshtein) to the same pass.

---

## Defect 3 — citation subject mismatch

**Where introduced:** the drafter, because there is no claim→source binding at draft time.

The verifier *does* enforce subject identity, but only per `(candidate_id, claim_id)` pair
(`verifier.ts`, `wrong_subject → unrelated`). A source that is `direct/partial` for **one** claim
enters `buildDrafterInputSources` as a flat, globally usable ref (`s1..sN`) carrying only
`supported_points` and `claim_ids`. `structuredValidation.ts` then accepts **any** ref in any
block's `source_refs` — `allowedRefs` is the whole pool — and `footnoteBuilder` never re-checks
claim identity. So:

- **F02** — רע"א 4179/20 בסט קאר (insurance) was verified for a generic "standard of judicial
  review / ultra vires" claim and re-used by the drafter for the rabbinical-court external-consideration
  proposition. Not a facet-query breadth problem: the facet lock worked (the חוק שיפוט בתי דין
  רבניים anchors appear), it is drafter over-use plus missing per-claim ref gating.
- **F06** — ת"א 32539-04-24 (district-court jurisdiction/settlement decision) used as s.12
  case-law application: the only `citable_as: judgment` with `full_text` in the pool, so the
  drafter's lead-ref preference for a body-text judgment outranked subject fit.
- **F06** — תקנת השוק scholarship used for reliance/estoppel: `same_domain`/`analogical` verdicts
  are retained as `partial` and become citable without any marker of the weaker subtype in the
  drafter input.

Contributing but secondary: verifier over-acceptance of `analogical`/`same_domain` as `partial`.

**Narrow fix (recommended):** propagate the verifier's per-claim binding into the draft contract —
tag each `DrafterInputSource` with its verified `claim_ids` (+ `support_subtype`), pass the facet /
claim id on each block, and have `structuredValidation`/`footnoteBuilder` drop a `source_ref` whose
verified claim set does not include that block's claim (telemetry counter
`subject_mismatch_refs_dropped`). No retrieval or verifier change needed.

---

## Recommended order

1. Defect 1 (pure rendering invariant, zero legal risk).
2. Defect 2 (deterministic label pass).
3. Defect 3 (claim-scoped ref gating) — largest behavioural change; validate against the same 12Q set.
