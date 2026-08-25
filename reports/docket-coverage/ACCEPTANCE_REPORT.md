# judgment_nomination_coverage_for_named_dockets_v1 — Acceptance Report

Status: **ACCEPTED**
Date: 2026-08-25 (UTC)
Artifacts: `reports/docket-coverage/*.json` (per-run telemetry + verbatim answers)

## What shipped

| Component | Change |
| --- | --- |
| `stages/docketDetection.ts` | Added `עת"ם/עת"מ`, `עע"ם` (final-mem) variants; new narrow un-punctuated lane (`בגץ, עא, עפ, רעא, רעפ, עעם/עעמ, עתם/עתמ, דנא, דנפ, בשפ, בשא, תמש, ברם, עהס`) with a Hebrew-letter lookbehind so a single attached prefix letter (ב/ל/ו/ה/ש/כ/מ) is tolerated but glued words are not. |
| `stages/explicitDocketGuard.ts` (new) | Deterministic coverage guard: detects explicit dockets in the user question, dedupe-merges against `source_nomination_v2`, otherwise adds an actionable judgment target (`category=judgment`, `actionability=known_identifier`, `nominated_by=explicit_docket_guard`, `provenance=user_question_explicit_identifier`, confidence 0.95), max 2 per question, prepended so discovery selects it. |
| `index.ts` | Runs the guard immediately after nomination, feeds the augmented nomination into query-merge and official discovery; emits `explicit_docket_guard` telemetry. Guard is skipped whenever nomination is skipped (router skip / `canonical_quote`), keeping deterministic modes byte-identical. |
| Tests | `stages/explicitDocketGuard.test.ts` (add / dedupe-merge / inert / prefix coverage) — 4 pass; existing `docketDetection.test.ts` 15 pass. |

No URL derivation was revived: the guard emits a target and a search query only. Drafter, verifier, source-integrity, claim-source-match, footnote builder, statute lane, relay infra and the zero-citable floor are untouched.

## Validation — sequential 9-run

| Run | Terminal | Guard det/add/merge | Judgment lane | Body | Cited | FN | Dangling | ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R02 (Mizrahi) | yes | 1/0/1 | yes (cache hit) | 100,924 ch | yes | 1 | 0 | 234s |
| NATION-STATE / Hasson | yes | 1/0/1 | yes (nomination already emitted) | via retrieval | yes | 1 | 0 | 162s |
| FRESH-SC (6427/02) | yes | 1/0/1 | yes (nomination already emitted) | via retrieval | yes | 1 | 0 | 139s |
| D1 | yes | 0/0/0 | statute acquired; judgment on cooldown | 2,460 ch | yes | 1 | 0 | 150s |
| D3 | yes | 0/0/0 | n/a | — | yes | 1 | 0 | 151s |
| MAYA | yes | 0/0/0 | opened (בג"ץ 1000/92) → http_403 | 0 | refusal | 0 | 0 | 123s |
| MAYA-AMIR | yes | 0/0/0 | opened (cooldown) | — | yes | 2 | 0 | 229s |
| P02 (fake docket) | yes | 1/**1**/0 | **opened by guard** → fetch failed (connection reset) | 0 | safe refusal | 0 | 0 | 212s |
| B8 | yes | skipped (canonical_quote) | n/a | — | yes | 1 | 0 | 95s |

## Acceptance criteria

- Explicit dockets always produce an actionable judgment target — met: 4 questions carried an explicit docket; 3 were dedupe-merged onto the existing nomination, 1 (P02) was added by the guard.
- Nation-State and FRESH-SC open the judgment lane — met; both now answer from an identified judgment with a court-page footnote and 0 dangling markers.
- No duplicate targets — met: merge path never adds a second nomination (`added_count=0, merged_count=1` on R02 / Nation-State / FRESH-SC).
- No guessed `z01/_z01` URLs fetched or relayed — met: MAYA detected 4 guessed candidates, all `relay_slot_spent=false`, `suppression_reason=guessed_url_pattern:z01_object_code`; no z01 URL appears in any fetch/egress attempt list.
- At least one explicit-docket run acquires and injects a judgment body, or fails with a specific downstream reason — met twice: R02 acquired/injected/cited 100,924 chars; P02 failed with `fetch_failed: connection reset` rather than "no judgment target".
- R02 no worse than the prior accepted result — improved: previously a refusal with 0 footnotes, now a cited answer with 1 footnote.
- P02 safe — met (refusal preserved; only an added time-limit notice line).
- B8 byte-identical — verified programmatically against the url-guess-suppression baseline.
- No citation without acquired, identity-validated text; no gate loosening; no CPU kills, stale jobs, stubs, dangling markers or orphan rows — all 9 runs terminal, all dangling counts 0.

## Recommended next minimal fix

`negative_cache_cooldown_scoping_v1` — D1 (בג"ץ 1715/97) and MAYA-AMIR (בג"ץ 8497/00) never attempted acquisition because a week-long failure cooldown from an older, now-fixed fetch path is still in force. Scope cooldowns by acquisition strategy version and shorten them for transient network errors, so fixes take effect without manual cache clearing.
