# Bounded pasted-citation infrastructure C2

## Baseline and scope
- Verified clean source baseline: `3d11a3e46dbd833580535a1c2acf05bfe3e7b550`.
- User-supplied independent C1 gate: 3,899 passed, 4 skipped, 64 probes, app TypeScript and explicit Vite build passed. These are external baseline results, not this sandbox's test count.
- Tested C2 source before report: `155cfe5fbb939bba278ac7a2860b5125b7f2820b`; final platform-managed revision includes report/roadmap changes.
- Production changes are limited to shared planner eligibility/request planning and Index's typed-success flag. No server lookup code, provider strategy, model settings, wire envelope, legal rules, taxonomy or UI layout was changed.

## Exact enabled routes
- Index initial submission and explicit manual regeneration now plan existing `foreignLookup.kind=book` and `book_chapter` requests through the same pure `planTypedRequest` as runCitation, BatchFootnoteBuilder and BibliographyGenerator.
- Eligibility uses existing `extractBookWork` structure, not classifier confidence or manual choice as identity proof: matching effective book/chapter family, explicit supplied authors and book/collection title, plus supplied chapter title for chapters; no parser preservation reason or unknown remainder; existing renderer must report genuinely missing fields.
- Complete sources remain local, with existing warnings and without identity verification claims. Explicit labels can safely retain numeric titles. Ambiguous bare numeric editor-only titles, unlabelled comma chapter heads, unknown publisher status, unsupported forms, crossed manual choices and anchorless manual books remain local/preserved, zero completion operations.
- This is intentionally narrower than the old runner's unrestricted anchorless book request construction. `Synthetic work needing details` cannot manufacture authors/title from a manual family. Explicit missing labelled inputs previously returned a local missing result; now they can use the existing completion operation.
- Removed only the obsolete `typedRequestBuilder` capability split after pure parity regressions passed. Local capability values match; `host` still identifies chat/runner for existing host ownership. Israeli article raw handling, foreign article DOI adapter, case precedence and typed statute requests remain unchanged.
- Index marks every shared typed plan as typed when applying the saved continuation, avoiding generic post-response validation on grounded book/chapter replies. Callback metadata, stale guards, success-once continuation and retry transport ownership remain unchanged.

## Semantic acceptance and partials
- C1 resolver/acceptance is unchanged: request/input/kind/jurisdiction binding, identity anchors, grounded fields, exact provenance values and meaningful donor evidence remain mandatory. No ideal payload was substituted for server output.
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