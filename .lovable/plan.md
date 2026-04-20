
## Goal
Eliminate the visible `oauth.lovable.app` flash for real users by making Google sign-in always start from the ReLex domain and by verifying the custom Google credentials are applied to the correct backend environment.

## What’s happening
The code is already using the correct Google login API (`lovable.auth.signInWithOAuth("google", ...)`), so this is not a “wrong auth method” bug.

The remaining flash usually means one of these is still true:
1. Google custom credentials were saved only for one environment, while the user is testing another one.
2. The custom Google client is missing one of the allowed callback URLs/domains.
3. The user is clicking Google login from a preview / `*.lovable.app` host, so the OAuth flow still starts from that host instead of `relexlm.com`.

## Implementation plan

### 1. Verify backend auth configuration
Check the Google sign-in settings in Lovable Cloud and confirm:
- **Custom credentials are enabled**
- They are enabled for the environment actually being tested
- The Google client includes the exact allowed redirect URLs shown in Cloud auth settings
- Both `relexlm.com` and `www.relexlm.com` are covered if both are used

If the user wants the flash gone on the published/custom domain only, production config is sufficient.
If they also want it gone while testing inside preview, the preview environment must also be configured with matching custom credentials and Google allowlisted callbacks.

### 2. Harden the frontend so OAuth never starts from preview for public users
Update the auth flow so:
- If the user is on `relexlm.com` or `www.relexlm.com`, Google sign-in starts normally there
- If the user is on any preview / staging / lovable host, clicking Google sign-in first redirects them to the canonical ReLex auth URL, then starts OAuth there
- Referral code (`ref`) and auth mode (`login` / `signup`) are preserved during that redirect
- Office add-in flow remains unchanged

This removes the preview-host dependency from the public login experience.

### 3. Centralize OAuth entry logic
Create a small shared helper for Google sign-in initiation that:
- Detects whether the current host is canonical
- Builds the canonical `/auth` URL when needed
- Preserves relevant query params
- Uses the correct redirect target (`/auth-redirect`) once on the canonical domain

Then use that helper from:
- `src/pages/Auth.tsx`
- any other future public Google sign-in entrypoints if needed

### 4. Keep Office add-in flow separate
Do not force canonical-domain redirection for the Office dialog flow in `AuthDialog.tsx` / `officeAuth.ts`.
That flow has its own popup/dialog requirements and is not the main branded web sign-in surface.

### 5. Validate expected behavior
After the changes:
- On `https://relexlm.com/auth`, Google sign-in should go directly from ReLex to Google without the Lovable broker flash
- On preview URLs, clicking Google should first move to the ReLex domain, then continue with Google
- Referral signups should still preserve `?ref=...`
- Email/password auth should remain unchanged

## Files likely involved
- `src/pages/Auth.tsx`
- `src/lib/publicUrl.ts`
- optional new helper in `src/lib/` for canonical OAuth start logic

## Technical details
Current issue in code behavior:
- `Auth.tsx` calls Google OAuth with:
  - `redirect_uri: ${window.location.origin}/auth-redirect`
- That means if the user starts on a preview host, the OAuth flow is tied to that preview host

Planned adjustment:
```text
If host is canonical:
  start OAuth immediately

If host is not canonical:
  redirect browser to:
  https://relexlm.com/auth?mode=currentMode&ref=currentRef
  and let OAuth start there instead
```

## Expected outcome
- Real users signing in from ReLex-branded links will no longer see `oauth.lovable.app`
- Google consent remains ReLex-branded
- Preview environments will no longer accidentally determine the public OAuth experience
