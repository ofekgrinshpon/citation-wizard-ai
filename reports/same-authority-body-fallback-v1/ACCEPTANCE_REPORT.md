# same_authority_body_fallback_v1 — Acceptance Report

Live run: `9ca7d240-360d-4685-82c8-fa002a26ee5a` (exact original natural question,
no authority or docket named by me).

## What was implemented

New stage `stages/sameAuthorityBodyFallback.ts`, wired in `index.ts` after
canonical acquisition and after the web judgment body lane.

1. **Eligibility.** An authority is eligible only when it is an identified
   judgment candidate in the pool, its preferred representation already failed
   to yield a body (docket appears in canonical attempts/gaps or in a failed
   web-lane row) and it still has no substantive body.
2. **Existing representations first.** All other representations of the *same
   normalized docket* are collected from pool candidates, pool drops and the
   run's already-discovered URLs, and scored deterministically (exact docket in
   title/URL, judgment evidence, integrity, snippet/body potential, document
   URL, listing penalty, pool presence). Court hosts and paywalled/access
   controlled URLs stay out of this lane; canonical/relay keeps them.
3. **Bounded recovery.** Only if the run holds no usable alternate is a single
   exact-authority lookup allowed for that authority, reusing
   `searchOfficialJudgmentUrls`. Hard limits: max 2 authorities per run, max 1
   lookup per authority, no recursion, no retry loop.
4. **Strict acceptance.** Fetching uses the existing bounded `fetchSecondaryBody`.
   A fetched page becomes `judgment/primary_mirror` only when the body is
   substantive **and** `validateJudgmentIdentityStrict` passes **and** the docket
   appears inside the fetched body **and** the body carries judgment-document
   markers. A URL/snippet docket alone is never enough. Failure is fail-closed:
   the original representation is untouched.
5. **Telemetry.** `retrieval.same_authority_body_fallback` with eligible/attempted/
   recovered counts, stop reason, and per-authority rows (preferred status,
   existing alternates found, lookup attempted + query, selected URL, fetch
   chars, docket_match, identity_validated, final representation, failure reason).

Nothing else changed: retrieval, ranking between authorities, pool targets,
source counts, duplicate resolution, integrity, canonical registry, verifier,
CSM, topicality, alignment, drafter, footnotes and Hebrew style are untouched.

## Checks

10 new tests in `src/test/sameAuthorityBodyFallback.test.ts` (official body
already good → inert; existing same-docket alternate used, no lookup; single
recovery lookup when nothing exists; genuine mirror accepted; commentary that
merely mentions the docket rejected; different authority on a similar subject
rejected; budget never exceeded). Full suite 42 files / 480 tests, typecheck
clean, deployment succeeded.

## Live run behaviour

`same_authority_body_fallback`: `ran: true`, `eligible_authorities: 0`,
`stop_reason: no_eligible_authorities`, 1 ms, 0 lookups — correctly inert,
because in this run **Bavli had no representation left in the pool** to repair.

### Bavli funnel (this run)

found (daat.ac.il `maamar.asp?id=151`, admitted as `caselaw / binding_case_law`,
score 0.75, rank 101) → **dropped at pool dedupe with `dup_url`**, drop key
`url:www.daat.ac.il/daat/maamar.asp` → no pool representation → canonical lane
ran anyway from the registry seed and failed both probes
(`gov.il` .doc → HTTP 403; the daat page → `not_a_document_file`, HTML 200,
74,462 bytes) → same-authority fallback found no eligible authority (no pool
representation to repair) → not cited.

### Other authorities in this run

Web judgment lane: 6 considered, 3 attempted, 1 acquired; the two court-host
documents (בג"ץ 6301/18 summary PDF, רע"א 6493/21) were correctly out of scope
for that lane. Pool held 30 candidates (7 primary statute, 21 binding case law,
2 persuasive), origins 20 local / 10 web.

### Final footnotes

1. החלטה בתיק בג"ץ 2592/20 (walla mirror PDF) — off point for rabbinical
   property review; a weak authority.
2. Compound: "הזכות לביקורת שיפוטית" + "סמכות בתי-המשפט שאינם בג"ץ להחיל ביקורת
   שיפוטית על חוק שפוגע בזכויות האדם" (both HUJI law journal) — on topic as
   scholarship, but background rather than direct authority.

No criminal or prosecution authorities appeared. The answer carries the
grounding-limitation notice and a metadata-only processing notice.

## Verdict

**Pass on mechanism, no richness gain in this run.** The stage is correct,
bounded and inert when it has nothing legitimate to repair; it did not weaken
any gate and cost 1 ms.

## Exact next loss stage (not fixed here)

`candidate_pool / url dedupe`: the daat Bavli page was dropped as `dup_url`
under key `url:www.daat.ac.il/daat/maamar.asp`. `daat.ac.il` is a query-param
identity host (`maamar.asp?id=<document>`) but is not in the docket-aware URL
key's identity-endpoint table, so distinct daat documents collapse into one key
and the Bavli representation is discarded before any body lane can see it.
