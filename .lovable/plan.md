# Answer: Q3 time/cost after 19e2bba (read-only, no implementation)

Evidence: code reads only, plus the Lovable gateway Responses docs. I made no infrastructure log queries, provider calls or edits.

## 1. Function lifetime and termination reason
- **Fact (code):** chunks run as a background task through `EdgeRuntime.waitUntil` (index.ts:1670, 1949, 1985, 2022) and hand off through a self-invocation (beta/resumeHandoff.ts). Heartbeats come from a timer (shared/providerLiveness.ts, 30 s keepalive, 300 s renewal window). The watchdog treats a run as stale after 180 s (beta/resumePolicy.ts:21).
- **Inference:** the timer was set when the call began at 18:03:05. If it stopped at about 18:04:35, about 90 s into the call and well inside the 300 s window, the isolate was probably killed or frozen. Our code did not stop it. Recovery at about 18:08 fits 18:04:35 + 180 s stale + a sweep interval.
- **Assumption (not verified):** generic Supabase Edge limits are about 150 s idle and a wall clock of 150 s (free) or 400 s (paid), counted from when the invocation starts, not from when the call starts. I could not confirm this function's tier or effective limits. Platform metadata available to me doesn't show a termination reason (wall clock, CPU, memory or shutdown) without reading function logs. I did not read them.
- **Unknown:** the tier, the exact limits, the kill reason, and the invocation start time of the Q3 chunk that died.

## 2. Durable background Responses / polling
- **Verified from gateway docs:** the gateway is stateless. It forces `store: false` and strips `previous_response_id` (knowledge ai-apps-openai-responses/references/history.md:3, 20). OpenAI's `background: true` mode and `GET /responses/{id}` both need stored responses, so neither is available through this gateway.
- **Not verified:** any other resumable or long-running mechanism (a job ID or webhook). None is documented. I did not probe for one.
- **Conclusion:** a finished Astra output is lost if the worker dies before the stream ends. It must be streamed to completion inside one live invocation.

## 3. The 57/61 calls with exactly 4671 cached tokens
- **Likely explanation (from code):** the prompt changes early in every call, so only the fixed opening ever matches.
  - The fixed opening is the system prompt plus `buildAgentUserMessage` (researchAgent.ts:539-549), sent along with the tool specs.
  - Every turn, `compactAgentMessages` (agent/contextWindow.ts:41-66) cuts older tool and assistant messages down. Only the last 4 tool messages stay intact, so earlier messages change from turn to turn.
  - The rolling state message is dropped and appended again with fresh content each turn (contextWindow.ts:69-71; researchAgent.ts:625).
  - When `forceMemo` is on, the tool list shrinks to the memo tool only (researchAgent.ts:639). That changes the tool definitions, which come before the input, so the cache breaks even earlier. This may explain the 4 calls that didn't match.
- **Unconfirmed:** that 4671 tokens equals the size of the system prompt + tools + first user message. This needs a token count of that fixed part.
- **What the gateway shows:** from earlier telemetry parsing, only usage `cached_tokens` (input token details). There is no documented cache-write count and no `prompt_cache_key` or retention control on the Lovable gateway. Whether it forwards `prompt_cache_key` is unknown and was not tested.

## 4. Smallest architecture changes (described only)
1. **Don't replay an unfinished call:** keep each chunk well under the effective wall-clock limit. Measure from when the invocation starts, and don't begin an Astra call unless there is enough time left for its typical length. Otherwise hand off first, so the call starts in a fresh invocation. An interrupted call is still lost (because of point 2), but there are fewer of them.
2. **Stable prefix:** keep the history append-only. Never rewrite earlier messages. Put the rolling state and compacted digests at the end only, or compact rarely and at fixed points, so the prefix stays the same between those points.
3. **Keep the tool list constant:** always send the full tool list. Force the memo by setting `toolChoice` only, rather than shrinking the list.
4. Optionally pass `prompt_cache_key` per run, if the gateway is shown to forward it.

None of these change the model, the reasoning effort, the research limits or the verification checks.

## Remaining unknowns
- The function's tier, effective limits, and why the Q3 worker died.
- Whether the 4671 tokens equals the size of the fixed opening.
- Whether the gateway forwards `prompt_cache_key` or reports cache writes.
- Whether a gateway route other than `/v1/responses` has a resumable or background mode.
