

## Fix: Legal QA Edge Function Timeout

### Root Cause
The function runs three sequential network calls (local DB search → Perplexity → Gemini Pro) that together exceed the edge function's ~60s execution limit. Switching to `gemini-2.5-pro` made this worse because Pro is significantly slower than Flash.

### Changes — `supabase/functions/legal-qa/index.ts`

**A. Switch back to `gemini-2.5-flash`** (line 320)
- Pro is too slow for edge function constraints. Flash is fast enough and handles tool-calling well.
- Keep `max_tokens: 8192` for long output.

**B. Run Perplexity and local search in parallel** (lines 149-255)
- Currently sequential. Use `Promise.all` to run both at the same time, saving ~10s.

**C. Add AbortController timeouts to all external calls**
- Perplexity: 15s timeout
- Gemini: 40s timeout
- This prevents any single call from consuming the entire budget.

**D. Slim down the prompt**
- Reduce `combinedContext` to max 6000 chars (currently unbounded — 8 local chunks + full Perplexity response can be huge).
- Reduce Perplexity results and local matches from 8 to 5 each.

**E. Always return HTTP 200 with structured JSON**
- All error paths return `{ error: "..." }` with status 200 so the client can always read the body.

### Files Changed
- `supabase/functions/legal-qa/index.ts` — model switch, parallel calls, timeouts, context trimming
- Redeploy edge function

