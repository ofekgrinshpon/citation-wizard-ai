# academic_style_model_v1 — acceptance

## What shipped
- `stages/academicStyleGuide.ts` — genre-sliced adaptation of the recovered Academic Style Guide v1.
  Blocks are 1.2–1.8 KB, fenced as non-citable ("לא מקור לציטוט"), and demand varied phrasing
  instead of reproducing the old guide's canned Hebrew phrase inventory (anti-house-style).
- Genre slices: introduction / theoretical_background (rhythm, topic sentences, transitions,
  anti-patterns), argument_paragraph (claim → steel-man counterargument → distinction → resolution),
  short genres (brevity, register, anti-patterns).
- Footnote-density rules are gated: thin pack, no sources, or short genre → `citation_restraint`
  ("do not add citations to hit a density target") instead of `citation_density`.
- `drafterV2` prompt deduplicated (retrieval-report ban now owned by the guide), argument_paragraph
  upgraded to the claim/counterargument structure.
- Flag `ACADEMIC_STYLE_GUIDE_ENABLED` (default on), telemetry `academic_style_model`
  (version, genre, sections_used, block_chars, limited_draft, has_footnotes, answer_words).
- Unit fixtures: `src/test/academicStyleGuide.test.ts` — 7/7 pass.

## Live validation (flag on) vs previous hygiene-run baseline
| id | genre | branch | bullets | footnotes | len | Δ vs baseline |
|----|-------|--------|---------|-----------|-----|----------------|
| AW1 | introduction | — | 0 | 2 | 4995 | +46% |
| AW4 | theoretical_background | — | 0 | 4 | 4155 | +42% |
| AW5 | research_question | — | 0 | 2 | 2195 | +13% |
| AW7 | argument_paragraph | academic_limited_draft | 0 | 1 | 1025 | −3% |
| AW8 | generic_academic | — | 0 | 4 | 3098 | +14% |

All five: prose only, no bullets, no retrieval-report opener, single work note preserved.

## Flags
- Verbosity guardrail (>~25%) triggered on AW1 and AW4. Short genres and the argument paragraph
  stayed flat, so the growth is confined to the long prose genres — candidate follow-up is a length
  ceiling in the guide's paragraph-rhythm slice, not a rollback.
- `academic_style_model` telemetry did not surface in the qa_logs metadata path the runner reads;
  the report is produced by the drafter but needs plumbing into the persisted metadata.

Verdict: ACCEPTED for style mechanics; MONITOR for verbosity on long genres.
