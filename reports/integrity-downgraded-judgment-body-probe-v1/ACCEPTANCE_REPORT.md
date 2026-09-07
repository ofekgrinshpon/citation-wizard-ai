# integrity_downgraded_judgment_body_probe_v1 — Acceptance Report

Run: `ccfe1fe5-4266-43f5-896a-be758b1e721c` (exact original natural testcase, no
named authority added).

## What was implemented

`stages/webJudgmentBodyAcquisition.ts` only. New `identityBackedProbeSignals()`:
a fetch-only probe for candidates that source integrity has downgraded
(`secondary_commentary` / `metadata_only`), requiring **all** of:

- concrete `http(s)` URL, non-court host (court hosts stay in canonical/relay),
- docket derivable from the document's own **title or URL** (snippet mentions
  are not evidence),
- not listing/search-like, not `reject`ed as a bad source, not
  paywalled/access-controlled, no substantive body already,
- document-judgment evidence from existing upstream deterministic signals
  (`documentEvidenceClassification`, `is_judgment_document`, `exact_authority`),
- at least one corroborating identity signal beyond the bare docket.

No host whitelist; no special-casing of Daat, Bavli, rabbinical courts or any
docket. Passing the gate means only "attempt a bounded fetch": source type,
integrity, citability, verifier, CSM and alignment are untouched, and
`validateJudgmentIdentityStrict` (docket match + judgment identity + substantive
body) must still pass before `applyAcquiredJudgmentBody` marks anything as
`judgment/primary_mirror`. Failure preserves the original downgrade, fail-closed.

Telemetry: `retrieval.web_judgment_body_acquisition.identity_backed_probe`
(`eligible/attempted/acquired/identity_validated` + per-candidate
`original_integrity_class`, `eligibility_signals`, `fetch chars`,
`identity_confirmed`, `docket_match`, `final_classification`).

Tests: 12 in `src/test/webJudgmentBodyAcquisition.test.ts` (downgraded page with
real docket identity → probe allowed; generic article name-dropping a judgment →
refused; listing → refused; bad source → refused; court host → canonical lane;
already-valid judgment and paywalled/no-docket cases unchanged). Full suite
41 files / 470 tests, typecheck clean, deployment succeeded.

## Probe behaviour in the live run

| candidate | original integrity | probe eligible | attempted | chars | identity validated | final |
|---|---|---|---|---|---|---|
| בג״צ 150/59 ועד עדת הספרדים (openscholar.huji.ac.il PDF) | secondary_commentary / metadata_only / commentary | yes | yes | 6,000 | yes (docket_match, party tokens in body, docket in title+URL) | `judgment/primary_mirror` |
| בג"ץ 3914-92 לב (cwj.org.il .doc) | secondary_commentary | yes | yes | 0 | no | downgrade preserved, fail-closed |

Stage totals: considered 4, attempted 3, acquired 1, 3.6 s. The mechanism the
track asked for is proven end-to-end: an integrity-downgraded page was tested
for its real body and upgraded **only after** strict post-fetch identity
validation, while the failing one stayed non-judgment.

## Bavli funnel (this run)

found (multiple representations) → **the representation that survived dedupe and
the pool was the official court PDF**
`supremedecisions.court.gov.il/.../92-1000-92-15.pdf`, not the daat page →
integrity class `official_primary / metadata_only / judgment` →
identity_backed_probe **not applicable** (`court_host_out_of_scope`; court hosts
are excluded from this web lane by design) → canonical/relay + official fetch
attempted → **all court-egress attempts failed** (`client error (SendRequest)`,
connection reset) → no body → admitted and in pack, verifier-usable →
**lost at CSM / representative selection**, `loss_reason:
no_acquired_body_or_weak_fit`, `survived_csm: false` → not cited.

The daat/judgments.org.il representations were not retrieved in this run's
discovery, so the new probe never had a non-court Bavli page to work on.

## Final footnotes

1. Compound: בג"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול **+** בג"ץ 11437-05 קו לעובד נ' משרד הפנים
2. בג"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול

Support check: סימה אמיר is directly on point (HCJ review of a rabbinical court
applying civil property law) and supports every proposition it is attached to.
קו לעובד (immigration) is **not** on point and is a weak compound partner in
footnote 1. No criminal or prosecution authorities appeared anywhere in the
answer — the earlier ע"פ 4988-08 / דנ"פ 5387/20 contamination is gone.

Also in pack but not cited: בג״צ 150/59 (body acquired via the new probe,
survived CSM, `in_pack_but_not_chosen_by_model`), בג"ץ 3914-92 לב, בג"ץ 7339/15,
בג"ץ 5658/23, and one scholarship item dropped by topic-aware alignment.

## Verdict

**Pass.** The integrity downgrade no longer blocks body probing, and a
commentary-looking page cannot become a judgment without strict post-fetch
identity validation.

## Exact next loss stage (not fixed here)

For Bavli: `csm / representative_selection`, reason
`no_acquired_body_or_weak_fit`, caused upstream by **court-egress failure on the
official court PDF** — the only Bavli representation that reached the pool this
run. Secondary loss worth noting: בג״צ 150/59 acquired a validated body and
reached the pack but was `in_pack_but_not_chosen_by_model`.
