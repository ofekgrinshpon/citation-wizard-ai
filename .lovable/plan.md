## Goal

Find out why this project's **Cloud & AI balance** is draining within ~2 days of a top-up, and recommend concrete, low-risk reductions. No code changes in this plan — investigation + a prioritized reduction list. Any actual optimization is a follow-up plan after we see the data.

## Why this project is unusually expensive

This is not a generic CRUD app. The backend runs a heavy multi-stage legal research pipeline that calls paid models on almost every user query:

```text
user query
  → legal-research-v1 (planner)
  → localRetrieval  (DB vector + trigram + ilike)
  → perplexityRetrieval  (Perplexity API, paid)
  → candidatePool / verifier  (model calls per claim)
  → drafter (Structured Citation Drafter v2.1e — likely GPT-5 / Sonnet class)
  → citation engine + classify-source + verify-source (more model calls)
  → qa_logs row written
```

In parallel, several **batch scripts** under `scripts/legal-research-v1-*` (drafter model comparisons, P3–P7 phase runners, occurrence-footnotes runners, style validation) are designed to fan out many AI calls. If any of these have been run recently — or scheduled — they alone can burn the $1 AI balance and a large fraction of the $25 Cloud balance in hours.

## Investigation steps (read-only, no code changes)

1. **AI side — identify the heaviest model paths**
   - Inspect `qa_logs.metadata.retrieval` and drafter telemetry for the last 7 days: number of runs, models used (`drafter_model`, `verifier_model`, Perplexity calls), token totals.
   - Count Perplexity calls per run (each `legal-research-v1` run can make several).
   - Check whether `classify-source` and `verify-source` are being called per-candidate vs per-final-source.
   - Check which model is configured for the drafter and verifier in `supabase/functions/legal-research-v1/lib/` — premium models (GPT-5, Sonnet, Pro) cost 5–20× a Flash model per equivalent output.

2. **AI side — script activity**
   - List recent runs of `scripts/legal-research-v1-*` (drafter-model-comparison, sonnet-rerun, phaseE*, occurrence-footnotes, quality-gate). Each comparison/validation runner loops over fixtures and calls drafter models repeatedly. One full sweep can easily exceed $1 of AI spend on its own.
   - Confirm none of these are running on a cron / background loop.

3. **Cloud side — compute + DB**
   - Check edge-function invocation counts and durations for `legal-research-v1`, `legal-qa`, `batch-embed-chunks`, `apify-ingest-cases`, `embed-legal-source` (long-running functions billed by duration).
   - Check `legal_document_chunks` vector index activity — HNSW rebuilds (`rebuild_hnsw_index`) and large batch embeds spike compute.
   - Check `apify-ingest-cases` / `fetch-apify-dataset` runs — bulk ingestion + embedding is a known burst cost.
   - Check egress: large `qa_logs.metadata` payloads and Perplexity response storage.

4. **Cross-check timing**
   - Map the spend curve from the top-up date forward against (a) `qa_logs` row timestamps, (b) script run timestamps, (c) edge-function invocation timestamps. Whichever curve matches the burn rate is the culprit.

## Expected top suspects (ranked by past experience with this codebase)

1. **Drafter model choice** in `legal-research-v1`. If it's currently GPT-5 / Sonnet / Pro-tier on every user query, this alone explains most of the AI burn.
2. **Per-claim verifier calls** + **per-candidate `classify-source` calls**. Fan-out multiplies cost by N candidates per query.
3. **Perplexity** calls per run — paid, and the new "reserve up to 10 trusted Perplexity candidates" change can increase upstream calls if retrieval is configured to over-fetch.
4. **Batch scripts** run during recent debugging (the conversation history shows several model-comparison and validation runs).
5. **Embedding jobs** (`batch-embed-chunks`, `embed-legal-source`) — cheap per call but expensive in bulk.
6. **Edge-function duration** — `legal-research-v1` runs are long; Cloud bills by GB-seconds.

## Deliverable after investigation

A short report with:
- The 3–5 biggest consumers, with rough $ share of the spent balance.
- For each: a concrete, low-risk reduction (e.g. "switch verifier from GPT-5 to `google/gemini-3-flash-preview` — ~10× cheaper, same task quality on the existing eval fixtures").
- A clear list of items that should NOT be touched (correctness-critical paths).

## Reduction levers I expect to recommend (preview, not committing yet)

- **Drafter** stays premium (quality-critical) but only on the final pass; intermediate steps move to Flash-tier.
- **Verifier / classify-source** → `google/gemini-3-flash-preview` or `gemini-2.5-flash-lite`.
- **Perplexity** → cap calls per run; cache responses keyed by normalized query.
- **Scripts** → gate behind an explicit `RUN=true` env var so they can't accidentally run; add a dry-run mode.
- **Embeddings** → confirm `batch-embed-chunks` isn't re-embedding unchanged rows.
- **Cloud instance size** → only consider upsizing if compute (not AI) turns out to be the dominant cost.

## What I need from you

Just approve this plan. Once approved I'll switch to build mode, run the read-only queries against `qa_logs`, edge-function logs, and the script files, and come back with the ranked report + a second plan for the actual optimizations.

## Out of scope for this plan

- No code changes.
- No model swaps yet.
- No instance resize yet.
- No changes to the recently approved exact-authority guard or Perplexity reservation logic.
