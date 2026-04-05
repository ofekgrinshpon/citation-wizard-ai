

# Fix Word Add-in White Screen (Attempt 3)

## Root Causes

**1. Auth deadlock in `onAuthStateChange`:** The `syncAuthState` function inside the `onAuthStateChange` callback uses `await resolveAdmin()`, which makes an async database query. This blocks the auth state change pipeline and can cause a deadlock — the session never finishes hydrating, so `loading` stays `true` forever, resulting in a permanent spinner → white screen.

**2. Manifest points to `/app?addin=1` which immediately redirects:** Word Online loads the task pane at `/app?addin=1`. This route requires auth, so it redirects to `/?addin=1`. This double-navigation inside Word's iframe can cause timing issues and the "add-in may not load properly" error.

**3. No `X-Frame-Options` / CSP consideration:** Word Online loads the task pane in an iframe. If any response headers block framing, the page will be blank. (This is handled by Lovable hosting, but the redirects compound the problem.)

## Plan

### 1. Fix auth deadlock (`src/hooks/useAuth.tsx`)
Remove `await` from the `resolveAdmin` call inside `onAuthStateChange`. Use fire-and-forget pattern so the callback doesn't block. Set `loading` to `false` immediately after setting user/session, then resolve admin status in the background.

```typescript
// Before (blocks):
await resolveAdmin(nextSession?.user ?? null);

// After (fire-and-forget):
resolveAdmin(nextSession?.user ?? null); // no await
```

Also set `loading = false` unconditionally once the session is hydrated, without waiting for admin resolution.

### 2. Change manifest to point to Landing page (`manifest.xml`)
Change `SourceLocation` and `Taskpane.Url` from `/app?addin=1` to `/?addin=1`. This way:
- Word loads the landing page directly (no redirect needed)
- If user is already logged in, Landing auto-redirects to `/app?addin=1`
- If not logged in, they see the login form immediately
- Eliminates the redirect-inside-iframe problem

### 3. Add console logging to bootstrap (`src/main.tsx`)
Add `console.log` statements at each stage of the bootstrap process so we can diagnose any remaining issues from the console logs.

## Files

| Action | File |
|--------|------|
| Modify | `src/hooks/useAuth.tsx` — fire-and-forget admin resolution |
| Modify | `manifest.xml` — point to `/?addin=1` instead of `/app?addin=1` |
| Modify | `src/main.tsx` — add diagnostic console logs |

