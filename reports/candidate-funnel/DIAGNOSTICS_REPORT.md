# DIAGNOSTICS REPORT — candidate_funnel_diagnostics_v1

**Type: diagnostics / telemetry only. No behavioural change was made to retrieval, ranking, sufficiency, claim-source-match, drafter, identity validation, cache rules or footnote rendering.**

- Builder: `scripts/legal-research-v1-candidate-funnel-diagnostics.py` (read-only; reads `qa_logs` telemetry by `metadata->>'run_id'`)
- Machine-readable full funnel: `reports/candidate-funnel/funnel.json` (every candidate of every run, all six funnel sections)
- Runs analysed: the 10 accepted `source_use_intent_planning_v1` validation runs (run_ids in `reports/source-use-intent/results.json`)

Every candidate record carries: discovery (id, title, url, host, source_type, discovered_by, originating query, rank, score), acquisition (local lookup, cache hit, web fetch, final_url, content_type, body_acquired, body_chars, acquisition_path, failure reason, ms), typing/integrity (original type, mapped type, tier, citable_as, usability, integrity flags/downgrades, doctrinal eligibility + reason), relevance (verifier verdict, reason, subtype, role match, diagnostics-only centrality label), final use (sufficiency membership + role, claim-match status + drop reason, used_in_answer, footnote number, found_only, dropped_unrelated) and budget (skipped_by_budget, cap). Where the pipeline emitted no reason, the record carries an explicit marker (`reason_missing`, `not_verified`, `no_body_acquisition_attempted`, `not_carried_into_drafter_pack`).

Centrality labels are derived from verifier verdict + support subtype **for reporting only**; nothing in the pipeline reads them.

## Cross-run funnel at a glance

| run | discovered | local / pplx / other | bodies acquired | direct | partial | eligible secondaries | drafter pack | claim-match passed | cited | primary bottleneck |
|---|---|---|---|---|---|---|---|---|---|---|
| ACADEMIC | 30 | 28 / 2 / 0 | 2 | 0 | 5 | 2 | 4 | 0 | 0 | claim-match |
| NATION-STATE-ACADEMIC | 30 | 28 / 2 / 0 | 8 | 3 | 2 | 3 | 5 | 1 | 1 | claim-match |
| PAYWALL | 31 | 27 / 3 / 1 nom | 3 | 0 | 1 | 1 | 1 | 1 | 1 | retrieval |
| MMM | 25 | 12 / 13 / 0 | 3 | 0 | 7 | 0 | 6 | 0 | 0 | acquisition + typing/eligibility |
| B8 | 30 | 26 / 4 / 0 | 8 | 4 | 4 | 4 | 6 | 1 | 1 | claim-match |
| D1 | 30 | 26 / 4 / 0 | 9 | 2 | 2 | 2 | 4 | 2 | 2 | claim-match (partially overcome) |
| D3 | 30 | 26 / 4 / 0 | 2 | 2 | 1 | 1 | 2 | 0 | 0 | retrieval depth → sufficiency |
| DARKPATTERNS | 32 | 24 / 6 / 2 nom | 5 | 0 | 8 | 0 | 8 | 0 | 0 | typing/eligibility + claim-match |
| R02 | 30 | 29 / 1 / 0 | 6 | 1 | 0 | 0 | 1 | 0 | 0 | acquisition of the named judgment (safe refusal) |
| P02 (fabricated docket) | 30 | 29 / 1 / 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | none — correct refusal |

### Three structural losses, visible in every run

