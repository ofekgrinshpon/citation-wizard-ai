# Plan: send ordinary public SOL research calls straight to the owner's OpenAI account (revised)

Planning only. I read the code at Main `83223320`. I edited nothing, deployed nothing, ran no model and read no secrets. No database queries were run.

## 1. Current behaviour (verified by reading the code)
- **New public jobs** (`index.ts:2140`) copy in `ORDINARY_RESEARCH_SETTINGS`: `openai/gpt-6.1-sol` with effort `medium`. No `agent_direct_provider` is set, so `chat()` in `shared/model.ts` takes the `LOVABLE_API_KEY` / `responsesChatGuarded` gateway path. That is why the last trial recorded `lovable_gateway`.
- **The native pilot** (`shared/directProviders.ts` `directChat`, plus `directProviderPolicy.ts`) already handles native Responses:
  - `stream`, `store:false`, `include:[reasoning.encrypted_content]`, `reasoning{effort, summary:auto}`, function tools with `strict:false`, `max_output_tokens`, `service_tier:default`
  - an exact `/v1/responses/input_tokens` count, then a USD reservation, then a checkpoint, before anything is sent
  - a per-attempt ledger, with uncertain outcomes (`pending`, `network_unknown`, `stream_unknown`, `aborted_unknown`) blocking any further call
- **Pilot-only parts:**
  - `V2_DIRECT_PROVIDER_PILOT` and `V2_DIRECT_PROVIDER_PILOT_RUN_ID` gates
  - writes to `v2_eval_runs` by `id`
  - `direct_pause_id` with manual review
  - a fixed $2 budget per run (`SOL61_PILOT_NATIVE_BUDGET_USD`)
  - `direct_provider_experiment_failed` throws
- **Job finish today** (`beta/job.ts`): `finishJobError(..., definitiveFailure=false)` stores `execution_outcome_unknown:true` and does **not** refund. Only a definitive failure refunds.
- **`chat()`** already rejects a checkpoint that has direct attempts but no direct route (`direct_provider_route_missing`).
- **Cost telemetry:**
  - `_shared/costTelemetry.ts` types `provider` as `"perplexity" | "lovable_gateway" | "none"`.
  - The generated types show `ai_cost_events.provider` as plain `string`.
  - The table's migration is not in the repository, so its live CHECK constraints are unverified.
  - It is also unverified whether the research function writes paid model attempts to `ai_cost_events` today.

## 2. Design: a separate "ordinary direct" mode, not the pilot
```text
new public job -> intake stamps agent_transport="openai_direct" (server-owned, only if switch on)
  -> researchAgent -> chat({transport}) -> ordinaryDirectChat -> api.openai.com/v1/responses
existing/resumed job -> keeps recorded transport; missing field = gateway (pinned)
```
1. **New module `shared/ordinaryDirect.ts`.** It reuses the pilot's pure helpers: request body builder, SSE parser, usage parser and `sol61UpperUsd`. It does not call `directChat` and does not read any pilot env flag, run-ID lock or `v2_eval_runs`. The pilot code stays byte-identical.
2. **Switch `V2_ORDINARY_TRANSPORT`:** `gateway` by default, `openai_direct` to turn it on. It is read only when a new job is created. Any request-body field with this name is ignored.
3. **Intake:**
   - `agent_transport` is stored once on the job's intake and checkpoint, and is never rewritten on resume.
   - A job where both `agent_transport` and `agent_direct_provider` are present is rejected. Ordinary and pilot runs can never mix.
4. **Agent:** only the research-agent stage (`costStage: v2_research_agent`) changes. Messages, tools, toolChoice, `medium` effort and the stop policy stay the same. The verifier, drafter and router keep their current routes.
5. **Fixed request fields:**
   - model `gpt-6.1-sol` and effort `medium`
   - `max_output_tokens: 16384`, the existing native value, proposed as the starting value only; it is not cost approval
   - `store:false`, the include field and `service_tier:default`

## 3. Existing vs new jobs
Only jobs created after the switch is turned on use the direct route. Jobs that are queued, running, paused or awaiting the user keep the gateway. Mixing is blocked by an `ordinary_transport_changed` check, and by `direct_cross_provider_replay` in both directions. Old results, history and conversations are untouched.

## 4. Failures, uncertainty and refunds
| Situation | Sent? | Result |
|---|---|---|
| `OPENAI_API_KEY` missing; switch, quota, input-count or reservation refusal; abort before dispatch; checkpoint fails before dispatch | Proven not sent | Attempt is `not_sent`, its reservation is released, and the job is a **definitive** failure: `finishJobError(definitive=true)` and the normal refund |
| HTTP 429 with no body generated | Treated as rejected | No automatic retry in the first rollout. Definitive failure with a refund, but the reservation is held until a receipt shows no usage (see section 6) |
| HTTP 5xx, timeout, network error, interrupted stream, `incomplete`, missing usage | **Uncertain** | Attempt keeps its uncertain outcome. No resend. Job ends via `finishJobError(definitive=false)`: `execution_outcome_unknown:true` and **no automatic refund**. The full reservation stays held |
| Refusal, invalid output, model mismatch | Sent and charged | Settled with the reported usage. The job fails as today, with no fallback |

Resume after any uncertain attempt fails closed, using the existing reconciliation rule. Nothing goes to the gateway, ever. A unit test asserts that the gateway fetch is never called once the transport is `openai_direct`.

