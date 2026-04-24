## Goal

Restore the deep pipeline's footnote density to its pre-regression level so the C/E/B citation-quality fixes can be evaluated against a meaningful baseline. Two narrow surgical changes, then re-capture baselines, then resume C.

## Root cause (confirmed)

Three commits on 2026-04-24 ~09:31–09:32 stacked:

1. `989844d` — added rerank drop telemetry (neutral).
2. `bb8db1a` — toughened rerank prompt to push off-branch legislation to score **0–2**.
3. `3148013` — raised non-caselaw rerank floor from `>= 3` to **`>= 4`** (`NON_CASELAW_FLOOR = 4`).

The combination is too aggressive: the prompt now drives many borderline-relevant legislation/research docs to 0–3, and the new floor 4 then deletes them. On Q6 the gate dropped 9 of 13 docs, leaving 4 local cards → 1–2 footnotes after dedup.

Compounding: the unanchored-footnote dropper at `index.ts:4427` deletes any AI footnote without a URL/card match — including valid Rule 37.7 `שם, פסקה N` ibid forms that legitimately reference the prior anchored citation.

## Changes

### Fix 1 — Rerank floor: revert the floor, keep the prompt

File: `supabase/functions/legal-qa/index.ts` (around line 1214–1216)

- Set `NON_CASELAW_FLOOR = 3` (revert of `3148013`).
- Keep the toughened prompt from `bb8db1a` — the off-branch warning is still useful; we just stop letting it cascade into the floor.
- Keep caselaw strict floor at 5 with the existing safety valve.
- Add one-line code comment recording why: "raising to 4 collapsed retrieval on broad procedural questions; rely on strict-keep (>=5) and safety valve instead."

This is a 1-line change, fully isolated. Expected effect: Q6 keeps 8–10 docs instead of 4, restoring 4–8 footnotes on most fixtures.

### Fix 2 — Whitelist Hebrew ibid short-forms in unanchored-drop

File: `supabase/functions/legal-qa/index.ts` (around line 4427)

Before dropping a footnote with no card/URL match, check whether the footnote text matches a Rule 37.7 short-form pattern:

- `^שם(\s*,\s*פסקה\s+[\dא-ת]+)?\.?$`
- `^שם(\s*,\s*ע[''׳']\s*\d+)?\.?$`
- `^לעיל\s+ה["״]ש\s+\d+`

If it matches AND there is at least one anchored footnote already in the list with the same source token (or simply at least one anchored fn earlier in the body), keep it as `source_type: "shortform"` with no URL. Otherwise fall through to the existing drop.

Telemetry: bump a new counter `kept_shortform_count` and surface it in `metadata` next to `dropped_unanchored_count`.

### Fix 3 — Re-capture baselines

Run `node eval/regression/run-regression.mjs --update-baselines` against the 6 fixtures after Fix 1 and Fix 2 deploy. Verify:

- `total_fn` lands in `[3, 12]` for at least 5 of 6 fixtures.
- `metadata.rerank_drops` shows fewer `below_floor` entries on Q6.
- No new SHAPE_DUP_STATUTE failures introduced.

If a fixture still under-counts, investigate that fixture specifically before relaxing the band.

### Then — proceed to Fix C

Once baselines are healthy, implement Fix C (citation validation tightening) in a separate turn, with a regression-check between C and E.

## Out of scope this turn

- Fix E (Rule 37 short-form generation) — comes after C.
- Fix B (dedupe brittleness) — comes after E.
- Any drafter prompt changes.
- Any rerank prompt changes (the off-branch warning stays).

## Risk and rollback

- Floor revert: low risk, restores known-good behavior. If false-positive legislation returns (the original problem `3148013` tried to fix), we'll catch it in the next baseline run as drift on Q-extort or similar; rollback = re-set floor to 4.
- Ibid whitelist: low risk, additive. Worst case a hallucinated `שם` slips through with no anchor — caught by the upstream "earlier anchored fn exists" check.

## Acceptance

- All 6 fixtures produce ≥3 footnotes.
- `metadata.rerank_drops` and `metadata.stage_runs` populated on every run.
- Existing duplicate-statute and broken-shortform bugs still surface in the report (so we know the harness still detects them for fixes C/E/B).
