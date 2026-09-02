# local_primary_anchor_resolution_v1 — acceptance report

Principle implemented: **local DB first, official/web second, metadata-only never.**

## What changed

| File | Change |
|---|---|
| `stages/localPrimaryAnchor.ts` (new) | Statute-title normalization (`חוק יסוד` / `חוק-יסוד` / `חוק־יסוד` / colon / year / gazette / `סעיף N ל…` prefix all collapse to one form), variants, token scoring, `locateStatuteSection`, local statute resolver, docket normalizer, local judgment resolver, all telemetry shapes. |
| `stages/officialSourceDiscovery.ts` | Statute lane calls `resolveLocalStatuteAnchor` **before** any URL fetch; judgment lanes (docketed, named, and the cooldown branch) call the local resolver before search-first / court-egress; `injectBody` carries local origin, authority tier, doc id, claim scope and limitation note; `primary_anchor_resolution_path` set on every terminal state. |
| `stages/localRetrieval.ts` | `LAW_BARE_RE` no longer lazy — bare law names survive intact; `cleanLawClue` strips dangling prepositions; `extractLawClues` telemetry (`law_clue_extraction`) added per query. |
| `src/test/localPrimaryAnchor.test.ts` (new) | 9 tests: title normalization, variants/tokens, scoring, clue cleaning, section location (positive / section-less / below-floor), docket normalization, tier gate. |

Safety unchanged: 400-char substantive floor, primary-tier requirement, strict judgment identity validation (`validateJudgmentIdentityStrict`) applied to local bodies exactly as to fetched ones, no metadata-only citation, no secondary support for primary-law claims, external acquisition retained as fallback.

## Nominated primary target / local-first results

| Fixture | Nominated statute | Local matches | Tier | Body | Section located | Usable | External attempted |
|---|---|---|---|---|---|---|---|
| AW4 | חוק-יסוד: כבוד האדם וחירותו §8 | 1 | statute_mirror | 1,633 | no | **yes** (framework) | **no** |
| AW1 | same | 1 | statute_mirror | 1,633 | no | yes | no |
| AW9 | same | 1 | statute_mirror | 1,633 | no | yes | no |
| ST1 | same | 1 | statute_mirror | 1,633 | no | yes | no |
| AW8 | חוק למתן תוקף להסכמים בין רשויות המדינה | 0 | — | 0 | — | no | fell back (no official URL) |
| AW7 | — (no statute nominated) | — | — | — | — | — | — |

Before this track, the same AW4 anchor ended `statute_extraction_budget_spent`, `body_chars 0`, `statute_count 0` after three Knesset PDF/DOCX fetches. Now it is resolved locally in ~110 ms with zero fetch slots.

## Section location

`locateStatuteSection` accepts only qualified anchors (`סעיף 8`, `§8`) or a numbered-heading marker — a bare digit is never an anchor. The local Basic Law body has no section numbering (stripped at ingest), so every run reported:

`explicit_marker_found=false, textual_anchor_found=false, section_located=false, whole_statute_fallback_used=true, allowed_claim_scope="general_statutory_framework"` plus the Hebrew limitation note.

Verified in the drafted answers: **no run claims "סעיף 8 קובע"** or attributes text to a numbered section.

## Local judgment resolution

| Fixture | Docket | Lookup attempted | Local matches | Identity | Fallback |
|---|---|---|---|---|---|
| AW4 / AW9 / ST1 | 1715/97 | yes | 0 | n/a | court-egress |
| AW1 | 6821/93 | yes | 0 | n/a | court-egress |
| AW7 | 4495/95 | yes | 0 | n/a | court-egress |
| AW8 | 1715/97 | yes | 0 | n/a | court-egress |

Local lookup now runs before external acquisition **and before the cooldown short-circuit** (a cooldown suppresses external retries only). The corpus itself holds no Supreme Court dockets in that era: all 7,396 `case_number` values are lower-court `NNNNN-MM-YY` forms, so the resolver correctly reports `no_local_match` rather than forcing a match. Local judgment resolution therefore works but is currently unproductive until docketed Supreme Court text is ingested.

## Path ordering (local-first vs external fallback)

| Fixture | local_attempted | local_status | external_attempted | final_status |
|---|---|---|---|---|
| AW4 / AW1 / AW9 / ST1 | true | resolved_whole_statute | **false** | acquired_local_primary |
| AW8 | true | no_local_match | false (no official URL) | no_usable_primary_anchor |

## Before / after coverage

| Fixture | Footnotes before | after | Primary anchor before | after |
|---|---|---|---|---|
| AW4 | 5 (best run; 2 typical) | 5 | none | local Basic Law |
| AW1 | 4 | 3 | none | local Basic Law |
| AW7 | 1 | 1 | none | none (correctly restrained) |
| AW8 | 3–4 | 4 | none | none |
| AW9 | 4 (0 in the pre-fix batch) | 6 | none | local Basic Law |
| ST1 (new statute-heavy fixture) | — | 3 | — | local Basic Law |

## Tests

`bunx vitest run` — 20 files, 206 tests passed (9 new).

## Value assessment

The Basic Law now reaches the drafter as a real primary anchor with body text on every constitutional fixture, which is what the AW4 audit said was missing, and it costs no fetch/extraction budget. The remaining thinness is no longer statutory: it is judgment text (no local Supreme Court dockets, gov.il 403 externally) and comparative scholarship. Next priority stays primary-judgment acquisition — either ingesting Supreme Court judgment text locally or stabilizing court egress — before Hebrew prose naturalness.
