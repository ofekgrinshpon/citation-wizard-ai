# legal_research_v2_core_bottlenecks_v1 — Acceptance Report

Scope: the four shared bottlenecks identified by the five-question value test.
V1 untouched, V2 still internal-only, no production traffic routed.

## 1. What changed

### A. Commit discipline (agent holds evidence but never submits a memo)
- `agent/stopPolicy.ts` — reserves 20% of the step budget (min 2, max 6) for memo
  synthesis. Once `researchStepLimit` is passed, `checkTool` closes every research
  tool (`research_phase_closed`) and the agent is called with
  `tool_choice: submit_research_memo`. Serializable (`toJSON` / `fromJSON`).
- `agent/commitPolicy.ts` — deterministic, once-only directives appended after a
  tool round: `named_authority_ready` (every explicitly named docket/statute has a
  read body), `early_commit` (≥3 readable documents), `stale_research`
  (2 rounds with no new evidence), `mandatory_commit` (research capacity spent).
  It says *when to consider committing*; the agent still judges sufficiency.

### B. Token / context cost
- Bodies never enter the conversation. `EvidenceStore` keeps the full text
  server-side and exposes `summary` + bounded `excerpt()` windows.
- `tools/fetch.ts` returns a summary, a 1,400-char head and ≤3 × 1,200-char
  windows, hard-clamped to 6.5 KB per response (was up to 60 KB).
- `fetch({source_id, query})` re-reads a specific part of an already-read
  document — no HTTP, no fetch budget, no fourth user-facing tool.
- An already-read URL returns the stored entry with an explicit
  "do not fetch this again" instruction; repeated calls of any tool get a
  repetition warning (`CommitTracker.noteToolKey`).
- After each round the agent receives a one-line-per-source evidence ledger,
  so context stays flat instead of growing with every document.
- Telemetry added: `prompt_tokens_per_call`, `max_prompt_tokens_single_call`,
  `largest_tool_response_chars`, `evidence_context_chars_last_turn`,
  `repeated_tool_calls_prevented`, `commit_directives`, `chunks_executed`,
  `acquisition_ledger`.

