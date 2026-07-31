# Judgment typing + authority-role labeling — validation

Scope: deterministic judgment typing, integrity pass-through into `used_sources`,
synthesis-role labels, telemetry. No planner / verifier / sufficiency / drafter-prompt changes.

## What changed
- `stages/sourceIntegrity.ts`: `gov.il` added as official host; new deterministic
  judgment detector (court hosts + decision URL shapes + docket + judgment phrasing +
  file documents) with `is_judgment_document` / `has_holding_text`; judgments are
  promoted out of `secondary_commentary` and typed `citable_as: judgment`;
  holding language upgrades `metadata_only` → `substantive_excerpt`.
- `stages/synthesisRole.ts` (new): planner role *seeds* a label; content overrides it
  (`leading_candidate`, `applying_candidate`, `limiting_or_distinguishing_candidate`,
  `statutory_background`, `secondary_commentary`, `unknown`) + pack summary.
- `stages/candidatePool.ts`, `stages/drafter.ts`, `stages/footnoteBuilder.ts`,
  `lib/types.ts`: integrity + synthesis fields carried into the drafter input pack and
  into `used_sources`.
- `index.ts`: telemetry — `source_integrity.judgment_documents`,
  `judgments_with_holding_text`, `synthesis_role_counts`, `synthesis_role_overrides`,
  and `drafter.synthesis_pack`.

## Results (2026 run)

| Q | mode | pool judgments | pack roles | outcome |
|---|---|---|---|---|
| C2 הלכת השיתוף | case_law_synthesis | 1 judgment (was 0) | 1 leading, 1 statutory, 6 commentary | ✅ `ע"א 52/80 שחר נ' פרידמן` (gov.il PDF) now `official_primary` / `judgment` / `leading_candidate` — previously `secondary_commentary` |
| C1 יורש אחר יורש | case_law_synthesis | 1 | commentary-only pack | ✅ framing correction preserved |
| M1 בנק המזרחי | specific_case | — | — | ✅ stable |
| M2 סעיף 6 לחוק החברות | statute_section_definition | 1 | 3 statutory, 1 leading, 3 commentary | ✅ statute-first behaviour unchanged |
| B8 canonical quote | canonical_quote | 0 | official statute PDF only | ✅ verbatim quote unchanged |
| B2 בג"ץ 6698/95 | specific_case | 2 | empty pack | ✅ deterministic missing-docket refusal preserved |

Known conservative gaps (intentional, no over-promotion): mirror pages without a docket
in title/URL (`psakdin.co.il/Court/...`) and law-firm republications (`toledano.co.il`)
remain `commentary`.
