# ReLex V2 — Exact Authority Recovery (implementation + targeted validation)

Scope: one bounded, deterministic recovery discovery round for an already-open,
still-unresolved authority target whose known concrete candidates are exhausted.
No change to identity thresholds, verifier, support verification, temporal logic,
source quality, drafter, renderer, citation logic, budgets, model, span-hunting,
academic retrieval, attempt ceilings or the discovery-refresh ceiling.

## 1. Root cause

When `acquire_authority` exhausted the candidates it already knew, it returned
`needs_discovery` and handed the one permitted discovery refresh back to the
model, with a prompt instruction to search again with `for_authority` and retry.
That recovery depended on the model remembering a three-step sequence many turns
after the original lookup. In the acceptance benchmark it frequently did not
happen: targets closed as unresolved while publicly readable copies of the exact
judgment or the concrete official statute page existed.

A second, narrower cause on the statute side: `lookupAuthority.officialSearchUrls`
builds a Knesset URL that puts the statute *name* in `lawitemid`, which expects a
concrete identifier. That URL is discovery-shaped, not a document — it can never
yield the law text. It was left in place as discovery only; no Knesset IDs are
fabricated and no statute map was added.

## 2. Implementation

New module `tools/exactAuthorityRecovery.ts`:

- `buildRecoveryQuery(authority_key, identity, label)` — deterministic, at most
  one query per authority.
  - Case: full preserved proceeding identity + docket → `…_with_hint` when a
    title/party hint is known → bare normalized docket as fallback. Scope `web`.
  - Statute: exact statute name (+ `סעיף N` when a section is requested).
    Scope `official`.
  - Returns `null` when the identity is not concrete enough to search.
- `runExactAuthorityRecovery` — runs the single discovery call, attaches only
  concrete candidates to the existing target through the injected
  `attachDiscoveryResults` / `isConcreteCandidate`, and returns bounded telemetry.
- `recoveryOriginLabel` — `local_corpus` | `official_source` |
  `mirror_reproduction` | `other`. Telemetry only; nothing ranks or verifies on it.

`tools/acquisitionOrchestrator.ts`: the attempt loop was extracted into a local
`runRound()`. After the first round, recovery runs **only** when: the target is
open, unresolved, not abandoned, has zero concrete untried candidates, still has
its single discovery refresh, attempts remain, and a query can be built. It
consumes the existing `MAX_DISCOVERY_REFRESHES_PER_AUTHORITY = 1`; the concrete
attempt ceiling (4/authority/run) is untouched. Recovered candidates are then
tried through the same `runFetch` and the same document/identity/corroboration
gates — nothing binds from title, snippet, domain or search rank.

`agent/researchAgent.ts`: supplies `recoverySearch` (official scope →
`runSearch(scope:"official")`, web scope → `runRawWebSearch`), both charged to the
existing StopPolicy budgets, both registering provenance exactly like ordinary
discovery. Absent this dep the previous behaviour is unchanged.

`index.ts` / `types.ts`: four new optional telemetry fields
(`authority_recovery_triggered`, `authority_recovery_candidates_attached`,
`authority_recovery_success`, `authority_recovery` records, capped at 12).

### Files changed

| File | Change |
| --- | --- |
| `tools/exactAuthorityRecovery.ts` | new — query construction, recovery round, telemetry, origin labelling |
| `tools/acquisitionOrchestrator.ts` | two-phase round + bounded recovery pass; `recovery` on the output; 4 new stats fields |
| `agent/researchAgent.ts` | `recoverySearch` backend wired into both acquisition call sites |
| `index.ts`, `types.ts` | recovery telemetry persisted per run |
| `src/test/exactAuthorityRecovery.test.ts` | new — 15 deterministic tests |
| `scripts/v2-recovery-validation.ts` | validation launcher (read-only) |

## 3. Tests

