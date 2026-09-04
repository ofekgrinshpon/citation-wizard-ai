# academic_richness_loss_audit_v1 — read-only diagnostic

No code, prompts, retrieval, admission, CSM, alignment, drafter or footnote logic was
changed. Evidence = stored telemetry (`qa_logs.metadata`) of the latest representative
runs, i.e. the same runs that followed `local_judgment_body_upgrade_v1` and
`topic_aware_claim_source_alignment_v1`. No fixture was re-run.

| fixture | run_id | total_ms | raw found | pool_after | verifier usable | drafter pack | distinct refs the plan permits | model-emitted refs | post-draft kept | footnotes |
|---|---|---|---|---|---|---|---|---|---|---|
| AW4 | 1b5fe080 | 161,110 | 221 | 13 | 13 | 13 | 5 (s1,s2,s3,s4,s9) | 17 | 9 | 3 |
| AW9 | 0d3a8b79 | 146,277 | 167 | 22 | 6 | 6 | 4 (s3,s4,s5,s6) | 13 | 7 | 2 |
| AW7 | 501c7e83 | 130,868 | 106 | 28 | 15 | 15 (13 passed) | 7 | 3 | 3 | 1 |
| Q3 | e2406aa9 | 122,387 | 110 | 14 | 7 | 7 | 6 | n/a | 8 | 4 |
| Q2 | 71978f12 | 150,986 | 121 | 17 | 10 | 10 | 5 | n/a | 8 | 2 |

## Headline finding (before any per-section detail)

**The web tier is dead.** In all five runs, every Perplexity call returned **HTTP 401**
and zero results:

| fixture | perplexity queries | HTTP | raw results | admitted |
|---|---|---|---|---|
| AW4 | 23 | 401 ×23 | 0 | 0 |
| AW9 | 4 | 401 ×4 | 0 | 0 |
| AW7 | 4 | 401 ×4 | 0 | 0 |
| Q3 | 14 | 401 ×14 | 0 | 0 |
| Q2 | 4 | 401 ×4 | 0 | 0 |

`PERPLEXITY_API_KEY` is a **connector-managed** secret, while
`stages/perplexityRetrieval.ts:270` and `stages/officialSourceDiscovery.ts:246` call
`https://api.perplexity.ai/chat/completions` **directly** with it. A gateway-backed
connection key is not a provider API key, so the provider rejects it — consistent with a
uniform 401 rather than sporadic failures. Consequences:

