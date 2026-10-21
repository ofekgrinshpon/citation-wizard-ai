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

## Correction: capability gate before verified-store cache (on fe373a9e)
- `planCapabilityGate` (pure, in `src/lib/citationPlanner.ts`) holds the effective family/jurisdiction manifest decision plus typed-completion eligibility; `planLocalCitation` reuses it, and `runCitation` calls it before `findVerifiedSourceMatch`, so a disabled entry preserves raw input with `DISABLED_RULEPACK_WARNING` and zero cache/classifier/provider calls.
- Tests `src/test/rulepackD1CacheOrder.test.ts` (9): 6 disabled (Brown/unanchored.case; book with/without Year/general.book; cache hit and miss) failed on fe373a9e and pass now; 3 enabled cache-hit controls match the frozen legacy runner exactly (one cache read, zero provider).
- Remaining limit: with no manual type and no foreign-case evidence, the source-type classifier still runs before the gate (the family is unknown until then); the cache is still read only after the gate.
- Full suite: 201 files, 4,120 passed, 1 skipped, 0 failed. Explicit TypeScript and production Vite build not run manually (not permitted here); automatic build OK.


## Bounded AU/CA LOCAL slice — independently gated baseline 56411d7

This section supersedes only the earlier AU/CA **local** capability gaps. It does not implement or claim the approved grounded Perplexity completion/recovery pipeline.

### Enabled exact templates (completion remains null for all six)
- `au.case.reported`: natural CLR/FCR, separate report year/volume/first page and supplied page/paragraph pinpoint; parties italic, separator punctuation roman; supplied `[No. 2]` retained.
- `au.case.neutral`: HCA/FCA, bracketed neutral year and number, required valid supplied full day-month-year decision date; bracketed supplied paragraph pinpoint; no guessed date.
- `au.statute.cth`: Commonwealth Act title + enactment year italic, `(Cth)` and optional typed s/ss, pt/pts, div/divs, sch/schs locators roman. Whole Act complete without locator.
- `ca.case.scc_neutral`: SCC neutral, optional modern annual-volume S.C.R. parallel; French c. unchanged, full party name roman with procedural-phrase exception.
- `ca.case.scr`: standalone annual-volume S.C.R. from 1975, SCR alias; separate supplied decision/report years and page/explicit paragraph roles.
- `ca.statute.federal`: distinct R.S.C. revision-year and S.C. enactment-year forms; official punctuation alias accepted, canonical `R.S.C. 1985, c C-46`; title roman; optional supplied subdivisions.

Authority metadata uses supplied Bluebook 21 R2/R12/R20 and the supplied official v21 T2.2/T2.6 URLs/observed date (2026-10-21). No paid source fetching or live provider/search calls. Product renderer ID `foreign_bluebook_v22` is unchanged and is not an edition certification.

### Shared architecture and actual hosts
- Pure `citationPure/countryLocal.ts` retains raw UTF-16 capture spans (including repeated equal years), unknown tails, missing fields/conflicts and semantic presentation markers. Alias normalization is render-only; no party/date/identity invention.
- `rulepackCapability(family, jurisdiction, templateId)` requires exact AU/CA template ID; controlled sibling toggles prove no inherited capability. Local eligibility is separate from lookup: all AU/CA completion remains OFF; actual server handler rejects generic and forged UNKNOWN requests before cache/usage/provider.
- Shared adapter/planner gives terminal country results in Index initial/manual and runCitation before verified-store/classifier/provider. Unsupported/incomplete/conflicting forms preserve exact input, escaped safely, with actionable warning; genuinely undetermined legacy routes remain.
- Actual batch and bibliography use the shared runner and exact effective manual choice. Bibliography country regeneration uses original raw input unless explicitly editing, avoiding reinterpreting presentation markers; country statute rows expose their existing classification picker.
- Index local chat saved/reloaded equality, batch local saved/reloaded equality and repeated bibliography generation tested. Existing book/chapter authoritative C2 replay and all existing Hebrew/style/repeat tests retained. These local persistence checks are **not** authoritative completed AU/CA replay certification.

### Offline commands and evidence
- `bunx vitest run src/test/foreignStatuteChatHost.test.tsx src/test/rulepackD1Bibliography.test.tsx src/test/citationRowRetry.test.tsx src/test/stageCBatchHost.test.tsx`: 255 passed, zero failed/skipped (before final 6 manual-batch +6 actual-server + additional pure guards).
- Final `bunx vitest run --maxWorkers=2`: **202 files; 4,210 passed, 1 skipped, 0 failed**. All prior tests retained; frozen baseline fixtures unchanged. Prior assertions were adjusted only where explicitly superseded by six local templates, detected CA evidence, or a now-terminal local route.
- An earlier unrestricted full run produced an unrelated `cpuLinearity.test.ts` wall-clock scaling failure under worker contention; no test/threshold changed. Bounded-worker full rerun passed the unchanged test.
- Separate app TypeScript command and production Vite build **not run**: environment explicitly forbids manual project typechecks/builds. Automatic harness compilation reports build OK (final signal inspected separately). Do not equate it with independent production Vite evidence.
- No live browser/backend E2E, hosted writes or provider calls: actual UI hosts were driven offline with external boundaries mocked, respecting the user's no-DB/no-provider restriction.

