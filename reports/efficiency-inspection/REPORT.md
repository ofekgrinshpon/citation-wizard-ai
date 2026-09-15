# ReLex V2 — Token & Research Efficiency Inspection

INSPECTION ONLY. No code, prompt, budget or deployment change. Nothing rerun. All numbers come from persisted `v2_eval_runs` rows (`result->'telemetry'`, `agent_turns`, `agent_trace`, `phase_ms`, `source_funnel`) and from reading the current implementation.

---

## 1. Executive summary

The expensive runs are **not** expensive because of large individual model turns, large rolling state, quote accumulation, repairs, chunking or context overhead. Every one of those is bounded and modest.

They are expensive for one reason: **after the answer-bearing body is already in the evidence store, the agent keeps issuing targeted re-reads of that same body ("span hunting"), 3–5 per turn, for many turns, and nothing in the current budget machinery stops it** — an `already_read` fetch is explicitly *not* charged to the fetch budget (`researchAgent.ts:810`), so the only ceiling it ever hits is the agent-step ceiling.

Measured share of prompt tokens spent *after the last turn that added a readable body*:

| Run | prompt tokens | after last evidence | share |
|---|---|---|---|
| Q27 | 304,871 | 205,031 | **67%** |
| Q28 | 165,676 | 149,628 | **90%** |
| Q18 | 228,978 | 195,688 | 85% (largest part legitimate recovery, see §10) |
| Q24 | 153,866 | 110,039 | 71% |
| Q29 | 209,036 | 115,059 | 55% |
| Q22 (comparator) | 66,601 | 12,647 | 19% (the memo turn itself) |

Average prompt tokens per research turn is stable at **7.6k–14k across all runs, cheap and expensive alike**; max single turn anywhere is 18.6k. So 305k is **many reasonably-sized turns**, not a few enormous ones. The optimization axis is **fewer turns**, not smaller prompts.

The commit machinery already *detects* this: Q27 issued `early_commit` at step 8 and `stale_research` at steps 5 and 7; Q28 issued `stale_research` at steps 4, 6, 8, 10, 12, 14; Q18 seven times. The agent read the signal and kept going. The signals are advisory only, and the behaviour they target costs no budget.

---

## 2. Runs inspected (latest post-fix rows)

| Q | run row id | created | note |
|---|---|---|---|
| Q27 | `33438705-e51c-45f9-a6d8-7c726209ad20` | 2026-09-15 03:11 | post-acquisition-orchestrator |
| Q18 | `65c07f13-236f-4e3f-b4c5-b1923fbb1316` | 2026-09-15 03:11 | post-acquisition-orchestrator |
| Q22 | `6fa402ea-9bb7-4b9b-a7b1-5be1a02049d1` | 2026-09-15 03:11 | efficient comparator |
| Q23 | `f22a7760-23d5-4edb-86af-5629b0df82f6` | 2026-09-15 03:11 | second cheap comparator |
| Q29 | `939dabe5-9048-453a-afab-e0c3a9ea7445` | 2026-09-15 04:33 | post-temporal-fix |
| Q24 | `40cc6f0c-fa9e-4c10-8c34-a9a0337efb5c` | 2026-09-15 04:33 | post-temporal-fix |
| Q28 | `2e7e425d-286d-4f35-a990-9512b29007ac` | 2026-09-15 04:33 | post-temporal-fix |

Q19 has no post-fix run and is therefore excluded (old Batch 3 rows deliberately not used).

---

## 3. Per-run efficiency table

