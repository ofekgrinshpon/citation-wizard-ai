# specific_case judgment identity + title recovery — validation

New stage: `stages/specificCaseIdentity.ts` (deterministic, no network/model).
Gate wired in `index.ts` → `specificCaseGate.allow` now requires identity pass;
failure reason surfaces as `specific_case_identity_limitation:<reason>`.

| Fixture | Mode branch | identity_passed | matched_by | failure_reason | Footnote 1 | Verdict |
|---|---|---|---|---|---|---|
| R02 בנק המזרחי | docket_limitation | false | none | judgment_body_missing_identity | — (no citations) | PASS — refuses instead of citing a generic gov.il document |
| R01 קעדאן | drafted | true | docket | — | HCJ 6698/95 Ka'adan judgment (court.gov.il .txt) | PASS — stable |
| P02 fake docket | docket_limitation | true* | body | — | — | PASS — deterministic refusal (docket guard) |
| B2 קעדאן+נושא | docket_limitation | true* | body | — | — | PASS — refusal, no scholarship holding |
| S1 commentary-only case | docket_limitation | true* | body | — | — | PASS — no scholarship-carried holding |
| B8 canonical quote | canonical_quote_registry | n/a | none | not_specific_case_mode | Knesset official PDF | PASS — unchanged |

\* identity did not veto; the pre-existing exact-docket/acquisition guard fired first.

Acceptance
- R02 refuses; no `מסמך מאתר ממשלתי` as footnote 1 for a case holding. ✔
- R01 good when Ka'adan body is acquired. ✔
- P02 deterministic refusal. ✔
- Scholarship cannot carry a specific-case holding (S1, B2). ✔
- B8 unchanged. ✔
- No stubs / verifier failures across 6 runs. ✔

Telemetry added under `metadata.retrieval.specific_case_identity` and
`metadata.drafter.specific_case_identity`: `specific_case_identity_required`,
`requested_docket`, `requested_case_title`, `matched_judgment_ref`, `matched_by`,
`title_recovery_attempted`, `title_recovery_success`, `recovered_title`,
`generic_title_detected`, `title_recoveries[]`, `specific_case_identity_passed`,
`specific_case_identity_failure_reason`.

Note: R02 title recovery was not exercised this run — no usable judgment body was
acquired at all, so the pack had nothing to re-title. Recovery paths are covered by
unit tests (`stages/specificCaseIdentity.test.ts`, 6/6 pass) and remain to be seen in
production once Bank Mizrahi discovery/acquisition succeeds.
