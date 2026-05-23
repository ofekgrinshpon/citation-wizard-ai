## Goal
Remove the per-stage percentage range labels (e.g. `0–8%`, `8–30%`) shown next to each category in the Deep research progress list. Keep the top progress bar's `{percent}%` indicator unchanged.

## Change
**File:** `src/components/StageProgressList.tsx`

1. Delete the `bandText` computation (lines 320–322).
2. Delete the `{bandText && !isPending && (...)}` `<span>` block (lines 351–355) that renders the range next to each row.

No other logic, no backend, no top-bar changes.