| | Q27 | Q18 | Q29 | Q28 | Q24 | Q23 | Q22 |
|---|---|---|---|---|---|---|---|
| prompt tokens | 304,871 | 228,978 | 209,036 | 165,676 | 153,866 | 88,479 | 66,601 |
| completion tokens | 9,928 | — | — | — | — | — | — |
| model calls (all stages) | 24 | 23 | 19 | 17 | 15 | — | 10 |
| agent turns / steps | 21 | 20 | 16 | 15 | 12 | 8 | 8 |
| chunks | 3 | 2 | 2 | 2 | 2 | — | 1 |
| **avg prompt tokens / agent turn** | **14,016** | **11,113** | **12,403** | **10,534** | **11,882** | 9,923 | **7,623** |
| **max single-turn prompt tokens** | 18,070 | 14,726 | 18,597 | 15,043 | 18,025 | 12,944 | 12,647 |
| avg context chars / turn | 27,891 | 21,028 | 25,250 | 21,167 | 24,398 | 20,948 | 16,065 |
| max context chars | 35,749 | 26,577 | 36,168 | 31,034 | 36,822 | 28,251 | 25,979 |
| searches (scoped) | 4 | 8 | 8 | 8 | 4 | — | 7 |
| raw_web_search calls / results / fetched | 1 / 8 / 0 | 3 / 24 / 0 | 0 | 0 | 0 | — | 1 / 10 / 3 |
| real fetch calls (budget-charged) | 3 | 8 | 6 | 3 | 4 | — | 9 |
| lookup_authority | 2 | 4 | 3 | 2 | 6 | — | 1 |
| readable bodies | 3 | 3 | 4 | 1 | 2 | — | 3 |
| **already_read actions** | **61** | 35 | 31 | **42** | 24 | — | **6** |
| noop_already_read_suppressed | 6 | 4 | 0 | 9 | 0 | — | 0 |
| repeated_tool_calls_prevented | 6 | 4 | 0 | 9 | 1 | — | 1 |
| no-op turns / their prompt tokens | 15 / 231,151 | 12 / 138,943 | 11 / 145,897 | 12 / 129,054 | 6 / 76,078 | 2 / 17,490 | 2 / 17,744 |
| context compactions / chars saved | 67 / 300,507 | 50 / 148,441 | 42 / 181,639 | 51 / 163,703 | 36 / 149,942 | — | 15 / 44,892 |
| rolling state chars (last turn) | 4,658 | 5,678 | 5,203 | 4,609 | 4,413 | — | 4,803 |
| largest tool payload chars | 6,609 | 4,960 | 6,452 | 6,498 | 6,587 | — | 4,893 |
| repair cycles / temporal repairs | 0 / 0 | 0 / 1 | 0 / 0 | 0 / 0 | 1 / 0 | — | 0 / 0 |
| span-verified pairs / footnotes | 5 / 2 | 4 / 1 | 7 / 3 | 8 / 1 | 7 / 1 | — | 5 / 2 |
| central_issue_covered | true | false | true | true | false | — | true |
| answer chars | 1,897 | 1,170 | 1,978 | 1,236 | 1,843 | — | 1,347 |
| agent-model wall time (ms) | 128,507 | 96,957 | 97,518 | 82,956 | 125,143 | — | 51,620 |

Agent-loop turns account for **96.5% of Q27's prompt tokens** (294,346 of 304,871). Verification, temporal and drafting model calls together are a small remainder (Q27: verification 5.6s, temporal 2.5s, drafting 17.9s of wall time). **The agent loop is the entire cost story.**

---

## 4. Per-turn forensic analysis

### Q27 (representative)

| turn | action | prompt tok | ctx chars | evidence? | no-op? | cumulative |
|---|---|---|---|---|---|---|
| 1 | lookup_authority ×2 + search | 2,921 | 5,707 | no | no | 2,921 |
| 2 | acquire_authority → S1 | 7,176 | 16,107 | **yes** | no | 10,097 |
| 3 | fetch (S2 statute, 13,883 chars) | 8,075 | 17,125 | **yes** | no | 18,172 |
| 4–6 | 3–4 `already_read` re-reads of S1/S2 each | 13,288 / 14,907 / 15,995 | ~33k | no | yes | 62,362 |
| 7 | search + raw_web_search + re-read | 12,304 | 25,619 | no | no | 74,666 |
| 8 | acquire_authority → S3 | 14,649 | 31,459 | **yes (last)** | no | **89,315** |
| 9–20 | 4–5 `already_read` re-reads per turn, S1/S2 only | 12,067–17,346 | 23k–35k | no | yes | 286,801 |
| 21 | submit_research_memo | 18,070 | — | — | no | 304,871 |

Turns 9–20 are twelve consecutive turns whose entire content is re-querying two bodies already in the store with paraphrased `find` phrases ("סוף דבר שיתוף לייק", "המסקנה היא", "יש לקבוע כי…"). 61 `already_read` actions total against **3** real fetches.

### Pattern across runs

