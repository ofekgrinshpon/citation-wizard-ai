

## Why the flash keeps happening

The flash is **structural**, not configuration. The `lovable.auth.signInWithOAuth(...)` helper always sends the browser through `/~oauth/initiate`, which the Lovable proxy worker rewrites to `oauth.lovable.app` before forwarding to Google. **Custom Google credentials change which Client ID is used at the broker, but they do not remove the broker from the redirect chain.** So even on `relexlm.com` with everything configured perfectly, the URL bar will briefly show `oauth.lovable.app/~oauth/...` mid-flow.

The only way to make that frame disappear is to skip the Lovable broker entirely.

## The fix: call Supabase Google OAuth directly

Replace the broker call with `supabase.auth.signInWithOAuth("google", ...)`. Supabase already has Google enabled on this project (verified just now via its public auth settings endpoint), so the flow becomes:

```text
relexlm.com  →  ioktiqcffungtlsmlkcv.supabase.co/auth/v1/authorize  →  accounts.google.com  →  relexlm.com/auth-redirect
```

No `oauth.lovable.app` frame anywhere. The Supabase callback hop is invisibly fast and uses your own project URL, not a Lovable-branded one.

## Implementation

### 1. `src/pages/Auth.tsx` — public web sign-in
Replace the Google button handler. Drop the import of `lovable` and the `?oauth=google` auto-trigger `useEffect` (no longer needed because we no longer have to bounce off the canonical host to reach a custom-credentials broker). Keep the host-redirect to `relexlm.com` so the public-facing flow still always finishes on the branded domain.

```ts
import { supabase } from "@/integrations/supabase/client";

// On Google click (non-Office):
if (!isCanonicalHost()) {
  // Same canonical-domain redirect as today, minus the oauth=google trigger
  window.location.replace(`${PUBLIC_SITE_URL}/auth?...`);
  return;
}
const { error } = await supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: `${window.location.origin}/auth-redirect`,
    queryParams: { prompt: "select_account" },
  },
});
```

The auto-trigger `useEffect` for `?oauth=google` can stay (now invoking `supabase.auth.signInWithOAuth` instead) so users coming from the preview-host redirect continue seamlessly.

### 2. `src/pages/AuthDialog.tsx` — Office add-in popup
Same swap inside the dialog: `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: ... } })`. The existing `onAuthStateChange` listener already handles the returned session.

### 3. `src/lib/officeAuth.ts`
No code change needed — it just opens the dialog window.

### 4. Supabase Google provider configuration (one-time, you do this)
For the bare-Supabase flow to work, the Google Cloud OAuth Client must trust Supabase's callback:
- **Authorized redirect URI in Google Cloud Console:** `https://ioktiqcffungtlsmlkcv.supabase.co/auth/v1/callback`
- **Site URL** (Cloud → Auth Settings → URL Configuration): `https://relexlm.com`
- **Additional Redirect URLs:** `https://relexlm.com/auth-redirect`, `https://www.relexlm.com/auth-redirect`, plus the preview/published URLs you want to allow.
- **Google Client ID + Secret** must be saved in Cloud → Auth Settings → Google (the same custom credentials you already created — they just get used by Supabase directly now instead of by the Lovable broker).

### 5. Files touched
- `src/pages/Auth.tsx` — swap call, drop `lovable` import.
- `src/pages/AuthDialog.tsx` — swap call.
- `src/lib/publicUrl.ts` — unchanged.

## Trade-offs

- **Pros:** zero `oauth.lovable.app` exposure, fully under your domain + your Supabase project URL, brand-safe in every frame.
- **Cons:** the very brief Supabase callback hop will show `ioktiqcffungtlsmlkcv.supabase.co` in the URL bar for a few hundred ms. To eliminate even that, configure a Supabase **Custom Auth Domain** (e.g., `auth.relexlm.com`) — optional, can be done later.

## Outcome
After this change and the Google Cloud Console redirect-URI addition, clicking "Sign in with Google" on `relexlm.com` will go straight from ReLex → Google → ReLex, with no Lovable-branded URL ever shown.

