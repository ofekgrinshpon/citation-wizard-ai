
Goal: fix the new “blank page with endless spinner after sign-in” state shown in the screenshot.

What I found
- This does not look like browser memory from the embeddings themselves.
- The screenshot matches a route that renders only a centered spinner while auth is unresolved.
- Several pages still gate rendering on auth-related loading and can show nothing or only a spinner:
  - `src/pages/Auth.tsx`
  - `src/pages/Landing.tsx`
  - `src/pages/Admin.tsx`
  - `src/pages/Index.tsx`
  - `src/pages/Profile.tsx`
  - `src/pages/LegalQA.tsx` currently returns `null` when auth/subscription is loading.
- The highest-risk issue is role resolution:
  - `useAuth` sets `loading=false` before admin role resolution finishes.
  - `Auth.tsx` and `Landing.tsx` immediately redirect authenticated users using `isAdmin`.
  - If the user is actually admin, they can be misrouted to `/app` first; if auth/role/session hydration races, the app can bounce into a bad loading state.
- Another likely issue: current Google OAuth still redirects to `window.location.origin`, not the dedicated `/auth-redirect` route that already exists in `src/App.tsx`.
- `AuthRedirect` currently returns `null` while auth is loading, which can produce a blank screen with no visible status.
- `Admin.tsx` is lighter than before, but `fetchKnowledge()` still does an expensive full `select("source_type")` on `legal_documents`, which should be removed/replaced.

Likely root cause
- Not “50k chunks in browser memory”.
- A post-login auth/role redirect race, made worse by blank loading states and at least one remaining heavy admin query.
- The app has a callback route, but the OAuth flow is not actually using it.

Implementation plan
1. Make auth state explicit and safe
- Update `useAuth` to separate:
  - session hydration ready
  - admin role loading
- Expose an additional readiness flag such as `authReady` / `roleReady` or `isAdminResolved`.
- Do not let pages make role-based redirects until role resolution is complete for signed-in users.

2. Fix OAuth landing flow properly
- Change Google sign-in in `src/pages/Auth.tsx` to redirect to `/auth-redirect` instead of bare origin.
- Update signup email redirect to point to a stable callback target if needed.
- Refine `AuthRedirect` in `src/App.tsx` so it shows a real loading screen, waits for auth + role readiness, then routes once:
  - admin → `/admin`
  - regular user → `/app`
  - no user → `/auth`

3. Remove blank-screen loading states
- Replace `return null` patterns with a visible loader/shell:
  - especially in `src/pages/LegalQA.tsx`
  - and any auth-protected route still rendering blank while loading
- Standardize one small “auth resolving” UI so users see progress instead of a white page.

4. Prevent premature redirects on auth pages
- In `src/pages/Auth.tsx` and `src/pages/Landing.tsx`, only redirect authenticated users after role resolution is complete.
- Avoid immediate `Navigate` based on a possibly stale default `isAdmin=false`.

5. Harden `/app` startup
- In `src/pages/Index.tsx`, gate route rendering on both auth readiness and projects readiness.
- If no `currentProject` is available yet, show shell/loading instead of continuing with half-ready state.
- Keep existing fail-soft behavior in `useProjects`, but avoid rendering the main workspace before it settles.

6. Finish admin performance cleanup
- Refactor `src/pages/Admin.tsx` knowledge tab fetch:
  - remove full `select("source_type")` over `legal_documents`
  - replace with lighter aggregated logic, backend summary query, or defer counts until requested
- Keep admin shell visible immediately while tab data loads.

7. Add diagnostics for the stuck flow
- Add focused console logs around:
  - auth session hydration
  - admin role resolution
  - `/auth-redirect` mount and redirect decision
  - post-login route chosen
- This will make the next report conclusive if anything still hangs.

Files to update
- `src/hooks/useAuth.tsx`
- `src/pages/Auth.tsx`
- `src/App.tsx`
- `src/pages/Landing.tsx`
- `src/pages/Index.tsx`
- `src/pages/LegalQA.tsx`
- `src/pages/Admin.tsx`
- possibly `src/pages/Profile.tsx` for consistent auth-loading handling

Expected result
- Google sign-in lands on a dedicated callback route instead of hanging on a blank page.
- Admin users are not misrouted while role lookup is still pending.
- The app always shows a visible loading state instead of a white screen.
- Heavy admin reads no longer make login feel frozen.