* **Highest-token turns** are always late turns — cost tracks position in the loop (accumulated transcript), not action type.
* **Repeated / no-op turns**: Q27 15/21, Q28 12/15, Q18 12/20, Q29 11/16, Q24 6/12 — vs Q22 2/8, Q23 2/8.
* **Turns that merely re-read existing material** dominate every expensive run.
* **Searches that produced no useful candidate/body**: Q28 8 web searches → 1 readable body; Q29 8 web searches → 4 bodies; Q18 3 raw searches after the first memo attempt → 1 zero-char document.
* **Repair turns**: essentially absent (see §12).
* **Memo turns** cost 12.6k–18.6k each; Q18 and Q24 paid for two memo turns (pre-memo acquisition gate handed the memo back once).

---

## 5. Work after sufficient evidence

| Run | last evidence-adding turn | memo turn | turns after | prompt tokens after | what those actions were |
|---|---|---|---|---|---|
| Q27 | 8 | 21 | 13 | 205,031 | 100% targeted re-reads of S1/S2 |
| Q28 | 2 | 15 | 13 | 149,628 | re-reads of S1 + 3 web searches + 1 403 fetch |
| Q18 | 4 | 14, then 20 | 16 | 195,688 | re-reads, 2 lookups, 1 failed acquire, 3 raw searches, 1 empty body |
| Q24 | 5 | 12 | 7 | 110,039 | re-reads + 2 lookups + 1 acquire |
| Q29 | 9 | 16 | 7 | 115,059 | re-reads of the statute body |
| Q22 | 7 | 8 | 1 | 12,647 | the memo itself |

**Proven, not assumed:** in Q27 and Q28 the post-evidence work produced **zero** new readable bodies and zero new authority acquisitions; the final answers cite only sources acquired at or before the last evidence turn (Q27 footnotes: S1 judgment + S2 statute; Q28: the single 46,752-char body fetched at turn 2). The hypothesis "ReLex already had the answer but did not know when to stop" is **confirmed for Q27, Q28, Q24 and Q29**, and only partly true for Q18 (§10).

---

## 6. Token cost classification

Approximate, Q27 / Q28 / Q18 / Q29 / Q24 (prompt tokens):

| Class | Q27 | Q28 | Q18 | Q29 | Q24 |
|---|---|---|---|---|---|
| **A** productive acquisition | ~89k (29%) | ~16k (10%) | ~33k (14%) | ~94k (45%) | ~44k (29%) |
| **B** failed-but-reasonable research | ~12k | ~15k | ~60k (403s, court resets, raw recovery) | ~20k | ~17k |
| **C** repetition / no-yield span hunting | **~186k (61%)** | **~119k (72%)** | ~90k (39%) | ~77k (37%) | ~60k (39%) |
| **D** exploration after adequate evidence | included in B+C above | — | — | — | — |
| **E** repair overhead | 0 | 0 | ~26k (2nd memo turn) | 0 | ~18k (2nd memo turn) |
| **F** context overhead (fixed+state, see §13) | ~61k of the above turns | ~44k | ~58k | ~46k | ~35k |
| **G** chunk/resume orchestration | negligible tokens (resume_gap 44s wall in Q27, no re-sent context) | — | — | — | — |
| **H** other | memo turn 18k | 14k | 26k | 19k | 34k |

F is not additive with A–E: it is the per-call floor *inside* each turn. Failed acquisition attempts (B) are counted as cost, not waste.

---

## 7. Context-size analysis

Rolling state built by `buildResearchStateMessage()` is **small and bounded** in every run: last-turn state 4,413–5,678 chars (≈2.0–2.6k tokens). It did not grow materially — stores held 1–8 sources, open targets 0–3, ledger rows ≤3.

Per-turn context (21k–36k chars) decomposes roughly as:

* system prompt 4,682 chars + tool specs ≈ 3k → ~8k chars fixed;
* rolling state ~5k chars;
* retained transcript: assistant messages with 3–5 tool-call argument blocks per turn, four verbatim recent tool payloads (largest observed 6.6k chars, cap 12k), plus 240-char digests of everything older.

Context is **stable, not growing**: Q27 turn 6 context 35,749 chars vs turn 20 context 28,794 chars. Compaction is working (67 compactions, 300,507 chars saved in Q27).

**Conclusion: context size does not explain the cost. Turn count does.** Reducing context would shave perhaps 15–20% off an inflated run; removing the redundant turns removes 60%+.

