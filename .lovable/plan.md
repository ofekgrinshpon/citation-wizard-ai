
Fix target: make login feel instant again and prevent the app from hanging right after sign-in.

What I found:
- This does not look like a browser-memory problem from “50k embeddings” on the auth page itself.
- The auth flow only touches auth/session data plus small tables like `user_roles`, `profiles`, and `projects`.
- The likely connection is post-login load: admins are redirected straight to `/admin`, and `src/pages/Admin.tsx` immediately runs several heavy queries, including:
  - exact count on `legal_document_chunks`
  - full `select("source_type")` over `legal_documents`
  - multiple large table reads in parallel
- With ~361k chunks and active embedding work, that can make it seem like “Google login loads forever” even if sign-in already succeeded.

Plan:
1. Make post-login lightweight
- Keep authentication separate from heavy admin analytics.
- After sign-in, send users to a lightweight shell/loading state first instead of triggering all admin queries immediately.
- Only load admin analytics after the route is mounted and the session is clearly ready.

2. Refactor `src/pages/Admin.tsx`
- Split the current `fetchData()` into smaller tab-specific fetches.
- Do not load everything in one `Promise.all`.
- Remove expensive “load all source types then count in JS” behavior.
- Replace chunk/document totals with lighter summary queries or a backend summary function/view.

3. Reduce expensive startup reads
- Review `useProjects`, `useSubscription`, sidebar/profile reads, and make them fail-soft:
  - add error handling
  - avoid blocking the whole app if one query stalls
  - render UI shell while secondary data loads

4. Harden OAuth landing flow
- Update the Google redirect target to a dedicated callback route instead of the bare site root.
- Use that callback page to wait for session hydration, then redirect to `/app` or `/admin`.
- Show a visible error state if callback/session setup fails instead of appearing stuck.

5. Verify backend pressure
- Check auth/database logs to confirm whether the database is timing out under embedding load.
- If confirmed, temporarily pause/throttle embedding while testing auth, or move admin stats to precomputed summaries.

Files likely involved:
- `src/pages/Admin.tsx`
- `src/pages/Auth.tsx`
- `src/hooks/useAuth.tsx`
- `src/hooks/useProjects.tsx`
- `src/hooks/useSubscription.tsx`
- possibly `src/App.tsx` for a dedicated post-auth callback/loading route

Technical details:
- Main suspected hotspot is `Admin.tsx` initial `fetchData()` doing broad reads across `citation_history`, `profiles`, `verified_sources`, `legal_documents`, `legal_document_chunks`, and `qa_logs`.
- `legal_document_chunks` exact counts are especially likely to get slower as the embedding corpus grows.
- This is a backend/query-load issue, not “the app holding 50k chunks in browser memory”.
- If you are an admin user, the problem would show up exactly as a login hang because admins are routed into the heavy dashboard immediately.

Expected result:
- Email/Google sign-in completes normally.
- Users reach the app quickly even while background/admin data is still loading.
- Admin dashboard becomes incremental instead of blocking the whole session on large-table queries.