### Limits / stop
- No AU/CA grounded lookup, identity/provenance completion, completed-case/statute retention envelope, or authoritative server final-result recovery. Later independent completion gate must extend the C2 pattern explicitly.
- No state/provincial forms, FCAFC/other AU courts, other reporters, CanLII/Quicklaw, pre-1975 SCR, regulations/bills or unsupported parallels/tails. Manual subjurisdictions cannot borrow a federal template. Incomplete forms do not search.
- AU neutral local grammar supports supplied bracketed paragraph pinpoints; other unstructured locators remain raw with warning rather than guessed.
- DE/FR remain disabled; FR oc./soc. unresolved. No new source families, lookup endpoints, retention schema, deployment/publication, live search/model/provider/DB calls, auth/security/permission/payment/billing/quota/refund changes. Per-run20 checkpoint and disabled daily cap untouched.
- Stopped after this slice for independent QA, including separately executed app TypeScript/production Vite gates.

## AU/CA local-slice QA corrections (baseline 491f1e75)
1. Country evidence is now structural only (`*_ANCHOR` regexes in `countryLocal.ts`, shared by `pastedCitation.ts` signals): AU `(yyyy) v CLR|FCR p`, `[yyyy] HCA|FCA|FCAFC n`, `yyyy (Cth)`, trailing `(Austl.)`; CA `yyyy SCC|CanLII n`, Quicklaw, `[yyyy] v S.C.R. p`, `R.S.C.|S.C. yyyy, c X`, trailing `(Can.)`. Incidental SCC/HCA in book titles or US party names keep legacy output, warnings and cache ownership; strong AU/CA anchors with a wrong manual book still conflict-stop with zero IO.
2. CA federal statute title is any nonempty comma-free original title (e.g. Criminal Code, Loi synthétique); series/year/chapter anchors unchanged. The D1 CA manual fixture `Criminal Code, RSC 1985, c C-46, s 718` now formats locally (expectation updated, superseded by this correction).
3. AU locators accept whitespace-separated known unit groups (`pt 2 div 3 s 4 sch 1`); unknown tails still preserve.
4. CA SCR omits the decision year when equal to the reporter year; AST keeps both roles/spans.
Tests: 14 new targeted tests fail on 491f1e75 and pass now; 5 new fixtures run through actual Index, Batch and bibliography hosts. Full: 202 files, 4,242 passed, 1 skipped, 0 failed. Separate TypeScript/Vite build not run manually (environment rule); automatic build is checked.

## Partial-structure recognition correction (baseline 852985df)
Recognition anchors (`countryLocal.ts`, shared by `pastedCitation.ts`) now identify AU/CA + family from typed prefixes even when the final number/page/chapter/year is missing (`[yyyy] FCA`, `(yyyy) v CLR`, `yyyy SCC`, `[yyyy] v S.C.R.`, `R.S.C. yyyy`, `S.C. yyyy`, `(Cth)`); template regexes alone decide completeness. Incomplete inputs keep raw, list the missing element plus `supported_template`, and stop before cache/classifier/usage/provider, including forged UNKNOWN/US server lookups. Bare `Quicklaw` is no longer evidence; title-only tokens (Quicklaw, CanLII, Cth, FCA/CLR) keep general-literature parity. Tests: 62 new checks fail on 852985df and pass now; full suite 202 files, 4,315 passed, 1 skipped, 0 failed.

## Labelled-literature country-suffix correction (baseline 29db8bbb)
`isLabelledLiterature` (`countryLocal.ts`): when every `;` segment is a known literature label with a value and one is a title label (Book/Title/Chapter/Article/Journal), a trailing `(Can.)`/`(Austl.)` is treated as title text, not country evidence. Structural legal anchors (reporter, neutral, `(Cth)`, `R.S.C./S.C. yyyy`) still count everywhere, so stray labels cannot erase a real AU/CA citation. The same rule gates `pastedCitation.ts` signals. The three frozen D1 references now match exactly (book output, warning, cache 1 / classifier 0 / provider 0 or 1). Tests: 7 new checks fail on 29db8bbb and pass now (runner, Index initial + manual regeneration, bibliography intake parity); adversarial controls (legal anchor plus stray labels; unlabelled `Maple v. Cedar (Can.).`) stay Canadian/terminal with zero IO. Batch has no dedicated literature-suffix host test; it shares the tested runner. Full suite 202 files, 4,326 passed, 1 skipped, 0 failed.