1. **Discovery precision.** Source-integrity classifies **17–24 of ~30** candidates per run as `index_or_listing` / `not_citable`. Local retrieval is the volume supplier (24–29 per run) but returns large amounts of low-instance family/magistrate case law and listing pages for doctrinal and academic questions (see ACADEMIC verifier free-text reasons in `funnel.json`). Effective discovery yield is roughly 5–8 plausible candidates per run, not 30.
2. **Body acquisition is only attempted for a narrow slice.** The dominant acquisition "failure" reason is `no_body_acquisition_attempted` (19–28 per run): the secondary-body stage only considers candidates already typed as doctrinal/secondary. Real fetch failures are rare and specific — `http_403` (MMM ×2, D1 ×1), `secondary_binary_too_large_for_inline_extraction` (B8 ×1), `not_substantive:below_min_body_chars` (MMM, D1). In `specific_case_or_statute` depth mode the stage does not run at all (`depth_mode_not_eligible`, R02/P02 — intended).
3. **Claim-source-match is the dominant *late* loss.** Sources that were discovered, acquired in full (up to 16,000 chars), passed integrity, passed the verifier as **direct**, and passed sufficiency are then dropped at the answer-block level with `claim_mismatch` (4–12 drops per run; ACADEMIC 4/4 pack refs, B8 9, DARKPATTERNS 12, NATION-STATE 7). The mismatch is between the *retrieval-time* `claim_id` bound to the source and the `claim_id` the drafter tagged on the block — not between the source's content and the proposition. This is why runs with 8–9 acquired bodies still emit 0–1 footnotes.

Secondary observations: 2–9 candidates per run are never verified at all (`not_verified`, verifier batch coverage), and `not_doctrinal_type` is the only doctrinal-eligibility rejection reason recorded (2–8 per run) — institutional/government material (MMM, DARKPATTERNS) is systematically not reaching doctrinal eligibility.

## Special analysis questions, per run

Legend: A plausible candidates arrived · B central candidates failed acquisition · C acquired central candidates failed verifier/integrity · D good candidates passed verifier but failed sufficiency · E passed sufficiency but failed claim-match · F drafter ignored good cited-eligible candidates · G main bottleneck.

| run | A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|---|
| ACADEMIC | yes (5 partial, 2 full bodies) | no | no | no (both eligible secondaries passed) | **yes — 4/4 pack refs dropped `claim_mismatch`** | no (nothing survived to cite) | claim-match |
| NATION-STATE-ACADEMIC | yes (3 direct) | no | no | no | **yes — 2 direct 16k/6.5k bodies dropped `claim_mismatch`** | no | claim-match |
| PAYWALL | **no — 30/31 verdicts `unrelated`** | n/a | n/a | no | no | no | retrieval |
| MMM | yes (7 partial, institutional) | **partly — 2 `http_403`, 1 below-min-chars** | no | **yes — 0 eligible (`not_doctrinal_type` ×6), 6 shown found_only** | yes (9 `claim_mismatch`) | no | acquisition + typing/eligibility |
| B8 | yes (4 direct, 8 bodies) | no (1 oversized PDF) | no | no (5 passed sufficiency) | **yes — 9 `claim_mismatch`, incl. two 16k direct bodies** | no | claim-match |
| D1 | yes | no | no | no | partly (6 `claim_mismatch`, 2 refs survived) | no | claim-match, mitigated by `limited_doctrinal_fallback_B` |
| D3 | thin (2 direct, pack 2, only 2 bodies) | no | no | **yes — `no_statutory_caselaw_or_doctrinal_anchor` → `insufficient_sources_limitation`** | not reached | no | retrieval depth → sufficiency |
| DARKPATTERNS | yes (8 partial, pack 8) | partly (no doctrinal body acquired) | no | **yes — 0 eligible (`not_doctrinal_type` ×8)** | **yes — 12 `claim_mismatch`** | no | typing/eligibility + claim-match |
| R02 | yes for context, **no usable body of the named judgment** | **yes — by design: secondary stage disabled in `specific_case_or_statute` mode; no official judgment text** | n/a | n/a | n/a | no | acquisition of the named judgment; refusal is correct |
| P02 (fabricated docket) | no (all 30 `unrelated`) | n/a | n/a | n/a | n/a | no | none — refusal is the correct outcome |

**Answer to G, aggregated:** the bottleneck is *not* drafting and *not* identity/safety. It is (1) claim-source-match rebinding for 5 of 10 runs, (2) discovery precision / doctrinal typing coverage for 3, and (3) correct, intended refusal for 2.

## Recommended next implementation track (evidence-based)

