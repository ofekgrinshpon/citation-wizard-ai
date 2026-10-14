# Plan: send ordinary public SOL research calls straight to the owner's OpenAI account

Planning only. I read code at Main `83223320`. I edited nothing, deployed nothing, ran no model, read no secrets and ran no database queries.

## 1. What the code does today (verified by reading it)
- **New public job intake** (`index.ts:2140`) copies in `ORDINARY_RESEARCH_SETTINGS`: `agent_model = openai/gpt-6.1-sol`, `agent_reasoning_effort = medium`. It does not set `agent_direct_provider`.
- **Agent call** (`agent/researchAgent.ts:757-780`) calls `chat()` in `shared/model.ts`. With no `directProvider`, `chat()` uses `LOVABLE_API_KEY` and `responsesChatGuarded` (the Lovable gateway). That is why the recent trial logged `lovable_gateway`.
- **Direct pilot** (`shared/directProviders.ts` `directChat`, plus `directProviderPolicy.ts`) already handles native OpenAI Responses for `gpt-6.1-sol`. It sends `stream:true`, `store:false`, `include:[reasoning.encrypted_content]`, `reasoning:{effort, summary:auto}`, function tools, `max_output_tokens`, and `service_tier:default`. Before each call it does an exact `/v1/responses/input_tokens` count and a USD reservation. It records each attempt (requested and returned model, tokens, cached tokens, duration, outcome) and checkpoints before sending.
- **Why the pilot can't be reused as is:**
  - It is locked to one approved run ID (`V2_DIRECT_PROVIDER_PILOT_RUN_ID`).
  - It writes results to `v2_eval_runs` by `id`.
  - It has a fixed $2 budget per run.
  - Any error is terminal (`direct_provider_experiment_failed`).
  - A pause needs manual review (`direct_pause_requires_review`).
  - None of these fit public jobs, which need normal history, refunds and resume.
- **Gateway fallback guard:** `chat()` already rejects a checkpoint that has direct attempts but no direct route (`direct_provider_route_missing`). This is a useful base for "no silent fallback".

## 2. Proposed design
Add a third, production route next to "gateway" and "pilot": **ordinary direct OpenAI**. The pilot stays as it is.

```text
new public job -> intake stamps agent_transport = "openai_direct" (server-owned)
  -> researchAgent -> chat({transport}) -> directChat(mode:"ordinary") -> api.openai.com
existing / resumed job -> keeps whatever transport its checkpoint recorded (missing = gateway)
```

1. **Policy (`ordinaryResearchPolicy.ts`):** add `agent_transport: "openai_direct"` to `ORDINARY_RESEARCH_SETTINGS`, behind a server env switch `V2_ORDINARY_TRANSPORT` (`gateway` by default, `openai_direct` to turn it on). The value never comes from the request body.
2. **Intake (`index.ts buildIntake`):** store the transport once, at creation. On resume it is never rewritten.
3. **Agent (`researchAgent.ts`):** pass `transport` into `chat()` with the same messages, tools, toolChoice, effort and replay flag. Only the research-agent stage changes. Verifier and drafter stay on their current routes.
4. **`directChat` ordinary mode:** reuse the same request body, streaming parser, attempt ledger and input-token pre-count. Swap the pilot-only gates for production ones:
   - no run-ID pin and no `v2_eval_runs`; use the normal job and conversation tables
   - a per-run native USD ceiling (a value for the owner to choose; see section 6)
   - a server-wide daily native ceiling
   - errors follow the normal job failure and refund path, not the "experiment failed" throw
5. **Resume:** the ordinary direct route uses the normal checkpoint and resume path. It does not use `direct_pause_id` or manual review. A resume where the last attempt is `pending`, `network_unknown`, `stream_unknown` or `aborted_unknown` fails closed: the job ends as a normal error with a refund and is never re-sent automatically. This matches the existing "never retry uncertain runs" rule.

## 3. New jobs vs existing jobs
- Only jobs created after the switch is turned on use the direct route.
- In-flight and paused jobs keep their recorded transport, so mixed history cannot happen: the existing `direct_provider_route_changed` and `direct_cross_provider_replay` checks reject switching mid-run.
- Old results, conversations and history display are unchanged.

