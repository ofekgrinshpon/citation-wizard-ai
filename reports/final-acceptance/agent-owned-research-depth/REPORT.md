# Agent-Owned Research Depth — acceptance report

## 1. Previous architecture (removed)

`buildIntake()` ran a deterministic Hebrew regex classifier (`classifyDeliverable`, `DEVELOPED_CUES`)
producing `Intake.deliverable: "focused" | "developed"`. That label then reached the research
control path: the early-commit directive text, the agent user message, the context-window header,
and (for Academic Writing) a forced `"developed"` assignment whenever `academic_context` existed.

Two structural failures: a semantically broad question without a cue word was labelled `focused`
(false shallowness), and a narrow question containing `סמינריון`/`פרק` was labelled `developed`
(false depth).

## 2. Removed dependencies

| File | Change |
| --- | --- |
| `agent/deliverable.ts` | DELETED (`DeliverableKind`, `DEVELOPED_CUES`, `classifyDeliverable`). |
| `types.ts` | `DeliverableKind` type and `Intake.deliverable` removed. |
| `index.ts` | classifier import removed; `buildIntake()` no longer assigns a deliverable; `academic_context` no longer forces `"developed"`. |
| `agent/commitPolicy.ts` | `CommitSignals.deliverable` removed; `EARLY_TEXT_FOCUSED` / `EARLY_TEXT_DEVELOPED` merged into one universal `EARLY_TEXT`; `namedText()` rewritten. |
| `agent/prompt.ts` | conditional depth branch in `buildAgentUserMessage` and the depth/scope bullets replaced by agent-ownership instructions. |
| `agent/researchAgent.ts` | `deliverable` no longer passed to `commit.directive()`. |
| `agent/contextWindow.ts` | deliverable-based `"תוצר מבוקש"` line removed. |
| `src/test/legalResearchV2.deliverable.test.ts` | DELETED. |
| `src/test/quotableSpanExtraction.test.ts` | stray `deliverable` field removed. |

Old serialized/resume state carrying an extra `deliverable` key is simply ignored — nothing reads it,
nothing validates against it, paused jobs resume unchanged.

## 3. Research Agent autonomy instruction

The system prompt now states that the agent is the owner of research scope: depth and breadth follow
the substance of the request and not trigger words or an externally assigned mode; a narrow
authority/statutory question may be resolved on a small number of strong sources; a broad, synthetic,
historical, comparative, theoretical or contested request may require several research directions,
scholarship, primary law and competing positions; sufficiency is reassessed as evidence accumulates
(expand if research reveals the issue is broader, stop when the actual product is supported);
explicit user instructions about scope, sources, period or jurisdiction are part of the request and
are respected semantically; tool budgets are safety ceilings, not targets.

`buildAgentUserMessage` now appends one neutral, label-free instruction to every request: assess the
research scope the request itself requires, decide which dimensions and source types are needed, and
continue only while a concrete substantive research need remains.

No replacement classifier of any kind was introduced — no regex, keyword list, heuristic, extra model
call, source quota, or renamed label. No intake-model call was added.

## 4. Commit policy

- **Early commit** (unchanged deterministic trigger, `readable_count >= 3`, once per run): one
  universal text stating that the number of documents read says nothing about sufficiency, asking the
  agent to reassess the actual request against the evidence in hand, submit if every material
  dimension is supported, otherwise name one concrete substantive gap and research toward it.
- **Named authority ready**: now says the explicitly named authority has been acquired and requires
  reassessment of the complete request; submission only if that authority plus the other evidence
  covers the whole task. It no longer instructs the agent to stop discovery.
- **Anti-loop + mandatory commit**: unchanged. Repeated-call warnings, stale-research signals and the
  hard mandatory commit at the end of the research budget remain resource/repetition controls only.

## 5. StopPolicy

Unchanged: `DEFAULT_BUDGETS` remain hard ceilings, research steps bounded, memo capacity reserved.
No budget is raised or lowered based on how a question "looks".

## 6. Compatibility

- **Academic Writing**: the forced `developed` label is gone. The chapter run still passes the real
  academic project context (research question, outline, chapter title, chapter instructions, prior
  context) to the agent, which is the semantic depth signal. No redesign; still feature-flagged.
- **Source Search** (`output_mode: "sources"`): its own contract and `SOURCE_SEARCH_BUDGETS` are
  untouched; its tests pass unchanged.
- **Drafter**: handoff untouched — verified-pack drafting architecture unchanged in this task.

## 7. Tests and typecheck