**Primary: `claim_source_rebinding_v1`.** Bind a source to an answer block by *topical/substantive* match (verifier `supported_points`, acquired body topical match, legal-area agreement) rather than by the retrieval-time `claim_id` it happened to be fetched under, and record `rebound_from_claim` telemetry. Evidence: `claim_mismatch` accounts for 4–12 late drops per run and for 100% of the pack losses in ACADEMIC, and for the loss of full-text 16,000-char **direct** sources in B8 and NATION-STATE-ACADEMIC. No safety gate is involved in these drops — the blocked sources are exactly the ones sufficiency already accepted. Expected effect: footnote yield rises from 0–2 to the 3–6 range without touching identity, docket or primary-law rules.

**Second: `discovery_precision_and_listing_suppression_v1`.** 17–24 of ~30 candidates per run are `index_or_listing`/`not_citable`, and local retrieval floods doctrinal questions with unrelated magistrate/family case law. Suppressing listing pages and off-area low-instance case law before the verifier would free verifier and acquisition budget for the 5–8 plausible candidates (also addresses the 2–9 `not_verified` candidates per run).

**Third: `institutional_source_eligibility_v1`.** `not_doctrinal_type` is the *only* recorded eligibility rejection (MMM ×6, DARKPATTERNS ×8): ministry/Knesset-research/regulator material never becomes an eligible institutional report, which is exactly what those two questions needed.

Not recommended now: drafter changes (no run showed the drafter ignoring citable sources) and any relaxation of judgment identity, docket or cache rules (R02/P02 behaved correctly).

## Per-run funnels

### ACADEMIC

`run_id` 5944aa95-2e2e-4563-9906-c2a70c191f7a

- discovered: **30** — {'perplexity': 2, 'local_retrieval': 28}
- bodies acquired: **2**; failure reasons: {'no_body_acquisition_attempted': 28}
- verifier: {'partial': 5, 'not_verified': 7, 'unrelated': 16, 'tangential': 2}
- eligible secondaries/institutional reports: **2**; drafter pack: **4**; passed sufficiency: **2**; passed claim-source-match: **0**
- cited footnotes: **0**; found_only shown: 0; unrelated dropped: 2
- sufficiency: `research_guidance_task_supported:literature_map(was:generic_procedure_only)` (sufficient=True); deterministic branch: `None`
- retrieval 18382 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': True, 'reason': 'stage_ran', 'local_hits': 2, 'local_lookups': 2, 'web_attempts': 0, 'ms': 228}

Top lost promising candidates (verifier direct/partial, never cited):

| # | title | verdict | body chars | loss reason |
|---|---|---|---|---|
| 1 | המהפכה החוקתית או מהפכת זכויות האדם? על העיגון החוקתי של הנורמות המוסדיות | partial | 16000 | `claim_source_match:claim_mismatch` |
| 2 | הזכות המנהלית והסעד הכספי במשפט המקובל המנהלי | partial | 16000 | `claim_source_match:claim_mismatch` |
| 3 | בית משפט השלום ירושלים, השופט דוד שאול גבאי ריכטר: הכרעת דין לטייס לשעבר שהורשע  | partial | 400 | `not_carried_into_drafter_pack` |
| 4 | חוק־יסוד: כבוד האדם וחירותו — נוסח החוק (כנסת) | partial | 214 | `claim_source_match:claim_mismatch` |
| 5 | חוק־יסוד: כבוד האדם וחירותו (כנסת) | partial | 93 | `claim_source_match:claim_mismatch` |

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| s1 | חוק־יסוד: כבוד האדם וחירותו — נוסח החוק (כנסת) | perplexity | 214 | official_primary / metadata_only | partial (useful) | ignored | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s2 | חוק־יסוד: כבוד האדם וחירותו (כנסת) | perplexity | 93 | official_primary / metadata_only | partial (useful) | ignored | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s3 | המהפכה החוקתית או מהפכת זכויות האדם? על העיגון החוקתי של ה | local_retrieval | 16000 | secondary_commentary / full_text | partial (useful) | background | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s4 | הזכות המנהלית והסעד הכספי במשפט המקובל המנהלי | local_retrieval | 16000 | secondary_commentary / full_text | partial (useful) | doctrinal_secondary | dropped: claim_mismatch | — claim_source_match:claim_mismatch |

