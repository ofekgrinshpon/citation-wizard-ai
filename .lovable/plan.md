# Real AI costs for אזכור אחיד, הערות שוליים and ביבליוגרפיה

This is a read-only answer. Nothing was changed.

## Confirmed facts (from current code and aggregate queries)

- **Shared engine.** `src/lib/runCitation.ts` calls `citation-chat` with `requestId: crypto.randomUUID()` and no `batchId`. Both `BatchFootnoteBuilder.tsx:183` (footnotes) and `BibliographyGenerator.tsx:129` (raw bibliography entries) call `runCitation` once per source. `src/pages/Index.tsx:224` (the wizard) also sends a `requestId`.
- **Batch pricing exists but is never used.** `citation-chat/index.ts:1644` accepts a client `batchId`, and line ~1740 calls `consume_usage_batch` (1 unit per 5 items) when it is present. Since no caller sends one, every source falls back to `consume_credits(_amount: 1, "citation-chat")`. The verified-source shortcut before that point (`verified_sources`, ~line 1693) is free.
- **Paid calls inside `citation-chat`:**
  - Perplexity `chat/completions` with `sonar-pro`. This covers case law, party search, verify passes, books, `perplexityWithFallback` (2 attempts) and the helpers at lines 330/460/785/831.
  - Perplexity `sonar` for statutes and regulations (lines ~2826 and ~2911).
  - Perplexity `/search` in `foreignLookup.ts:78`.
  - One Lovable AI Gateway call with `google/gemini-2.5-flash` (line ~3482–3490). It refunds on 429 or when the service is unavailable.
  - Which calls run depends on the source type and on earlier results, so the number of calls per source varies.
- **Optional classification.** `src/lib/sourceTypeClassifier.ts:73` calls `classify-source`, which uses `gemini-3-flash` through the gateway.
- **Not confirmed in this pass:** a separate Gemini 2.5 Flash "verifier". I found only one gateway call in `citation-chat`. Treat that earlier observation as unverified.
- **Legacy and side paths.** `bibliography-lookup` (Perplexity `sonar`) has charges only through 2026-08-12. `citation-refill` calls Perplexity `sonar-pro`.
- **Ledger, aggregate only:**
  - `citation-chat` consume: 608 rows, 2026-04-20 to 2026-09-30, 432 units. The gap between rows and units fits zero-charge admin rows.
  - `bibliography-lookup` consume: 166 rows / 162 units.
  - 16 refunds.
  - The ledger has no columns for model, tokens, cost, feature or batch. `reason` is the only attribution, so `useUserUsage.tsx:191` cannot tell wizard, footnote and bibliography usage apart.

## (1) Where real billed dollars come from

| Source | What it measures | Authoritative for |
|---|---|---|
| Lovable development-message credits | My work in the editor | Not app runtime. Unrelated. |
| Lovable Cloud + AI balance (Settings → Plans & credits; the project's AI Gateway request logs) | Gemini calls through the gateway, plus Cloud functions and database | Gateway model spend. Logs are per request, but not grouped by feature. |
| Perplexity account billing / usage dashboard | `sonar` / `sonar-pro` / search calls made with your own `PERPLEXITY_API_KEY` | The Perplexity dollars. This is outside Lovable and I cannot see it. |
| App usage units (`credit_ledger`) | Your internal pricing to users | Not a cost. It is not dollars. |
| Per-request telemetry | Does not exist yet for these features | — |

What I could not access or verify: Perplexity invoices or usage, the workspace's actual billed AI totals, and how long gateway logs are kept. I did not open the AI Gateway logs, because the privacy boundary rules out per-request content.

## (2) Can past costs be reconstructed?

Not exactly. They can only be estimated, roughly.
- Perplexity bills at account level, and its calls carry no request ID linking them to a ledger row or a feature.
- Gateway logs, while they last, can give Gemini spend per call. They have no feature or batch tag, though, and the timestamp links to ledger rows are fuzzy.
- The ledger has no record of which paid calls ran per source, of retries or fallbacks, or of whether a call came from the wizard, footnotes or bibliography.
- At best: total Perplexity spend for a period ÷ ledger rows in that period, which gives a blended average. Even that is distorted by legal-research and other functions using the same Perplexity key.

## (3) Smallest prospective measurement plan (proposal, not implemented)

1. **Attribution from the client.** `runCitation` gets an optional `feature` (`wizard|footnotes|bibliography|refill`) and a `batchId`, one per footnote or bibliography run. Callers pass them through.
2. **One cost-event table.** `ai_cost_events(id, created_at, user_id, feature, batch_id, request_id, function, stage, provider, model, attempt, outcome, cache_hit, input_tokens, output_tokens, search_requests, est_usd, billed_usd null)`. Admin-only reads, inserted by the service role. Store no prompts or answers.
3. **A single wrapper** around every Perplexity and gateway `fetch` in `citation-chat`, `classify-source` and `citation-refill`:
   - Write one row per HTTP attempt, retries and fallback tiers included, with `attempt` and `outcome`.
   - Take token and search counts from the provider's `usage` field.
   - Write one `cache_hit` row (with zero cost) for the verified-source shortcut.
4. **Avoid double counting.**
   - `est_usd` is calculated from a versioned price table, per attempt.
   - Rows are summed by request and by batch; the ledger is never added on top.
   - Once a month, reconcile the totals against the Perplexity invoice and the Lovable AI balance, and keep the result as `billed_usd` at the aggregate level.
5. **Admin view.** Cost per source and per batch for each feature, with the p50/p90 number of calls.

## (4) Local vs paid, and the "mostly Perplexity, therefore cheaper" claim

- **Local or free:**
  - Verified-source hits.
  - Prompt building and engine hints in `runCitation`.
  - Rule formatting and normalization (Hebrew number ranges, editor placement, Knesset terms, trusted-host checks).
  - Importing already-resolved footnotes into the bibliography.
- **Paid:**
  - The Perplexity calls listed above (often several per source, with fallbacks).
  - One Gemini 2.5 Flash call to the gateway.
  - Optional classification with Gemini 3 Flash.
- **"Mostly Perplexity":** partly supported, by call count only. Most paid call sites are Perplexity, but a Gemini formatting call still runs, so "code formats the output" is only partly true.
- **"Cheaper than the legal assistant":** not supported. There is no measured cost per source for citations, and no comparable measured cost for the assistant. The earlier assistant figure was an estimate. A footnote batch of N sources makes N or more engine runs. Do not state a relative cost until step 3 produces data.

## Change and cost confirmation

Nothing was changed: no code, configuration or data. I ran only read-only queries that return totals. No paid model calls. I can't see the credits charged for this response; the standard plan-mode price is 1 credit.
