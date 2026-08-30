# academic_style_model_v1

Adapt the deleted Academic Style Guide v1 into the current `legal-research-v1` academic-writing path. Retrieval, acquisition, sufficiency thresholds, judgment identity, docket limitation, claim-source-match, citation rendering and source selection stay untouched — this track only changes prompt text, a new style asset, telemetry and validation.

## 1. Recover the old guide (inspection only)

Restore from git history into a scratch location for reading, not into the function tree:

- `supabase/functions/legal-qa/academicStyleGuide.ts`
- `.lovable/memory/features/academic-writing-mode/style-guide-v1.md`
- `academicProfiles.ts` only if genre/paragraph rules are needed

The deletion commit is known (the legal-qa excision). No legal-qa pipeline code is restored; nothing from `legal-qa/` is re-added to `supabase/functions/`.

## 2. New genre-sliced style asset

`supabase/functions/legal-research-v1/stages/academicStyleGuide.ts`

```ts
buildAcademicStyleGuideBlock(genre, options) -> { block: string; sections: string[]; version: string }
```

- Sections are stored as small named units (paragraph rhythm, topic sentences, typed transitions, argument structure, register, anti-patterns, citation density).
- Each genre selects only 2–4 sections. Target block size ~2–4 KB, never the full 12K guide.
- Genres covered: `introduction`, `theoretical_background`, `research_question`, `chapter_outline`, `argument_paragraph`, `topic_presentation`, `generic_academic`.
- The block opens with a non-citable fence: style guidance only, do not cite it, do not copy phrases verbatim, not legal authority.

## 3. Deduplicate the drafter prompt

In `stages/drafterV2.ts`, the academic branch (the `academicWriting` block in `buildUserMessage`) keeps only:

- legal safety rules (no invented holdings/citations, no non-existence claims);
- source-support rules;
- genre/length envelope (including the one-paragraph rule for `argument_paragraph`);
- citation and no-URL rules;
- the topic-focus rule.

Removed from the drafter and owned by the style guide: prose-vs-bullets phrasing quality, paragraph rhythm, register, transitions, argument structure, anti-patterns. `academicPresentationHygiene` stays the deterministic post-draft safety net, unchanged.

## 4. Gated footnote-density guidance

The citation-density section is emitted only when the pack is not thin. When `deterministic_branch = academic_limited_draft`, sufficiency is limited-doctrinal, or there are no usable footnote-bearing sources, that section is replaced by a restraint line: write cautiously, cite only acquired source-supported material, never add citations to satisfy a density target.

## 5. Argument paragraph upgrade

For `argument_paragraph` the guide supplies the internal structure claim → strongest counterargument → distinction → resolution, inside the existing single-paragraph, 150–300-word contract enforced by the hygiene pass.

## 6. Flag and telemetry

- Env flag `ACADEMIC_STYLE_GUIDE_ENABLED` (default on in the deploy env, off disables the block entirely and restores today's prompt).
- Telemetry `academic_style_model: { enabled, version, genre, sections_used, block_chars, limited_draft, has_footnotes }` added next to `academic_presentation_hygiene` in the drafter result and persisted to `qa_logs.metadata`.

## 7. Validation

A/B with the flag off then on, using the existing runner (`scripts/legal-research-v1-academic-writing-validation.ts`, `ONLY=AW1,AW4,AW5,AW7,AW8`).

Measured per run: answer length, paragraph count, bullets, raw URLs, caveat count, footnote count, case names cited, latency, and cross-answer repetition of any guide phrase.

Acceptance:

- AW1 reads as a seminar introduction rather than a doctrinal listing.
- AW4 becomes 2–3 coherent theoretical-background paragraphs with topic sentences and typed transitions.
- AW7 is one paragraph following claim → counterargument → distinction → resolution, 150–300 words.
- No new sources, no new case names, no authority-level strengthening, citation count unchanged or explainable.
- No guide phrase repeated verbatim across answers.
- Hygiene invariants hold: exactly one caveat, no URLs, no bullets in prose genres.
- No substantial latency blow-up.

Unit tests in `src/test/academicStyleGuide.test.ts`: genre slicing, block size ceiling, thin-pack suppression of density guidance, flag off = empty block.

Deliverables: `reports/academic-style-model/ACCEPTANCE_REPORT.md` plus the full A/B answers, both sent in chat.
