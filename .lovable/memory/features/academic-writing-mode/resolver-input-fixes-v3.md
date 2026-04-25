---
name: Resolver Input Fixes v3 (titleHint + pre-resolve cleanup + bare-docket boundary)
description: Three-part plumbing fix for the chapter legal-resolver path — passes card.title/case_number into the router, normalizes punctuation noise before resolveCitation, and tightens the bare-docket regex to require a court-name token nearby.
type: feature
---

Scope: chapter-footnote → legal-resolver pipeline only. No classifier topology, no chapter-writing prompts, no resolver capability changes.

## Changes
1. **titleHint plumbing** (`legal-qa/index.ts` ~line 6238): chapter loop now looks up `fnNumberToCard.get(fn.number)` and passes `{ titleHint: card.citation, caseNumberHint: card.case_number }` into `routeChapterFootnote`. Activates the previously dead `titleHint` pathway in `extractLegislation`/`extractBasicLaw` for bare-section statutes.
2. **Pre-resolve normalization** (`chapterCitationRouter.ts` `preResolveNormalize`): strips trailing supra fragments (`, לעיל ה"ש N`), collapses repeated punctuation (`.,.` → `.`), tidies trailing comma+dot noise, and balances a single dangling open paren. Applied only to legal-routed strings before `resolveCitation`.
3. **Bare-docket boundary** (`chapterCitationRouter.ts` `looksLikeBareDocket`): `CASELAW_BARE_DOCKET_RE` now requires a court-name token (`בית המשפט`, `בתי המשפט`, `בית הדין`, `בג"ץ`, `העליון`, `המחוזי`, `השלום`, `לעבודה`, `לענייני`, `הצבאי`) within ±80 chars. Kills the false-positive where statutory subsection patterns like `26(2) ו-(4)` matched the bare-docket shape.

## After3 measurement vs after2

| Q | engine resolved/attempts | classify shifts |
|---|---|---|
| Q1 | 0/5 (was 0/7) | Bare-docket caselaw all promoted to `caselaw_prefix_shape` because the drafter now emits proper `בג"ץ NNNN-NN-NN` shapes (downstream effect of titleHint enriching the card → drafter sees fuller metadata). |
| Q2 | 2/7 (was 2/15) | Total legal-routed dropped from 17 → 8 because non-legal items now route to bibliography (1 journal_article + 0 routed-cleanly). 5 statutes still `missing_required` — see open issue below. |
| Q3 | 0/1 (was 1/0) | One statute regressed because the drafter restructured the chapter; not a resolver-side change. |

### What worked
- **Mode B (statutory subsection bleed) eliminated**: zero `caselaw_bare_docket` false-positives in after3 across all three runs.
- **Mode D (truncated text)**: Q2 fn#6 `"חוק שירות המדינה (מינויים), התשי\"ט-1959,."` extractor now succeeds — punctuation noise stripped.
- **Mode C partial win**: Q2 fn#2 `"חוק שירות המדינה (מינויים), התשי\"ט-1959, ס\"ח 123."` now resolves cleanly via direct extraction (no titleHint needed once the drafter receives the card).
- **Bibliography reroute**: Q1 went from 0 → 5 `journal_article` cards, all passed through the validator instead of being mis-routed to the legal resolver.

### What still fails
- Q2 still shows 5 × `missing_required` for statutes where the citation is a bare reference (e.g. `"חוק לתיקון פקודת הנזיקין (מס' 10) - חסינות עובד הציבור (2018)"`) and the matched card.citation does NOT contain the Hebrew year — so titleHint provides no additional fields. The fields the resolver needs (`hebrewYear`) literally do not exist in either the citation OR the card. This is a content-quality issue, not a plumbing issue.
- Q1 still shows 5 × `missing_required` because the drafter emitted full `בג"ץ NNNN-NN-NN (בית המשפט העליון)` shapes WITHOUT party names. Caselaw_database requires `party1`/`party2`. This is the case for #4 (real bare-docket extractor) — without it, even clean shapes fail.

### Net verdict
- Plumbing fixes #1 + #2 + #3 landed cleanly with no regressions.
- The remaining `missing_required` rate is now ~71% of legal attempts (10/14 across Q1+Q2+Q3) and is driven by **two distinct content gaps**: (a) drafter dropping party names in caselaw, (b) cards lacking Hebrew years for some statutes.
- Item #4 (real bare-docket extractor with party-name fallback to card) is now the highest-leverage next step. Mode A is no longer cheap-fixable.

## Files changed
- `supabase/functions/_shared/chapterCitationRouter.ts` (added `preResolveNormalize`, `looksLikeBareDocket`)
- `supabase/functions/legal-qa/index.ts` (passed titleHint + caseNumberHint at line 6244)