---

## 8. `KEEP_RECENT_TOOL_MESSAGES = 4`

Estimated contribution: the four retained payloads are ≈8k–18k chars per turn (fetch payloads observed at 4.9k–6.6k), i.e. roughly a third to half of context chars, ~4k–7k tokens per turn. They are **partly** redundant with the rolling state (source id, length, document status, summaries all reappear there), but they also carry the only literal excerpt text returned by that fetch, which the state re-surfaces only for the last 6 quotes × 520 chars.

Lowering the number would save real tokens but risks removing exact quotable text before the agent uses it — and would not address the turn count, which is the dominant term. **Not the right lever. No change recommended, no number changed.**

---

## 9. Served quotes

`QUOTE_LIMITS`: MAX_KEPT 24, MAX_CHARS 900, state re-surface 6 × 520 chars. Maximum possible quote contribution to the rolling state is therefore **3,120 chars (~1.4k tokens) per turn**, and observed state totals (4.4k–5.7k chars) confirm quotes are a minor, hard-bounded component. Quotes do persist after they stop being needed, but the FIFO cap makes that immaterial.

**Quotes are not a cost driver. No change recommended — the exact-text guarantee should stay exactly as is.**

---

## 10. Search and re-read behaviour

**Search.** Scoped searches are modest (4–8 per run) and mostly early. Two patterns worth naming:
* Q28: 8 web searches, 0 corpus/official, yielding 1 readable body — low-yield discovery, but each search is cheap relative to the re-read turns around it.
* Q18 steps 15–17: three raw searches issued *after* the first memo submission; they surfaced only a `chars=0` document. Legitimate alternate-source discovery in intent, unsuccessful in result.

No run issued a new search while a concrete untried acquisition candidate was waiting *and* ignored it — the orchestrator's `untried_acquisition_path` pointer is being followed (Q27 step 8, Q22 step 4→7, Q24 step 2). The acquisition orchestrator is behaving as designed.

**Re-reads.** The old ~84% re-read pathology **still exists and is now the top cost**: 61 already-read actions on 3 fetches (Q27), 42 on 3 (Q28), 35 on 8 (Q18), 31 on 6 (Q29). The existing suppression fires far too rarely — 6/61 in Q27, 9/42 in Q28, 0/31 in Q29 — because suppression keys on the exact tool-call signature (`toolCallKey`) and every re-read carries a freshly paraphrased `query`/`find`, producing a new key each time. Critically, `already_read` reads are deliberately **not charged to the fetch budget** (`researchAgent.ts:810`), so `StopPolicy` never constrains them; the run only ends when the *step* ceiling forces the memo.

Telemetry does not record per-read quote yield, so the fraction of those re-reads that produced a genuinely new served quote cannot be measured exactly from persisted data. The verified outcome bounds it: Q27 ended with 5 span-verified pairs and 2 footnotes after ~60 re-reads; Q28 with 8 pairs / 1 footnote after 42.

---

## 11. Repair behaviour

Repairs are **not** why these runs are expensive.

* Q27, Q28, Q29, Q22, Q23: `repair_cycles` 0, `temporal_repairs` 0.
* Q24: 1 repair cycle — fired on a central-coverage gap, added no new evidence, answer still delivered (1,843 chars, 1 footnote). **Reasonable-but-unsuccessful.**
* Q18: 1 temporal repair, plus a second memo turn driven by the pre-memo acquisition gate; `repair_skip_reason = central_gap_not_research_fixable` correctly prevented a further cycle. **High-value guard, working.**

The post-temporal-fix runs show the temporal repair path largely idle, consistent with the earlier fix. No recommendation to touch repair.

---

## 12. Model-call fixed overhead

Turn 1 of Q27 cost 2,921 prompt tokens with the full system prompt, tool specs, intake and a 5,707-char context — so the **fixed floor is ≈2.9k tokens per agent model call**, and the fixed + rolling-state floor is ≈4.5k–5k.

Fixed-overhead share: Q27 21 × 2.9k ≈ 61k of 305k (20%); Q28 ≈ 44k of 166k (26%); Q22 ≈ 23k of 67k (35%).

