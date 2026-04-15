

## Fix Authentication on Published URL

### Problem Analysis

The evidence shows two separate issues:
- **Preview**: Email login POST fails at the network level ("Load failed") due to the preview's fetch proxy. Google OAuth returns an immediate error. These are known preview environment limitations.
- **Published version**: Google OAuth "loads forever" -- likely the app hasn't been re-published with latest code, or the OAuth callback isn't being processed correctly after returning from Google.

### Root Cause

The Google OAuth handler in `Auth.tsx` does not handle the `result.redirected` case, and lacks error logging. After returning from Google, if token processing fails silently, the user sees a loading state forever. Additionally, the app may not have been published with the latest code changes.

### Plan

**1. Improve Google OAuth handler in `Auth.tsx`**
- Add explicit `result.redirected` handling (return early since browser is navigating away)
- Add console logging to capture the exact error when OAuth fails
- Add a timeout fallback so the button doesn't stay in "loading" state forever

**2. Add error resilience to `useAuth.tsx`**
- Add a try/catch around `supabase.auth.getSession()` so if the initial session check fails, `loading` still becomes `false` (preventing infinite spinner)

**3. Publish the latest version**
- Ensure the published URL has the latest code with these fixes

### Technical Details

In `Auth.tsx`, the Google button handler will be updated:
```typescript
const result = await lovable.auth.signInWithOAuth("google", {
  redirect_uri: window.location.origin,
});
if (result.redirected) return; // browser is navigating to Google
if (result.error) {
  console.error("[ReLex] Google OAuth error:", result.error);
  toast.error("שגיאה בהתחברות עם Google");
}
```

In `useAuth.tsx`, wrap the session hydration in a try/catch:
```typescript
void supabase.auth.getSession().then(...).catch(() => {
  hasHydratedSession.current = true;
  setLoading(false);
});
```

### Important Note

Email and Google authentication **will not work in the Lovable preview** due to iframe restrictions and the proxy environment. You must test authentication on the published URL: `https://citation-wizard-ai.lovable.app`. This is a platform limitation, not a code bug.

