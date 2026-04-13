

## Fix: QA History Should Be Strictly Per-Project

### Problem
Line 62 of `QAHistorySidebar.tsx` uses `.or(`project_id.eq.${projectId},project_id.is.null`)`, which shows all legacy logs (with null project_id) in every project's history. Each project should only show its own logs.

### Change

**File: `src/components/QAHistorySidebar.tsx`** (line 61-63)

Replace the `or` filter with a strict `eq` filter:

```typescript
// Before
if (projectId) {
  query = query.or(`project_id.eq.${projectId},project_id.is.null`);
}

// After
if (projectId) {
  query = query.eq("project_id", projectId);
} else {
  query = query.is("project_id", null);
}
```

This ensures:
- When a project is selected → only that project's logs appear
- When no project is selected (edge case) → only unassigned logs appear

No database or edge function changes needed.

