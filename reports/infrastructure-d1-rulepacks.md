# Infrastructure D1 — rulepack/jurisdiction contract (baseline b36df130)

## Capabilities
- `supabase/functions/_shared/citationPure/rulepack.ts` (pure, browser+Deno): `RULEPACK_MANIFEST` v1 with id, jurisdiction/subjurisdiction, family/template, authority (Bluebook ed. 21, rules, v21 URL, observed 2026-10-21), renderer id (existing `foreign_bluebook_v22` product id, not renamed), status, required fields, exclusions, completion eligibility.
- Enabled entries describe only existing routes: US case/statute, UK case/statute, unanchored case lookup (US/UK grounding only), general book/chapter/article (lookup) and general manuscript/thesis/newspaper/internet/constitution (local only).
- Planned/disabled (no template, no completion, renderer null): AU CLR/FCR, HCA/FCA neutral+date, Cth statutes (T2.2 italic parties/statute title); CA SCC neutral/S.C.R. parallel, RSC/SC; DE BGH/BVerfG reported, BGH unpublished docket, BGB/HGB (R20 small-caps codes/expanded reporters, roman court); FR Cass./Bull. selected civ./crim., Code civil/commerce. FR oc./soc. excluded (source anomaly). Not an all-countries claim; registry includes subsystems/non-country entities.
- Shared contract: `MANUAL_CHOICE_JURISDICTIONS` IL/US/UK/DE/AU/CA/FR/UNKNOWN (server sanitizer + browser `citationManualChoice` via `rulepackJurisdictionFromId`); typed-lookup wire stays US/UK/OTHER/UNKNOWN and the server rejects others (`lookup_jurisdiction_unsupported`). `planForeignLookup` eligibility now passes through `rulepackLookupEligible`. Wire `rulepackVersion`: absent = legacy v1, 1 = current, other = preserve (`rulepack_version_unsupported`).
- Planned-country manual choice (any family) → `rulepack_planned_disabled:XX`, raw preserved/escaped, actionable warning, zero provider/cache/classifier/usage traversal; conflicting text evidence still wins as `manual_jurisdiction_conflict`. Natural `BGH`/`BGHZ`/`BGHSt` are DE evidence (existing DE preserve; docket never reaches Israeli lookup). Server recomputes evidence from bound raw; forged wire fields don't authorize.
- Hosts: Index (initial + manual regeneration), runCitation (batch/bibliography) and citation-chat entry all use the same shared functions.

## Tests (offline)
- `src/test/rulepackD1.test.ts` 24 cases; 17 failed before the change, all pass after.
- `src/test/rulepackD1Differential.test.ts`: 15 frozen US/UK/literature/Israeli/DE/Unicode/marker inputs captured on baseline (contract, chat+runner plans, server guard) — identical after.
- `foreignStatuteChatHost.test.tsx` +2 Index cases (AU regeneration zero IO; BGH zero IO).
- Full suite: 197 files, 4,076 passed / 1 skipped / 0 failed.
- Unrun: explicit app TypeScript and explicit Vite production build (environment disallows manual runs); automatic build status only.

## Remaining gaps (not done)
- No AU/CA/DE/FR templates, rendering or provider completion; Perplexity grounding, server identity/provenance validation and authoritative history/recovery for them are D2 (AU/CA) then D3 (DE/FR).
- Authoritative final-result replay exists only for books/chapters; no general case/statute replay guarantee.
- Planned-country literature (e.g. a book with manual AU) is preserved rather than formatted under general rules — deliberate conservative choice, revisit with QA.
- DE keeps its legacy `formatter_DE_not_supported` code/warning text for output parity.
- No deployment, live calls, DB/schema/auth/security/billing/limit changes.

## Correction (on a8ab09c1) — independently reproduced defects
1. BibliographyGenerator regeneration now passes the effective `plan.manualChoice` (not only sourceType) through `lookupOneSafe`/`lookupOne` to runCitation. Recovery retries keep their retained operation. 8 actual-component cases (AU/CA/DE/FR × case/statute) preserve raw with zero cache/provider.
2. General literature restored: a planned-country choice blocks only country-scoped families; enabled general families (book, chapter, journal, newspaper, manuscript, thesis, internet) keep their template unless the text is a real case (manual-family conflict still terminal). 18 AU/CA/FR × six-family cases match a fixture captured by running the same test in an extracted b36df130 tree (output, markup, warnings, cache/provider counts).
3. `rulepackCapability(family, jurisdiction)` is the shared decision: planner preserves before local renders, book/chapter completion, statute requests and case requests when the entry is disabled; `pastedCaseRequest` and `planForeignLookup` use it as well; the server rejects lookups without an enabled completion (`rulepack_lookup_disabled`) before UsageGuard/cache/provider. 9 planner + 3 handler toggle-and-restore tests, plus a missing-entry rejection.
4. Server manual choice: `jurisdictionId` resolves through `rulepackJurisdictionFromId`; omitted code uses it, a contradictory code → `manual_jurisdiction_id_mismatch`, a malformed code → `manual_jurisdiction_malformed`; all preserve raw. 9 actual-handler cases with zero usage/cache/provider; legacy US control still routes.
5. Manifest metadata: `us.constitution` (not general); `us.case.reported` vs `us.case.unreported` (local only, docket/date, no volume/page); `ca.case.scc_neutral` vs `ca.case.scr`; `fr.case.cass` requires chamber/bulletinPart/decisionNumber; oc./soc. still excluded. AGENTS rule restored: identity must match an official record path consistent with the extracted citation.

Fail-before: the 32 new correction tests run against a8ab09: 31 failed, 1 passed (the legacy US control). Full suite after: 200 files, 4,111 passed / 1 skipped / 0 failed. Earlier D1 frozen differential fixture unchanged. Explicit app TypeScript and Vite production build not run (environment); automatic build status only.

Remaining gaps unchanged: no AU/CA/DE/FR templates/completion/replay; book-only authoritative replay; Bibliography initial intake has no classification plan (unchanged); manifest entries are mutable objects inside a frozen array solely so tests can toggle and restore them.