15 new deterministic tests: query construction (full identity, hint, bare docket,
statute, statute+section, null when not concrete); origin labelling; recovery
success from a mirror; article mentioning the docket rejected; wrong proceeding
type with the same number rejected; recovered search page never consumes an
attempt; statute binds only after body corroboration; section target stays
unresolved when the section is absent; no recovery while a local corpus candidate
is untried; recovery at most once per authority and never repeated after failure;
attempt ceiling unchanged; no recovery for abandoned or already-acquired targets.

**Full suite: 78 files, 882 tests, all passing.** `tsgo --noEmit -p tsconfig.app.json` clean.

## 4. Targeted validation (deployed build, strictly sequential, one run each)

| Q | claims | footnotes | central | unresolved | recovery | tokens | latency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q23 | 0 | 0 | true | 3 | triggered ×2, 6 candidates, 0 bound | 146k | 273s |
| Q25 | 3 | 2 | true | 0 | **1 success** (mirror) | 137k | 242s |
| Q28 | 4 | 2 | false | 1 | not needed | 153k | 483s |
| Q30 | 4 | 2 | true | 2 sections | **1 success** (mirror) | 162k | 358s (1 resume) |

Per fixture:

- **Q25 — recovered.** The planned judgment (`case:845/02`) failed on the local
  corpus row (`judgment_body_form_absent`). Recovery query `845/02 פסק דין`
  returned 8 results, 7 concrete candidates attached, the first fetch bound on
  `body_identity_corroborated:docket_present_in_body` from a public reproduction.
  Answer substantive, 0 unresolved authorities.
- **Q28 — resolved without recovery.** `case:5168/93` (a residual unresolved from
  the identity fix) bound on its first attempt from a public reproduction; the
  identity fix plus normal acquisition sufficed. Remaining unresolved
  `case:15868/04` is a network-edge `http_403`. One core claim (C3) failed support
  verification and was disclosed as a limitation rather than asserted.
- **Q30 — statute recovered from a concrete body.** `חוק זכויות הסטודנט` bound
  from the concrete official Knesset PDF (`fs.knesset.gov.il/17/law/17_lsr_300141.pdf`),
  not from the `lawitemid`-with-a-name discovery URL. `case:8077/08` was recovered
  via the new path from a public reproduction. Sections #4/#15 stayed unresolved
  (the alternate body yielded no usable text) — disclosed, not asserted.
- **Q23 — failed cleanly, no misbinding.** Recovery triggered twice
  (`case:1511/05`: 8 results, 6 concrete attached, 2 attempts, closed on
  `attempt_ceiling`; the 2023 amendment section: 0 results). No body bound. This
  run planned different authorities than the acceptance run and ended
  limitation-only with zero verified claims — the statute body and §20/§25 *were*
  acquired, so the loss is downstream of acquisition (support verification), not a
  recovery defect. `case:2098/97` did not appear in this run's plan.

## 5. Safety

- Recovered bindings: 2 (Q25 `case:845/02`, Q30 `case:8077/08`), both on
  `docket_present_in_body` after the unchanged judgment self-identity gate.
- **False bindings: 0.** Invariant errors: 0 across all four runs. Unsupported
  core claims reaching the reader: 0 (Q28's C3 was withheld and disclosed).
- Articles, search pages and portal stubs were still refused: recovered
  discovery-shaped URLs never consumed an attempt, and non-self-identifying bodies
  were recorded `not_the_document` / `readable_unconfirmed_identity`.
- No host is trusted: a mirror binds only because its body self-identifies; the
  same host's article pages failed in the same runs.

## 6. Observations (not changed, out of scope)

- Q30 spent four attempts on the same Wikisource URL for two section targets, each
  returning `no_usable_body` — bounded by the ceiling, but wasteful; pre-existing
  attempt-key behaviour, untouched here.
- Q23's zero-claim outcome with an acquired statute body points at support
  verification, not acquisition.

## 7. Verdict

EXACT AUTHORITY RECOVERY — PARTIAL

NO OTHER SYSTEM BEHAVIOUR CHANGED.
