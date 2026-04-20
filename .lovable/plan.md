

## Goal
Restore the previous behavior where Google's consent screen reads "המשך אל **relexlm.com**" by reverting to the Lovable broker. Trade-off: the brief `oauth.lovable.app` URL flash will return.

## Why this works
The Lovable broker (`lovable.auth.signInWithOAuth`) registers your custom domain as the OAuth client display name with Google, so the consent screen shows "relexlm.com" instead of the technical callback host.

## Changes

### 1. `src/pages/Auth.tsx`
- Restore the `import { lovable } from "@/integrations/lovable/index"`.
- Replace both `supabase.auth.signInWithOAuth({ provider: "google", ... })` calls (the click handler and the `?oauth=google` auto-trigger `useEffect`) with:
  ```ts
  const result = await lovable.auth.signInWithOAuth("google", {
    redirect_uri: `${window.location.origin}/auth-redirect`,
    extraParams: { prompt: "select_account" },
  });
  if (result.error) { /* toast */ }
  ```
- Keep the `isCanonicalHost()` redirect to `relexlm.com/auth?...` so the flow always finishes on the branded domain.

### 2. `src/pages/AuthDialog.tsx` (Office add-in)
- Replace `supabase.auth.signInWithOAuth({ provider: "google", ... })` with `lovable.auth.signInWithOAuth("google", { redirect_uri: ..., extraParams: { prompt: "select_account" } })`.
- Keep the `onAuthStateChange` listener — the Lovable broker calls `supabase.auth.setSession` internally, which fires the same event.

### 3. Google Cloud Console (you, one-time)
Add the Lovable broker callback back to **Authorized redirect URIs** on your Google OAuth client:
```
https://oauth.lovable.app/~oauth/callback
```
The Supabase callback (`https://ioktiqcffungtlsmlkcv.supabase.co/auth/v1/callback`) you added last round can stay — harmless.

### 4. Files NOT touched
- `src/integrations/supabase/client.ts` — leave alone (auto-generated).
- `src/lib/publicUrl.ts` — unchanged.
- `src/lib/officeAuth.ts` — unchanged.
- `.env` — unchanged.

## Outcome
- ✅ Google consent screen: "המשך אל **relexlm.com**" (back to what you had).
- ❌ Brief `oauth.lovable.app` URL bar flash returns mid-flow (~300ms).

## Confirmed trade-off
You explicitly chose this over the custom-auth-domain route (`auth.relexlm.com`), which would have eliminated both the flash AND the supabase.co text but required a CNAME DNS record. If you change your mind later, that path remains available.

