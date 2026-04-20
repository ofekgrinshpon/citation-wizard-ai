

## Goal
Extend the credits/pricing system (pending implementation) with two production-grade features:
1. **Refundable credit flow** — credits are restored automatically when a paid action fails technically or returns an empty/not-found result, backed by an auditable ledger.
2. **Referral loop** — every user gets a personal referral code; both sides receive 10 bonus credits when a new user signs up via the link and completes their first successful in-app action.

These extend the previously approved credits plan (4 plans + admin, `consume_credits` RPC, `useCredits` hook) — they do not replace it.

---

## Part 1 — Refundable credit flow

### Database

**New table `credit_ledger`** (the source of truth; `profiles` balances become a cached projection):
- `id uuid pk`
- `user_id uuid not null` (FK auth.users)
- `request_id text not null` (client-generated UUID per paid action)
- `event_type text` check in `('consume','refund','topup','renewal','admin_adjustment','referral_bonus','signup_bonus')`
- `amount int not null` (positive for credit-add events, negative for `consume`)
- `included_delta int not null default 0`, `topup_delta int not null default 0` (which bucket moved)
- `balance_after_included int not null`, `balance_after_topup int not null`
- `reason text`, `metadata jsonb default '{}'`
- `created_at timestamptz default now()`
- **Unique index** `(user_id, request_id, event_type)` → makes consume/refund idempotent.

RLS: users `SELECT` own rows; admins `SELECT` all; inserts only via security-definer RPCs.

**Updated RPCs** (replace the previously planned signatures):
- `consume_credits(_amount int, _reason text, _request_id text) returns jsonb`
  - Admin: insert ledger row with zero deltas, return ok.
  - Idempotent: if a `consume` row already exists for `(user_id, request_id)`, return the prior result.
  - Atomic: lock profile row, drain included first then topup, write ledger row, return `{ ok, request_id, remaining_included, remaining_topup }`. On insufficient → `{ ok:false, error:'INSUFFICIENT_CREDITS', remaining_* }`.
- `refund_credits(_request_id text, _reason text) returns jsonb`
  - Idempotent: if a `refund` row exists for `request_id`, return prior result.
  - Looks up the matching `consume` row; restores the same `included_delta`/`topup_delta` to the same buckets; writes a `refund` ledger row; returns updated balances.
  - No-op + ok response if no matching consume exists (defensive).
- `add_topup_credits`, `set_user_plan`, `reset_or_renew_credits` from the prior plan also write ledger rows (`topup` / `renewal` / `admin_adjustment`).

### Edge functions (`legal-qa`, `citation-chat`, future paid endpoints)

Pattern applied uniformly:
1. Read `requestId` from the request body (client generates one per call).
2. Call `consume_credits(cost, reason, requestId)`. If `INSUFFICIENT_CREDITS` → return HTTP 402 + `{ remaining_* }`.
3. Wrap the rest in `try/catch`. **Refund triggers**:
   - Any thrown exception (Lovable AI gateway failure, Perplexity timeout, parse error, OCR/convert-doc failure, etc.).
   - `legal-qa` returns no usable answer (e.g. `answer` empty/whitespace, or `footnotes.length === 0` AND body length < 80 chars, or the model returned the explicit "לא נמצאו מקורות" sentinel we already detect for the empty-state UI).
   - `convert-doc` / document-grounding pre-step fails before the QA call runs → refund the QA cost too (since nothing meaningful was produced).
4. On refund: call `refund_credits(requestId, reason)` and add `{ refunded: true, refundReason }` to the response payload. Frontend uses this to show the toast.
5. On success that is genuinely meaningful (non-empty answer with at least one footnote *or* ≥80 chars of body): keep deduction, no extra action.

### Frontend

- **`useCredits.consume(amount, reason)`** generates a `requestId` (`crypto.randomUUID()`), passes it through to the edge function call, and returns it to the caller so the same id can be used for downstream refunds. Client-side actions (batch builder, bibliography per-item) call `consume_credits` then `refund_credits` themselves on failure using the same id.
- **`useCreditLedger()`** hook fetches recent ledger rows for the Profile usage table.
- **Refund toast**: when an edge function response includes `refunded: true`, show `toast.info("הפעולה נכשלה והקרדיטים הוחזרו אוטומטית")` and call `refresh()` on the credits hook.
- **Profile → "ניהול חשבון" / "היסטוריית שימוש"** table is sourced from `credit_ledger` (replacing the previously planned `activity_logs` source). Columns: date, action (translated `event_type` + `reason`), amount (signed), balance after. Refund rows render in green with a small "הוחזר" badge.

---

## Part 2 — Referral loop (10 + 10 credits, post-first-action grant)

### Database

**Add columns to `profiles`**:
- `referral_code text unique not null` — generated on insert (8-char base32, e.g. `R7K2QX9F`)
- `referred_by_user_id uuid references auth.users(id)` (nullable, set once at signup, never updated)
- `referral_bonus_granted boolean not null default false` — per the *referred* user; flips to true when their first paid action succeeds and triggers the dual reward
- `referral_first_action_at timestamptz` (audit)

