

## Fix: QA History Sidebar — RLS Permission Error

### Root Cause
The `qa_logs` table has an RLS policy "Admins can read all qa_logs" that references `has_role(auth.uid(), 'admin'::app_role)` in the **public** schema. The authenticated role doesn't have EXECUTE permission on `public.has_role`, so PostgreSQL throws `permission denied for function has_role` — and since all permissive policies are evaluated together, this blocks even the user's own SELECT policy from working.

Every other table uses `private.has_role()` which works correctly.

### Fix
Database migration to drop and recreate the admin SELECT policy on `qa_logs` using `private.has_role()`:

```sql
DROP POLICY "Admins can read all qa_logs" ON public.qa_logs;

CREATE POLICY "Admins can read all qa_logs"
  ON public.qa_logs
  FOR SELECT
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));
```

### Files
- Database migration only — no code changes needed

