# Usage statistics in the management panel

The panel already has a **📊 סטטיסטיקות** tab. Rather than adding a second one, this rebuilds that existing tab into a real usage dashboard — how the app is actually being used, over time, per feature, and per user.

## What's there today, and what changes

Today the tab shows seven static counters (total citations, verified sources, counts per source category, registered users) plus a "most cited sources" list. They describe the *source library*, not app usage: no time dimension, no per-feature breakdown, no activity or reliability signal.

The existing counters are kept — moved into a compact "מאגר המקורות" strip at the bottom of the tab, along with the most-cited-sources list — and the usage dashboard below becomes the top of the tab.

## What I checked

Live data volumes today: 2,781 QA runs, 1,983 credit ledger rows, 1,259 research jobs, 746 citations, 508 activity log rows, 18 users. Feature attribution already exists in the data: `qa_logs.task_mode` (research, legal_research_v1, academic_writing, source search, case summary, pleading analysis) and `credit_ledger.reason` (`citation-chat`, `legal-qa:*`, `bibliography-lookup`, `legal-research-v1`, `document-check`). Everything needed is already recorded — no new tracking is required.

At these volumes the numbers can be computed in the browser from a few bounded queries; no new database objects are needed.

## The rebuilt tab

**Time range selector** at the top: 7 days / 30 days / 90 days / all time. Every panel below respects it.


### 1. Headline numbers
- Total actions in range (citations + QA runs + research jobs)
- Active users in range, and new signups in range
- Credits consumed in range (and refunded)
- Average actions per active user

Each shows a comparison against the previous equivalent period (e.g. "+18% vs. previous 30 days").

### 2. Usage over time
A line/area chart of daily activity in the range, with one series per feature family (citation wizard, legal research, legal QA, academic writing, bibliography). Immediately answers "are we growing, and which day was that spike".

### 3. Usage by feature
Horizontal bar list: action count, share of total, credits spent, and distinct users per feature. Sorted by volume. This is where "which parts of the app matter" becomes visible.

### 4. Users
- Top 10 users by actions in range (name/email, plan, actions, credits spent)
- Plan distribution (basic / pro tiers / admin) as counts
- Retention snapshot: users active this week vs. last week, and users who signed up but never performed an action

### 5. Reliability
- Research job outcomes in range: completed / failed / stuck, with failure rate
- Failed requests from the activity log (`request_failed`), grouped by error code — the same signal that surfaced the Shira/Yoel charging bug
- Refund count and reasons

### 6. מאגר המקורות (kept from today)
The current counters — total citations, verified sources, per-category counts, registered users — condensed into one compact strip, with the existing "מקורות הכי מצוטטים" list beneath it. Nothing that exists today is lost.

### 7. Export
A "הורדת CSV" button exporting the daily-activity table for the selected range, so the numbers can be taken into a spreadsheet.

## Technical notes

- Rewrites the `activeTab === "analytics"` block in `src/pages/Admin.tsx`; the tab id, label, and lazy-loading pattern stay as they are. The heavy markup moves into a new `src/components/admin/UsageDashboard.tsx` so `Admin.tsx` doesn't grow further, with the data fetch in a new `useUsageStats(range)` hook.
- `fetchAnalytics` gains the range-bounded queries: `citation_history`, `qa_logs` (id, user_id, task_mode, created_at), `credit_ledger` (user_id, event_type, amount, reason, created_at), `legal_research_jobs` (status, created_at), `activity_logs` (action, details, created_at), `profiles` (created_at, plan). Only the columns needed, refetched when the range changes and bucketed client-side by day.

- Charts use the `recharts` setup already in the project; cards reuse `StatCard` and shadcn components with existing semantic tokens (no hardcoded colours).
- Admin-only, behind the existing `isAdmin` gate. Read-only — no schema changes, no migrations, no writes.
- If volumes grow past a comfortable client-side aggregation (roughly 50k rows), the same panels can be moved behind a single security-definer aggregate function later without changing the UI.
