# Credits in the management panel: why they look frozen, and how to fix it

## What I checked

I queried the live database (profiles + credit ledger) and read the charging code.

Findings:

1. **The panel shows the right field.** The users table reads `included_credits_remaining` / `topup_credits_remaining` from the profile row. Those numbers are genuinely not moving.
2. **Real usage in August produced zero charge records.** Four non-admin users (gili, kfir, omer, yoel) generated citations on Aug 10–11, and none of them has a single `consume` row in the credit ledger. Their balances are untouched (20/20, 3595).
3. **One "user" is actually an admin.** `arielg1000@gmail.com` has plan `basic` but holds the `admin` role. Admin accounts are intentionally charged zero — their ledger shows 6 research calls in May with the balance staying at 20. So for that account, unchanged credits are correct behaviour, not a bug.
4. **The charge is currently fail-open.** In `citation-chat`, if the credit RPC returns an error the code logs it and continues without charging. Combined with the recent removal of the legacy frontend charge, a silent RPC failure now means the query is completely free and leaves no trace anywhere.
5. **Legal Research never charged at all** (the leak fixed earlier in this project) — that fix must be confirmed deployed.

I could not yet see, in the retained function logs, the exact reason the August citation calls skipped the charge — the log window no longer covers them. That is why step 1 below is instrumentation, not a guess.

## Plan

### 1. Make charging observable and fail-closed
- Log every credit decision in `citation-chat` and the other charging functions: user id, request id, amount, RPC outcome, and which early-return branch (verified-source short-circuit, invalid input, etc.) was taken.
- Stop swallowing RPC errors: if the charge cannot be recorded, return a clear error instead of serving the query for free. Keep genuinely free paths (exact verified-source hit, invalid input) explicitly free and logged as such.
- Re-run a real citation query end to end and confirm a matching ledger row appears.

### 2. Confirm Legal Research charging is live
- Verify the deployed `legal-research-v1` actually consumes 5 credits and refunds on failure, with a ledger row per run.

### 3. Make the management panel trustworthy
- Add a **Refresh** action and auto-refresh on tab focus so the numbers are never a stale snapshot.
- Show, per user: used / remaining out of the monthly allowance, plus **last activity** and **last charge** timestamps. When a user has recent activity but no recent charge, mark the row so this class of bug is visible immediately.
- Label accounts with the admin role as **unlimited (not charged)** so they are no longer mistaken for a broken counter.
- Add a per-user drill-down listing recent ledger entries (consume / refund / renewal) so you can see exactly where the credits went.

### 4. Backfill decision (your call)
Past uncharged usage can be left alone, or the affected accounts can be adjusted manually. Nothing is deducted retroactively without your approval.

## Technical notes
- Charging path: `consume_credits` / `refund_credits` RPCs, called with the caller's token from the edge functions; admin plan or admin role produces a zero-delta ledger row by design.
- Panel data source: `profiles` via a one-shot fetch in the admin users tab; enriched with a ledger aggregate query for the new columns.
- No schema changes required; the ledger already stores everything needed.
