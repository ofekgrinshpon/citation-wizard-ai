# Bounded pasted-citation infrastructure C2

## Baseline and scope
- Verified clean source baseline: `3d11a3e46dbd833580535a1c2acf05bfe3e7b550`.
- User-supplied independent C1 gate: 3,899 passed, 4 skipped, 64 probes, app TypeScript and explicit Vite build passed. These are external baseline results, not this sandbox's test count.
- Tested C2 source before report: `155cfe5fbb939bba278ac7a2860b5125b7f2820b`; final platform-managed revision includes report/roadmap changes.
- Initial C2 changes were limited to shared planning and Index's typed-success flag. The bounded correction below additionally tightens existing chapter identity matching/acceptance and edition presentation; provider strategy, model settings, legal rules, taxonomy and UI layout remain unchanged.

## Exact enabled routes
- Index initial submission and explicit manual regeneration now plan existing `foreignLookup.kind=book` and `book_chapter` requests through the same pure `planTypedRequest` as runCitation, BatchFootnoteBuilder and BibliographyGenerator.
- Eligibility uses existing `extractBookWork` structure, not classifier confidence or manual choice as identity proof: matching effective book/chapter family, explicit supplied authors and book/collection title, plus supplied chapter title for chapters; no parser preservation reason or unknown remainder; existing renderer must report genuinely missing fields.
- Complete sources remain local, with existing warnings and without identity verification claims. Explicit labels can safely retain numeric titles. Ambiguous bare numeric editor-only titles, unlabelled comma chapter heads, unknown publisher status, unsupported forms, crossed manual choices and anchorless manual books remain local/preserved, zero completion operations.
- This is intentionally narrower than the old runner's unrestricted anchorless book request construction. `Synthetic work needing details` cannot manufacture authors/title from a manual family. Explicit missing labelled inputs previously returned a local missing result; now they can use the existing completion operation.
- Removed only the obsolete `typedRequestBuilder` capability split after pure parity regressions passed. Local capability values match; `host` still identifies chat/runner for existing host ownership. Israeli article raw handling, foreign article DOI adapter, case precedence and typed statute requests remain unchanged.
- Index marks every shared typed plan as typed when applying the saved continuation, avoiding generic post-response validation on grounded book/chapter replies. Callback metadata, stale guards, success-once continuation and retry transport ownership remain unchanged.

## Semantic acceptance and partials
- C1 request/input/kind/jurisdiction binding, grounded fields, exact provenance values and meaningful donor evidence remain mandatory. The correction adds distinct chapter/collection evidence requirements; no ideal payload was substituted for server output.
- Fixtures run the real `runForeignLookup` extractor against synthetic mocked Search evidence. Mutated failure fixtures start from those real envelopes.
- Book `Author: Jane Doe; Book: Synthetic Collection` accepts grounded year 2020 from the matching donor. Chapter `Author: Jane Doe; Chapter: Quiet Rules; Collection: Synthetic Collection` keeps grounded year 2020 while firstPage stays missing with an explicit warning; no page is inferred.
- A supplied edition 2d is never replaced by found 3d; unrelated grounded year remains useful. Wrong kind/jurisdiction/raw, unmatched/error/missing-key, multiple candidates, missing/mismatched provenance terminate safely without generic content or another operation.
- Actual chat initial/manual message completion metadata is compared with the real runner result. Actual batch cells/review cards and bibliography review-to-add callback objects retain the same accepted fields/provenance, missing/conflicts and identity/completeness status. Canonical input and supplied unknown spans remain in pastedCitation.
- Comparisons target semantic metadata and warnings, not context-specific bibliography/footnote punctuation or styling. Existing contextual formatting/export gates remain in the full suite.
- No persisted schema changes: chat/footnote localStorage strips completion/pastedCitation; existing real BibliographyProvider entry/storage/reload and history-insert tests remain passing. Old results lacking metadata remain compatible.

## Operation and provider bounds
- Each eligible explicit initial/regeneration action dispatches one existing top-level citation operation. Tests assert one operation for each batch/bibliography row and two for two separate chat initial/manual actions.
- Positive synthetic book/chapter extraction fixtures assert exactly one existing Search fetch and zero page fetches. The existing server strategy is untouched: max_results 8, existing Tier 1/Tier 2 and bounded page inspection. Broader existing bound/failure tests still pass; one synthetic success fetch is not a universal provider-call or cost cap.
- C1's eight actual-handler book/chapter unmatched/error/thrown/missing-key tests still prove zero generic gateway calls and unchanged begin/finish settlement semantics.
- Complete/ambiguous actual batch/bibliography and chat controls assert zero completion operations. Telemetry-only zero-work calls are distinguished from completion operations in runner-host tests.
- Retry tests retain the prepared binding and skip repeat classification. Actual Index success continuation applies once; actual Index button ownership retains its existing double-submit lock. Existing stale input/account/project/manual scope, idempotence and retry suites remain passing.

