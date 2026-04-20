

## Goal
Make every "invite" link ReLex-branded — both the personal referral link a user copies from their Profile, and the auth emails (verification, password reset, magic link, account invites) sent to people who sign up.

---

## Part 1 — Referral link always points to relexlm.com

**Problem:** `Profile.tsx` builds the referral link as `${window.location.origin}/auth?mode=signup&ref=…`. When the logged-in user is on the Lovable preview domain (or a `*.lovable.app` URL), they share a Lovable-looking link instead of a ReLex one.

**Fix:** Hard-code the public ReLex domain for shareable links.

- Add `src/lib/publicUrl.ts` exporting `PUBLIC_SITE_URL = "https://relexlm.com"` and a small `buildReferralLink(code)` helper. One constant, one source of truth.
- Update `src/pages/Profile.tsx` (line 156–158) to use `buildReferralLink(referralCode)` instead of `window.location.origin`.
- Also update the redirect after signup verification (`useAuth.signUp` → `emailRedirectTo`) to prefer `PUBLIC_SITE_URL` when the current origin is a non-production preview, so the magic-link "back to app" target also lands on relexlm.com. Production users keep the same behavior; preview users stop generating Lovable-branded redirect URLs.

Result: when a user clicks "העתק קישור" in Profile → ניהול חשבון → הזמן חברים, the clipboard contains `https://relexlm.com/auth?mode=signup&ref=ABCD1234` no matter where they're browsing from.

---

## Part 2 — ReLex-branded auth emails sent from relexlm.com

Today auth emails (signup verification, password reset, magic link, invite, email change, reauthentication) use Lovable's default templates and a generic Lovable sender. We'll switch them to ReLex-branded templates sent from the project's already-configured custom domain `relexlm.com`.

Steps the implementation phase will run:

1. **Set up email infrastructure on relexlm.com.** This provisions a verified sender subdomain (e.g. `notify.relexlm.com`) and the queue/cron used to actually deliver emails. The user will see a one-click "Set up email domain" dialog as part of this; once completed, DNS verification continues in the background.

2. **Scaffold ReLex-branded auth email templates.** Six templates are generated under `supabase/functions/_shared/email-templates/`:
   - `signup.tsx` — "אימות כתובת האימייל שלך ב-ReLex"
   - `magic-link.tsx` — "קישור התחברות ל-ReLex"
   - `recovery.tsx` — "איפוס סיסמה ב-ReLex"
   - `invite.tsx` — "הוזמנת ל-ReLex"
   - `email-change.tsx` — "אישור שינוי כתובת אימייל"
   - `reauthentication.tsx` — קוד אימות חד-פעמי

3. **Apply ReLex brand styling** to every template:
   - White email body (`#ffffff`) — required for inbox rendering, even though the app is light/neutral.
   - Brand colors pulled from `src/index.css` CSS variables (primary blue/teal pair used by `--gradient-primary`).
   - ReLex logo at the top (`public/relex-logo.png`) uploaded to an `email-assets` storage bucket and referenced by absolute URL.
   - RTL layout (`dir="rtl"`, `lang="he"`), Hebrew copy matching the app's tone (e.g. "התחבר/י", "ניהול חשבון").
   - CTA buttons styled like the in-app primary button (rounded-xl, `var(--gradient-primary)` flattened to a solid brand color for email-client compatibility).
   - Footer: "ReLex — מערכת אזכור משפטי" + link to `https://relexlm.com`. No unsubscribe link (system appends one automatically only for transactional emails; auth emails don't get one).

4. **Deploy `auth-email-hook`** edge function so Supabase Auth routes all auth emails through the new branded templates.

5. **Tell the user where to monitor activation.** Templates start sending automatically once the DNS for `notify.relexlm.com` finishes verifying — usually minutes, can take up to 72h. Status is visible in Lovable Cloud → Emails. Until then, default Lovable auth emails continue to be delivered (no downtime).

---

## Files touched
- New: `src/lib/publicUrl.ts`
- Edit: `src/pages/Profile.tsx` (referral link builder)
- Edit: `src/hooks/useAuth.tsx` (`emailRedirectTo` uses `PUBLIC_SITE_URL`)
- New: `supabase/functions/auth-email-hook/{index.ts, deno.json}`
- New: `supabase/functions/_shared/email-templates/{signup,magic-link,recovery,invite,email-change,reauthentication}.tsx`
- Edit: `supabase/config.toml` (auth-email-hook function block)
- New storage bucket: `email-assets` (logo upload)

## Out of scope
- Transactional / app-wide notification emails (e.g. "your credits were topped up"). Easy to add later on the same `notify.relexlm.com` sender — just say the word.
- Changing the Auth page UI itself.
- Migrating any historic ledger data.

## Expected outcome
- Referral link copied from Profile is always `https://relexlm.com/auth?mode=signup&ref=…`.
- Verification / reset / invite emails arrive **from `noreply@notify.relexlm.com`**, with the ReLex logo, Hebrew RTL copy, and the brand color CTA button — zero Lovable branding visible to recipients.
- Existing users' password-reset and verification flows keep working through the transition (defaults serve until DNS verifies, branded templates take over automatically).