So: **even a perfect prompt-slimming exercise caps out at ~20–25% on the expensive runs, while removing the redundant turns removes 60%+. The answer to "smaller prompt or fewer model turns?" is unambiguously fewer model turns.**

---

## 13. Q27 deep dive

* Evidence complete at **turn 8** (cumulative 89,315 prompt tokens): S1 = רע"א 1239/19 judgment body, S2/S3 = חוק איסור לשון הרע §2. Both final footnotes come from these.
* Turns 9–20: forty-plus `already_read` calls against S1 and S2 with paraphrased search phrases, hunting for a terminal "סוף דבר" formulation of the share/like holding. Zero new bodies, zero new authorities.
* **205,031 prompt tokens (67%) spent after the last useful evidence.**
* Did later research improve the answer? No new source entered the final answer; the substance (share = publication under §2, like = not) was available from S1 by turn 8. At most the extra reads sharpened which literal span was quoted.
* Why didn't commit/stop finish earlier? `early_commit` was issued at step 8 and `stale_research` at 5 and 7 — all advisory text. `StopPolicy.checkTool` never blocked, because re-reads consume no fetch budget and the total search budget was untouched (4 of N used). The run ended only when the reserved-memo step ceiling forced `submit_research_memo` at step 21.

**Q27 is the cleanest signal of pure efficiency waste in the set.**

---

## 14. Q18 deep dive

Q18 is genuinely different and must be treated differently.

* ~60k tokens are **class B**: 403s on gov.il, a Supreme Court portal connection reset, `acquire case:630/78 → exhausted`, `case:53/86 → needs_discovery`, three raw searches. These are the very attempts that turned Q18 from limitation-only into a substantive answer.
* But the middle of the run (steps 7–13) is the same span-hunting pattern: 35 already-read actions across S1/S4/S5, four per turn, with only 4 suppressed.
* Genuine waste after evidence was found: roughly 90k tokens (class C), distinct from the 60k of reasonable failure.
* **Risk note:** aggressively shortening Q18 risks restoring the old give-up-too-early failure. Any stopping rule must key on *no-yield repetition*, never on elapsed turns or on "an authority failed". Productive persistence — new authorities, new URLs, new acquisition paths — must stay untouched.

---

## 15. Q28 variance (93k → 166k)

Cause identified, and it is **not** temporal and not random:

* A single 46,752-char body (S1) was fetched at **turn 2** and was the only readable body of the run.
* Turns 3–14 then issued **42 already-read actions against S1 alone**, 4–5 per turn, with 9 suppressions and 6 `stale_research` directives ignored.
* Secondary contributors: 8 web searches (0 corpus/official) with low yield, two `needs_discovery` acquisitions, one 403.
* Not caused by larger context (avg 21k chars, below Q27/Q29), not by repairs (0), not by chunk/resume (1 resume gap, 556ms).

Q28 is therefore **systemic inefficiency of the same class as Q27**, expressed as variance because the number of span-hunting turns the agent chooses to run is itself variable.

---

## 16. Q22 comparator (66.6k)

Why it is cheap, measured rather than assumed:

* It committed **one turn after** the last body landed (bodies S5 73,132 chars and S6 44,289 chars at turn 6; memo at turn 8) — post-evidence spend 12,647 tokens, all of it the memo call.
* Only **6** already-read actions in the whole run (vs 61 / 42 / 35).
* 8 turns vs 21, and a smaller average context (16,065 chars vs 27,891), partly because fewer turns means less retained transcript.
* Same tooling otherwise: it hit 403s, had an `exhausted` acquisition target, used raw web search (3 of 10 results fetched — the only run where raw search fed the answer), and still finished cheaply.
* 0 repairs; 5 span-verified pairs and 2 footnotes — i.e. **equal grounding density to Q27 at 22% of the cost.**

Q23 (88.5k, 8 turns, 2 no-op turns) corroborates the pattern.

---

## 17. Ranked bottlenecks

**1. HIGH — Unbounded no-yield re-reads of already-acquired bodies ("span hunting")**
*Evidence:* 61/42/35/31/24 already-read actions vs 3/3/8/6/4 real fetches; 67%/90%/71%/55% of prompt tokens spent after the last evidence turn; suppression fires on 6/61 and 0/31 because the call key changes with every paraphrase; `already_read` reads are not charged to any budget.
*Affected:* Q27, Q28, Q24, Q29, middle of Q18 — 5 of 6 expensive runs.
*Token impact:* ~60% of the excess, roughly 100k–190k per affected run.
*Risk of fixing:* Medium-low — must not sever access to exact quotable text.
*Benefit:* 2–3× cost and latency reduction on the expensive tail with no expected quality change.

