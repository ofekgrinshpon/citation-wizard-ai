# pipeline_architecture_diagnosis_v1 — read-only

Scope: architecture diagnosis of `legal-research-v1`. No code changes, no new
runs. Evidence: `reports/internal-dogfooding-6/` (D1–D6, run 2026-08-22/23),
plus the deployed source under `supabase/functions/legal-research-v1/`.

Headline: **the pipeline is not broken — it is undifferentiated.** Every
question, from "what does section 12 say" to a six-facet constitutional memo,
walks the identical maximal path: full claim analysis → facet expansion →
multi-target retrieval → judgment body acquisition → verifier → six gates →
structured drafter → claim-source-match → footnote reconciliation. The heavy
path is correct for perhaps one query class in five. For the rest it buys
runtime, cost and failure surface with no answer-quality return, and its own
safety gates then strip the weakly-matched sources it produced, leaving the
thin, heavily-caveated answers seen in D1/D2/D4/D6.

---

## 1. Current pipeline map

Single linear path in `index.ts` (2,011 lines), one edge invocation per job.

| # | Stage | Module | Model | Notes |
|---|---|---|---|---|
| 0 | Auth, validation, credit consume, job row | `index.ts` | — | credits charged up front, refunded on early failure |
| 0b | Attachment extraction | `lib/attachments.ts` | — | uploaded judgment text becomes a priority candidate |
| 1 | Claim analyzer | `stages/claimAnalyzer.ts` | `gpt-5-mini` → `gpt-5` on escalation triggers A1/B1–B4 | emits claims, `required_roles`, `answer_intent.output_shape`, interpretation note |
| 1b | Research-mode classification | `stages/researchMode.ts` | deterministic | 7 modes; **planner-only influence today** |
| 1c | Claim facet expansion | `stages/claimFacetExpansion.ts` | deterministic registry + `AREA_LOCKS` | decomposes each claim into doctrinal facets — the main query multiplier |
| 2 | Query planner | `stages/queryPlanner.ts` | `gpt-5-mini` → `gpt-5` on C1–C5 | mode obligations audited deterministically |
| 2b | Required anchors | `stages/requiredAnchors.ts` | deterministic | appends statute-section / docket anchor queries |
| 3 | Retrieval | `localRetrieval.ts` + `perplexityRetrieval.ts`, raced under `RetrievalBudget` | embeddings + Perplexity | deadline 200 s default / 90 s specific-case; launch stop at 75 % |
| 3b | Specific-case fast lane | `specificCaseResolution.ts`, `courtFileUrls.ts` | deterministic | derived court URLs, text endpoints probed before PDFs |
| 4 | Source acquisition | `judgmentTextAcquisition.ts` (1,577 lines), `statuteTextAcquisition.ts` | fetch + sync extraction | governed by `pdfExtractionPreflight.ts` and the extraction ledger |
| 5 | Candidate pool | `candidatePool.ts` | deterministic | dedup (`docketAwareUrlKey`), cap 30 |
| 6 | Verifier | `verifier.ts` (1,136 lines) | LLM, per-candidate × per-claim | verdicts direct/partial/tangential/unrelated + subject-identity pass |
| 7 | Source gates | `sourceIntegrity.ts`, `sourceSufficiency.ts`, `sourceHierarchy.ts`, `metadataOnlyHoldingGate.ts`, `negativeExistenceGuard.ts`, `displayTitleHygiene.ts`, `namedDoctrine.ts` | deterministic | classification, citability, sufficiency refusal |
| 8 | Drafter V2 | `drafterV2.ts` (1,876 lines) | **`gpt-5-mini` by default** (`MODEL_FULL` only via harness header) | structured blocks + deterministic branches (docket / statute-section / canonical-quote / insufficient-sources) |
| 9 | Claim-source match | `claimSourceMatch.ts` | deterministic | drops refs whose source claim/area ≠ block claim/area; adds מגבלת ביסוס notice |
| 10 | Structured validation → footnote builder | `structuredValidation.ts`, `footnoteBuilder.ts` | deterministic | marker parse, orphan drop, renumber (footnote invariant) |
| 11 | Finalization | `index.ts` + `telemetry.ts` | — | qa_logs terminal row, job status, budget report |
| 12 | Fallbacks | `retrievalBudget.ts` guard, trace row, SQL stale-job reaper | — | `retrieval_interrupted_limitation` when the isolate dies |

