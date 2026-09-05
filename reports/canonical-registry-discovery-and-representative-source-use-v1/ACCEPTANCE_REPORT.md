# canonical_registry_discovery_and_representative_source_use_v1 — Acceptance Report

Status: **partially accepted**. All five fixes are implemented, tested and live.
Discovery starvation is resolved (`discovery_candidate_count` 0 → 2 for registry
authorities); canonical body acquisition still fails, now at the *network egress*
layer rather than for lack of a URL.

## 1. What was implemented

### Fix 1 — Canonical registry official discovery (`stages/canonicalRegistryDiscovery.ts`)
Registry-nominated canonical authorities are now searched for directly, instead of
relying on planner nominations only. Per authority: local corpus resolution first
(`resolveLocalJudgmentAnchor`), then up to N bounded targeted web queries built from
docket + party names + court (`buildAuthorityQueryVariants`, non-hardcoded). Every
candidate is screened before any fetch (`screenCanonicalCandidate`): guessed court
URLs and listing pages rejected; exact docket evidence in title or URL required,
with a capped allowance for official hosts hit by a *targeted* docket query (identity
is still proven inside the body downstream). Wired in `index.ts` before
`runCanonicalAuthorityAcquisition`, whose discovered-URL input now prepends these.
Telemetry: `retrieval.canonical_registry_discovery` with
`canonical_registry_discovery_query` and `canonical_discovery_candidate_selection`.

### Fix 2 — Representative source use (`stages/representativeSourceSelection.ts`)
Per claim, at most one strongest source per representative role
(primary statute/text, canonical case law, direct doctrinal scholarship, theoretical,
critique, comparative, remedy/application, policy). Selection is drawn only from
sources the claim-source plan already permits — nothing is added or revived.
Telemetry: `representative_source_selection`, `representative_source_use`.

### Fix 3 — Drafter representative-source obligation
`renderRepresentativeSourceBlock` injects the per-claim anchors into the prompt right
after the claim-source plan. Post-draft, `drafter_representative_source_compliance`
reports which anchors were used vs omitted. No footnote count is forced.

### Fix 4 — Statute dominance hard fallback (`enforceStatuteDominanceOnDraft`)
Applied to the raw draft before every gate: on a statutory question with an admitted,
verified statute, that statute is promoted to the primary position of statutory
blocks (reorder/promote of an already-permitted source only). Verified at the end
against the real footnote list (`verifyStatuteDominanceInFootnotes`). When no verified
statute exists, `blocked_reason: no_verified_statute_source_available` is recorded
instead of silently citing case law as a substitute.

### Fix 5 — Pack-to-cited funnel (`stages/sourceLastMileFunnel.ts`)
Per-source loss attribution across pack → body → drafter emission → CSM → alignment →
final citation, with the losing stage named.

### Incidental correctness fix
`ביקורת חוקתית / שיפוטית / מנהלית` (judicial review) is no longer misread as a critical
stance by the role classifier.

## 2. Tests

`src/test/canonicalRegistryDiscovery.test.ts` — 13 tests (query variants, exact-docket
selection, listing/adjacent rejection, `no_derivable_url` no longer terminal, role
mapping, one-representative-per-role, weak-pool abstention, drafter compliance,
statute promotion, statute-only-judgment guard, absence declaration, funnel loss
attribution). Full suite: **29 files / 300 tests passed**.

## 3. Live validation (deployed function)

| Fixture | run_id | Registry discovery | Canonical acquisition | Statute check | Rep. selected | Funnel (pack→cited) | Footnotes |
|---|---|---|---|---|---|---|---|
| Q3 | fd0cd506 | 2 authorities queried, 2 candidates | URLs reached; probes `fetch_failed` (egress) | `statute_cited: true`, `statute_first_or_primary: true` | 7 | 17 → 16 body → 7 emitted → 6 CSM → 6 aligned → **4 cited** | 4 (incl. חוק יסוד: כבוד האדם וחירותו) |
| Q2 | 9b27d646 | 2 authorities queried, 2 candidates | same | n/a — run refused before drafting | n/a | n/a | 0 |

Q2 ended in a доctrinal-absence refusal this run (3 Perplexity 429s thinned the pool),
so drafter-side telemetry is absent there; the refusal itself is the honest, intended
behaviour, not a regression from this track.

## 4. Assessment

Met:
- Registry canonical authorities are now actually searched for. `discovery_candidate_count`
  moved from a persistent 0 to real candidates, and acquisition consumes them.
- Pre-fetch screening works as designed (one Mizrahi candidate rejected `guessed_court_url`,
  the other admitted with targeted-official evidence).
- Representative selection, drafter obligation, compliance reporting, statute check and
  the last-mile funnel all populate on a completed run.
- Q3 footnotes 3 → 4, with the Basic Law present and statute-primary confirmed.
- No gate weakened, no pool inflation, no forced citation count.

Open:
- **Canonical bodies still not acquired**: probes now fail with `fetch_failed` on
  `supremedecisions.court.gov.il` and `elyon1.court.gov.il` (connection errors from the
  function's egress IP), i.e. the remaining blocker is the court-egress path, not
  discovery. That is the next track.
- Statute dominance on a squarely statutory question (Q2) still awaits a completed run.
- Footnote density remains modest (4 on Q3); the funnel now names where the losses
  happen — emission 7 → CSM 6 → cited 4.
