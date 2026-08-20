# Statistics panel: fix inflated action counts + add per-user drill-down

## What I found about "Ariel Gamrian — 651 actions"

The number is not a bug in the counting math: there really are 651 rows for that account in the last 30 days. They are just not real product usage.

Verified in the database for `arielg1000@gmail.com`:

- 1,095 legal-research rows in the last 90 days, 651 of them in the last 30 days, and **0 in the last 7 days**.
- Every one of those rows carries internal pipeline diagnostics (`run_id`, `stage_runs`, `verifier`, `drafter_v2_full_compare`) — i.e. they were produced by the research validation/regression runs, not by a person using the app.
- The same question repeats dozens of times (e.g. "מהי דוקטרינת ההבטחה המנהלית?" 36 times, "צטטו את סעיף 1 לחוק יסוד..." 36 times) — regression batches.
- 54 of them are `[stub]` placeholder answers and ~190 are "לא נמצא/לא אותר" refusals — failed or non-answer runs still counted as actions.
- The account has only **11 credit-ledger rows** in total, versus 1,095 research rows: these ran on the admin/zero-charge path, before and around the credit-gate work.
- This account holds the **admin** role, together with `ofekgrinshpon@gmail.com`.

So the dashboard is currently reporting developer test traffic as customer usage, which also inflates total actions, active users, actions-per-user and the feature mix (research looks far bigger than it is).

## What to change

### 1. Separate real usage from internal traffic

- Classify each action row as **internal** when it comes from an admin account, or when the log row is a pipeline diagnostic/regression run, or when the answer is a `[stub]` placeholder.
- Add a toggle at the top of the statistics tab: **"הצג שימוש אמיתי בלבד"** (on by default) / include internal traffic. All headline metrics, the daily chart, feature breakdown and the user table respect the toggle.
- Show a small note with how many rows were filtered out, so nothing looks silently missing.
- Count failed/refused answers separately (a "הצלחה" column per feature) instead of treating them as normal actions.

### 2. New "חיפוש משתמש" drill-down

- A search box above the user table (name / email), with live filtering over all users, not just the top 10.
- Selecting a user opens a per-user panel showing, for the selected time range:
  - total actions, real vs internal split, credits spent, credits refunded, current balance and plan;
  - **breakdown by section**: אשף האזכורים, הערות שוליים, מחקר משפטי, שו״ת, כתיבה אקדמית, ביבליוגרפיה, ניתוח מסמכים — each with action count, credits and success rate;
  - a daily mini-chart of that user's activity;
  - the last ~50 individual actions (time, section, short question/input, outcome, credits) with a link into the existing ledger drill-down;
  - CSV export of that user's actions.

### 3. Small fix that is blocking the build

`src/components/BatchFootnoteBuilder.tsx` fails to compile: TypeScript is not narrowing the pool result union at line 234 (`result.error`). Fix by giving the pool callback an explicit discriminated check (assign `result` to a typed local, or expose `ok`/`error` via a type guard in `src/lib/concurrency.ts`).

## Technical notes

- `src/hooks/useUsageStats.tsx`: add an `internal` flag to the `Event` type; derive it from the admin user-id set (fetched from `user_roles`), from `metadata->'run_id'`/`stage_runs` presence on `qa_logs`, and from `[stub]` answer prefixes. Add `outcome` (`answered` | `refused` | `stub`) per event. Expose `excludeInternal` as a hook argument and return `internalCount`.
- New `src/hooks/useUserUsage.tsx`: given a `userId` and range, fetch that user's `citation_history`, `qa_logs`, `credit_ledger` and `activity_logs` rows (bounded, `.limit(500)`) and aggregate per section/day.
- New `src/components/admin/UserUsageDrilldown.tsx` rendered inside `UsageDashboard`; reuse the existing chart tokens (`--chart-1`…`--chart-7`) and the existing ledger dialog.
- Footnote batch actions currently land in `citation_history` like wizard actions; separate them using the existing per-row source marker so the section breakdown can tell אשף האזכורים from הערות שוליים.
- No database migration required — all of this reads existing tables.