Everything above runs for every question. There is no branch that skips
stages 3b/4/6 on cost grounds.

## 2. Query-type routing (what actually happens today)

`classifyResearchMode` already produces the right *label* — but the label only
reaches the **planner obligations**. Retrieval intensity, acquisition, verifier
scope, drafter shape and budget are identical across modes (the sole exception:
`specific_case` gets the 90 s deadline and the fast lane).

| Query type | Mode label today | Actual path | Verdict |
|---|---|---|---|
| Statute section | `statute_section_definition` | full path; statute acquisition + full case-law retrieval + verifier | over-served; statute text alone would answer it (D4) |
| Exact case | `specific_case` | fast lane → derived URLs → PDF preflight → docket limitation | closest to a real specialized path; mostly works |
| Doctrine explanation | `doctrine_explanation` | full path incl. speculative judgment acquisition | over-served and under-anchored (D1, D2) |
| Complex research memo | `case_law_synthesis` / `generic` | full path with facet multiplication | correctly sized, but the CPU sink (D3, D5) |
| Citation/footnote task | no mode — goes through the answer pipeline | full research path | badly over-served |
| Source-only | `pipeline_mode=sources_only` | shares stages 1–7, exits before drafter | already a partial specialized path, and the most reliable surface in the product |

Observation worth stating plainly: the **sources-only path is the existing proof
that specialization works.** It reuses the same retrieval and skips what it does
not need, and it is the mode users report as reliable.

## 3. Failure diagnosis from dogfooding 6

### D3, D5 — `retrieval_interrupted_limitation` (835 s, 825 s, zero output)
Both are broad multi-facet doctrinal questions with no docket. They therefore
get: default 200 s retrieval deadline, facet-multiplied query set, and
**speculative** judgment acquisition over many candidate judgments. The wall
clock deadline governs what may be *launched* and what network work is aborted;
it cannot preempt `extractDocumentText`, which is synchronous and
uninterruptible. The PDF preflight and the speculative ledger
(`MAX_SPECULATIVE_EXTRACTIONS_PER_RUN: 1`, 1.2 MB) bound *one* extraction well —
they do not bound the aggregate cost of a facet-expanded run that also does
embeddings, ~30 candidates × N claims of verifier calls, and post-extract
normalisation. The isolate exceeds CPU quota, nothing terminal is written, the
stale reaper closes the job. `cpu_or_stale: true`, `partial_retrieval: null`,
`extraction_ledger: null` in both records — i.e. the run died before the budget
report was persisted. This is an *architectural* failure: heavy path applied to
a question that never needed judgment bodies at all.

### D1 — 25 dropped refs, 18 tagged blocks, 1 surviving footnote
Facet expansion produced six constitutional facets; retrieval returned a wide
topical pool; the verifier passed enough of it as usable; the drafter cited it;
then claim-source-match dropped 25 of 26 refs with reasons
`unrelated_legal_area`, `claim_mismatch`, `commentary_in_substantive_block`. The
single survivor is a **gov.il press-collection page** (`spokmanship_court?skip=30`)
— a paginated listing, not a judgment. So the answer is model knowledge with one
decorative citation and a מגבלת ביסוס banner. The gates behaved correctly; the
retrieval never found the actual proportionality authorities (Bank Mizrahi, the
Basic Law limitation clause). Root cause: generic doctrinal retrieval, not
drafting.

### D2 — rabbinical/property contamination in a reasonableness answer
Same mechanism from the other side. Facet expansion + planner emitted queries
across adjacent public-law facets; the pool absorbed neighbouring-topic
material; claim-source-match flagged `unrelated_legal_area` (12 drops) but only
at ref level — the *prose* generated from those blocks stays. There is no gate
that removes a topic once it has entered the block plan. The surviving footnote
1 is a **private law-firm blog** (`toledano.co.il`) standing in for בג״ץ 5658/23,
which is precisely the `source_label_quality_v2_unread_sources` backlog item.

