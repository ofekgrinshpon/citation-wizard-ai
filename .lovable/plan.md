# "אין מספיק קרדיטים" in the bibliography maker — real cause

## What I verified

- Your account (`ofekgrinshpon@gmail.com`) is genuinely admin: plan `admin` + `admin` role. The database charge routine bypasses admins, so your own credits are not the problem.
- Your `activity_logs` from 04:47–04:48 today show ~15 failures, all identical:
  `fn: citation-chat, status: 402, code: "Payment required."`
- That exact code is not the app's own credit error (`INSUFFICIENT_CREDITS`). It is produced only when the **AI gateway** answers 402 — i.e. the workspace-level AI balance used to run the models is exhausted/blocked, not your user credits.
- The frontend maps any 402 to the Hebrew text "אין מספיק קרדיטים", which is why a platform-side billing error is shown to you as a personal credit shortage.

So: two separate problems — a real AI-balance outage, and a misleading error message that hides it.

## Plan

### 1. Restore AI capacity (the actual blocker)
Confirm the workspace AI balance and top it up in Settings → Cloud & AI balance. Until that is done, every citation, bibliography row, footnote and research call will fail the same way, for all users.

### 2. Stop mislabelling gateway 402 as a user credit problem
In `citation-chat` (and the other functions that proxy the AI gateway), return a distinct code for gateway exhaustion, e.g. `AI_UNAVAILABLE` with HTTP 503, instead of a bare 402 "Payment required.".
In `src/lib/functionError.ts`, only show "אין מספיק קרדיטים" when the body code is `INSUFFICIENT_CREDITS`; a gateway outage gets its own Hebrew message ("השירות אינו זמין כרגע עקב מגבלת ספק ה-AI — נסו שוב מאוחר יותר").

### 3. Refund credits on gateway failures
`citation-chat` charges 1 credit **before** calling the model, and the 402 and 429 early-returns skip `refundIfCharged`. Paying users who hit today's outage were charged for nothing. Add `refundIfCharged("ai_gateway_402" / "ai_gateway_429")` on both branches, matching the existing exception path.

### 4. Bibliography-specific behaviour
Bibliography fires several rows at once, so one outage produces a wall of identical red rows. Surface a single banner when all rows fail with the same gateway code, and keep the per-row "נסה שוב" for genuine per-row errors.

### 5. Backfill check
After the fix, list `credit_ledger` consumes from the outage window with no matching refund and refund those users, so no one loses credits to today's failures.

## Technical notes
- Charging point: `supabase/functions/citation-chat/index.ts` ~line 1728 (`consume_credits`), gateway error handling ~line 3435.
- Client mapping: `src/lib/functionError.ts` `messageFor()` — the `status === 402` branch is what produces the wrong Hebrew text.
- No schema changes needed.
