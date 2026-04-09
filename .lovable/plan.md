
Goal: stop the admin ingestion flow from “disconnecting” the user in the middle of fetch/upload, and make resume reliable.

What I found
- The disconnect toast is coming from one place only: `src/components/admin/ApifyIngestionPanel.tsx`.
- `getAuthHeaders()` currently calls `supabase.auth.refreshSession()` every time:
  - before each Apify page fetch
  - before each ingestion batch
  - again on retries
- During long runs this means the app is repeatedly rotating the session while many requests are still in flight. If one refresh fails or the stored session gets out of sync, the panel throws:
  - `לא מחובר – יש להתחבר מחדש`
- The session replay matches this exactly: ingestion was progressing normally through page 13, then the UI suddenly switched back to idle and showed the reconnect toast.
- Network logs show refresh-token requests are happening during ingestion, so auth refresh is definitely part of the hot path.
- The edge function logs do not show a backend crash at that exact moment; the interruption is more consistent with client-side auth/session handling than with document ingestion itself.

Implementation plan

1. Stabilize auth usage in `ApifyIngestionPanel`
- Replace the “refresh on every batch” approach.
- Change `getAuthHeaders()` to:
  - first read the current session with `supabase.auth.getSession()`
  - use the current access token if it exists
  - only try `refreshSession()` as a fallback when there is no valid session/token
- Cache the access token for the current run and refresh only on explicit auth failure (401/403), not preemptively on every request.

2. Add resilient request wrappers
- Create small helpers for:
  - calling `fetch-apify-dataset`
  - calling `apify-ingest-cases`
- If a request returns 401/403:
  - attempt one token refresh
  - retry that same request once
- If refresh still fails:
  - pause the run instead of behaving like a full logout
  - preserve progress and remaining work in component state

3. Preserve full resume state for streamed ingestion
- Right now pause/resume inside Apify mode only keeps the remaining items from the current page.
- Add resume state for:
  - current Apify source (`actorId` / dataset)
  - current `offset`
  - current page number
  - current accumulated totals
  - any remaining items in the current page
- Result: clicking “Resume” continues from the exact stopped point, not from the beginning and not only from a partial batch snapshot.

4. Make disconnect messaging more accurate
- Separate:
  - temporary auth refresh failure
  - network timeout
  - backend worker issue
- Show a clearer paused state such as:
  - “החיבור פג זמנית – אפשר להמשיך מאותה נקודה”
  instead of implying the whole app is signed out.
- Keep the buttons disabled/enabled based on paused state so the user can continue without confusion.

5. Protect the admin page from accidental redirect during transient auth churn
- In `src/pages/Admin.tsx`, the page redirects to `/` when `!user || !isAdmin`.
- I’ll tighten this logic so brief session-transition states during token refresh don’t kick the user out of admin while a long-running job is active.
- The redirect should only happen after auth is clearly resolved, not during temporary refresh turbulence.

6. Verify related behavior after the fix
- Confirm the document counter and progress text still update during long ingestion.
- Confirm duplicate skipping still works as before.
- Confirm pause/resume continues safely after a simulated auth hiccup.
- Confirm no change is needed in the ingestion edge functions for this specific disconnect bug.

Technical details
```text
Current problem flow:
batch/page start
→ refreshSession()
→ token rotates repeatedly
→ one refresh/session sync fails
→ "not connected" error thrown
→ UI exits ingestion loop

New flow:
batch/page start
→ getSession()
→ use existing token
→ request
→ only on 401/403: refresh once + retry once
→ if still failing: pause and keep resume checkpoint
```

Files to update
- `src/components/admin/ApifyIngestionPanel.tsx`
- `src/pages/Admin.tsx`

Expected result
- The user should no longer be “suddenly disconnected” mid-ingestion due to aggressive session refreshing.
- Long Apify runs should pause gracefully on real auth problems and continue from the same spot.
- The app should stay on the admin screen instead of feeling like it logged out unexpectedly.