### D4 — statute-only but repetitive and awkward (252 s)
The statute-section detector and statute acquisition worked: nevo text for חוק
החוזים, one clean footnote. But the drafter still received a **13-block plan**
built for a full research memo, and with no case law it filled ~7 of those
blocks with variations of "case law is not presented here because no usable
judgments were found". Hence the repetition. There is also a raw language defect
in the output ("aquí" leaking into Hebrew prose) — a small-model artifact. The
block plan should have collapsed to statute text + scope + limitation. Wrong
*shape*, not wrong content.

### D6 — acceptable but thin and heavily caveated
Two footnotes, one of which is a bare `ע"פ 1776/06` with a `type=4` download URL
(unread body, generic label) and one a MoJ blob folder. Five refs dropped on
`claim_mismatch` with `block_legal_area: null` — the criminal-law facets were
never area-tagged, so the matcher could not confirm support and the drafter fell
back to hedged phrasing. Thin because retrieval surfaced two usable items for an
eleven-block plan.

**Common pattern across D1/D2/D4/D6:** the drafter is asked to fill a block plan
far larger than the evidence supports; the gates then strip most refs; the user
sees a long hedged answer with one or two weak citations. The gates are not the
problem — they are the only reason these answers are honest. The problem is
upstream: block plan size and retrieval breadth are not conditioned on the
question type or on how much citable authority actually exists.

## 4. Model problem or pipeline problem?

Context: the drafter and both planning stages currently run on **`gpt-5-mini`**;
`gpt-5` is reachable only via escalation triggers or a harness header. So there
is real headroom — but it is narrower than it looks.

| Failure | Classification | Reasoning |
|---|---|---|
| D3/D5 CPU death | **Not fixed by stronger model** — requires routing/retrieval change | CPU is spent in retrieval, extraction and verifier fan-out, before the drafter runs. A stronger drafter would raise cost and make it worse. |
| D1 weak grounding, 25 drops | **Not fixed** (retrieval), **partially helped** at planner | The authorities were never retrieved. A stronger *planner* would write better anchor queries; a stronger drafter cannot cite what is not in the pool. |
| D2 topic contamination | **Partially helped** | GPT-5.5-class reasoning would likely reject off-topic blocks. But the durable fix is area-locked retrieval and a block-level topical gate. |
| D4 repetition / awkward Hebrew | **Likely fixed by stronger model**, and fully fixed by shape routing | Repetition is a small-model padding artifact against an oversized block plan; the "aquí" leak is pure model quality. |
| D6 thinness | **Partially helped** | Better facet area-tagging and retrieval would help more than better prose. |
| Weak source labels (all runs) | **Not fixed** | Deterministic hygiene + reading the body; already tracked as `source_label_quality_v2_unread_sources`. |

Score: of six recurring defects, **one** is mainly a model problem, two are
partially model, three are structural.

## 5. Recommended redesign — router + specialized paths

Keep everything that works. All seven protected gates are path-independent and
stay wired into every path that can produce an answer:

footnote rendering invariant · metadata-only holding gate · claim-source-match ·
docket limitation · canonical quote registry · PDF extraction preemption ·
terminal fallback (budget guard + trace row + reaper).

The change is **one new decision point and five budget/stage profiles**, not a
rewrite. `classifyResearchMode` already computes the label; promote it from a
planner hint to a **pipeline router** that selects a profile controlling:
retrieval breadth, whether speculative judgment acquisition runs at all,
verifier fan-out, drafter block-plan ceiling, and wall-clock budget.

```text
question ─▶ analyzer (shape + claims) ─▶ ROUTER ─┬─▶ A statute_first
                                                 ├─▶ B exact_case      (exists)
                                                 ├─▶ C doctrine_explainer
                                                 ├─▶ D research_memo   (today's path)
                                                 └─▶ E citation_only
                        all paths ─▶ shared gates ─▶ footnote builder ─▶ finalize
```

**A. statute_first** — trigger: statute section detected, shape=definition.
Statute text acquisition first; case law only as a bounded second pass (≤ 2
queries) and only if the section text was acquired. **No speculative judgment
acquisition.** Drafter block ceiling ~5; blocks with no evidence are *omitted*,
not filled with "not presented here". Fixes D4.

