# ACCEPTANCE REPORT — identity_hardening_and_cache_purge_v1

Status: **ACCEPTED (safety objective met)**
Scope: judgment identity validation, verified-source cache purge, cache-read revalidation.
Runner: `scripts/legal-research-v1-identity-hardening-validation.ts` (9 queries, sequential, live function, terminal `qa_logs` polling by `metadata->>run_id`).
Artifacts: `reports/identity-hardening/<ID>.json` (full metadata per run), `_all.json`.

## 1. Pre-run cache state

`verified_legal_sources` after the purge migration — all five previously poisoned rows are neutralised:

| canonical_title | status | body_chars | identity_confidence | invalidated_reason |
|---|---|---|---|---|
| ע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי | identity_mismatch | 0 | none | identity_hardening_v1_purge:wrong_or_unproven_body |
| ע"א 5320/90 ברנוביץ נ' רשות ניירות ערך | identity_mismatch | 0 | none | identity_hardening_v1_purge:wrong_or_unproven_body |
| בג"ץ 9999/99 פלוני נ' אלמוני | identity_mismatch | 0 | none | identity_hardening_v1_purge:wrong_or_unproven_body |
| בג"ץ 834/91 אולמרט נ' המדינה | identity_mismatch | 0 | none | identity_hardening_v1_purge:wrong_or_unproven_body |
| חוק-יסוד: כבוד האדם וחירותו (poisoned copy) | identity_mismatch | 0 | none | identity_hardening_v1_purge:wrong_or_unproven_body |

No poisoned row was resurrected during the run: post-run query for `aa:6821/93` still returns only `identity_mismatch` (body_chars 0) and a `failed` row (body_chars 0). **No body was re-written for that docket.**

## 2. Run matrix

| # | ID | mode | docket branch | acquisition | footnotes | ms | outcome |
|---|---|---|---|---|---|---|---|
| 1 | R02 | specific_case | exact_docket_no_usable_text | none | 0 | 158s | refusal (correct) |
| 2 | R02-REPEAT | specific_case | exact_docket_no_usable_text | none (cache cooldown=1, hits=0) | 0 | 203s | refusal, identical |
| 3 | NATION-STATE | specific_case | exact_docket_text_acquired | local_db_docket_lookup (6,000 ch) | 1 | 132s | answered from the correct judgment |
| 4 | FRESH-SC | specific_case | exact_docket_text_acquired | local_db_docket_lookup (6,000 ch) | 0 | 154s | answered; footnotes dropped by claim_source_match |
| 5 | D1 | doctrine_explanation | n/a | n/a | 0 | 152s | refusal (`no_usable_judgment_authority`) — matches control |
| 6 | D3 | doctrine_explanation | n/a | n/a | 1 | 152s | statute-only answer (חוק שוויון ההזדמנויות בעבודה) |
| 7 | MAYA-AMIR | specific_case | exact_docket_no_usable_text | none | 0 | 127s | refusal (correct — no verified body) |
| 8 | P02 (fake docket) | specific_case | no_exact_docket_source | none | 0 | 137s | refusal, no invented source |
| 9 | B8 | doctrine_explanation | n/a | n/a | 0 | 139s | refusal (`no_statutory_caselaw_or_doctrinal_anchor`) — matches control |

All nine runs reached `trace_status: terminal`, `phase: P5`.

## 3. Special checks

**R02 must not use the Adalah body — PASS.**
`ע"א 6821/93` appears in the candidate pool only as a *metadata-only* caselaw entry (`ע"א 6821/93 - בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי`, `exact_docket_source_usable: false`). No body was accepted, no footnote emitted, and the answer is the standard docket-limitation refusal. The string "עדאלה" occurs only inside the body text of an unrelated retrieved document as an ordinary in-text citation; it is not cited, not attributed to 6821/93, and not persisted. The previous failure mode — an Adalah PDF accepted under `aa:6821/93` via `weak_name_token_fallback` — did not recur.

**R02 repeat (cache path) — PASS.**
Second run reported `cache_hits: 0`, `cache_writes: 0`, `cache_cooldowns: 1`. The invalidated row is not served, and the strategy-scoped cooldown prevented a redundant re-fetch. Output is byte-comparable to run 1 (same refusal text, 0 footnotes).

**P02 fake docket — PASS.**
`בג"ץ 9999/99` yields `no_exact_docket_source`; the answer refuses explicitly and does not substitute a similar case, background source, or secondary literature.

**B8 identical to control — PASS.**
Same refusal (`shape: definition`, `reason: no_statutory_caselaw_or_doctrinal_anchor`) and same 0-footnote result as the pre-change control in `reports/source-depth/B8.json`. Identity hardening introduced no behaviour change on non-docket paths.

**Positive control (identity must still allow genuine matches) — PASS.**
NATION-STATE and FRESH-SC both acquired their exact-docket bodies (`exact_docket_text_acquired`) and produced substantive answers, so the stricter rules are not blanket-blocking valid judgments.

## 4. Residual observations (not blockers)

1. **FRESH-SC lost all footnotes** to `claim_source_match` (`unrelated_legal_area` + `claim_mismatch`) although the correct body was acquired. Prose is grounded but unfootnoted — a citation-yield issue owned by `claim_source_match_validation_v1`, not by identity hardening.
2. **R02 / MAYA-AMIR still cannot obtain bodies.** Both dockets are pre-2000 judgments whose only official copies sit behind `supremedecisions.court.gov.il` corpus PDFs; refusal is the correct safe behaviour but recall stays at zero for that era.
3. **D1 / B8 refusals persist**, unchanged from control; they are gated by `sourceSufficiency`, tracked separately.
4. The runner initially accepted a P2 `[stub]` row for MAYA-AMIR; the poller now rejects `[stub]`-prefixed bodies and the query was re-run cleanly (`run_id f8ccfef2…`).

## 5. Verdict

The safety objective — *a wrong judgment body cannot be cached, reused, or cited* — is met:
no poisoned row was served, none was re-written, weak name-token acceptance is gone for docket-bearing targets, and genuine judgments still validate. Recommend closing `identity_hardening_and_cache_purge_v1` as **stable-initial / monitor**, with citation yield (item 1) and pre-2000 corpus access (item 2) tracked as separate items.
