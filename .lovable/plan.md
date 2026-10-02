# Status answer (read-only, no plan to implement)

## 1. Is legal-research-v2 running commit 9ac6c06?
**Not established.**
- **Verified:** the newest lifecycle event for function `0da654a2-a345-40f6-88e2-04ee5cefb072` was at 02:35:40 UTC, on platform version **351**.
- **Verified:** queries for boot and shutdown events after 02:34 UTC return nothing, and that includes the period after the 03:05:44 deploy. No worker has started since then, so no new function version has been seen yet.
- **Not visible to me:** the status of deployment `a8e7b484…`. The function metadata doesn't link any version number to a git commit. Version 351 is not linked to 4a2b6c8 either.
- **What would prove it:** a deployment record that maps a function version above 351 to commit 9ac6c06, with its deploy time. Only the platform or support can supply this. Without that, the earliest proof is the first boot event showing a version above 351. Even then, the mapping to the commit can only be inferred.
- Note: deploying the site (publishing) doesn't necessarily redeploy backend functions. So the frontend going live is not proof that the backend changed.

## 2. Facts relevant to a single Q2 experiment capped at $10
**Output caps (gateway documentation, skill `ai-apps-openai-model-parameters`):**
- The documentation says how to cap output for `openai/gpt-6*` and Astra. On chat-completions, use `max_completion_tokens`; `max_tokens` is rejected. Astra requires reasoning (low to max).
- It does **not** say whether the cap includes reasoning tokens. It also does not say whether the gateway guarantees to enforce the cap on `/v1/responses`, which is the route Astra uses here. Nothing found covers Gemini.
- Our V2 code sends no output-cap field at all: there is no match for `max_output_tokens`, `max_tokens` or `max_completion` in legal-research-v2.

**Sonar search (V2 code):**
- `tools/search.ts:62` calls Perplexity directly with `model: "sonar"`, not through the gateway. `tools/rawWebSearch.ts` uses Perplexity's `/search` route.
- No step limit, tool limit or output limit is set in either file. The legacy `_shared/partyLookup.ts:178` uses `sonar-pro`.

**Hard spend controls:**
- No existing control was found that blocks spend per experiment or per request before a call is made.
- The only money-related signals are the workspace AI limit (a gateway credit cap for the whole workspace, not per experiment) and the after-the-fact `ai_cost_events` table. Neither one limits a call that is already running.

**Prices vs gateway billing:**
- Official provider price lists are public. The gateway's per-token billing rate for Astra and Gemini isn't documented, and we have no verified Astra price.

## Missing facts to get from the platform or support
1. A mapping of deployment `a8e7b484` to the function version and the commit.
2. Whether the gateway enforces `max_completion_tokens` or `max_output_tokens` on `/v1/responses` for Astra, and whether reasoning tokens count toward it.
3. The gateway's billing rates for Astra and Gemini.
4. Whether a per-request or per-key spend cap exists.
5. Perplexity: whether Sonar charges for its internal search steps, and whether any account-level cap exists.
