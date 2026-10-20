# Unified pasted-citation infrastructure — batch A

## Scope and revisions
- Starting HEAD verified clean: `7ce1a9d6550be3cc008874544e21fd0f084d551f`.
- Final tested implementation HEAD: `8eaa047d6cd9291e5ddc937590edb5fd16cc0a6f` (report/roadmap-only completion follows; the final checkout SHA is supplied in the completion message).
- Offline synthetic fixtures/mocks only. No deployment, provider/model/research requests, production database reads/writes, schema, authentication, permissions, billing semantics or settings changes.

## Implemented routing
1. `_shared/pastedCitation.ts` is the pure version-1 supplied-evidence contract used by the browser and actual citation-chat handler. It retains exact raw text, a non-cryptographic routing fingerprint, original character spans, unknown spans, source kind, jurisdiction/subjurisdiction evidence, court/reporter/docket candidates, manual choice, supplied/parser provenance, missing/conflicting/unsupported states. The fingerprint is not identity proof and does not replace existing cryptographic request identity.
2. `pastedCitationAdapter.ts` adapts existing Bluebook detections, not a new country parser or rule registry. Normalized values without an exact source substring remain unknown in the evidence contract. Complete supported cases use existing rendering. Existing book/periodical/statute/article helpers remain authoritative.
3. Index initial/manual regeneration and runCitation/batch use the contract to choose local/typed/preservation routes, send it with exact raw input, and check returned input binding. Batch and classification generation plans carry explicit manual choices. These choices are retained in an existing bounded recovery message, so no new recovery schema or database storage is required; this also binds them to existing request fingerprints.
4. Server derives evidence from supplied raw input, actual last-user text and lookup text. Forged client jurisdiction/route cannot authorize Israel. Preservation is before verified-source cache, usage claim and docket enrichment. Israeli prefix or Hebrew-party evidence keeps the existing Israeli route; bare numeric identifiers alone do not authorize cache/search or verification.
5. German BVerfG/BVerfGE/BvR forms identify foreign/Germany evidence but are unsupported: preserve input plus warning, zero classifier/cache/provider work. Conflicting manual choices and mixed known jurisdictions preserve with a specific warning. Unknown country remains unknown. UK subunit selection does not grant a full formatter; unsupported subunit selections preserve.
6. Complete US/UK case forms can render locally in both hosts. Incomplete foreign-case-shaped input uses existing typed foreign case lookup, with UNKNOWN jurisdiction when evidence is absent. Matched conflict-free jurisdiction-compatible responses fill only missing fields; supplied fields win. Failed/unmatched lookups never escape to generic model formatting or Israeli fallback. Existing disambiguation and unusable-response recovery behavior remain.
7. Evidence collections are capped per signal (16) without truncating raw text or hiding another jurisdiction; manual field strings are bounded. No new raw-content diagnostics were introduced.

## Tests and validation
- Independently reproduced before implementation: **10 failed / 26 passed** actual runCitation/Index regressions.
- Initial full-suite failures exposed injected legacy-handler fixture dependencies and intended bare-docket/cache behavior changes; fixture bindings were updated rather than bypassing their handlers. Genuine retry/disambiguation/cache/stale behavior regressions were corrected.
- Focused caller/server/recovery set before final bounds: **137/137 passed**.
- Final full offline suite: **187 files passed; 3,392 tests passed, 1 skipped**, total 3,393.
- Actual Index mounted initial/manual tests, actual batch regeneration using runCitation, actual citation-chat source executed with dummy runtime/closed transports, and pure span/routing tests cover the named Israeli/US/German controls, forged declarations, manual conflicts, unknown numeric identifiers, suffix/marker preservation, response binding, repeated evidence bounds and recovery choices.
- Existing suites cover supported US/UK, article/statute contracts, prior book/periodical ambiguity gates, stale response checks and request idempotence.
- Automatic preview compilation: latest visible `build OK` at `2026-10-20T22:36:28Z` after implementation. Separate app-typecheck and production-build results are **not exposed** by the harness; manual builds/typechecks are forbidden in this environment. They are not claimed passed and remain independent release-gate checks.
- No authenticated live browser/provider flow was performed: user authorized offline mocked callers only.

## Remaining host differences / exclusions
- Index retains its conversation/history success continuation; runCitation retains its existing verified-store-first and local warning/status semantics. They share safety routing, not every workflow or display status.
- Existing verified-source hits remain identity-bearing in runCitation; Index complete local case formatting skips its cache path. Local formatting is never itself identity verification.
- Article/statute response contracts remain their existing versioned protocols. The new supplied-evidence fields are not a universal completion/provenance engine for retrieved metadata.
- No German or other new-country formatter, all-country coverage, language-based country inference, broad abbreviation tables, menu redesign, Hebrew typography correction or new provider retries.
- Raw input remains available through existing user-facing request/history/recovery paths; no diagnostic logging was added. Extremely large raw inputs are still governed by existing request/recovery bounds, not a new product quota.
- Report does not claim unified Perplexity completion across all families/hosts. Batch B requires separate authorization.

## Credit checkpoint
- Read-only build-mode spendable balance snapshots: 177.92 initially, 166.52 at final check, a **11.40-credit decrease** across workspace snapshots (not exact settled attribution for this turn).
- No limit/settings changes. Daily Build limit remained disabled. The required per-run 20-credit checkpoint was observed manually with snapshots; no independent platform checkpoint configuration was exposed/changed.
- Stop at batch A. Separate app-typecheck/production-build evidence and independent review gate remain required before any release.