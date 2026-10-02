# Three-arm comparison plan: GPT-6.1 Sol vs Astra vs historical Astra

Planning only. Nothing was edited, deployed or called. I read the database with four read-only metadata queries, which returned no content.

## 1. Can this project use GPT-6.1 Sol?
**Not established.**
- **Verified:** the project's model catalog lists `openai/gpt-6-sol`, `openai/gpt-6-astra` and `openai/gpt-6-luna`. It has no 6.1 entry, and nothing in the repository mentions `gpt-6.1`.
- **Unknown:** the exact model ID (for example `openai/gpt-6.1-sol`), whether it supports Responses tool calling, its reasoning efforts and its billing rate. No non-secret documentation or configuration covers any of these. A missing catalog entry does not prove the model is unsupported.
- **Smallest next step (not run):** one authenticated `GET https://ai.gateway.lovable.dev/v1/models` from the server. It is a catalog listing, not a model call. It uses the existing key without printing it. Copy the exact ID, modalities, `data_retention_by_surface.responses` and any listed price. If no 6.1 ID appears, arm A stops. No substitute model is used.
- Responses tool support can only be confirmed by one real call. That call is the first step of arm A, and its own check (section 5) stops the run on failure.

## 2. Is the run 0bbe6e54 evidence snapshot reusable?
**No complete reusable snapshot exists.**
- **Verified:** the run is job `e8748d32…`, status done, created 2026-10-02 03:48 UTC.
- **Verified:** the stored result holds only these fields: answer (10.8 KB), footnotes, used_sources (848 B), and debug (telemetry 94 KB, unresolved_questions, error fields). There is no stored agent state, no tool trace and no source-body field.
- **Verified:** there is no separate evidence or run-state table. The only body cache is `secondary_source_bodies`, keyed by source, not by run.
- **Conclusion:** exact historical replay of that run is impossible. used_sources gives the source list, but not the bodies as they were served.

## 3. Three kinds of test (kept separate)
- **Exact historical replay:** not possible (see section 2).
- **Frozen identical corpus (proposed):** collect the bodies once, freeze them with sha256 per document, and give all three arms the same corpus. This tests reasoning and writing on identical evidence. It does not test how well each arm finds sources.
- **Live acquisition test:** each arm searches the live web. It is not proposed, because results would differ by search luck as well as by model.

## 4. Isolated execution approach
Use an offline local harness in the sandbox. It runs no deployed function, writes no production rows, and leaves the live default unchanged.

```text
corpus.json (frozen, hashed) -> replay tools (search/fetch/lookup answer only from corpus)
   -> agent loop at commit X with model M -> verifier -> render -> report.json
```
- Arms A and B check out `2f7da3e0` into `/tmp/arm-current`. Arm C checks out `9ac6c068` into `/tmp/arm-hist`. Both are temporary git worktrees, not the deployed code, and each arm keeps its own prompts and code exactly as committed.
- The model is selected through the existing per-run `agent_model` intake field (index.ts:188, 293). It is a field the code already reads, so no source change is needed. It is reused only through the harness, never through the public endpoint or the `V2_EVAL_TOKEN*` path, so production and stored data are never touched.
- Identical across arms: the question as you gave it, the corpus, reasoning effort `medium`, ToolBudgets, verifier model, rendering and drafter settings. If the two commits differ in budgets or verifier defaults, the harness pins one value for all arms and reports the difference.

**New files only (outside deployed code):**
1. `eval/three-arm/corpus.json`: the frozen bodies with hashes, built once with Perplexity and fetch (small paid cost).
2. `eval/three-arm/replayTools.ts`: corpus-backed search, fetch and lookup with the same output shape as the real tools. A corpus miss returns "not found" and never falls back to the live web.
3. `eval/three-arm/run.ts`: runs one arm, injects the replay tools, and writes report.json.

No changes to `supabase/functions/**`, the frontend, settings or data.

**Open risk:** if commit `9ac6c068` hard-wires its tools with no injection point, arm C would need a shim. That shim is the only code that would differ for C, and it would be documented. Inspecting this is step 1 of build.

## 5. No-silent-fallback checks
- Before each call, assert that the requested model equals the arm's configured ID.
- After each call, read the `model` field returned in the Responses body. If it differs from the requested ID, or if a 400 or 404 is returned, stop the arm and mark it invalid. No retry, no substitution, and no move to chat-completions.
- The harness disables the Astra router fallback and the separate drafter fallback (`V2_USE_SEPARATE_DRAFTER` stays at its commit default and is logged).
- Every call is logged with requested ID, returned ID, AI Gateway run ID and attempt number.

## 6. Budgets
**Preparation credits (estimate):** this inquiry about 1 to 2. Build plus offline tests about 4 to 6. Total stays within 10. If arm C needs a shim, the scope stops for review before going further.

**Provider cost per run:** these are estimates, not billed rates. Astra and 6.1 Sol rates are unknown.
- Building the corpus (Perplexity and fetch): about $0.5 to $1.
- One arm: about $1 to $4, scaled from earlier runs (Q2 Astra: 371k input and 16k output tokens).
- All three arms: about $5 to $13, inside the $20 target.

**Technical vs advisory limits:**
- *Technical:* step, tool and search ceilings (ToolBudgets), the replay corpus (no live web), one run per arm, and abort on a model mismatch.
- *Advisory only:* the $20 target. There is no pre-call dollar cap: the gateway's output-cap enforcement on Responses is unverified, and telemetry is recorded after each call. As a soft stop, the harness halts before starting the next arm if the running estimate passes $15.

## 7. Report format (per arm, then side by side)
- The full answer text and the full footnote and citation list.
- Source availability: corpus documents served, documents cited, corpus misses.
- Issue coverage against a fixed checklist: rights involved, sale vs licence, exhaustion, Israel vs comparative law (for example ReDigi and UsedSoft).
- Verifier results: verified, partial and rejected claims, plus invariant errors.
- Timing: wall time, and model time vs tool time.
- Per-attempt usage: requested and returned model, input, cached, output and reasoning tokens, estimated USD (labelled as estimated), and gateway credits if available.
- One run per arm is a directional signal only, not a statistical result.

## Verified vs uncertain (summary)
- **Verified:** 6.1 Sol is absent from the catalog and the repository. Run 0bbe6e54 has no body snapshot. A per-run `agent_model` field exists.
- **Uncertain:** the 6.1 Sol ID, availability, tool support, reasoning settings and price. Astra's billed rate. Whether commit 9ac6c068 accepts injected tools. Whether the gateway enforces output caps on Responses.
- **This turn's development-credit usage:** not shown to me.