### C. Judgment acquisition
- `tools/acquisitionLedger.ts` — per-authority attempt ledger (URL, outcome,
  reason). It returns short guidance after repeated failures ("do not repeat
  these paths; look for a mirror copy") and marks an authority as acquired once
  a body with matching identity is read. It ranks and fetches nothing.
- Corpus wiring bug fixed: `search_legal_chunks_text` builds its own tsquery from
  plain words, but V2 was handing it a full tsquery *expression*. It now receives
  normalized plain terms plus any detected docket. (Read-only probe first:
  21,542 documents / 512,338 chunks, expression form scored ~0.113 on unrelated
  hits, plain terms ~0.15–0.166 on relevant ones.)

### D. Long runs vs. edge-worker lifetime
- The research loop is chunked (`maxStepsThisChunk`, `deadlineAt`) and fully
  serializable (messages, policy, discovery, evidence store, commit tracker,
  acquisition ledger, trace, stats).
- A chunk that ends without a memo persists state and self-invokes once to
  continue in a fresh worker; bounded by `MAX_CHUNKS = 8`, and the next hop fires
  only when research actually remains.
- After the first literature run was killed by "CPU Time exceeded" mid-chunk,
  a **per-step checkpoint** was added, and a run left `running` with a checkpoint
  is resumable from its last completed step. PDF extraction bound tightened to
  24 pages / 12s per document.

### E. Title / citation hygiene
- `shared/titleHygiene.ts` strips Knesset internal numbers in both text
  directions ("מספר פנימי: 2233595" and the RTL-reversed "2232480 : פנימי מספר"),
  prefers a real body title over a filename, and is applied at store time and at
  citation render time.
- Internal evidence ids ("S1") can no longer leak into footnote text.

## 2. Acceptance runs (live, one run each)

| Run | Question | Result | Steps | Chunks | Docs read | Verified claims | Citations | Prompt tokens (max single call) | Latency |
|---|---|---|---|---|---|---|---|---|---|
| B1 | בג"ץ 1000/92 בבלי — named case | **answered** | 11 | 2 | 3 (2 readable) | 2 | 1 | 87,583 (16,748) | 78 s |
| B2 | HCJ review standard, rabbinical court / property | **answered** | 23 | 3 | 2 | 3 | 2 | 343,471 (31,023) | 168 s |
| B3 | סקירת ספרות על עילת הסבירות | **answered** (after CPU-kill on first attempt) | 17 | 2 | 4 | 1 | 1 | 166,813 (18,549) | 116 s |

Invariant errors: **0** across all three. Fabricated citations: none.
All three previously produced either an honest refusal (B1, B2) or nothing at
all (B3 — both original attempts died with the worker).

Commit directives that fired: B1 `stale_research`, `named_authority_ready`;
B2 `mandatory_commit`; B3 `early_commit`, `stale_research`.

### Answers (verbatim, abbreviated to the substantive text)

**B1 — Bavli.** Establishes that the rabbinical court must apply Israeli civil
law including the community-property presumption in spousal property matters,
and that the presumption means equal division of jointly-earned property
regardless of formal registration absent contrary intention. One footnote to a
judgments.org.il copy of the judgment (court egress to supremedecisions failed
again and is recorded in the acquisition ledger).

**B2 — review standard.** Non-intervention as the baseline; HCJ is not an appeal
instance; intervention where the rabbinical court departs from binding precedent
requiring civil law in property matters joined to divorce; civil law does not
retroactively punish infidelity by stripping property rights, though infidelity
may bear on whether sharing crystallized in a specific asset; and where civil
rhetoric merely wraps a religious/punitive consideration ("lip service"), that is
an extraneous consideration justifying intervention. Two footnotes
(supremedecisions PDF of the ruling; דנג"ץ 8537/18 via afiklaw).

**B3 — literature review.** Identifies בג"ץ דפי זהב as the case that established
the expansive use of the reasonableness ground, Barak's formulation of
unreasonableness as an independent ground of invalidity (relevant considerations
weighted improperly), and the Landau/Barak disagreement over the scope of
judicial intervention. One footnote — Hebrew Wikipedia.

## 3. Verification invariants

- No claim was cited without a verified, verbatim span from a fetched body.
- 0 invariant errors, 0 unsupported core claims in the published answers.
- The trust model was not touched: identity, span, support and source-id checks
  are unchanged.

## 4. Remaining blockers

1. **Official court egress still fails.** `supremedecisions.court.gov.il` search
   remains unreachable from the function (recorded per-authority in the
   acquisition ledger); B1 was answered only from a mirror.
2. **Literature depth is still shallow.** B3 completed for the first time, but
   cited a single encyclopedic source. Scholarship acquisition (journal PDFs) is
   heavy and CPU-bound; the 24-page/12s bound protects the worker at the cost of
   depth. This is the next real track, not a bottleneck fix.
3. **Some display titles are still poor** where the source itself has a bad
   title ("המאגר המשפטי הטוב בישראל ובחינם ⚖️") or where an RTL PDF header
   extracts reversed ("העליון המשפט בבית"). Internal-ID leakage is fixed; word
   order recovery is not attempted deterministically.
4. **Chunk self-invocation is untested under load** — one hop per pause, bounded
   at 8 chunks; no queue, no scheduler.

## 5. Production-hardening recommendation

Before V2 takes any real traffic:
- move run state off the eval table onto a proper jobs table with an owner,
  a single-flight lease and a paused/failed state surfaced to the app;
- add circuit-breaker handling for gateway `402`/`403` at the job entry point;
- cap total model spend per run (B2 already used ~343k prompt tokens);
- resolve court egress or formally accept mirror sources as first-class;
- keep V2 internal until literature-scale acquisition is addressed.

## 6. Tests

`src/test/legalResearchV2.bottlenecks.test.ts` — 18 tests covering reserved memo
capacity, research-phase closure, policy serialization, each commit directive
(including once-only behaviour), repeated-call keys, the acquisition ledger,
title hygiene in both RTL directions, evidence-store excerpting and round-trip,
fetch payload clamping, and citation id leakage.
Full suite: 47 files / 529 tests passing; Deno typecheck clean; V1 unchanged.