## Offline gates
- Pre-change new planner suite: **16 failed / 8 passed**, reproducing missing eligibility/host parity and unsafe anchorless continuation.
- Final full sandbox suite: **190 files passed; 3,879 tests passed; 1 skipped; 0 failed**.
- Focused actual-host/planner/server/extractor/persistence suite: **371 passed / 1 skipped**, seven files, followed by **26/26** actual Index continuation/legacy tests; final full suite includes the additional zero-call and retry regressions.
- Automatic harness latest compilation: **build OK at 2026-10-21T00:27:02Z**, after fixing its reported test mock tuple type error.
- Separate explicit app TypeScript and Vite production build commands were **not run**: environment instructions prohibit manual builds/typechecks, and knowledge lookup exposed no supported separate gate interface. Automatic compilation is not represented as independent explicit gate evidence. Those two requested gates require independent verification.
- All provider/database/auth/history service boundaries were mocked; no live application/browser/authenticated production flow was exercised under this offline authorization.

## Remaining limits and stop
- Only existing explicit bounded book/chapter structure is eligible. Natural unlabelled author/title boundaries, editor-only incomplete identities and unsupported unknown spans do not gain a completion route. No guessing, new grammar, countries or expansion D.
- Existing generic book/chapter extractor may only complete limited publication metadata (e.g. year/edition); it does not promise independently grounded chapter pages or full completion.
- Existing case/article/book/chapter server envelopes lack mandatory raw echoes; retained request binding and existing identity evidence remain the C1 compatibility boundary. Unbound historical recovery remains its documented display-only compatibility branch, not newly verified identity.
- No deployment/publication, backend/database/data/schema/auth/security/permission/payment changes, purchases, live provider/model/research calls, menu changes or unrelated Hebrew fixes. Daily cap/per-run checkpoint settings were not changed; actual credits were not measured here.
- Stop after C2 for independent QA, including the separate explicit TypeScript/Vite gates; expansion D remains unstarted.

## Independently reproduced C2 correction

### Reviewed baseline and three boundaries
- Verified clean baseline `a66d3c56fabc2112a068dd0d5c7df35ae02c8d76`.
- **Edition suffix:** shared book/chapter parenthetical rendering recognizes numeric ordinal values (`2nd`, `2d`, etc.) with or without one canonical `ed.` suffix, emitting exactly one suffix. Unknown edition text stays literal, with existing escaping; no arbitrary suffix stripping or new edition inference. Labelled parsing now retains the exact supplied edition instead of stripping `ed.` indiscriminately. Lookup `fields.edition` and `provenance.edition.value` remain `2nd ed.`; only presentation normalizes it.
- **Chapter identity:** existing server identity-source filter requires both exact normalized chapter and collection text in the same returned title/snippet, not the URL or collection alone. Existing author matching remains required. A successful chapter response adds `chapter:<supplied title>` only after matching. Wrong/absent chapter evidence yields unmatched, empty additions and explicit `chapter_identity_unconfirmed`; no new searches or extraction grammar.
- **Client acceptance:** shared resolver requires distinct matching chapter and collection anchors and same-source chapter/collection evidence, and rechecks each field's provenance donor for both identities. Legacy `title:<chapter>` plus `title:<collection>` anchors remain acceptable when source evidence proves both. Old collection-only matched envelopes fail closed with a chapter-specific warning. Matching a valid chapter does not license additions from a sibling collection-only donor. Existing field/kind/raw/jurisdiction/conflict checks remain.
- **Eligibility:** real `extractWorkFromEvidence` book/chapter branch returns only year/edition publication metadata. Shared planner now requires at least one missing field supported by that extractor. Existing renderer marks year as required but not edition: missing edition alone is not a new reason to search. FirstPage-only chapters stay on the existing local renderer with `firstPage` missing marker/warning. Missing year can still use one operation and leave firstPage honestly missing. Neither bibliographic firstPage nor user pinpoint is inferred/searched; a supplied pinpoint cannot become firstPage.

### Actual-host and compatibility evidence
- Exact new fixtures run the production lookup constructor with mocked donor `Jane Doe, Synthetic Collection (2nd ed. 2020)` and the specified wrong chapter/collection record. No forged positive identity envelopes.
- Actual Index initial and same-family manual regeneration, real batch cells/review cards and bibliography review/add objects assert single-suffix rendering, unchanged provenance, wrong/absent chapter unconfirmed with original input retained, firstPage-only zero completion requests, and missing-year useful partial completion with exactly one existing top-level operation per action.
- Positive chapter fixtures in earlier tests were corrected to contain real requested chapter evidence; existing assertions were retained. C1 B9 now explicitly supplies both known chapter and collection titles. Collection-only envelopes are separately tested as rejected, not treated as successful completion.
- Correction matrix production-extractor calls remain one existing Search fetch, no page fetch; no claim of a universal cost cap. Actual host firstPage-only tests assert zero citation operations (zero-work telemetry remains separate). No IO/claims/refunds/retry ownership changes.
- Existing transient metadata/storage stripping, manual/account/project stale guards, retry request IDs, typed server terminal failures, grounded partials, unknown-span preservation, HTML/marker escaping, Hebrew precedence and foreign docket protections remain covered by focused/full offline suites.

