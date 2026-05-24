## Problem
When a history item is clicked, `setTaskMode(externalResult.taskMode)` can set a value that isn't present in `TASK_MODES` (legacy mode IDs from older sessions). `activeMode = TASK_MODES.find(...)` returns `undefined`, then `activeMode.placeholder` at line 3167 throws.

## Change

**`src/components/LegalQAChat.tsx` line 2194**

- From: `const activeMode = TASK_MODES.find((m) => m.id === taskMode)!;`
- To: `const activeMode = TASK_MODES.find((m) => m.id === taskMode) ?? TASK_MODES[0];`

This falls back to the first mode (research) so `.placeholder` and other reads stay safe. No other code changes.

## Out of scope
History storage format / migration of legacy mode IDs.
