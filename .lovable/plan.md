

## Goal
Remove the two remaining Lovable signals visible to users / invitees:
1. **Google sign-in screen** — currently shows "Lovable" as the requesting app. Switch to ReLex-branded Google OAuth.
2. **Link preview** — when the referral link is shared (WhatsApp, iMessage, Slack, Twitter, LinkedIn) the unfurled card currently shows a Lovable preview screenshot + "@Lovable" attribution. Switch the card to ReLex.

---

## Part 1 — Brand the Google consent screen as ReLex

**What the user sees today:** Clicking "התחברו עם Google" opens `accounts.google.com` and shows something like *"Lovable wants to access your Google Account"* with a Lovable icon. That string and icon come from the **Google OAuth client** the project uses — by default Lovable Cloud uses its own managed client, so all projects share Lovable's branding.

**Fix:** Provide our own Google OAuth client in the Google Cloud Console (BYOK — bring-your-own-key), branded as **ReLex**. Lovable Cloud then uses our credentials instead of the managed ones.

**Steps you do once in Google Cloud Console** (I'll guide you — this is a one-time setup, no code involved):

1. Go to **Google Cloud Console → APIs & Services → OAuth consent screen**
   - App name: **ReLex**
   - User support email: your address
   - App logo: upload `relex-logo.png`
   - App domain: `relexlm.com`
   - Authorized domains: `relexlm.com`, `lovable.app`, `supabase.co`
   - Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
   - Publishing status: **In production** (otherwise only test users can sign in)

2. Go to **Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - Name: ReLex Web Client
   - Authorized redirect URI: copy it from **Cloud → Auth Settings → Sign-In Methods → Google** in our project (Lovable shows the exact callback URL for our OAuth broker)
   - Save → copy **Client ID** and **Client Secret**

3. In our project: **Cloud → Auth Settings → Sign-In Methods → Google → Use custom credentials** → paste Client ID + Secret → Save.

**Result:** Every Google sign-in popup now reads *"ReLex wants to access your Google Account"* with the ReLex logo. No Lovable text or icon anywhere.

I'll prepare and verify the setup in Lovable Cloud once you have the Client ID + Secret ready. Until then the existing managed (Lovable-branded) client keeps working as a fallback — no downtime.

---

## Part 2 — Remove the Lovable thumbnail from shared links

**What the user sees today:** When someone pastes the referral link `https://relexlm.com/auth?mode=signup&ref=…` into WhatsApp / iMessage / Slack / Twitter, the link unfurls into a card showing:
- A **screenshot of the Lovable preview environment** (`og:image` points to `pub-…r2.dev/…lovable.app-….png`)
- *"by @Lovable"* attribution (`twitter:site` = `@Lovable`, `meta name="author" content="Lovable"`)

That data lives in `index.html`. I'll rewrite the social-card metadata to be pure ReLex.

**Changes to `index.html`:**
- `<meta name="author" content="ReLex">` (was "Lovable")
- `<meta name="twitter:site" content="@relexlm">` (was `@Lovable`) — or remove if no Twitter handle
- `<meta property="og:image">` and `<meta name="twitter:image">` → point to a ReLex-branded social card hosted on `relexlm.com` (e.g. `https://relexlm.com/relex-social-card.png`, 1200×630) instead of the Lovable preview screenshot
- `<meta property="og:url" content="https://relexlm.com">` — added so unfurlers show the canonical domain
- Remove the `<!-- TODO: Update og:title… -->` comment

**Social card image:** I'll generate a 1200×630 PNG with the ReLex logo on the brand background and the tagline (Hebrew + English) and place it at `public/relex-social-card.png` so it's served from `https://relexlm.com/relex-social-card.png`. Once you push, social platforms (WhatsApp/Twitter/LinkedIn) cache aggressively — recipients may need a fresh share, or you can force a refresh via Twitter Card Validator / LinkedIn Post Inspector / Facebook Sharing Debugger (I'll include the links).

**Browser tab favicon** (`/relex-icon.svg`) is already ReLex — no change needed.

---

## Out of scope (already fixed earlier)
- Referral link domain (already canonicalized to `relexlm.com`)
- Auth emails (already ReLex-branded via `notify.relexlm.com`)
- "Edit with Lovable" badge on published site (already hidden)

---

## Expected outcome
- Google sign-in popup says **"ReLex"** with the ReLex logo — no Lovable text or icon.
- Pasting the invite link in any chat/social app unfurls a **ReLex social card** — no Lovable screenshot or `@Lovable` attribution.
- All other surfaces remain unchanged.