### Correction gates and remaining limits
- New exact regression matrix before implementation: **28 failed / 177 passed**, reproducing all three defects through shared/server and actual hosts.
- Final focused eight-file suite: **408 passed / 1 skipped / 0 failed**.
- Final full suite including donor/pinpoint/supplied-edition tests: **191 files; 3,915 passed / 1 skipped / 0 failed**; tested code revision `dbb795c1aefdafceab1b039acbefa1b7382cb2aa` (final revision adds this gate record).
- Automatic compilation: **build OK at 2026-10-21T00:41:49Z**. Separate explicit app TypeScript/Vite commands remain unavailable under the environment's manual-command prohibition, not claimed as independently run.
- Strong chapter evidence uses existing returned title/snippet text. Records without that evidence fail closed even if a URL looks plausible or the collection matches; no new page-inspection identity strategy was added. Exact normalized occurrence is not full-text legal identity verification. Bibliographic firstPage extraction remains unsupported; complete edition data is not promised.
- No deployment, live calls, DB/data/schema/auth/security/permission/payment changes, provider/search strategy expansion, quota/settings changes or D. Stop for independent QA; explicit app TypeScript/Vite gates remain external blockers.

## Narrow C2 planner-to-server wire correction

### Baseline and separation
- Verified clean baseline `2e4b11a6c27b6e060c7b73b4428e673b1b04e43c`; prior edition, chapter-identity and extractor-eligibility corrections retained.
- Shared book/chapter planning now keeps complete local parsed fields separately from `foreignLookup.parsedFields`. The wire projection uses the existing server `suppliedLookupFieldsMatch` allowlist/check unchanged, omits unsupported keys, and requires raw-bound author/book/chapter anchors. No server binding gates or allowlist were modified.
- `originalYear`, publisher identity/status, selected section/paragraph and normalized display pinpoint stay local for rendering and conflict acceptance; they do not become provider-search fields. Exact labelled values and original-input spans survive in transient `completion.suppliedFields`, independently of provider-added `fields`/`provenance`. Leading whitespace offsets are tested.
- Exact supplied `214-216` is projected as `pinpoint: "214-216"`, never its displayed `214–216`; selected `Section: 4.2` remains local and renders as `§ 4.2`, never fabricated as a raw-bound `§4.2` request value. User-selected pinpoints are neither searched nor inferred.
- Resolver validates donor additions against the complete local supplied fields, not merely the smaller wire projection, then gives local fields precedence in rendering. All four exact inputs retain supplied semantics while accepting grounded year/edition. Unsupported/unsafe identity projection stays on existing local render/preserve paths; no invalid request or generic escape is introduced.

### Actual boundaries tested
- `citationC2Wire.test.ts`: actual planner output and production lookup extraction for A original year 1901; B Synthetic Press/non-original; C chapter firstPage 12/pinpoint 214-216; D section 4.2. Exactly one existing synthetic Search fetch, no extra page/provider call.
- `hebrewArticleEvidence.test.ts`: each actual planner-generated request enters the actual citation-chat handler with mocked lookup/usage/gateway dependencies. Each passes exact preflight, performs one lookup and one begin/finish pair, and performs zero generic gateway calls. Lookup spy checks the exact forwarded planner fields. These are handler acceptance tests, not live provider tests.
- Negative actual-handler controls: forged unsupported extra field, different raw citation, unrelated year value, crossed source kind and US-evidence/UK-declared jurisdiction all preserve before cache, usage or lookup/gateway.
- Actual Index initial/manual, runCitation, BatchFootnoteBuilder review result and BibliographyGenerator add callback retain exact local supplied metadata and accepted donor provenance. Display respects original year/publisher/range/section; stored chat/footnote payloads still omit transient metadata.
- No disconnected ideal positive request fixtures; positive lookup envelopes use the real existing extraction constructor with synthetic donors. No pre-edit fail-before run was performed in this turn; independently reproduced failures came from the user, and post-change actual-handler/host gates demonstrate correction.

### Final offline gates and limits
- Focused eight-file gate: **432 passed, 1 skipped, 0 failed**.
- Full final gate: **192 files passed; 3,941 passed, 1 skipped, 0 failed**. Tested source revision `a5d5984da460ac04462f6b9a9bcf02add8df8613`; subsequent report/roadmap changes are documentation-only.
- Latest automatic compilation: **build OK at 2026-10-21T00:54:42Z** after correcting fixture typing. Explicit standalone app TypeScript/Vite production commands were **not run**, because environment instructions prohibit manual builds/typechecks; automatic compilation is not claimed as those requested independent gates.
- Existing extractor still completes only supported year/edition fields, not bibliographic firstPage or intended pinpoints. Unknown spans/raw input remain preserved; no new search/extraction grammar, request kind, country or D work.
- No live calls, deployment/publication, DB/data/schema/auth/security/permissions/payment changes, usage/refund/billing/quota/limit/settings changes or purchases. Per-run checkpoint configuration unchanged; credits were not measured. Stop for independent QA.