# canonical_judgment_text_acquisition_v1 — implementation status

Implemented (Option B only): `stages/canonicalAuthorityAcquisition.ts`, wired in `index.ts`
after statute acquisition, capped at 2 seeded dockets/run and 3 derived URLs/docket,
text endpoints first, PDF preflight + extraction ledger, docket validated inside the body,
candidate injected only on success. Telemetry: `retrieval.canonical_authority_acquisition`.

## First validation pass (D1–D6, controls still running)

| ID | terminal | runtime | footnotes | acquisition attempts | bodies acquired |
|---|---|---|---|---|---|
| D1 | done | 102s | 0 | 2 (מזרחי, לשכת מנהלי ההשקעות) | 0 |
| D2 | done | 141s | 3 | 2 (דפי זהב, גנור) | 0 |
| D3 | done | 101s | 2 | 1 (בבלי) | 0 |
| D4 | done | 101s | 1 | 0 | 0 |
| D5 | done | 121s | 1 | 0 | 0 |

Stability holds: every run terminal, no CPU kills, no dangling markers, no orphan rows,
runtime delta ≈ +1s (each attempt costs 0.7–1.1s).

**Blocker:** every probe fails with `plain_text_below_threshold` — the derived
`supremedecisions`/`elyon1` URLs return a short body (error/redirect page), not the judgment.
So recall is unchanged: 0 of the failing authorities body-acquired. The lane, caps, guardrails
and telemetry are correct; the URL derivation for these older dockets is what needs work
(suffix/corpus variants, and the `type=4`/PDF fallback currently blocked by the text-first cap).

Not accepted. Next step is a derivation-only fix, no gate changes.
