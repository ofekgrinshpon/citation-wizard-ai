

## Fix: Legal QA Timeout — Keep Full Citations, Fix the Timer

### What's Actually Wrong
The 40-second AI timeout is too short for Gemini Flash to process the full prompt and generate a complete legal memo with tool-calling. The model needs ~45-50 seconds for complex queries. When attempt 1 is killed at 40s, the retry starts with almost no time left and produces a tiny fragment.

The citation rules are NOT the bottleneck — they're ~3KB of text which Flash handles fine. The bottleneck is the combination of prompt + tool-calling + generation length.

### The Fix (No Trimming Required)

**1. Increase AI timeout from 40s → 55s** (`index.ts` line 326)
- Perplexity + local search run in parallel and finish in ~12s
- Edge functions allow up to 150s on paid plans
- 55s gives Flash plenty of room to generate a full memo with all citation rules intact

**2. Make retry actually useful — don't repeat the same call**
- Currently both attempts use the identical heavy payload, which is wasteful
- If attempt 1 times out at 55s, there's no time for attempt 2 anyway
- Change strategy: remove the retry loop entirely and use a single call with the longer timeout
- If it fails, return a clear error immediately instead of wasting time on a doomed retry

**3. Keep everything the user wants**
- Full citation rules — no trimming
- Full context (6000 chars) — no reduction
- Full tool-calling with structured footnotes
- 8192 max_tokens for long output

### What Changes
- `supabase/functions/legal-qa/index.ts`:
  - Line 326: timeout `40000` → `55000`
  - Lines 313-395: Remove retry loop, use single attempt with proper error handling
  - All citation rules, context, and quality settings stay exactly as they are

### Why This Works
The previous approach (40s + retry) was self-defeating: the timeout was too short for success, and the retry had no time left. A single 55s attempt gives the model the time it actually needs, and the parallel search/Perplexity (already implemented) ensures the total function stays well within edge function limits.

