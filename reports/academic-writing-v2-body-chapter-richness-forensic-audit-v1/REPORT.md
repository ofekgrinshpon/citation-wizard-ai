# academic_writing_v2_body_chapter_richness_forensic_audit_v1

READ-ONLY. No code, prompt, model, budget, verifier or routing change. No rerun.

## 1. Research trace

- job_id: `1bc191ba-1c9a-4f06-a2e8-ed206e399d5f` — run_id: `c330801c-1751-453e-97ff-f847e1e3fcc9`
- Research Agent: GPT-5.6 Terra (V2 beta default); verifier/drafter: Gemini
- latency 226,760 ms; 14 agent steps in 2 chunks; 16 model calls; 117,624 prompt / 10,376 completion tokens
- phase_ms: agent_model 150,818 · search 50,760 · drafting_model 15,482 · verification_model 3,860 · fetch 2,972 · lookup 226 · resume_gap 646
- tool budget used: 8 searches (official 3, web 2, corpus 2, academic 1), 4 network fetches, 6 lookups
- turn shape: t1 search → t2 fetch (new evidence) → t3 fetch (new evidence) → **t4–t13: ten consecutive no-op turns** (tool_ms 0–95 ms; already-read re-reads / lookups; `added_evidence:false`) → t14 `submit_research_memo`
- 81 already_read actions; 24 no-op re-reads suppressed; 26 repeated tool calls prevented; 94 context compactions (191,042 chars saved)
- section retrieval: 75 targeted reads yielded a window, 5 came back missing; 0 sources marked exhausted
- commit directives issued: `step3:early_commit` (developed wording), `step5:stale_research`. Commit was the agent's own decision at step 14 — not a mandatory stop (steps and budgets were not exhausted: 4/12 fetches, 8/8 searches used).

## 2. What the agent tried to build

Research memo produced 4 research claims; 1 verified, 3 unsupported. Its own `unresolved_questions` name the intended dimensions:

1. statutory structure — ss. 2–6, 8, 9, 11 (scope, agreement validity, property separation during marriage, half-value right and its exclusions, mode of balancing, "special circumstances" deviation power, preservation remedies);
2. the doctrinal distinction between deferred obligatory balancing and proprietary co-ownership, incl. third parties and single-name assets ("core issue for the research question");
3. case law — BAM 4623/04 on career assets / earning capacity / s. 8;
4. academic scholarship and competing positions (critique of the separation-plus-deferred-balancing model, scope of s. 8);
5. current consolidated text of the law before any statement of present law.

So the agent planned a genuinely chapter-sized foundation. It failed to convert any of it into citable evidence except the 2008 Amendment 4.

## 3. Source funnel

| id | source | disc. | fetched | readable | identity | temporal | span | support | pack | cited |
|----|--------|-------|---------|----------|----------|----------|------|---------|------|-------|
| S1 | gov.il PDF, חוק יחסי ממון 1973 | yes | **no (HTTP 403)** | – | – | – | – | – | no | no |
| S2 | fs.knesset.gov.il/17/law/17_lsr_300050.pdf — תיקון מס' 4, 2008 | yes | yes | yes | pass | pass | pass | supports_partially | yes | **yes** |
| S3 | nevo.co.il/law_html/law00/72138.htm — consolidated 1973 law | yes | yes | yes (`acquired`, identity matched in ledger) | **fail at claim level** | – | **fail** | – | no | no |
| S4 | supremedecisions — בע"מ 4623/04 | yes | yes | yes (`acquired`) | **fail at claim level** | – | **fail** | – | no | no |

Aggregate: 9 evidence pairs, 9 identity-verified, **1 span-verified**, 1 support verdict (`supports_partially`), 0 `supports`. `primary_unreadable: []`, `unresolved_authorities: []`, `repair_cycles: 0`, `repair_skip_reason: narrowable_to_verified_propositions`.

Not pursued at all: no scholarship was acquired (single `academic` search, nothing fetched); no case law beyond BAM 4623/04 was opened.

## 4. Statute acquisition

- The academic chapter ran on the **same** current V2 fetch path — targeted-section retrieval was present and used heavily (75 yielding section reads).
- The consolidated law was **not** an acquisition failure at the HTTP level: gov.il returned 403, but Nevo (S3) was fetched, passed `checkIsActualDocument`, and was recorded in the acquisition ledger as `body_read_with_matching_identity`.
- The failure was **downstream**: spans the memo attributed to S3 (and S4) did not survive `matchSpan` — 8 of 9 evidence pairs died at the verbatim-span check. The agent's own note ("S3 נקרא, אך לא חולצו בפלט חלונות טקסט שניתן להעתיק מהם במדויק") matches: it never got quotable literal text out of the Nevo HTML extraction, then re-read S3 ten times without changing that.
- Not a wiring difference with normal V2, not a stale path, not a truncation ceiling (text was well under `MAX_TEXT_CHARS`).

## 5. Research breadth — cause ranking

Primary: **A + C**, in that order, with an E component.
- A/E hybrid: the consolidated statute body was in hand but not quotable, so verification rejected it (8/9 pairs). That is the earliest hard failure.
- C: after that failure the agent spent turns 4–13 re-interrogating the same three documents (81 already_read actions, ten no-op turns, ~80 s of model time) instead of pivoting to scholarship or further case law. It behaved like a stalled focused Q&A, not like chapter-scale research.
- Not B (it did not stop early — it stopped late, after ten empty turns), not D (searches did surface primary and case-law material), not F (context was framing only), not G (fetch/lookup budgets unspent), not H.

## 6. Drafter

The drafter received exactly one verified proposition (Amendment 4, `supports_partially`) plus the unresolved list. 1,585 chars is an honest ceiling for that pack; more text would have required unsupported padding. The chapter correctly discloses the unverified consolidated text. No drafter fix is warranted.

## 7. Project context

Bounded context was passed (chapter index 2, title "חוק יחסי ממון ואיזון המשאבים", research question "האיזון בין קניין בן זוג לעקרון השיתוף בפירוק נישואין", outline, prior-chapter memory on חזקת השיתוף, empty source registry — this was the first V2 chapter, `project_id: null`). Nothing in it constrained the chapter, and no existing project source was available-but-ignored.

## 8. Writing guide

`guide_version: body-v1` was injected. Prose is genuinely academic: third person, no process reporting, argument-led opening, honest limitation paragraph. This is a **research-richness** problem, not a writing-quality problem.

## Conclusions

1. Earliest root cause: the consolidated statute (S3) and the judgment (S4) were read but yielded no verbatim-quotable spans, so 8 of 9 evidence pairs failed the span check and only Amendment 4 survived.
2. One citation because only one source produced a span the verifier could match.
3. ~1,585 chars because a one-proposition pack honestly supports nothing longer.
4. The architecture is sound — verifier, ledger, section retrieval, context discipline, refusal honesty and the academic wiring all behaved as designed.
5. Both, but weighted: an **extraction/quotability fix first**, then an agent-depth fix (stop re-reading a body that has already failed to yield quotable text; pivot to scholarship/case law).
6. Smallest next track: `v2_quotable_span_extraction_and_pivot_v1` — make read windows return text in the exact form the span check compares against (Nevo HTML / court PDF normalization at store time), and mark a source no-yield-for-quoting after N failed span attempts so the agent pivots instead of looping.
7. Yes — Introduction and Conclusion should wait. They depend on the same evidence pipeline and would reproduce the same thinness.
