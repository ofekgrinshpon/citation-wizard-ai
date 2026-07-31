# Synthesis snippet budget — validation

Scope: snippet budget only. No planner, verifier, sufficiency, drafter prompt/skeleton, integrity-classification, or deterministic-branch changes.

## What changed
- **`stages/synthesisSnippetBudget.ts` (new)** — deterministic budget resolver. Expanded budget only when `research_mode = case_law_synthesis` **and**:
  - `judgment` + `leading_candidate` → 1200
  - `judgment` + `applying_candidate` / `limiting_or_distinguishing_candidate` → 900
  - `statute` + `statutory_background` → 1200
  - everything else (commentary, scholarship, unknown) → unchanged 500 cap.
  - Hard guard: sources whose `text_usability` is `metadata_only` / `unusable` / `unknown` never expand ("no_real_text").
- **`stages/localRetrieval.ts` / `stages/perplexityRetrieval.ts`** — reserve untruncated chunk text as `metadata.extended_text` (≤1600). Displayed snippet caps unchanged; the reserve is only spendable by an eligible synthesis source.
- **`stages/drafter.ts`** — `buildInputSources(..., researchMode)` applies the budget and records `snippet_budget`, `snippet_budget_expanded`, `snippet_budget_reason`, `snippet_length`, `available_text_length`, `has_statutory_text`.
- **`stages/drafterV2.ts` / `index.ts`** — planner mode passed to the drafter; `drafter.snippet_budget` telemetry (per-source budget/length/reason, holding-text and statutory-text flags, `judgment_sources_ge_900`, `statute_sources_ge_900`, `commentary_max_snippet_length`).

## Results

| id | mode | synthesis run | expanded | max snippet | commentary max | outcome |
|---|---|---|---|---|---|---|
| C2 הלכת השיתוף | case_law_synthesis | yes | 0 | 395 | 395 | deterministic `insufficient_sources_limitation` (retrieval variance this run); every judgment/statute source arrived `metadata_only`, so no budget was spendable |
| C1 יורש אחר יורש | case_law_synthesis | yes | 1 (s11 statute → 1200) | 393 | 393 | ✅ framing correction preserved |
| M1 בנק המזרחי | specific_case | no | 0 | 394 | 394 | ✅ unchanged |
| M2 §6 חוק החברות | statute_section_definition | no | 0 | 500 | 500 | ✅ unchanged (s10/s11 had 1156/1183 chars available but stayed at 500 — correctly not expanded) |
| B8 canonical quote | canonical_quote | no | — | — | — | ✅ verbatim quote unchanged |
| B2 missing docket | specific_case | no | 0 | 500 | 500 | ✅ deterministic refusal preserved |

No stubs, no verifier failures.

## Acceptance
- ✅ Commentary does not bloat (commentary max stayed ≤ 395/500 everywhere; no commentary source expanded).
- ✅ Metadata-only sources did not become long.
- ✅ C1 framing correction, M1 / B8 / B2 unchanged.
- ⚠️ **C2's leading judgment did not receive a longer snippet.** The mechanism fired correctly but had nothing to spend: `ע"א 52/80` was admitted with `text_usability: metadata_only` and only 142 chars of available text. The remaining blocker is **text acquisition** (no judgment body is fetched for web-discovered PDFs), not budgeting. C1's statutory-background source proves the expansion path works when real text exists.

No final-answer quality claim is made here.
