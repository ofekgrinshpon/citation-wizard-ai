

# Fix Office Word Add-in Authentication & App Loading

## Problem
When the manifest opens the Task Pane at `/app?addin=1`, the user sees the app but:
1. **No auth trigger in the Task Pane** — The `AuthDialog` page exists but nothing in the app ever calls `Office.context.ui.displayDialogAsync()` to open it. Google OAuth popups are blocked inside Task Panes, so authentication silently fails.
2. **Landing page doesn't adapt for add-in** — If the user is redirected to `/` (Landing), the Google OAuth button uses `lovable.auth.signInWithOAuth` which opens a popup — blocked in Task Panes.
3. **No session recovery from dialog** — Even if the dialog somehow opened, there's no listener in the Task Pane to receive the `messageParent` tokens and set the Supabase session.

## Plan

### 1. Add Office Auth Helper (`src/lib/officeAuth.ts`)
Create a utility that:
- Opens `displayDialogAsync` pointing to `/auth-dialog`
- Listens for `messageParent` messages with the auth tokens
- Calls `supabase.auth.setSession()` with the received tokens
- Returns a promise that resolves on success or rejects on error

### 2. Update Landing Page for Add-in Mode
In `src/pages/Landing.tsx`:
- Detect `isOfficeAddin` from the `useOffice` hook
- When in add-in mode, replace the Google OAuth button's `onClick` to call the Office auth helper (displayDialogAsync) instead of `lovable.auth.signInWithOAuth`
- Email/password login works as-is (no popup needed)
- Hide the guest mode option in add-in mode (or keep it — your choice)

### 3. Update Index Page Auth Gate
In `src/pages/Index.tsx`:
- When `isOfficeAddin && !user`, show a login prompt or redirect to Landing instead of showing an empty/broken state
- Add a "Sign in" button that triggers the Office auth dialog

### 4. Add Dialog Message Listener to App
In `src/hooks/useAuth.tsx` or a new hook:
- When running in add-in mode, register a listener for dialog events
- On receiving `auth-success` message, call `supabase.auth.setSession({ access_token, refresh_token })`
- Update the auth context state accordingly

### 5. Fix AuthDialog Page
In `src/pages/AuthDialog.tsx`:
- The OAuth redirect_uri should use the **published URL** origin, not `window.location.origin` (which inside the dialog may differ)
- Handle the case where the OAuth callback lands with hash fragments (Supabase appends tokens to the URL hash)
- Ensure Office.js is loaded in the dialog context for `messageParent` to work

### Technical Details

**Dialog flow:**
```text
Task Pane (/app?addin=1)
  → user clicks "Sign in with Google"
  → Office.context.ui.displayDialogAsync("/auth-dialog", {width:50, height:60})
  → Dialog opens /auth-dialog
  → AuthDialog calls lovable.auth.signInWithOAuth("google", {redirect_uri: origin+"/auth-dialog"})
  → Google OAuth completes, redirects back to /auth-dialog
  → AuthDialog detects session, calls Office.context.ui.messageParent({tokens})
  → Task Pane receives tokens, calls supabase.auth.setSession()
  → User is authenticated, app loads
```

**Files to create:**
- `src/lib/officeAuth.ts`

**Files to modify:**
- `src/pages/Landing.tsx` — add-in mode auth button
- `src/pages/Index.tsx` — auth gate for add-in
- `src/pages/AuthDialog.tsx` — fix redirect URI handling
- `src/hooks/useOffice.tsx` — optionally expose a `signInWithOfficeDialog` method

