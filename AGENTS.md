
- Legal assistant UI is conversation-based (research_conversations/research_messages); legal_research_jobs link via conversation_id and stay internal. Why: chat UX where jobs are an execution detail.
- Assistant chat messages are inserted only by the legal-research-v2 function (service role). Why: users cannot forge assistant replies.

- Citation-pipeline provider cost telemetry goes through `_shared/costTelemetry.ts` (`trackedFetch` + AsyncLocalStorage context) into service-role-only `ai_cost_events`; telemetry ids are never sent as billing `batchId`. Why: per-attempt USD attribution without mixing concurrent requests or changing billing.
- Cost telemetry v2: stages come from a bounded enum passed explicitly at each provider call site; zero-work (cache/deterministic) events are metadata-only (provider none, USD 0) and client-reported ones go only through the authenticated allowlisted `cost-telemetry-event` function. Why: per-attempt attribution without forgeable paid events.
- legal-research-v2 paid-provider telemetry: model.ts records each attempt via beginAttempt (observe-only, Responses SSE terminal usage), Perplexity via trackedFetch; each driveRun chunk gets its own context (request id = run UUID, batch id = per-invocation UUID). Why: per-attempt cost attribution across background/resumed chunks without changing wire requests or billing.