## 4. Compatibility and parity
- **Tools:** function tools are converted with `strict:false`, the same as the pilot that already ran several Sol 6.1 trials. Forced memo choice maps to `{type:"function", name}`.
- **Medium reasoning:** sent as `reasoning.effort:"medium"`. The returned effort is recorded (`effort_returned`, `effort_status`). For medium, `not_reported` is logged, not treated as an error.
- **Reasoning replay:** the direct OpenAI path keeps all `reasoning_items` per turn (researchAgent:783). It also bypasses `enforceReplayBudget`, which means a large history is not trimmed the way the gateway trims it. **Decision needed:** either apply the same 2M-char / 64-item replay limit on the direct path (parity), or keep the full replay (the pilot's behaviour). I recommend parity.
- **Output cap:** the pilot needs an explicit `max_output_tokens` (1,024 to 128,000). The ordinary policy needs a fixed value for the owner to approve. The ordinary gateway path today does not reliably enforce one.

## 5. No silent fallback, missing key
- If the transport is `openai_direct`, the code never reaches the `LOVABLE_API_KEY` branch. A unit test asserts that the gateway is never called.
- Missing `OPENAI_API_KEY` returns `401 direct_provider_key_missing` before anything is sent. The job then fails through the normal path with a refund and the usual Hebrew failure message. Nothing switches to the gateway.
- OpenAI `429` and `5xx` responses get the existing bounded retry only when the attempt is known `not_sent` or is a clean HTTP error. Every uncertain outcome is terminal.
- **To verify at approval time:** that an `OPENAI_API_KEY` secret already exists on the project from the existing OpenAI integration. I check the secret name only, never the value. If it does not exist, the rollout is blocked: I will not create one.

## 6. Spending safeguards (owner sets the values)
- **Per run:** a pre-call reservation using the exact input count and the output cap. The run stops with `402` if the next call would go over the run ceiling.
- **Per day, server-wide:** an atomic counter for reserved and settled native USD, kept in an existing service-role-only table or a new one. **Decision:** which of the two to use. Adding a new table needs a migration and your approval. Once the ceiling is hit, new direct calls fail closed. They don't switch to the gateway.
- The long-context guard stays (`>272k` input tokens is rejected). Recent trials had about 16k tokens per call (400,197 across 25 calls), well below that.
- The OpenAI account's own spending limit is outside the app's control. This plan does not change it.

## 7. What gets recorded per attempt
For each attempt: requested model, returned model, input, cached, cache-write, output and reasoning tokens, `duration_ms`, input-count time, checkpoint time, outcome, provider request and response IDs, and estimated USD from the `sol61-standard-2026-10-03` list price. The estimate is labelled as an estimate.
- Attempts are also written to `ai_cost_events` (stage `v2_research_agent`, provider `openai_direct`). This fixes the "total cost missing" gap for this stage. The actual OpenAI invoice is never available to the app.

## 8. Latency (not assumed fixed)
The 11m19s run has no per-stage breakdown in this plan. Moving the model provider changes only model time. Two items add time per call: the extra input-count round trip and the checkpoint before each call. These two need measuring. The fetch, Perplexity and verifier stages are unchanged. The earlier direct pilots took 4 to 4.5 minutes, but those runs had different setups. I will report model time vs tool time separately, without assuming an improvement.

## 9. What still uses Lovable / other providers
- **Lovable AI gateway (Lovable credits):** the verifier (`gemini-3.7-flash`), the drafter (`gemini-3.1-pro-preview`, only if the separate drafter is on), the model router and short replies (`modelRouter.ts`), and citation-chat and the other functions.
- **Separate providers, unchanged:** Perplexity/Sonar search, Apify and the fetch relay.
- **Lovable Cloud infrastructure:** the database, functions, storage and hosting.
- **Lovable development credits:** building and planning in this chat.

## 10. Preserved behaviour
Sign-in checks, owner-scoped conversations, assistant messages inserted only by the function, credit claims and refunds, idempotent job claim and the terminal-race guards, and the evidence and verifier trust rules are all unchanged.

## 11. Offline tests (no network calls; fake fetch)
- New job stamps `openai_direct` when the switch is on and `gateway` when it is off.
- A resumed checkpoint keeps its original transport.
- The direct transport never calls the gateway, and a missing key leads to a 401 and a refund path with no call sent.
- Uncertain last attempt on resume leads to a terminal error, with no re-send.
- Per-run and daily ceilings return 402 before sending.
- Request body: effort is medium, `store:false`, the include field is set, tools are mapped, and the output cap is present.
- Usage parsing: cached tokens, reasoning tokens and a model mismatch lead to `model_mismatch`.
- The replay limit is applied, if parity is chosen.
- The existing `directProviders`, `directSol61High` and `ordinaryResearchPolicy` tests still pass.

## 12. Rollback
Set `V2_ORDINARY_TRANSPORT=gateway`, or leave it unset. New jobs go back to the gateway right away. Jobs already running on the direct route finish on it, or fail closed if the key is removed. The code can be reverted, but external charges already incurred cannot be undone.

## Risks
- Unknown OpenAI rate limits or tier on the owner's account could cause 429s under public load.
- The extra input-count call adds latency and a second point of failure.
- List-price estimates may not match the invoice.
- Keeping the full replay could make requests larger.
- The ordinary resume code differs from the pilot's manual-review pause, so it needs careful review.

## Steps that need approval
1. Approve this plan. Implementation is about 4 to 7 build credits, within the daily 30.
2. Choose: the per-run USD ceiling, the daily USD ceiling, the output cap, and replay parity vs full replay.
3. Approve a migration if the daily counter needs a new table.
4. Check that the `OPENAI_API_KEY` secret name exists (no value is read).
5. Deploy `legal-research-v2` only, with the switch still off.
6. Turn the switch on and run one approved live trial, as a separate authorization.
