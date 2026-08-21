# תנאי שימוש + מדיניות פרטיות — pages, signup consent checkbox, acceptance record

## What gets built

1. Two public legal pages with your exact Hebrew text: `/terms` (תנאי שימוש) and `/privacy` (מדיניות פרטיות).
2. A required consent checkbox on the signup form (email signup **and** Google signup) linking to both pages.
3. A durable record of who accepted what, and when, stored on the user's profile.
4. Footer links to both pages so they are reachable outside signup.

## Current state (verified)

- `src/pages/Auth.tsx` — single page toggling between login/signup via `isLogin`. Signup collects שם מלא / אימייל / סיסמה, plus a Google OAuth button used for both modes. No consent UI today.
- `src/App.tsx` — routes list; no `/terms` or `/privacy` route exists.
- `src/hooks/useAuth.tsx` — `signUp(email, password, fullName, referralCode)` calls `supabase.auth.signUp` and passes `full_name` / `referral_code` through `options.data`.
- Database trigger `handle_new_user` reads `raw_user_meta_data` and inserts into `public.profiles`.
- `public.profiles` columns: id, email, full_name, created_at, is_subscribed, citation_count, plan, credit fields, billing fields, referral fields. **No consent columns exist.**
- No legal text currently exists anywhere in the app (no terms/privacy strings found in `src/`).

## 1. Legal content

Create `src/content/legal/terms.ts` and `src/content/legal/privacy.ts` holding your Hebrew markdown verbatim, exported as strings. Both include the "עודכן לאחרונה: 21 באוגוסט 2026" date.

Add a shared version constant in `src/content/legal/version.ts`:

```text
LEGAL_VERSION = "2026-08-21"
```

This is what gets recorded on acceptance, so a future policy update can be detected.

## 2. Pages

New `src/pages/Legal.tsx` — one RTL document layout component rendering markdown, reused by both routes:

- `/terms` → תנאי שימוש
- `/privacy` → מדיניות פרטיות

Details:
- Public routes (no auth guard), registered in `src/App.tsx` above the catch-all.
- RTL (`direction: rtl`), readable prose width, semantic headings, single `<h1>` per page.
- Per-page `<title>` and `<meta name="description">` set on mount.
- `mailto:` links for support@ / privacy@ / billing@ render as real links.
- "← חזרה" back button, matching the existing Auth page styling and design tokens.

## 3. Signup consent checkbox

In `src/pages/Auth.tsx`, shown **only when `!isLogin`**:

- A single required checkbox, unchecked by default:
  > קראתי ואני מסכים/ה ל[תנאי השימוש](/terms) ול[מדיניות הפרטיות](/privacy)
- Links open in a new tab so an in-progress signup form is not lost.
- The "הירשמ/י" submit button is **disabled** until it is checked.
- The Google button, while in signup mode, is also blocked until checked — clicking it unchecked shows a Hebrew toast (`יש לאשר את תנאי השימוש ומדיניות הפרטיות`) instead of starting OAuth. In login mode Google behaves exactly as today.
- Login mode is untouched — no new friction for existing users.

## 4. Recording acceptance

Database migration adding to `public.profiles`:

```text
terms_accepted_at    timestamptz
terms_version        text
privacy_accepted_at  timestamptz
privacy_version      text
```

Wiring:
- `signUp()` in `useAuth.tsx` gains an `acceptedLegal` flag and passes `legal_version` + `legal_accepted_at` through `options.data`.
- `handle_new_user` is updated so its `INSERT INTO public.profiles` also populates the four new columns from `raw_user_meta_data`. Existing behaviour (referral code resolution, referral_code generation) is preserved exactly.
- Google OAuth signup does not flow through `signUp()`, so consent for that path is stamped after the session lands: on `/auth-redirect`, if the profile has no `terms_accepted_at` and the browser recorded consent for this signup attempt (sessionStorage flag set when the checkbox was ticked), write the acceptance to the profile.

Existing users keep `NULL` in these columns — they are not blocked or re-prompted. Re-consent on policy change is out of scope for this plan.

## 5. Footer links

Add תנאי שימוש / מדיניות פרטיות links to the Landing page footer so both documents are reachable without signing up.

## Out of scope

- Re-consent prompts for existing users when `LEGAL_VERSION` changes.
- An English translation (your text states the Hebrew version is binding).
- Account-deletion self-service and the retention automations the policy describes — the policy correctly says some deletions are handled manually on request to privacy@.

## Technical notes

- Markdown rendering reuses the project's existing renderer where possible rather than adding a dependency; if none is suitable, the content renders through a small RTL-aware markdown component.
- Consent state is client-side UI gating **plus** a server-side record; the checkbox is not a security control, it is an evidentiary record of acceptance.
- Migration includes `GRANT` review: `profiles` already has grants and RLS; adding columns does not change policies, and the new columns are covered by the existing "users read/update own profile" policies.
