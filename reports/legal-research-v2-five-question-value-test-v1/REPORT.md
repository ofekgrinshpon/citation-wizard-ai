# legal_research_v2_five_question_value_test_v1

Frozen evaluation of the deployed `legal-research-v2` vertical slice. V1 was not run and not modified.

## 0. Pre-test fixes applied (only the three permitted)

1. Background execution for evaluation runs (`background: true`, results persisted to internal `v2_eval_runs`, HTTP 202 + poll) — avoids the ~150s synchronous limit.
2. Per-run fetch dedupe: normalized URL key (fragments + tracking params stripped, query preserved as identity); a repeat fetch is served from the evidence store and does not consume fetch budget unless `refetch_reason` is supplied.
3. HTML entity decoding (`&#039;`, `&quot;`, `&amp;`, numeric/hex) in extracted text and display titles.

No prompt, tool, budget, verifier, citation, embedding, egress, frontend or V1 change was made before or during the test.

## 1. Questions

| ID | Category | Question |
|----|----------|----------|
| Q1 | Natural doctrinal | בסוגייה של חלוקת רכוש לאחר גירושי בני זוג, מה היא אמת המידה לביקורת שיפוטית של בג״ץ כאשר יש חשד שבית הדין הרבני הסתמך על שיקול חיצוני לדין האזרחי? |
| Q2 | Named case | מה נקבע בבג״ץ 1000/92 בבלי נ׳ בית הדין הרבני הגדול בסוגיית הדין החל על חלוקת רכוש בין בני זוג? |
| Q3 | Statute/section (existing fixture Q21) | מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים או הפסקת כהונה? |
| Q4 | Complex synthesis (existing fixture Q-extort) | סחיטת דמי חסות — היקף האחריות הפלילית והאזרחית בישראל |
| Q5 | Literature (existing P1) | תעשה לי סקירת ספרות על עילת הסבירות |

One normal run each. Q5 was retried once: the first run's worker terminated without ever writing a result row (platform-side background-task termination, not a model or logic failure). The retry terminated the same way. Both are reported.

## 2. Run outcomes

| Run | Status | Latency | Docs read | Research claims | Verified claims | Cited sources | Footnotes | Invariant errors |
|-----|--------|---------|-----------|-----------------|-----------------|---------------|-----------|------------------|
| Q1 | refusal | 144s | 3 | 0 (`agent_step_budget_exhausted_without_memo`) | 0 | 0 | 0 | 0 |
| Q2 | refusal | 209s | 4 | 0 (`agent_step_budget_exhausted_without_memo`) | 0 | 0 | 0 | 0 |
| Q3 | answered | 67s | 1 | 2 | 1 (+1 correctly rejected) | 1 | 1 | 0 |
| Q4 | answered | 174s | 6 | 3 | 3 | 3 | 3 | 0 |
| Q5 (run 1) | infrastructure failure | never returned | — | — | — | — | — | — |
| Q5 (retry) | infrastructure failure | never returned | — | — | — | — | — | — |

## 3. Per-question analysis

### Q1 — natural doctrinal: FAILED (honest refusal)

Answer: a clean refusal stating no verified material was available. Nothing invented, nothing miscited.

Trace: 8 searches (3 corpus → 0 results each, 3 web, 1 official, 1 academic), 5 lookups, 11 fetches. Bavli was located by the registry, but every canonical path failed: `supremedecisions.court.gov.il` → egress connection errors, Nevo HTML/DOC/PDF → HTTP 500/404, Versa PDF → 404. Only three bodies were read (an unrelated 80k court document, a 2.2k "page not found" doc, and the Hebrew Wikipedia entry). The agent then exhausted its 30 steps re-fetching already-cached sources and never submitted a memo.

Earliest breaking stage: **acquisition** (canonical judgment text unreachable), compounded by **agent step exhaustion** — with dedupe now free, the agent burns steps on repeats instead of stopping.

### Q2 — named case: FAILED (honest refusal)

Same failure mode with a much better start: it read the Daat article (69k chars) and a judgments.org.il copy (78k chars) of Bavli in its first three steps. It then spent the remaining 27 steps on web searches and deduped re-fetches of documents it had already read, and never called `submit_research_memo`. The material to answer this question was in hand; the agent simply never committed.

Earliest breaking stage: **research agent loop/termination policy**. Not verification, not drafting.

### Q3 — statute: PASSED

One fetch of the Nevo text of חוק שירות המדינה (מינויים) produced a verbatim span of section 17. The answer correctly tells the user that section 17 has nothing to do with dismissal — it governs the form of appointment — and explicitly flags that the dismissal rule (s. 46א) was not evidenced. The verifier rejected the second claim (`span_not_found`) and the drafter honoured that rejection instead of asserting it. This is exactly the intended behaviour: correct, narrow, and honest about its own limits.

### Q4 — complex synthesis: PASSED (strongest run)

Six bodies read from Knesset official sources; three claims, all verified with verbatim spans, three footnotes. The answer covers the s. 428א offence tiers (6/7/9 years), the mandatory criminal and civil forfeiture mechanisms in 428ב, and the absence of a dedicated compensation scheme with the two pending bills and the tort route. Weaknesses: it is legislation-only (no case law, no scholarship — court egress and corpus are dead), and two footnote labels are raw Knesset document artefacts ("מספר פנימי: 2233595", "2232480 : פנימי מספר") rather than real citation titles.

### Q5 — literature: INFRASTRUCTURE FAILURE

Neither the original run nor the single permitted retry ever wrote a result; the background worker was terminated before completion (literature runs exceed the platform wall-clock budget for a background task). No answer, no telemetry. The current slice cannot complete a literature-scale run at all.

## 4. Cross-run findings

1. **Verification works.** Zero invariant errors, zero fabricated citations, zero unverified source IDs in five runs. Every footnote traces to a verbatim span in a fetched body. The one rejected claim (Q3/C2) was rejected for the right reason and correctly demoted in the prose.
2. **Refusal is honest, not evasive.** Q1 and Q2 refused rather than bluffing. That is the desired failure mode, but it is a product failure for the user.
3. **The binding constraint is acquisition, not architecture.** Israeli judgment text is effectively unavailable: court.gov.il rejects edge egress, Nevo returns 500/404, corpus search returned 0 results on every call. Statute and Knesset material fetch fine — which is precisely why Q3 and Q4 succeeded and Q1/Q2 did not.
4. **The agent's stop/commit policy is weak.** Two of five runs died on step exhaustion without a memo, one of them (Q2) while holding sufficient material. Fetch dedupe removed the cost of repetition without removing the temptation, so repeats now consume steps instead of budget.
5. **Cost/latency.** Q2 consumed ~1.02M prompt tokens over 31 model calls for zero output. Tool payloads are re-sent in full on every turn; this is the dominant cost driver.
6. **Presentation is mostly clean** but source labels derived from official document headers still leak internal artefacts.

## 5. Decision

**B — promising, but needs targeted work before it becomes the primary architecture.**

The trust layer is genuinely good and is the hardest part to build; it already does what V1 spent many tracks approximating. Two of five questions produced answers a lawyer could use, with fully traceable citations and no hallucination. But three of five produced no usable output, and the reasons are narrow and identifiable rather than architectural:

- judgment-text acquisition (egress/mirrors) — the single largest value blocker;
- an agent commit/stop policy that submits a memo before the step budget dies;
- a run-completion path that survives literature-scale workloads;
- context/token management so long runs are affordable.

None of these require redesigning the six-component architecture. Recommend continuing to build ReLex on this engine, with acquisition as the next track.