**2. MEDIUM — Advisory-only commit discipline**
*Evidence:* `stale_research` issued 6× in Q28, 7× in Q18, and the loop continued to the step ceiling every time; `early_commit` in Q27 at step 8 preceded 13 more turns.
*Affected:* all expensive runs.
*Impact:* inseparable from #1 in practice — it is the reason #1 is not self-limiting.
*Risk:* Medium — a hard stop could truncate legitimate persistence (Q18).
*Benefit:* would make the existing signals bite.

**3. MEDIUM — Per-call fixed overhead × turn count**
*Evidence:* ~2.9k tokens fixed floor; 20–26% of expensive runs; 35% of Q22.
*Risk:* low but the ceiling of the gain is low too.
*Benefit:* secondary; largely absorbed by fixing #1.

**4. LOW — Low-yield scoped searching**
*Evidence:* Q28 8 web searches → 1 body; Q18 3 post-memo raw searches → 1 empty document.
*Benefit:* small; and constraining discovery risks the acquisition gains just shipped.

**5. LOW — Context/quote/compaction overhead**
*Evidence:* state 4.4k–5.7k chars, quotes hard-capped at ~3.1k chars per turn, context flat across turns, 300k chars saved by compaction in Q27.
*Benefit:* not worth changing before launch.

**6. LOW — Repair and chunk/resume overhead**
*Evidence:* 0 repair cycles in 5 of 7 runs; resume gaps ≤44s wall, no token re-send.

---

## 18. Single recommended next optimization

**Charge no-yield re-reads against the research budget, and count consecutive no-yield reads per source rather than per exact call signature.**

*What exactly should change:* today a fetch that resolves to `already_read` is exempt from `policy.note("fetch")` and its suppression keys on the exact `toolCallKey`, so paraphrased re-reads are both free and unrecognised. The change is to track, per source, consecutive targeted reads that produce **no new served quote**, and once that count passes a small threshold (a) treat further reads of that source as budget-consuming, and (b) escalate the existing `stale_research`/commit directive for that source specifically. A re-read that *does* yield a new quote resets the counter and stays free.

*What must remain untouched:* exact served-quote text and `QUOTE_LIMITS` (the agent must keep literal text to quote); `KEEP_RECENT_TOOL_MESSAGES`; verification, identity, evidence-admission, temporal, sufficiency and drafting logic; the acquisition orchestrator; all tool budgets and `max_agent_steps`; the first read of any source and every read that yields new text; discovery breadth.

*Expected token reduction:* Q27 305k → ~110–130k, Q28 166k → ~60–70k, Q24 154k → ~90k, Q29 209k → ~130k; roughly 40–55% on the expensive tail, near zero effect on Q22/Q23.

*Primary regression risk:* cutting off span hunting that would eventually have found the exact quotable span, producing a weaker `quoted_span` or a lost footnote — and, in Q18-shaped runs, an earlier give-up. Mitigated by keying strictly on *no new quote produced* and by leaving all genuine acquisition paths free.

*Targeted validation questions:* **Q27** (pure waste — expect large reduction, identical answer), **Q28** (variance case), **Q18** (persistence must not regress to limitation-only), **Q22** (must remain unchanged), **Q29** (grounding density must hold at 3 footnotes).

Not implemented.

---

## 19. Launch relevance

**NO — OPTIMIZE BEFORE FULL BENCHMARK BUT NOT A BLOCKER.**

Answer quality on the expensive runs is good (Q27, Q29, Q24 all substantive and footnoted; central issue covered in 4 of 6), and worst-case latency is ~230s wall with resumable chunking, which the product already handles. The cost is real — roughly 2–3× what the same answers need — and it is concentrated in one identified, narrow, low-blast-radius behaviour that affects most runs, so it is worth fixing before spending a full benchmark at inflated cost. It does not threaten correctness, safety or deliverability, so it does not block launch.

---

EFFICIENCY BOTTLENECK IDENTIFIED — READY FOR NARROW FIX

NO CODE CHANGED.