Not carried into the drafter pack: **26** — {'not_carried_into_drafter_pack': 8, 'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 18}

### NATION-STATE-ACADEMIC

`run_id` 0f84f1ee-70bb-4e31-a157-3c491013d7f1

- discovered: **30** — {'perplexity': 2, 'local_retrieval': 28}
- bodies acquired: **8**; failure reasons: {'no_body_acquisition_attempted': 22}
- verifier: {'direct': 3, 'unrelated': 18, 'not_verified': 7, 'partial': 2}
- eligible secondaries/institutional reports: **3**; drafter pack: **5**; passed sufficiency: **3**; passed claim-source-match: **1**
- cited footnotes: **1**; found_only shown: 2; unrelated dropped: 0
- sufficiency: `doctrinal_anchor_present` (sufficient=True); deterministic branch: `None`
- retrieval 16974 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': True, 'reason': 'stage_ran', 'local_hits': 7, 'local_lookups': 7, 'web_attempts': 0, 'ms': 1657}

Top lost promising candidates (verifier direct/partial, never cited):

| # | title | verdict | body chars | loss reason |
|---|---|---|---|---|
| 1 | רבע מאה למהפכה החוקתית: תמונת מצב של ה"חוקה בהרצה" | direct | 16000 | `claim_source_match:claim_mismatch` |
| 2 | חוק יסוד: ישראל-מדינת הלאום של העם היהודי בראי המשפט הבין-לאומי | direct | 6556 | `claim_source_match:claim_mismatch` |
| 3 | חוק יסוד: ישראל מדינת הלאום של העם היהודי (הכנסת) | direct | 301 | `claim_source_match:claim_mismatch` |
| 4 | חוק-יסוד: ישראל – מדינת הלאום של העם היהודי | partial | 0 | `sufficiency_bucket:found_only` |

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| s1 | חוק יסוד: ישראל מדינת הלאום של העם היהודי (הכנסת) | perplexity | 301 | official_primary / substantive_excerpt | direct (central) | found_only | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s2 | חוק-יסוד: ישראל – מדינת הלאום של העם היהודי | local_retrieval | 0 | statute_mirror / unknown | partial (useful) | found_only | not_run | — sufficiency_bucket:found_only |
| s3 | חוק יסוד: ישראל-מדינת הלאום של העם היהודי בראי המשפט הבין- | perplexity | 6556 | secondary_commentary / full_text | direct (central) | doctrinal_secondary | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s4 | רבע מאה למהפכה החוקתית: תמונת מצב של ה"חוקה בהרצה" | local_retrieval | 16000 | secondary_commentary / full_text | direct (central) | doctrinal_secondary | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s5 | אזרחות, זכויות וחובות: על הדיונים בנושא השירות האזרחי בישר | local_retrieval | 16000 | secondary_commentary / full_text | partial (useful) | doctrinal_secondary | passed | footnote 1 |

Not carried into the drafter pack: **25** — {'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 18, 'not_carried_into_drafter_pack': 7}

### PAYWALL

`run_id` 973ac6aa-0133-4684-9f1e-173c249f36b7

- discovered: **31** — {'nomination': 1, 'perplexity': 3, 'local_retrieval': 27}
- bodies acquired: **3**; failure reasons: {'no_body_acquisition_attempted': 28}
- verifier: {'unrelated': 30, 'partial': 1}
- eligible secondaries/institutional reports: **1**; drafter pack: **1**; passed sufficiency: **1**; passed claim-source-match: **1**
- cited footnotes: **1**; found_only shown: 0; unrelated dropped: 0
- sufficiency: `research_guidance_task_supported:literature_map(was:no_statutory_caselaw_or_doctrinal_anchor)` (sufficient=True); deterministic branch: `None`
- retrieval 13887 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': True, 'reason': 'stage_ran', 'local_hits': 1, 'local_lookups': 1, 'web_attempts': 0, 'ms': 199}

Top lost promising candidates (verifier direct/partial, never cited):

_none — no direct/partial candidate was left uncited._

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| s1 | המהפכה החוקתית או מהפכת זכויות האדם? על העיגון החוקתי של ה | local_retrieval | 16000 | secondary_commentary / full_text | partial (useful) | doctrinal_secondary | passed | footnote 1 |

Not carried into the drafter pack: **30** — {'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 30}

### MMM

`run_id` 51a2d753-8ab5-4cfb-8a02-4ec47e79bd5e

- discovered: **25** — {'perplexity': 13, 'local_retrieval': 12}
- bodies acquired: **3**; failure reasons: {'no_body_acquisition_attempted': 19, 'http_403': 2, 'not_substantive:below_min_body_chars': 1}
- verifier: {'partial': 7, 'unrelated': 13, 'tangential': 5}
- eligible secondaries/institutional reports: **0**; drafter pack: **6**; passed sufficiency: **0**; passed claim-source-match: **0**
- cited footnotes: **0**; found_only shown: 6; unrelated dropped: 0
- sufficiency: `thin_governing_statute_pack_present` (sufficient=True); deterministic branch: `None`
- retrieval 11439 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': True, 'reason': 'stage_ran', 'local_hits': 3, 'local_lookups': 6, 'web_attempts': 3, 'ms': 763}

Top lost promising candidates (verifier direct/partial, never cited):

| # | title | verdict | body chars | loss reason |
|---|---|---|---|---|
| 1 | דוחות פעילות שנתיים - מינהל הסדרה ואכיפה / משרד העבודה | partial | 162 | `not_carried_into_drafter_pack` |
| 2 | מינהל הסדרה ואכיפת חוקי עבודה / משרד העבודה | partial | 158 | `sufficiency_bucket:found_only` |
| 3 | יישום החוק להגברת האכיפה של דיני עבודה התשע"ב-2011 | partial | 87 | `claim_source_match:claim_mismatch` |
| 4 | מידעון מרכז המחקר והמידע של הכנסת – נובמבר 2023 | partial | 83 | `claim_source_match:claim_mismatch` |
| 5 | אכיפת חוקי העבודה בישראל | partial | 80 | `claim_source_match:claim_mismatch` |

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| s1 | אכיפת חוקי העבודה בישראל | perplexity | 80 | official_primary / metadata_only | partial (useful) | found_only | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s2 | יישום החוק להגברת האכיפה של דיני עבודה התשע"ב-2011 | perplexity | 87 | official_primary / metadata_only | partial (useful) | found_only | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s3 | אמצעים להגברת האכיפה של חוקי עבודה | perplexity | 71 | official_primary / metadata_only | partial (useful) | found_only | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s4 | מידעון מרכז המחקר והמידע של הכנסת – נובמבר 2023 | perplexity | 83 | official_primary / metadata_only | partial (useful) | found_only | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s5 | מינהל הסדרה ואכיפת חוקי עבודה / משרד העבודה | perplexity | 158 | primary_mirror / metadata_only | partial (useful) | found_only | not_run | — sufficiency_bucket:found_only |
| s6 | מרכז המחקר והמידע של הכנסת | perplexity | 57 | primary_mirror / metadata_only | partial (useful) | found_only | not_run | — sufficiency_bucket:found_only |

Not carried into the drafter pack: **19** — {'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 18, 'not_carried_into_drafter_pack': 1}

### B8

`run_id` 6259e5ba-a742-4dc1-a1cf-7218cbd2d16d

- discovered: **30** — {'perplexity': 4, 'local_retrieval': 26}
- bodies acquired: **8**; failure reasons: {'no_body_acquisition_attempted': 21, 'secondary_binary_too_large_for_inline_extraction': 1}
- verifier: {'not_verified': 2, 'unrelated': 19, 'partial': 4, 'direct': 4, 'tangential': 1}
- eligible secondaries/institutional reports: **4**; drafter pack: **6**; passed sufficiency: **5**; passed claim-source-match: **1**
- cited footnotes: **1**; found_only shown: 0; unrelated dropped: 1
- sufficiency: `doctrinal_anchor_present` (sufficient=True); deterministic branch: `None`
- retrieval 14158 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': True, 'reason': 'stage_ran', 'local_hits': 6, 'local_lookups': 8, 'web_attempts': 2, 'ms': 3776}

Top lost promising candidates (verifier direct/partial, never cited):

| # | title | verdict | body chars | loss reason |
|---|---|---|---|---|
| 1 | היקף הביקורת השיפוטית על שינוי מדיניות עקבית של רשויות המנהל | direct | 16000 | `claim_source_match:claim_mismatch` |
| 2 | הבטחה מינהלית | direct | 16000 | `claim_source_match:claim_mismatch` |
| 3 | הבטחה מנהלית: לידתה, תולדותיה, אחריתה | direct | 128 | `claim_source_match:claim_mismatch` |
| 4 | על כללים והצדקות: הבעיה הקשה | partial | 16000 | `claim_source_match:claim_mismatch` |
| 5 | בית המשפט המחוזי בחיפה בשבתו כבית-משפט לערעורים אזרחיים, השופט חננאל שרעבי:  דחי | partial | 400 | `not_carried_into_drafter_pack` |

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| s1 | הבטחה מנהלית: לידתה, תולדותיה, אחריתה | perplexity | 128 | secondary_commentary / metadata_only | direct (central) | ignored | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s2 | היקף הביקורת השיפוטית על שינוי מדיניות עקבית של רשויות המנ | perplexity | 16000 | secondary_commentary / full_text | direct (central) | doctrinal_secondary | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s3 | הבטחה מינהלית | perplexity | 16000 | secondary_commentary / full_text | direct (central) | doctrinal_secondary | passed | footnote 1 |
| s4 | על כללים והצדקות: הבעיה הקשה | local_retrieval | 16000 | secondary_commentary / full_text | partial (useful) | doctrinal_secondary | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s5 | בג"ץ 5658/23 התנועה למען איכות השלטון בישראל נ׳ הכנסת ו7-  | local_retrieval | 400 | primary_mirror / full_text | partial (useful) | primary | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s6 | הבטחה מינהלית | local_retrieval | 16000 | secondary_commentary / full_text | direct (central) | doctrinal_secondary | dropped: claim_mismatch | — claim_source_match:claim_mismatch |

Not carried into the drafter pack: **24** — {'not_carried_into_drafter_pack': 4, 'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 20}

### D1

`run_id` a60272be-af87-4502-b485-856ccc0e2120

- discovered: **30** — {'perplexity': 4, 'local_retrieval': 26}
- bodies acquired: **9**; failure reasons: {'no_body_acquisition_attempted': 19, 'not_substantive:below_min_body_chars': 1, 'http_403': 1}
- verifier: {'partial': 2, 'tangential': 3, 'unrelated': 14, 'not_verified': 9, 'direct': 2}
- eligible secondaries/institutional reports: **2**; drafter pack: **4**; passed sufficiency: **2**; passed claim-source-match: **2**
- cited footnotes: **2**; found_only shown: 0; unrelated dropped: 2
- sufficiency: `limited_doctrinal_fallback_B:two_doctrinal_secondaries(was:no_usable_judgment_authority)` (sufficient=True); deterministic branch: `None`
- retrieval 13667 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': True, 'reason': 'stage_ran', 'local_hits': 6, 'local_lookups': 8, 'web_attempts': 4, 'ms': 3780}

Top lost promising candidates (verifier direct/partial, never cited):

| # | title | verdict | body chars | loss reason |
|---|---|---|---|---|
| 1 | עליית המידתיות, ירידת ההסתברות והשלכותיה הבלתי-צפויות של המהפכה החוקתית על המשפט | partial | 243 | `claim_source_match:claim_mismatch` |
| 2 | חוק-יסוד: כבוד האדם וחירותו — סעיף 8 | partial | 171 | `claim_source_match:claim_mismatch` |

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| s1 | חוק-יסוד: כבוד האדם וחירותו — סעיף 8 | perplexity | 171 | official_primary / metadata_only | partial (useful) | ignored | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s2 | Barak_Aharon.doc | perplexity | 16000 | secondary_commentary / full_text | direct (central) | doctrinal_secondary | passed | footnote 1 |
| s3 | עליית המידתיות, ירידת ההסתברות והשלכותיה הבלתי-צפויות של ה | perplexity | 243 | secondary_commentary / substantive_excerpt | partial (useful) | ignored | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s4 | בעקבות ספרו של אהרן ברק, מידתיות במשפט – הפגיעה בזכות | perplexity | 2024 | secondary_commentary / full_text | direct (central) | doctrinal_secondary | passed | footnote 1 |

Not carried into the drafter pack: **26** — {'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 17, 'not_carried_into_drafter_pack': 9}

### D3

`run_id` 31ed6bed-ee0a-4998-88fc-6ec2a4a3202d

- discovered: **30** — {'perplexity': 4, 'local_retrieval': 26}
- bodies acquired: **2**; failure reasons: {'no_body_acquisition_attempted': 28}
- verifier: {'direct': 2, 'tangential': 3, 'unrelated': 24, 'partial': 1}
- eligible secondaries/institutional reports: **1**; drafter pack: **2**; passed sufficiency: **1**; passed claim-source-match: **0**
- cited footnotes: **0**; found_only shown: 0; unrelated dropped: 1
- sufficiency: `no_statutory_caselaw_or_doctrinal_anchor` (sufficient=False); deterministic branch: `insufficient_sources_limitation`
- retrieval 23739 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': True, 'reason': 'stage_ran', 'local_hits': 2, 'local_lookups': 2, 'web_attempts': 0, 'ms': 234}

Top lost promising candidates (verifier direct/partial, never cited):

| # | title | verdict | body chars | loss reason |
|---|---|---|---|---|
| 1 | פיטורי עובדות הרות וקריטריון הוותק בחוק עבודת נשים: ההגנה שהפכה למנגנון מעודד אפ | direct | 16000 | `drafter_omitted` |
| 2 | חוק שוויון ההזדמנויות בעבודה, תשמ"ח-1988 (נבו) | direct | 156 | `sufficiency_bucket:ignored` |
| 3 | ביהמ"ש העליון, אב"ד, הנשיא יצחק עמית, המשנה לנשיא נעם סולברג, השופטת דפנה ברק אר | partial | 400 | `not_carried_into_drafter_pack` |

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| s1 | חוק שוויון ההזדמנויות בעבודה, תשמ"ח-1988 (נבו) | perplexity | 156 | official_primary / metadata_only | direct (central) | ignored | not_run | — sufficiency_bucket:ignored |
| s2 | פיטורי עובדות הרות וקריטריון הוותק בחוק עבודת נשים: ההגנה  | local_retrieval | 16000 | secondary_commentary / full_text | direct (central) | doctrinal_secondary | not_run | — drafter_omitted |

Not carried into the drafter pack: **28** — {'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 27, 'not_carried_into_drafter_pack': 1}

### DARKPATTERNS

`run_id` a57e9097-3d0f-498c-ae64-3b467f5f2f00

- discovered: **32** — {'nomination': 2, 'perplexity': 6, 'local_retrieval': 24}
- bodies acquired: **5**; failure reasons: {'no_body_acquisition_attempted': 27}
- verifier: {'partial': 8, 'tangential': 1, 'unrelated': 23}
- eligible secondaries/institutional reports: **0**; drafter pack: **8**; passed sufficiency: **1**; passed claim-source-match: **0**
- cited footnotes: **0**; found_only shown: 1; unrelated dropped: 6
- sufficiency: `doctrinal_anchor_present` (sufficient=True); deterministic branch: `None`
- retrieval 10044 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': True, 'reason': 'stage_ran', 'local_hits': 2, 'local_lookups': 2, 'web_attempts': 0, 'ms': 243}

Top lost promising candidates (verifier direct/partial, never cited):

| # | title | verdict | body chars | loss reason |
|---|---|---|---|---|
| 1 | חוק הגנת הפרטיות, התש"מ"א–1981 | partial | 800 | `claim_source_match:claim_mismatch` |
| 2 | חוק הגנת הצרכן, התשמ"א–1981 | partial | 800 | `claim_source_match:claim_mismatch` |
| 3 | חוק הגנת הפרטיות, תשמ"א–1981 - אתר הכנסת (PDF) | partial | 117 | `sufficiency_bucket:ignored` |
| 4 | זכויות - gov.il (PDF) | partial | 109 | `sufficiency_bucket:ignored` |
| 5 | סוגיות בהגנה על הצרכן | partial | 106 | `claim_source_match:claim_mismatch` |

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| s1 | חוק הגנת הפרטיות, התש"מ"א–1981 | nomination | 800 | official_primary / full_text | partial (useful) | primary | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s2 | חוק הגנת הצרכן, התשמ"א–1981 | nomination | 800 | official_primary / full_text | partial (useful) | found_only | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s3 | סוגיות בהגנה על הצרכן | perplexity | 106 | official_primary / metadata_only | partial (useful) | ignored | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s4 | חוק הגנת הפרטיות, תשמ"א-1981 - נבו | perplexity | 76 | official_primary / metadata_only | partial (useful) | ignored | not_run | — sufficiency_bucket:ignored |
| s5 | חוק הגנת הפרטיות, תשמ"א–1981 - אתר הכנסת (PDF) | perplexity | 117 | official_primary / metadata_only | partial (useful) | ignored | not_run | — sufficiency_bucket:ignored |
| s6 | חוק הגנת הפרטיות (תיקון מס' 13), התשפ"ד-2024 - gov.il | perplexity | 90 | official_primary / metadata_only | partial (useful) | ignored | dropped: claim_mismatch | — claim_source_match:claim_mismatch |
| s7 | זכויות - gov.il (PDF) | perplexity | 109 | official_primary / metadata_only | partial (useful) | ignored | not_run | — sufficiency_bucket:ignored |
| s8 | חוק הגנת הצרכן, תשמ"א-1981 | perplexity | 32 | official_primary / metadata_only | partial (useful) | ignored | dropped: claim_mismatch | — claim_source_match:claim_mismatch |

Not carried into the drafter pack: **24** — {'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 24}

### R02

`run_id` ba6e9f8f-f4ec-482c-84a6-8f41c0be9d50

- discovered: **30** — {'perplexity': 1, 'local_retrieval': 29}
- bodies acquired: **6**; failure reasons: {'no_body_acquisition_attempted': 24}
- verifier: {'direct': 1, 'unrelated': 23, 'tangential': 6}
- eligible secondaries/institutional reports: **0**; drafter pack: **1**; passed sufficiency: **1**; passed claim-source-match: **0**
- cited footnotes: **0**; found_only shown: 0; unrelated dropped: 0
- sufficiency: `None` (sufficient=None); deterministic branch: `docket_limitation`
- retrieval 16831 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': False, 'reason': 'depth_mode_not_eligible:specific_case_or_statute', 'local_hits': 0, 'local_lookups': 0, 'web_attempts': 0, 'ms': 0}

Top lost promising candidates (verifier direct/partial, never cited):

| # | title | verdict | body chars | loss reason |
|---|---|---|---|---|
| 1 | ע"א 6821/93 - בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי | direct | 154 | `drafter_omitted` |

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| s1 | ע"א 6821/93 - בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי | perplexity | 154 | primary_mirror / metadata_only | direct (central) | background | not_run | — drafter_omitted |

Not carried into the drafter pack: **29** — {'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 29}

### P02

`run_id` 72ca5ac7-b796-4e8b-b6bb-47199b6e51fc

- discovered: **30** — {'perplexity': 1, 'local_retrieval': 29}
- bodies acquired: **4**; failure reasons: {'no_body_acquisition_attempted': 26}
- verifier: {'unrelated': 30}
- eligible secondaries/institutional reports: **0**; drafter pack: **0**; passed sufficiency: **0**; passed claim-source-match: **0**
- cited footnotes: **0**; found_only shown: 0; unrelated dropped: 0
- sufficiency: `None` (sufficient=None); deterministic branch: `docket_limitation`
- retrieval 16728 ms, retrieval budget exceeded: False; secondary-body stage: {'ran': False, 'reason': 'depth_mode_not_eligible:specific_case_or_statute', 'local_hits': 0, 'local_lookups': 0, 'web_attempts': 0, 'ms': 0}

Top lost promising candidates (verifier direct/partial, never cited):

_none — no direct/partial candidate was left uncited._

Carried drafter pack (full per-candidate records for all candidates are in `funnel.json`):

| ref | title | discovered_by | body chars | tier / usability | verdict (centrality) | sufficiency role | claim-match | final use |
|---|---|---|---|---|---|---|---|---|
| — | _no source reached the drafter pack_ | | | | | | | |

Not carried into the drafter pack: **30** — {'verifier_dropped_irrelevant(free_text_reason_in_funnel.json)': 29, 'פסק דין מס\' 3289-24 – אינו בג"ץ 9999/99.': 1}

