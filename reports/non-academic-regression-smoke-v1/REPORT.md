# non_academic_regression_smoke_v1 — read-only diagnostic

Read-only. No code changed. Three non-academic fixtures run against the deployed
`legal-research-v1` (smoke mode). Raw telemetry: `results.json`; verbatim answers: `ANSWERS.md`.

| id | run_id | latency | footnotes |
|----|--------|---------|-----------|
| Q1 | c6ce82ca-3060-4c7d-9d47-2360da3b0fbb | 214s | 0 |
| Q2 | 966a97a3-f2c2-4759-b48a-599c555189ec | 177s | 1 (compound) |
| Q3 | a61d3e86-1cc8-4cb8-b145-31389b3170eb | 819s | 0 — infrastructure failure, no answer |

## 1. non_academic_routing_smoke

| question_id | detected_intent | genre | depth | academic_writing_triggered | correct_route | notes |
|---|---|---|---|---|---|---|
| Q1 | doctrine_explanation | analysis | narrow_doctrine | no (`academic_mode=false`, academic admission reviewed 0) | yes | router profile `doctrine_explainer`, block ceiling 7 |
| Q2 | doctrine_explanation / statutory | analysis | narrow_doctrine | no | yes | statutory claim categories declared for blocks 0–1 |
| Q3 | (research_mode set, reaped before drafting) | — | — | no | n/a | isolate reaped, `infrastructure_failure=true` |

Routing acceptance passes: no academic path, no `הערת עבודה`, no academic chapter framing.

## 2. non_academic_source_flow

| question_id | local_statutes_found | local_judgments_found | local_scholarship_found | final_pool_size | footnotes | source_types_used |
|---|---|---|---|---|---|---|
| Q1 | 0 resolved into pack (`synthesis_pack.statute_count=0`) | 10 local caselaw protected by the new content-aware gate, but 0 reached the pack (`judgment_count=0`) | yes (s1–s3 with 16k / 2.2k bodies) | 23 passed → **0 used** | 0 | none |
| Q2 | Basic Law text not bound to any statutory block (blocks 0–1 `kept_refs=[]`) | 32 local caselaw protected by the gate, 0 in pack | yes | 10 passed → 2 used, merged into 1 marker | 1 | journal_article only |
| Q3 | — | — | — | — | — | run died before synthesis |

## 3. non_academic_claim_source_precision

| question_id | claim | cited_source | source_type | source_role | verdict | issue |
|---|---|---|---|---|---|---|
| Q1 | all 4 blocks (doctrinal_synthesis, contextual_background, 2× court_holding) | none | — | — | uncited | CSM dropped every ref: `claim_mismatch`, `commentary_in_substantive_block`, `insufficient_authority_for_claim_category`, `unrelated_legal_area` |
| Q2 | Basic Law rights list / s.8 limitation clause (statutory) | none | — | — | uncited | statutory claim requires primary text; local statute never bound |
| Q2 | proportionality-test doctrinal synthesis | s6 + s5 merged into footnote 1 | journal_article ×2 | secondary_commentary | acceptable in substance, **broken in form** | one marker carries two unrelated articles; rendered title concatenates "נדב דגן…461" with "חופש הביטוי בתקשורת המקוונת…" (`source_type: compound`) |
| Q3 | — | — | — | — | — | no answer |

No off-doctrine judgment supports a doctrinal claim (no judgments were cited at all).
No secondary source is used for statutory text, holdings, docket outcomes, or quotes — the
guard held, but at the cost of leaving those claims wholly uncited. No citation padding.

## 4. non_academic_answer_quality (1–10)

| question_id | directness | usefulness | citation_precision | over_academic | caution | final_verdict |
|---|---|---|---|---|---|---|
| Q1 | 7 | 6 | 1 (zero citations) | 4 | 8 (too cautious) | fail — correct prose, no sourcing |
| Q2 | 6 | 6 | 3 | 4 | 8 | fail — statutory claims uncited, compound footnote |
| Q3 | 0 | 0 | 0 | — | — | fail — infrastructure failure after 13.6 min |

## 5. Regressions found

1. **Citation-stripping on ordinary doctrinal Q&A (Q1, major).** 23 sources passed to the
   drafter; `used_sources = []`. `claim_source_match` tagged the blocks
   `block_legal_area = constitutional` while on-point sources carried
   `public_law_hcj`, producing `unrelated_legal_area`; the surviving doctrinal
   secondaries were then dropped as `commentary_in_substantive_block` /
   `insufficient_authority_for_claim_category` against `court_holding` categories.
   Topic-aware alignment was not the culprit — it ran with `refs_removed=0` and received
   already-empty blocks (it did fix 16 source roles).
2. **Local corpus unlock does not reach the answer on non-academic runs.** The new gate
   protected 10 (Q1) and 32 (Q2) substantive local judgments from listing suppression, yet
   `synthesis_pack.judgment_count = 0` in both. Recall improved, admission into the pack did not.
3. **Local statute resolution absent on this path.** `local_primary_anchor` telemetry is null
   for both Q1 and Q2; the Basic Law question never anchors on the statutory text that the
   local resolver was built to supply.
4. **Compound footnote label defect (Q2).** Two distinct journal articles share one marker and
   one concatenated title string with `source_type: "compound"` — a display/rendering defect,
   not merely a ranking choice.
5. **Over-cautious boilerplate.** Both completed answers end with two stacked notices
   (`מגבלת ביסוס` + `הערה על היקף המקורות`) even when the pipeline did have usable local
   judgments. Not academic wording, but it reads defensively for a practical Q&A.
6. **Latency / stability.** 177–214s for completed runs and one 819s isolate reap
   (`infrastructure_failure`, credits refunded). Q3 — the most mainstream case-law question —
   produced no answer at all.

Safety: no regression. Identity, metadata-only, statute-text and holding guards all held;
no fabricated authority appeared in either completed answer.

## 6. Recommendation

**Fix the non-academic regression first — do not proceed to Hebrew naturalness.**
Priority order:
1. Claim legal-area tagging in `claimSourceMatch` (constitutional vs. public_law_hcj collision)
   and the `court_holding` category assignment for generic doctrinal blocks — this alone caused
   the Q1 zero-citation answer.
2. Admission of gate-protected local judgments into the synthesis pack for non-academic modes.
3. Local primary-anchor resolution on the non-academic path (Basic Law / named statutes).
4. Compound-footnote splitting/labelling.
5. Stability of long case-law runs (Q3 reap) before any style work.

Hebrew naturalness is a polish track; today ordinary Q&A returns unsourced or thinly sourced
answers, which is a substance-level regression.
