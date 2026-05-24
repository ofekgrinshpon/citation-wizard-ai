**Diagnosis**

This is the same failure class, but now P6.5 proves the retry branch ran:

```text
claim_analyzer.initial         gpt-5-mini   10.4s  ok:true, but invalid/empty analyzer payload
claim_analyzer.escalated       gpt-5        270ms  ok:false
claim_analyzer.escalated_retry gpt-5        350ms  ok:false
```

The two `gpt-5` failures are too fast to be real model reasoning. They are almost certainly AI gateway transport/provider failures, rate-limit/credit errors, or immediate 5xx-style rejects. Because the current debug only records `ok:false`, we cannot see the exact `http_status`/error body in the UI.

**P6.6 approved-scope proposal**

Keep source quality untouched. Do not change retrieval, Perplexity, verifier, drafter, grounding, citations, or answer quality logic.

**1. Add clear escalation diagnostics**

Update only the analyzer/gateway debug metadata so each escalation attempt records:

- `http_status`
- short `http_error` or `parse_error`
- whether it was retried
- why retry did or did not happen

This will tell us whether the repeated failure is `429`, `402`, `5xx`, network `0`, malformed gateway response, etc.

**2. Retry only true retryable failures**

Replace the current `ms < 2000` heuristic with explicit retry rules:

- Retry: `http_status === 0`, `408`, `429`, `500`, `502`, `503`, `504`, or thrown errors.
- Do not retry: `402` credits/payment, `400/401/403` config/auth problems, or model responses that arrived but failed analyzer schema validation.

Use up to **3 full-model attempts total** for analyzer escalation, with small backoff, for example:

```text
attempt 1
wait 1s
attempt 2
wait 3s
attempt 3
```

This does not weaken answer/source quality. It only gives the high-quality escalation model more than one chance when the gateway rejects immediately.

**3. Stop showing the P2 stub as if it were an answer**

If analyzer escalation fails because all full-model attempts were transport failures, return a clean error state instead of the old P2 stub answer:

- Backend error code: `analyzer_escalation_unavailable`
- Hebrew UI message: “מודל הניתוח המשפטי לא היה זמין רגעית. נסו שוב בעוד דקה.”
- Keep full debug collapsed for development/admin inspection.

This prevents users from seeing `[stub] ...` and thinking a legal answer was generated.

**4. No quality-affecting fallback**

Do **not** proceed to query planning/retrieval using empty or low-confidence claims.

No heuristic claim generation, no cheaper fallback model, no relaxed schema, no fewer sources, no Perplexity reduction, no verifier reduction.

**Files likely touched**

- `supabase/functions/legal-research-v1/stages/claimAnalyzer.ts`
- `supabase/functions/legal-research-v1/lib/types.ts`
- possibly `supabase/functions/legal-research-v1/index.ts` to map analyzer transport failure to a clean job error
- possibly `src/components/LegalResearchV1Panel.tsx` to display that clean error instead of raw JSON

**Validation**

- Re-run the same failing query from the UI.
- If the gateway recovers: answer reaches P5 normally.
- If it still fails: UI shows a clean temporary-unavailable message, not `[stub]` or raw JSON.
- Debug must show exact statuses for all full-model attempts.
- Confirm no changes to retrieval, Perplexity, verifier, drafter, citation/source selection, or source-quality thresholds.