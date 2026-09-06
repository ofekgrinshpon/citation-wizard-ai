# academic_literature_gate_repair_and_thin_pack_recovery_v1 — Acceptance Report

Deployed: `legal-research-v1`. No fixed source or citation count, no padding, no new model pass, no weakened integrity/CSM/alignment gates.

## What was implemented

1. **`stages/academicLiteratureGateRepair.ts` (new, deterministic, no model call)**
   - `isStrongDirectLiteratureCandidate` — combined-signal assessment: subject topicality, Hebrew legal-scholarship vocabulary, author + quoted scholarly title (article identity), journal/institution detection, scholarly host, DOI, mirror status (`not_a_mirror` / `mirror_with_article_identity` / `mirror_unvalidated`), plus disqualifiers (marketing, listing, off-topic).
   - `buildLiteratureGateTrace` — one row per strong direct candidate: found → admitted → body attempted/acquired/chars → post-body topicality → verifier usable → pack → final loss stage and reason.
   - `classifyBodyTopicality` — post-fetch, pre-verifier classification of the acquired body (`direct` / `adjacent` / `off_topic`) with key matching terms and negative signals; an off-topic body is refused, never packed.
   - `decideThinPackRecovery` — literature-only guard, hard bounds `max_candidates 3`, `max_web_attempts 3`, `total_ms 12000`, one retry only, restricted to candidates **already found** in this run and not definitively rejected. Reports `no_recoverable_strong_direct_candidates_real_scarcity` instead of inventing work.
   - `checkNamedSynthesis` — named-source use, generic "הספרות טוענת" phrase count, unsupported generic claims, limitation-sentence presence.

2. **`stages/academicCandidateAdmission.ts`** — combined-signal admission repair. A candidate with strong topical fit **and** validated scholarly identity (article identity / publisher / university / institute / journal host / DOI) is no longer rejected for soft reasons alone (`no_credible_academic_provenance`, `mirror_or_unknown_repository`, `citation_aggregator_or_search_index`, `insufficient_academic_signals`, `no_scholarly_title_or_abstract`, `source_too_generic`). Hard rejections — listing pages, marketing/SEO, off-topic, missing domain — still stand, and admission confers nothing downstream.

3. **`stages/secondaryBodyAcquisition.ts`** — new `literature_direct_ids` input. A strong direct scholarship candidate gets one bounded acquisition attempt even when its declared type carries no doctrinal keyword, so `discovery_only` stops being terminal for real scholarship. Primary law, already-acquired bodies, paywalls and access-controlled URLs are still refused.

4. **`index.ts`** — strong-direct assessment before body acquisition (top 8 by topicality feed the body lane), `academic_literature_strong_direct_candidates` durable marker, the bounded thin-pack recovery guard immediately before the drafter, post-body topicality for every acquired body, and persisted telemetry: `academic_literature_mode`, `academic_literature_gate_repair_version`, `academic_literature_gate_trace`, `academic_literature_body_topicality`, `academic_literature_thin_pack_recovery`, `academic_literature_named_synthesis`.

5. **Tests** — `src/test/academicLiteratureGateRepair.test.ts` (8 tests): mirror admission with article identity, marketing refusal, off-topic refusal, recovery not firing outside literature mode / on a healthy pack / on real scarcity, bounded recovery firing, off-topic body refused for pack. Full suite: **31 files / 315 tests pass**. Preview build: `build OK`.

## Live validation (same two literature-only queries)

| | L1 (עילת הסבירות) | L2 (הבטחה מנהלית / הסתמכות) |
|---|---|---|
| run_id | `10e473c8-ce82-429b-a01d-fe8aef2b1422` | `e19e1cfb-6117-44a0-afb0-26d56d367be4` |
| duration | 328,063 ms | 247,497 ms |
| scholarship bodies acquired | **2** (prev. 3, of which only 2 packed) | **6** (prev. 1) |
| strong-direct trace rows | 2 | 5 |
| all trace rows admitted / body / verifier-usable / packed | 2/2/2/2 | 5/5/5/5 |
| final loss stage on traced rows | `none` | `none` |
| footnotes in final answer | 1 (prev. 1) | **3** (prev. 1) |
| distinct named sources cited | 1 | 3 |
| off-topic body spend | 0 | 0 |
| thin-pack recovery | not triggered — `no_recoverable_strong_direct_candidates_real_scarcity` | not triggered — `pack_not_thin` |
| added recovery latency | 0 ms | 0 ms |
| generic unsupported literature claims | 0 | 0 |
| limitation sentence present | yes | yes |
| case-law / statute filler | none | none |

L2's cited sources: `הגנת ההסתמכות במשפט המנהלי` (משפטים, HUJI), ברוורמן, `"כגודל הציפייה": היקף הביקורת השיפוטית על שינוי מדיניות עקבית של רשויות המנהל` (Radzyner Law Review), and `הזכות המנהלית והסעד הכספי במשפט המקובל המנהלי` (עיוני משפט, TAU). L1's cited source: נדב דגן, `מידתיות חוקתית, סבירות מנהלית` (Haifa).

Full answers: `L1_answer.md`, `L2_answer.md`; raw telemetry: `results.json`.

## Assessment

- **L2 passes.** The gate repair converted the previous 1-body / 1-citation run into 6 acquired bodies, 5 usable direct scholarship sources and a 3-source synthesis that names positions and authors, with zero off-topic spend and an honest scope sentence. Every traced candidate now survives admission → body → verifier → pack (`final_loss_stage: none`), which is exactly the gate failure this track targeted.
- **L1 improves at the gate but not yet at the pen.** Both traced candidates reached the pack and both are direct, yet the drafter cited only one of them; the loss is now purely drafter citation behaviour, not admission, provenance, fetch or pack. The answer also leans on paraphrase ("כתבים מסוימים", "ניתוחים דוקטרינריים מסוימים") where a second named source was available in the pack.
- The recovery guard behaved as designed: it never fired, added 0 ms, and correctly distinguished "pack not thin" (L2) from genuine scarcity (L1) rather than launching new retrieval.

**Recommended next track:** `literature_pack_utilisation_v1` — make the drafter cite every direct pack source it actually relies on (attribute the paraphrased positions to the named source already in the pack) without introducing any citation floor.

## Prohibitions honoured

No new general recovery stage, no post-hoc rescue layer, no additional LLM pass, no fixed source/citation minimum, no padding, no global retrieval inflation, no unsafe citations, no case/statute filler, no off-topic filler, no weakened integrity/CSM/alignment, no Hebrew style changes, no hardcoded fixtures or source IDs, no broad web recovery, no access-control bypass.
