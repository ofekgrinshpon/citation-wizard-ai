

## Goal
Remove the `oauth.lovable.app` flash (and the "Lovable" name on the Google consent popup) by switching Google sign-in from the shared managed broker to your own ReLex-branded OAuth client.

---

## Why the flash happens today
With managed Google credentials, every login goes:

```text
relexlm.com  →  oauth.lovable.app/~oauth/initiate  →  accounts.google.com  →  oauth.lovable.app/~oauth/callback  →  relexlm.com
                ^^^^^^^^^^^^^^^^^                                            ^^^^^^^^^^^^^^^^^
                this is the flash you're seeing
```

The broker exists because Google requires every redirect URI to be registered against a specific OAuth client, and Lovable's managed client points at `oauth.lovable.app`. Bringing your own client lets Google redirect **directly** to `relexlm.com`, eliminating the broker hop entirely.

---

## What you do (one-time, ~10 minutes in Google Cloud Console)

### Step 1 — OAuth consent screen
Go to **console.cloud.google.com → APIs & Services → OAuth consent screen**:
- App name: **ReLex**
- User support email: your email
- App logo: upload `public/relex-icon.png` (or the larger `relex-logo.png`)
- App domain: `relexlm.com`
- Authorized domains: `relexlm.com`
- Scopes: `openid`, `userinfo.email`, `userinfo.profile`
- Publishing status: **In production** (otherwise only test users you whitelist can log in)

### Step 2 — Create the OAuth client
**Credentials → Create credentials → OAuth client ID**:
- Type: **Web application**
- Name: ReLex Web Client
- **Authorized redirect URI**: I'll grab this exact URL from **Lovable Cloud → Auth Settings → Sign-In Methods → Google** the moment we're ready — it's what Google calls back to.
- Save → copy the **Client ID** and **Client Secret**.

### Step 3 — Paste credentials into Lovable Cloud
**Cloud → Auth Settings → Sign-In Methods → Google → Use custom credentials** → paste Client ID + Client Secret → Save.

---

## What I do
Nothing in code needs to change — `lovable.auth.signInWithOAuth("google", …)` automatically uses your custom credentials once they're saved. After you paste them in, I'll:
- Verify the redirect URI matches exactly between Google Console and Lovable Cloud.
- Test a sign-in end-to-end on `relexlm.com` and confirm:
  - No `oauth.lovable.app` flash.
  - Consent screen reads **"ReLex wants to access your Google Account"** with the ReLex logo.
- Test the same flow on the Word Add-in popup (`/auth-dialog`) since it uses the same provider.

---

## Risk / fallback
Until you save custom credentials, the existing managed flow keeps working — zero downtime. If anything breaks after the swap, removing custom credentials in Auth Settings instantly reverts to the managed broker.

---

## Outcome
- One smooth redirect: `relexlm.com → Google → relexlm.com`.
- Zero `oauth.lovable.app` visible to users at any frame of the flow.
- Google popup is fully ReLex-branded.

**Tell me when you've pasted the Client ID + Secret into Cloud → Auth Settings, and I'll verify the flow end-to-end.**