**`handle_new_user` trigger** is extended:
- Generate a unique `referral_code` (retry on collision).
- If `raw_user_meta_data->>'referral_code'` is present and resolves to an existing user that is **not** the new user, set `referred_by_user_id` accordingly. Self-referral is rejected silently.

**New RPC `grant_referral_bonus_if_eligible(_user_id uuid) returns jsonb`** (security definer):
- No-op if `referral_bonus_granted = true` or `referred_by_user_id IS NULL`.
- Inside a single transaction:
  - Set `referral_bonus_granted = true`, `referral_first_action_at = now()`.
  - Add 10 to the new user's `topup_credits_remaining` + ledger row `event_type='referral_bonus'`, `request_id = 'referral:<new_user_id>:referee'`.
  - Add 10 to the referrer's `topup_credits_remaining` + ledger row with `request_id = 'referral:<new_user_id>:referrer'`.
- Idempotent via the boolean flag AND the unique `(user_id, request_id, event_type)` index on the ledger (defense in depth).

**Trigger**: invoke `grant_referral_bonus_if_eligible(NEW.user_id)` after every successful `consume` ledger insert (positive consume i.e. real deduction, not admin). This implements the "first successful in-app action" rule with no edge-function changes.

### Frontend

- **Signup flow** (`Auth.tsx` / `AuthDialog.tsx`):
  - Read `?ref=<code>` from URL on mount; persist to `sessionStorage` so it survives the OAuth round-trip.
  - On `signUp`, pass `{ data: { referral_code: storedRef } }` so the trigger picks it up.
  - Show a small banner when a ref code is present: "הצטרפת דרך הזמנה — לאחר הפעולה הראשונה שלך תקבלו שניכם 10 קרדיטים."
- **Profile → new "הזמן חברים" section**:
  - Display personal `referral_code`.
  - Copy-link button (`https://relexlm.com/auth?mode=signup&ref=<code>`).
  - Short Hebrew explainer per spec (using 10 credits, post-first-action).
  - Read-only counter: total referrals granted (`SELECT count(*) FROM profiles WHERE referred_by_user_id = me AND referral_bonus_granted = true`).
- **Admin `UsersTable.tsx`**:
  - Two new read-only columns: `referral_code`, `referred by` (resolves to email).
  - Tooltip on the row shows total referral bonuses paid out to that user (sum of `referral_bonus` ledger rows).

---

## Out of scope

- Real payment integration (still stubbed, per prior plan).
- Refund of partially-successful results (e.g. QA returned a body but Perplexity failed) — kept as a "success with degraded sources" toast; no refund.
- Multi-step referral campaigns / tiered rewards.
- Anti-fraud beyond: self-referral block, single-grant-per-referred-user, idempotent ledger, post-first-action gate. Email/IP heuristics deferred.

---

## Files touched (additions to the prior credits plan)

- New migration: `credit_ledger` table + RLS, updated `consume_credits` / `refund_credits` / `add_topup_credits` / `set_user_plan` / `reset_or_renew_credits`, `grant_referral_bonus_if_eligible`, ledger trigger, `profiles` referral columns, updated `handle_new_user`.
- `supabase/functions/legal-qa/index.ts` — request-id intake, try/catch refund, empty-result detection.
- `supabase/functions/citation-chat/index.ts` — same pattern with cost = 1.
- `supabase/functions/convert-doc/index.ts` — refund hook for failed parses (when called as part of a paid grounding flow).
- `src/hooks/useCredits.tsx` — request-id generation, `consume(reason)` / `refund(requestId, reason)` API.
- `src/hooks/useCreditLedger.tsx` (new) — paginated ledger reader for the usage history table.
- `src/lib/refundResponse.ts` (new) — shared helper that detects `{ refunded:true }` in edge responses and fires the toast.
- `src/pages/Auth.tsx`, `src/pages/AuthDialog.tsx` — `?ref=` capture + signup metadata.
- `src/pages/Profile.tsx` — usage history sourced from `credit_ledger`; new "הזמן חברים" card.
- `src/components/admin/UsersTable.tsx` — referral columns.
- `src/pages/LegalQA.tsx`, `src/components/BatchFootnoteBuilder.tsx`, `src/components/BibliographyGenerator.tsx`, `src/pages/Index.tsx` — adopt the new `consume(reason)`/refund-on-error pattern.

## Expected outcome

- Every paid action that fails technically or yields no real result silently returns the credits and shows a Hebrew "הוחזרו אוטומטית" toast; the refund is visible in the user's history.
- Users can share `relexlm.com/auth?mode=signup&ref=R7K2QX9F`. When the invitee signs up and runs their first successful action, both sides instantly see +10 top-up credits and a ledger entry. Self-referral, double-grants, and replays are all blocked at the DB level.