New `src/test/agentOwnedResearchDepth.test.ts` (7 tests): no classifier symbols or `deliverable ===`
branches anywhere in the V2 production path; the agent user message is byte-identical for
`סמינריון`-flavoured, `סקירת ספרות`-flavoured and plain narrow questions (only the question text
differs); the system prompt asserts scope ownership, semantic depth, reassessment and
ceilings-not-targets; the early-commit directive carries the "count is not sufficiency" language; the
named-authority directive demands full-request reassessment; mandatory commit still fires at budget
end.

Full suite: **82 files / 972 tests passing**. `tsgo --noEmit`: clean. Deployed `legal-research-v2`.

Static audit after implementation: no `classifyDeliverable`, `DEVELOPED_CUES`, `DeliverableKind`,
`EARLY_TEXT_FOCUSED`, `EARLY_TEXT_DEVELOPED`, or `deliverable ===` remains. Remaining hits are
comments in `index.ts`, `types.ts` and `sources/contract.ts` using the word "deliverable" to describe
the source-search product contract — no behaviour attached.

## 8. Behavioural matrix (live, deployed, one sequential run each)

| probe | steps | searches (web/corpus/academic/official) | fetches | body reads | verified claims | cited | latency | commit directives |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N1 statute | 8 | 1/0/0/3 | 2 | 1 | 2 | 1 | 75 s | stale ×2, named_authority_ready |
| N2 named judgment | 5 | 0/0/0/0 (+1 lookup) | 1 | 1 | 4 | 1 | 58 s | named_authority_ready, stale |
| N3 "סמינריון" + same statute | 12 | 1/0/0/2 | 2 | 2 | 2 | 1 | 86 s | stale, named_authority_ready |
| D1 good-faith evolution | 11 | 0/3/3/2 | 11 | 8 | 4 | 3 | 193 s | early_commit, stale ×3 |
| D2 scholarly disagreement | 16 | 2/0/6/0 | 5 | 4 | 4 | 3 | 279 s | early_commit, stale |
| D3 reasonableness vs proportionality | 19 | 1/0/3/3 | 6 | 6 | 4 | 2 | 277 s | early_commit, stale ×5 |
| D4 literature review | 7 | 1/0/3/2 | 10 | 9 | 6 | 5 | 170 s | early_commit, stale |
| D5 comparative IL/UK | 5 | 2/1/1/1 | 12 | 7 | 4 | 2 | 113 s | early_commit |

### Interpretation

- **No artificial depth.** N3 contains `סמינריון` — previously an automatic `developed` label. Its
  research profile is materially the same as N1: 3 searches, 2 fetches, no academic scope, 86 s vs
  75 s. The word no longer buys breadth.
- **No artificial shallowness.** D1, D2, D3 contain none of the old cue phrases and were previously
  classified `focused`. All three ran multi-direction research with academic scope (3, 6 and 3
  academic searches), 4–8 body reads and 2–3 cited sources — the agent recognised breadth from
  meaning alone. D2 in particular treated "what do scholars disagree about" as a scholarship task
  (6 academic searches, zero official) rather than one doctrinal proposition.
- **Dynamic adjustment.** In every broad probe the early-commit reminder fired at step 2–3 and the
  agent did *not* submit; it continued toward concrete gaps and submitted only at steps 7–19. In the
  narrow probes the named-authority signal arrived and the agent stopped shortly after.
- **No budget gaming.** D5 answered a comparative question in 5 steps and D4 a literature review in
  7, both well inside the ceilings; nothing pushed the agent to consume remaining budget.
- **Academic scope is now need-driven**, used in D1–D5 and in none of N1–N3.

Counts are read as evidence of research *direction*, not quality; the qualitative reading above is
the acceptance basis. No prompt was tuned to these probes.

## 9. Safety invariants

Unchanged and re-verified by the full suite: search results are never evidence, only fetched/read
bodies are; exact quoted spans; deterministic identity checks; body-only canonical authority
identity; verification before drafting; temporal safeguards; attachment provenance and
user-document authority restrictions; Rule 37 / deterministic footnote rendering; V2-only production
routing. No V1 file was modified.

## 10. Remaining risks

- Depth is now a model judgement; a weak model day can under- or over-research a borderline request.
  The hard ceilings and the mandatory commit bound the blast radius in cost and latency, not in
  depth.
- Broad probes show higher token usage (D2/D3 ≈ 220–235k prompt tokens) — the intended price of real
  breadth, but worth watching against the efficiency work done earlier.
- `stale_research` fires frequently in long runs (D3 ×5); it is advisory only, but its repetition in
  broad research is worth a later look.

AGENT-OWNED RESEARCH DEPTH — SHIP

DETERMINISTIC FOCUSED/DEVELOPED CLASSIFICATION: REMOVED

RESEARCH DEPTH OWNER: RESEARCH AGENT

DRAFTER HANDOFF: UNCHANGED IN THIS TASK