- no web scholarship, no comparative/foreign material, no critique literature;
- `officialSourceDiscovery` (court/Knesset official pages) cannot discover anything;
- canonical judgments named by the nominator (בנק המזרחי, בג"ץ 1715/97) can never be
  fetched — the local corpus has **0** documents for 1715/97 and no proportionality
  landmark text;
- every fixture is effectively a **local-corpus-only** run.

Second structural finding: `canonical_authority_acquisition` was **skipped** in AW4 and
Q3 with `skip_reason: "docket_cap_zero"` and in Q2 with `registry_not_triggered`. The
canonical-authority path exists and is enabled but acquires nothing.

Third: the pre-draft `claim_source_plan` caps `preferred_source_ids` at **4 per claim**.
The union across claims is the hard ceiling on how many distinct sources can be cited.
AW4 had a 13-source pack but the plan permitted only 5 distinct refs; the drafter obeyed
perfectly (24/24 blocks compliant) and emitted 17 markers over those 5, which collapsed
to 3 distinct footnotes.

---

## 1. Query / planner richness

The planner is **not** the bottleneck. AW4 alone generated 28 queries covering statute
text, binding case law, persuasive/foreign case law, scholarship, historical/German
origins, ECHR comparative material, remedies and a Knesset/Ministry-of-Justice report.

planner_richness_table

| fixture | genre | planned_facets | missing_facets | richness_planning_score | diagnosis |
|---|---|---|---|---|---|
| AW4 | theoretical_background (mode: doctrine_explanation, depth academic_research) | statute, canonical case law (מזרחי, 1715/97), doctrinal scholarship, historical/German origins, ECHR comparative, critique, remedy, government report | none material | 9 | Rich map planned; 23 of its queries went to a 401 web tier |
| AW9 | theoretical_background (depth **narrow_doctrine**) | statute §8, בבלי, 1715/97, reliance/legitimate-expectation scholarship, admissibility tests, remedies, UK *Coughlan* comparative | none material | 8 | Good map; only 4 web queries were attempted and all 401'd; local corpus lacks the doctrine |
| AW7 | argument_paragraph (depth narrow_doctrine) | doctrinal scholarship, case law, statute, critique | dedicated counter-position search | 6 | Facets fine, but query text drifted to family/rabbinical-court terms |
| Q3 | doctrine_explanation (depth broad_research) | statute, canonical case law, scholarship, critique, application | none material | 8 | Canonical dockets were named but unreachable |
| Q2 | doctrine_explanation (depth narrow_doctrine) | §8 full text, interpretive case law, scholarship | none material | 8 | Statute facet planned and satisfied |

Answer to the key question: **the system did build a rich research map.** Cause 1 is
rejected.

---

## 2. Retrieval yield by source role

role_funnel_table (consolidated; per-role numbers taken from `pool.counts`,
`verifier.counts`, `used_sources`)

| fixture | role | found | admitted | body_acquired | reached_pack | emitted_by_drafter | survived_final | final_cited | main_loss_point |
|---|---|---|---|---|---|---|---|---|---|
| AW4 | primary_statute | 9 | 1 | 1 (local) | 1 | 1 | 0 | 0 | post-draft filter (statute not acceptable for implementation_example) |
| AW4 | canonical_case_law | 4 | 3 | 2 | 3 | 2 | 2 | 2 | canonical landmarks absent from corpus; only adjacent בג"ץ used |
| AW4 | direct_doctrinal_scholarship | ~8 local (Weill, Barak, Dagan) | 8 | 8 | 8 | 1 | 1 | 1 | **claim_source_plan ceiling** — s5–s13 allowed for no claim |
| AW4 | comparative / historical / critique | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **web 401** |
| AW9 | direct_doctrinal_scholarship (reliance) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **absent from corpus + web 401** |
| AW9 | generic/adjacent scholarship | 14 | 6 | 6 | 6 | 5 | 5 | 2 | verifier dropped 16/22 as tangential |
| AW9 | canonical_case_law (בבלי, 1715/97) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | absent + web 401 |
| AW7 | on-topic admin-law scholarship | ~3 | 3 | 3 | 3 | 1 | 1 | 1 | pack dominated by off-topic family/rabbinical material |
| AW7 | adjacent/tangential | ~25 | 12 | – | 12 | 0 | 0 | 0 | verifier + non-emission |
| Q3 | canonical proportionality case law | 0 | 0 | 0 | 0 | 0 | 0 | 0 | canonical acquisition skipped (`docket_cap_zero`) + web 401 |
| Q3 | statute / adjacent judgments / scholarship | 14 | 7 | 7 | 7 | 8 refs | 8 | 4 | acceptable |
| Q2 | primary_statute (Basic Law) | 1 | 1 | 1 (local) | 1 | yes | yes | 1 | – |
| Q2 | interpretive case law | 9 | 5 | 5 | 5 | yes | yes | 1 | – |

Answer: **both.** For proportionality (AW4/Q3) rich doctrinal material *is present and
lost*. For reliance/legitimate expectation (AW9) the material is genuinely *absent*.

---

## 3. Local corpus utilization

local_corpus_utilization

| fixture | local_found | local_admitted | local_body | local_in_pack | local_cited | strongest unused local sources | reason unused |
|---|---|---|---|---|---|---|---|
| AW4 | 221 (13 origins local, 0 web) | 13 | 13 | 13 | 3 | רבקה ווייל "האם המחוקק ירה בתותח כדי לפגוע בזבוב?"; אהרן ברק "אילוץ דאונטולוגי, תרבות ההצדקה"; ברק "הזכות החוקתית לגוף"; "על חוקתיות ועל סבירות (בקמן)" | never entered any claim's `preferred_source_ids` (top-4 cap) → drafter forbidden to cite them |
| AW9 | 167 | 22 | 6 | 6 | 2 | ברק "על תורת הסעדים החוקתיים"; בל יוסף "הדיאלוג החוקתי" | verifier `tangential` (13/22) — correct: none is about reliance |
| AW7 | 106 | 28 | 15 | 15 | 1 | "המנהליזציה של המשפט החוקתי"; "שני מושגים של ריסון - וסבירות"; אלון קלמנט "חריגה מסמכות עניינית" | drafter emitted only 3 refs in a single block; genre depth = narrow_doctrine |
| Q3 | 110 | 14 | 7 | 7 | 4 | נדב דגן "מידתיות חוקתית, סבירות מנהלית"; "על חוקתיות ועל סבירות (בקמן)" | not in plan preference set / not emitted |
| Q2 | 121 | 17 | 10 | 10 | 2 | "המהפכה החוקתית או מהפכת זכויות האדם?"; "עשרים שנה לבנק המזרחי" | statutory_framework claims are restricted to s1 by design (correct) |

Note: `local_caselaw_content_listing_gate` bypassed 19–50 candidates per run — the
unlock from the previous track is working. `academic_pack_admission_summary` reports
`reviewed_candidates: 0` in **all** academic fixtures: the academic admission/slotting
module is effectively inert in these runs.

Answer: the local corpus is **passing through as candidates, not being used as research
material** — AW4 cites 3 of 13, AW7 1 of 15.

---

## 4. Perplexity / web utilization

perplexity_utilization (representative rows; the pattern is identical for all 49 queries
across the five runs)

| fixture | query | intended role | found | admitted | body | pack | cited | failure_reason |
|---|---|---|---|---|---|---|---|---|
| AW4 | חוק-יסוד: כבוד האדם וחירותו סעיף 8 | primary_statute | 0 | 0 | – | – | – | HTTP 401 |
| AW4 | ע"א 6821/93 בנק המזרחי | canonical case law | 0 | 0 | – | – | – | HTTP 401 |
| AW4 | ECHR proportionality / margin of appreciation | comparative | 0 | 0 | – | – | – | HTTP 401 |
| AW4 | Verhältnismäßigkeit / Kelsen / Dworkin origins | historical-theoretical | 0 | 0 | – | – | – | HTTP 401 |
| AW9 | UK *Coughlan* legitimate expectation | comparative | 0 | 0 | – | – | – | HTTP 401 |
| Q3 | canonical proportionality judgments | canonical case law | 0 | 0 | – | – | – | HTTP 401 |
| Q2 | סעיף 8 נוסח מלא | primary_statute | 0 | 0 | – | – | – | HTTP 401 |

Answer: Perplexity **is** correctly targeted at role gaps (each query carries a `role`
and a reason) — it simply never executes. This is an infrastructure/credential defect,
not a design defect.

---

## 5. Admission and acquisition losses

promising_source_loss_table

| fixture | source | type | apparent role | stage lost | loss reason | should have been saved | notes |
|---|---|---|---|---|---|---|---|
| AW4 | רבקה ווייל, "האם המחוקק ירה בתותח…" | journal_article | direct doctrinal scholarship on proportionality | pre-draft plan | not in any claim's top-4 `preferred_source_ids` | **yes** | the single most on-topic Hebrew article in the pack |
| AW4 | אהרן ברק, "אילוץ דאונטולוגי, תרבות ההצדקה…" | journal_article | theoretical/critique | pre-draft plan | same | **yes** | direct reply-to-critics piece |
| AW4 | נדב דגן, מידתיות חוקתית/סבירות מנהלית | journal_article | doctrinal | pool dedup ×116 `dup_document_id`, one copy survived | – | n/a | survived and was cited |
| AW4 | חוק-יסוד: כבוד האדם וחירותו | statute | primary anchor | post-draft filter | `class_statute_not_acceptable_for_implementation_example` | debatable | correct rule, wrong block; statute ends up uncited in a constitutional chapter |
| AW4 | ECHR / Canada Oakes / German origins | – | comparative | retrieval | web 401 | **yes** | nothing acquired |
| AW9 | any reliance/legitimate-expectation doctrine source | – | direct doctrinal | retrieval | absent from corpus + web 401 | **yes** | corpus has no admin-law reliance scholarship |
| AW9 | 16 pool candidates | mixed | adjacent | verifier | `tangential`/`unrelated` with explicit Hebrew reasons | no | drops are correct |
| AW7 | most of the 28-candidate pool | family/rabbinical/consumer | off-topic | retrieval relevance | Hebrew query drift | no | pack itself is wrong for the question |
| Q3 | canonical proportionality landmarks | judgment | canonical | canonical acquisition | `docket_cap_zero` | **yes** | registry fired, cap = 0 |
| Q2 | scholarship on §8 | journal_article | doctrinal | pre-draft plan | statutory_framework claims restrict to s1 | no | correct design |

Responsible stages, ranked: **(1) web tier 401**, **(2) pre-draft plan top-4 ceiling**,
**(3) canonical-authority cap zero**, **(4) local retrieval relevance for AW7/AW9**,
(5) verifier drops (correct), (6) post-draft filter (mostly correct).

---

## 6. Drafter usage behaviour

drafter_usage_table

| fixture | pack | role-valuable in pack | emitted refs | distinct final cited | overused | ignored strong sources | likely reason |
|---|---|---|---|---|---|---|---|
| AW4 | 13 | ~9 | 17 markers / 5 distinct | 3 | s2 in 5 of 7 blocks | Weill, Barak ×2, Bakman article | plan permitted only 5 distinct refs; drafter 24/24 compliant |
| AW9 | 6 | 2 | 13 markers / 4 distinct | 2 | s3 in 4 of 5 blocks | none stronger existed | thin pack, correct behaviour |
| AW7 | 15 | ~3 | 3 | 1 | – | "המנהליזציה של המשפט החוקתי", "שני מושגים של ריסון" | one substantive block (genre) + narrow_doctrine depth |
| Q3 | 7 | 5 | 9 | 4 | – | דגן article | acceptable |
| Q2 | 10 | 3 | 8 | 2 | – | – | statutory dominance is intended |

Answer: **the pack is weak in AW9/AW7, and the plan is too tight in AW4.** The drafter
itself is not the problem — it complies exactly with what it is allowed to cite and
already emits 3–6× more markers than survive.

---

## 7. CSM / alignment / footnote finalizer losses

post_draft_loss_table

| fixture | emitted refs | CSM/pre-CSM dropped | alignment dropped | footnote finalizer | correct drops | questionable drops | thinness caused by gates |
|---|---|---|---|---|---|---|---|
| AW4 | 17 (5 distinct) | 6 | 2 | collapse of 9 kept citations → 3 distinct footnotes | 7 | 1 (statute in b2) | partial — the ceiling is upstream, not here |
| AW9 | 13 (4 distinct) | 6 | 0 | 7 kept → 2 footnotes | 6 | 0 | no |
| AW7 | 3 | 0 | 0 | 3 kept → 1 footnote | – | 0 | no |
| Q3 | 9 | – | 1 | 8 kept → 4 footnotes | 1 | 0 | no |
| Q2 | 9 | – | 1 | 8 kept → 2 footnotes | 1 | 0 | no |

`footnote_density_emission` shows `refs_available_after_csm = 1` for almost every block:
by the time the finalizer runs there is nothing left to split. The finalizer is not
over-pruning; it is starved.

Answer: the safety gates are **mostly correct**. They are not the primary cause of
thinness.

---

## 8. Genre / depth suppression

genre_depth_behavior

| fixture | genre | depth_mode assigned | expected depth | actual | suppression triggered | appropriate | issue |
|---|---|---|---|---|---|---|---|
| AW4 | theoretical_background | **academic_research** (mix: judgments 2–4, primary 1–2, secondary 2–4, institutional 1–3) | rich | 3 footnotes | none from depth policy | yes | depth policy correct, plan ceiling binds first |
| AW9 | theoretical_background | **narrow_doctrine** (`academic_cue: false`) → secondary 0–1, institutional 0–0 | rich | 2 footnotes | **yes** | **no** | an academic chapter request was classified as narrow doctrine; secondary allowance of 0–1 directly caps scholarship |
| AW7 | argument_paragraph | **narrow_doctrine** (`academic_cue: false`) | concise but anchored | 1 footnote | yes | partly | conciseness fine; single-source anchoring is weak |
| Q3 | doctrine_explanation | broad_research | 3–5 | 4 | no | yes | – |
| Q2 | doctrine_explanation | narrow_doctrine | statute-dominant | 2 | yes | yes | correct |

Answer: **yes for AW9 and partly AW7** — `academic_cue` detection missed both academic
requests, so an academic chapter ran under a narrow-doctrine source budget.

---

## 9. Source quality and canonicality

canonicality_table

| fixture | expected canonical/direct sources | found | reached pack | cited | missing reason | score |
|---|---|---|---|---|---|---|
| AW4 | בנק המזרחי; 1715/97 לשכת מנהלי ההשקעות; §8 Basic Law; Barak/Weill/Cohen-Eliya scholarship; Oakes/German origins | §8 ✔, Weill ✔, Barak ✔, Dagan ✔; landmarks ✘ | §8, Weill, Barak, Dagan | only Dagan + 2 adjacent בג"ץ | landmarks absent locally, web 401, canonical acquisition `docket_cap_zero`; Weill/Barak blocked by plan ceiling | 4/10 |
| AW9 | בבלי; 1715/97; reliance/legitimate-expectation scholarship; *Coughlan* | none | none | philosophy volume + admin-remedy article | corpus gap + web 401 | 2/10 |
| AW7 | admin-law judicial-review scholarship; a professional-discretion judgment | 1 (שיקול דעת שיפוטי: העידן השלישי) | yes | that one | rest of pack off-topic | 4/10 |
| Q3 | canonical proportionality judgments | none | none | ע"א 10078/03 + דנ"פ 5387/20 (adjacent) | canonical cap zero + web 401 | 4/10 |
| Q2 | חוק-יסוד: כבוד האדם וחירותו §8 | ✔ local | ✔ | ✔ (footnote 2 of 2) | – | 7/10 — statute present but a בש"פ leads the footnote order |

---

## 10. Latency budget analysis

Baseline: 122–161 s total; retrieval consumes only 9–19 s of it (`retrieval_budget`
elapsed), models consume the rest. There is substantial headroom inside the 200 s
retrieval budget.

latency_options_table

| possible fix | likely latency cost | expected quality gain | risk | recommended |
|---|---|---|---|---|
| Restore the web tier (correct Perplexity credential/gateway routing) | +2–8 s (already-budgeted calls that currently 401 in ~120 ms) | **very high** — unlocks comparative, critique, canonical discovery | low | **yes, first** |
| Raise `preferred_source_ids` cap 4 → 6–8 per claim, role-diverse | 0 s | high for AW4/Q3 | low (plan still restricts) | **yes** |
| Fix `academic_cue` detection → academic depth mix for AW9/AW7 | 0 s | medium-high | low | **yes** |
| Enable canonical-authority acquisition (`docket_cap_zero`) | +3–10 s | high for Q3/AW4 | medium (external fetch) | yes, after the web tier |
| Deterministic research brief (no model) | +0.1 s | low on its own | low | only as part of the above |
| Mini-model pre-draft research brief | **+15–40 s** | low — planner is already rich | medium | **no** |
| Role-gap retrieval, local only | +2–5 s | low-medium (corpus gaps are real) | low | maybe later |
| Role-gap retrieval, local + web | +5–15 s | high, but only once the web tier works | medium | after credential fix |
| Extra body acquisition | +5–20 s | low — bodies are already acquired | medium | no |
| Stronger role-aware pack construction only | 0 s | medium | low | yes |

Answer: **richness can be improved substantially with zero added latency** (plan cap,
academic_cue, pack construction) plus one infrastructure repair that costs a few seconds.

---

## 11. Diagnosis summary

fixture_diagnosis

| fixture | main cause of thinness | secondary causes | NOT the cause | recommended fix type |
|---|---|---|---|---|
| AW4 | `claim_source_plan` top-4 ceiling: 13-source pack reduced to 5 permissible refs, 3 cited; the best proportionality scholarship (Weill, Barak) was never citable | web 401 kills comparative/critique; canonical `docket_cap_zero`; 116 `dup_document_id` collapses | planner facets; drafter behaviour; footnote finalizer; genre depth | claim_source_plan_too_restrictive + canonical_authority_priority + Perplexity_role_gap_retrieval |
| AW9 | genuine corpus absence of reliance / legitimate-expectation doctrine, with the web tier dead so the gap cannot be filled | `academic_cue: false` → narrow_doctrine secondary budget 0–1; verifier correctly drops 16/22 | CSM; alignment; footnote gates; drafter | Perplexity_role_gap_retrieval + genre_depth_policy |
| AW7 | local retrieval relevance failure — pack is family/rabbinical/consumer material for an administrative-law argument | narrow_doctrine depth; one substantive block by genre | plan (7 refs permitted, only 3 emitted); gates (0 drops) | local_retrieval + genre_depth_policy |
| Q3 | canonical proportionality authorities never acquired (`docket_cap_zero` + web 401); answer rests on adjacent judgments | plan ceiling | gates (1 correct drop); drafter | canonical_authority_priority |
| Q2 | mostly correct; statute is cited but ordered second behind a בש"פ | – | plan (correctly statute-only for statutory claims) | canonical_authority_priority (ordering only) |

---

## 12. Recommendation

**A. Is a full `pre_draft_academic_research_brief_v1` needed? No.** The planner already
produces 13–28 role-tagged queries covering statute, canonical case law, scholarship,
comparative, critique, remedy and institutional context. Adding another planning layer
would re-plan work that is already planned and would add 15–40 s for no gain.

**B/C. The lightest thing that solves the real problem**, in order:

1. **Repair the web tier.** 49/49 Perplexity calls returned 401 across five runs, and
   `officialSourceDiscovery` uses the same key. This one defect removes comparative
   sources, critique literature, foreign case law and official canonical discovery from
   every answer. Nothing else in the pipeline can compensate for it.
2. **Loosen the pre-draft plan ceiling** from 4 preferred refs per claim to 6–8 chosen
   for role diversity, so an on-topic 13-source pack cannot collapse to 5 permissible
   refs. Zero latency; the plan keeps its restrictive power.
3. **Fix academic genre detection** (`academic_cue` was false for both AW9 and AW7 even
   though both begin with "כתוב פרק/פסקה … אקדמית"), so academic chapters get the
   academic source mix rather than 0–1 secondary sources.
4. **Un-zero the canonical-authority cap** (`docket_cap_zero`) once the web tier works.

**D. Latency.** Items 2–4 cost ~0 s; item 1 costs a few seconds of calls that are already
budgeted and currently fail instantly. Total retrieval today uses 9–19 s of a 200 s
budget.

**E. Avoid**: a mini-model research brief, additional body acquisition, more aggressive
retrieval volume, and any loosening of CSM/alignment — the gates were 90 % correct in
this audit and body acquisition already succeeds.

**F. Hebrew naturalness: not yet.** Two of five fixtures currently cite sources that are
not about the question (AW9 philosophy volume; AW7 a single tangentially-selected
article). Polishing prose over a thin, partly off-topic source base would make weak
research read more convincingly, which is the wrong failure mode for a legal tool.

final_recommendation

```
proceed_to_hebrew_naturalness: no
implement_pre_draft_research_brief: no
recommended_next_track_name: web_tier_restoration_and_plan_ceiling_v1
reason: 49/49 Perplexity calls returned HTTP 401, so no comparative, critique,
        foreign or officially-discovered canonical source can enter any answer;
        and where good local sources DO exist (AW4), the pre-draft plan's top-4
        preferred-ref cap forbids the drafter from citing them. These two,
        plus academic_cue misdetection and docket_cap_zero, explain every thin
        fixture in this audit.
expected_latency_impact: negligible (0 s for the plan/genre/pack fixes; +2-8 s
        for web calls that today fail in ~120 ms)
expected_quality_impact: AW4 3 -> 6-8 footnotes with the strongest scholarship
        cited; Q3 canonical authorities restored; AW9 rescued only by the web
        tier (its doctrine is absent from the local corpus); AW7 needs a
        separate local-retrieval relevance fix
risks: restoring the web tier re-introduces external-source noise into gates
        that have only been exercised on local material recently; the plan
        ceiling must stay role-diverse or citation precision regresses
```

### Honest statement

The system **is** doing real research planning. What it is not doing is *executing* half
of that plan (the entire web half returns 401), and where execution succeeds it then
forbids the drafter from citing most of what it found. The problem is narrower than
"no research architecture" — but it is more serious than a drafting or prose issue.