## 5. Reasoning and tool replay
Keep the pilot's proven replay: every encrypted reasoning item and complete tool call/result pair is resent, and `enforceReplayBudget` stays bypassed on this route, as it is in the pilot. There is no blind 64-item or 2M-character trimming. Explicit limits fail closed:
- the request is over `DIRECT_LIMITS.maxRequestBytes`
- the counted input is over 272k tokens
- the reservation would go over the run or day ceiling

Dependency-aware trimming is a separate, later, tested change.

## 6. Durable spending limits
- **Per-run reservation:** kept in the job's own checkpoint ledger, as in the pilot. It uses the exact input count and the 16384 output cap through `sol61UpperUsd`.
- **Per-day ceiling.** No suitable existing table is verified, so a migration is proposed but **not run**:
  - Table `public.research_native_spend`: `attempt_id uuid pk`, `job_id uuid`, `reserved_usd numeric`, `settled_usd numeric null`, `state text check (state in ('reserved','settled','released','uncertain'))`, `utc_day date`, `created_at`, `updated_at`.
  - RLS on, with no policies. `REVOKE ALL` from `anon` and `authenticated`, and `GRANT` to `service_role` only.
  - RPC `reserve_native_spend(attempt_id, job_id, usd, day_cap)`, `security definer`, granted to `service_role` only. It takes a `pg_advisory_xact_lock`, then sums the rows where state is `reserved` or `uncertain` (any day) plus `settled` (today, UTC), then inserts or refuses. An existing `attempt_id` is a no-op, which makes it idempotent.
  - RPCs `settle_native_spend` and `release_native_spend`: these only move a row out of `reserved`. A `released` or `settled` row can never be released again, so a resume cannot double-release. `uncertain` rows stay counted against the ceiling indefinitely, across UTC day changes, until an owner reconciles them.
- **What counts toward the limit:** only native OpenAI research-agent calls, plus their `input_tokens` count calls. Sonar, Gemini and infrastructure costs are excluded.
- The amounts are list-price upper estimates, not invoice guarantees.

## 7. Telemetry
- **Ledger:** each attempt records requested and returned model, effort sent and returned, input, cached, cache-write, output and reasoning tokens, `input_count_ms`, `checkpoint_ms`, `duration_ms`, outcome, provider IDs, and estimated USD.
- **`ai_cost_events`:** first verify the live constraint and its consumers. This is a read-only check of the table definition and the admin/statistics readers, done at approval time.
  - Then widen the TypeScript `CostEvent["provider"]` union to include `"openai_direct"`, update the consumers that switch on provider, and add a matching CHECK-constraint migration if one exists.
  - Until that is verified, write ordinary-direct events with `provider:"openai_direct"` only behind a type-safe adapter. A failed write never affects the job.

## 8. Latency
Not assumed to improve. Each call adds an input-count round trip and a checkpoint. Reporting will separate model, count, checkpoint and tool time. The 11m19s run has no per-stage breakdown in this plan.

## 9. What still uses Lovable or others
- **Lovable AI gateway:** the verifier, the drafter (when enabled), the router and short replies, and every other function.
- **Separate providers:** Perplexity/Sonar, Apify and the fetch relay.
- **Lovable Cloud:** database, functions and hosting.
- **Lovable development credits:** building and planning.

## 10. Preserved
Auth and owner isolation, assistant messages inserted only by the function, conversation history, credit claim and refund rules (including `execution_outcome_unknown` meaning no refund), idempotent job claim and terminal-race guards, and the verifier and evidence trust rules.

## 11. Offline tests (fake fetch only)
- With the switch off, new jobs use the gateway. With it on, they use `openai_direct`. A request-body override is ignored.
- A resumed or queued old job stays on the gateway. A transport change is rejected.
- A missing key leads to `not_sent`, a definitive failure, a refund and a release, with no network call.
- 5xx, timeout or a cut-off stream leads to uncertain, no resend, no refund, and the reservation held.
- 429 is not retried.
- No gateway fetch happens on any `openai_direct` path.
- Replay sends all reasoning and tool pairs unchanged. Over-limit requests fail closed.
- Day reservations: concurrent reservations never exceed the cap, the same `attempt_id` is idempotent, double release is impossible, and uncertain rows carry across UTC days. This is a pure model test; the SQL is reviewed but not executed.
- **Pilot isolation:** the existing `directProviders`, `directSol61High` and `ordinaryResearchPolicy` tests pass unchanged. A new test proves the ordinary mode never reads the pilot flags or run ID, and that an intake with a pilot marker plus `agent_transport` is rejected.

## 12. Rollback
Set `V2_ORDINARY_TRANSPORT=gateway`, or leave it unset, and new jobs use the gateway right away. Direct jobs already running finish or fail closed. External charges cannot be undone.

## Stages (each needs its own approval)
1. **Offline implementation, switch off:** code and tests only, with no deploy and no migration run. Estimated 4 to 7 build credits. This is an estimate, not a guarantee.
2. **Read-only checks:** the `OPENAI_API_KEY` secret name exists (value never read), plus the `ai_cost_events` constraint and its consumers.
3. **Migration:** the spend table and RPCs from section 6, run only after the SQL is reviewed.
4. **Deploy:** `legal-research-v2` only, with the switch still off.
5. **Turn the switch on and run one approved live trial**, under the owner's limits.

## Risks
- Unknown OpenAI rate limits on the owner's account.
- Uncertain outcomes leave jobs unrefunded until someone reconciles them.
- List-price estimates may not match the invoice.
- Full replay makes later requests larger.
- The live `ai_cost_events` constraints are unknown.

## Owner decisions still needed
1. The per-run native USD ceiling.
2. The daily native USD ceiling.
3. Confirm 16384 as the starting output cap.
4. Confirm that 429 is a definitive failure with a refund, rather than uncertain.