**B. exact_case** — unchanged. Fast lane, derived court URLs, preflight, docket
limitation. Already the best-behaved path.

**C. doctrine_explainer** — trigger: shape=definition/analysis, no docket, no
section. Facet expansion capped (≤ 3 facets) with hard area locks; retrieval
biased to statute + binding case law; speculative acquisition limited to the top
2 ranked judgment candidates; verifier only on candidates whose facet area
matches. Drafter must either produce an anchored block or drop it. Fixes D1/D2
breadth and prevents the D3/D5 class of blow-up.

**D. research_memo** — today's full path, but entered **only** on explicit memo
signals (multi-part question, synthesis cues, explicit "memo/סקירה מקיפה"), with
its own longer budget and an up-front user-visible expectation that it is slow.

**E. citation_only** — citation/footnote formatting tasks bypass retrieval,
verifier and drafter entirely; deterministic citation engine + footnote builder.

Existing `sources_only` remains as it is; it is effectively path F.

## 6. Cost and risk per path

| Path | Expected runtime | AI cost | Retrieval intensity | Risk of weak answer | Refuse / limit when |
|---|---|---|---|---|---|
| A statute_first | 30–60 s | Low (analyzer + short drafter) | Statute acquisition + ≤2 case queries | Low — statute text is deterministic | Section text not acquired → `statute_section_limitation` |
| B exact_case | 60–150 s | Low–medium | Derived URLs only, no broad web | Low; refuses cleanly | No usable body for the requested docket → `docket_limitation` / `exact_case_body_unavailable` |
| C doctrine_explainer | 60–120 s | Medium | ≤3 facets, ≤2 speculative acquisitions | Medium — depends on anchor retrieval | Zero direct-support primary anchors → `insufficient_sources_limitation` |
| D research_memo | 200–400 s | High (facet × verifier fan-out dominates) | Full | Medium–high | Budget guard fires → partial-retrieval disclosure; never silent death |
| E citation_only | 5–20 s | Very low | None | Very low | Unresolvable citation → explicit unresolved marker |

Cost note: today **every** query pays path D. On the dogfooding set, D4 (a
statute question) burned 252 s and D3/D5 burned ~14 minutes each for zero
output. Routing D1/D2/D4/D6 to A/C would cut that set's runtime by roughly half
and its AI spend by more, before any quality gain.

## 7. Recommendation

**Should we delete the pipeline and restart?** No. The deterministic layer —
gates, footnote invariant, docket limitation, PDF preemption, terminal
fallback — is the hard-won part and is working: across all six dogfooding runs
there were zero dangling markers, zero orphan source rows, zero fabricated
citations, and every non-crashed run was honestly caveated. That is the
expensive asset. Discarding it to chase prose quality would be a large step
backwards.

**Should we mostly keep it and add routing?** Yes. This is the recommendation.
The single highest-leverage change is promoting the already-computed research
mode from a planner hint to a real router with per-path retrieval, acquisition
and drafter-shape budgets. It addresses the two total failures (D3, D5), the
shape defect (D4), and most of the breadth/contamination defects (D1, D2)
without touching a single gate.

**Should we switch to GPT-5.5?** Not as the answer to these failures — three of
the six are structural and one would get *worse* with a more expensive drafter
on the current unbounded path. But note the pipeline is running the **mini**
model in the drafter today, which is almost certainly under-specified for
Hebrew legal prose (the D4 "aquí" leak and the D4/D2 repetition are typical
small-model artifacts).

**Where should GPT-5.5 be used, if anywhere?** In this order:
1. **Drafter, on the light paths first (A, C).** Short block plans, small
   context, bounded cost — the place where prose quality is the binding
   constraint and the cost delta is smallest.
2. **Query planner.** Better anchor queries are the direct fix for D1's missing
   primary authorities, and the planner is a single cheap call.
3. **Not the verifier.** It is the fan-out stage; a stronger model there
   multiplies cost and CPU across ~30 candidates and makes D3/D5 more likely.
4. **Research memo drafter — only after routing lands**, so the heavy model runs
   on a path that is explicitly opted into and budgeted.

Sequence: router + path budgets first (structural, unblocks the crashes), then
model upgrade on paths A and C, then re-run the dogfooding six as the before/
after comparison.
