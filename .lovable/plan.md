# substance_based_doctrinal_sufficiency_v1

Goal: let acquired and validated secondary/doctrinal material carry *limited doctrinal explanations* in broad research questions, instead of refusing. No loosening of judgment identity, docket, cache or primary-law integrity rules.

## Current behaviour (verified in code)

- `stages/sourceSufficiency.ts` recognises doctrinal material only through a fixed set: `journal_article, article, scholarship, book, commentary`. Anything typed `other` is invisible to sufficiency, even with an acquired body.
- The catch-all profile (`statutory_institution`) passes only when there is a domain-matched statute, a usable judgment, or a topical-authority source; otherwise it returns `no_statutory_caselaw_or_doctrinal_anchor`, which `drafterV2.ts` turns into the `insufficient_sources_limitation` refusal draft.
- Even when that branch passes on doctrinal-only material, `sufficiency_authority_basis` is forced to `insufficient`, so the drafter gets no signal about which authority level it may claim.
- `stages/claimSourceMatch.ts` classifies blocks by a `proposition_type` tag (`black_letter_rule | application | background | practical_guidance | limitation`) with a default of `application`, and Rule B drops any non-primary `background`/`commentary` source from a substantive block. That is what strips footnotes from doctrinal-only answers.
- The five-mode depth decision (`sourceDepth.depth_mode`) is computed in `index.ts` but is **not** passed into the drafter or the sufficiency gate.

## What to build

### 1. Claim-support categories by substance (new `stages/claimSupportCategory.ts`)

Map every drafted block to one of five support categories using structural signals already present — the block's `proposition_type` tag, its claim/facet binding, the claim's `required_roles` from the analyzer, the analyzer `answer_type` / `output_shape`, and the research + depth mode. No fixed Hebrew phrase lists.

| Category | Required support |
|---|---|
| A court_holding | acquired judgment body + strict identity + integrity + verifier direct/partial + claim match |
| B statutory | acquired official statute/regulation text (section/title validated where relevant) |
| C doctrinal_synthesis | acquired + validated secondary/doctrinal, case law, statutes, or a combination |
| D scholarly_commentary | acquired full-text scholarship/commentary + integrity + verifier direct/partial + claim match |
| E background | acquired institutional/official/secondary material; never proves a rule |

`black_letter_rule` blocks split into A or B by whether the bound claim's roles are case-law or statutory; unbound/doctrinal blocks in broad modes fall to C rather than A.

### 2. Narrow source-type remapping (new `stages/doctrinalSourceTyping.ts`)

For sources that reach the drafter with `source_type: "other"` **and** an acquired body plus passing integrity, remap by provenance/content to `legal_article`, `book_or_chapter`, `doctrinal_commentary`, `institutional_report` or `scholarship`. Untyped, body-less, metadata-only, listing, block/exception, or integrity-failing sources stay non-citable. Remapping is recorded as telemetry (`original_type`, `mapped_type`, `evidence`) and consumed by sufficiency + claim match; it does not touch nomination, cache identity keys, or footnote rendering.

### 3. Secondary-source eligibility helper

One shared predicate used by both sufficiency and claim match: body acquired, type in the doctrinal set (after remap), integrity pass, verifier `direct`/`partial`, not Perplexity-only / snippet-only / abstract-only / metadata-only / discovered-only.

### 4. Mode-aware doctrinal sufficiency fallback

Pass `depth_mode` into `assessSourceSufficiency`. For `broad_research`, `academic_research` and doctrine-shaped modes only, when the current gate would return `no_statutory_caselaw_or_doctrinal_anchor`, accept one of:

- A: relevant statute/primary law + ≥1 eligible doctrinal secondary
- B: ≥2 eligible doctrinal secondaries
- C: ≥1 acquired judgment body + statute or secondary

Result is a new basis `doctrinal_secondary` with `limited_doctrinal_answer: true`. `case_law_synthesis`, `specific_case`, statute-section, quote and docket branches are untouched.

### 5. Authority-level control in the drafter

When `limited_doctrinal_answer` is set, the drafter receives an instruction block stating the available authority level (statute / judgment / secondary / background) and that secondary support may explain doctrine, framing or criticism but must not be presented as binding case law. Wording stays the model's choice; a Hebrew limitation line records that the explanation rests on doctrinal literature.

In `claimSourceMatch`, Rule B is relaxed **only** for category C and D blocks in the limited-doctrinal branch: an eligible secondary may support them. Categories A and B keep the current strict rule.

### 6. Supported / limited / found-only separation

Telemetry (and, for broad answers, a short trailing section) splitting sources into cited support, limited/partial support, and found-for-further-checking. Only cited support produces footnotes; found-only never supports a legal claim.

### 7. Telemetry

Per run: `depth_mode`, acquired sources by type, remap list, doctrinal-eligibility decisions with reasons, claim categories, sufficiency before/after (control vs new), claim-match drops, footnotes, limitation text, found-only list.

## Validation

New script `scripts/legal-research-v1-doctrinal-sufficiency-validation.ts`, sequential: D1, B8, D3, ACADEMIC, FRESH-SC, R02, NATION-STATE, P02 fake docket, MAYA-AMIR. Each run also executed with the new behaviour disabled (`x-disable-doctrinal-sufficiency: 1`) for the before/after column on the four broad runs. Report to `reports/doctrinal-sufficiency/ACCEPTANCE_REPORT.md`, with the full drafted Hebrew answers exported alongside.

Acceptance is judged against: at least one previously refusing broad run now yields a limited supported answer; D1 no longer refuses solely for lack of a judgment body when eligible secondaries exist; B8/D3 improve or log a precise reason; ACADEMIC yields a separated source list or an explicit bibliography-mode queue; R02/P02/NATION-STATE unchanged; no metadata/snippet/abstract/Perplexity-only citation; bounded runtime; no CPU kills, stubs or dangling markers.

## Explicitly out of scope

Source nomination, depth policy itself, query planner, relay, cache identity rules, footnote rendering, crawling, paywalled access, landmark registry, and any relaxation for specific-case holdings.
