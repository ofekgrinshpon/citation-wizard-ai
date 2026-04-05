

# Fix Word Add-in White Screen — Root Cause Found

## The Real Problem

The Supabase client is configured with `auth: { storage: localStorage }` (auto-generated, line 13 of `client.ts`). The `useProjects` hook also calls `localStorage.getItem()` during initialization. 

**Word Online loads the add-in in a cross-origin iframe.** Most browsers block `localStorage` access in third-party iframes (ITP, third-party cookie blocking). When `localStorage` is accessed, it throws a `SecurityError` that crashes React before any UI renders — hence the white screen.

The `ErrorBoundary` in `App.tsx` cannot catch this because the crash happens inside providers (`ProjectsProvider`, `AuthProvider`) that sit at the same level or above it.

## Plan

### 1. Add a safe storage wrapper (`src/lib/safeStorage.ts`)
Create a `SafeStorage` class implementing the `Storage` interface that:
- Tries to use `localStorage` 
- If it throws (iframe restriction), falls back to an in-memory `Map`
- Export a singleton instance

### 2. Override Supabase auth storage (`src/App.tsx`)
Since we cannot edit `client.ts` (auto-generated), we wrap the Supabase client initialization by calling `supabase.auth.setSession` with the safe storage approach. Actually, the better approach: **create a wrapper** in `main.tsx` that patches `window.localStorage` with the safe fallback before any imports run — or use a custom storage adapter.

**Better approach**: Shim `localStorage` at the very top of `main.tsx` (before any imports) so all code that uses `localStorage` works transparently. If `localStorage` is blocked, replace it with an in-memory polyfill.

### 3. Fix `useProjects.tsx` localStorage usage
Wrap the `localStorage.getItem(LS_CURRENT_PROJECT)` call in a try-catch so it doesn't crash during SSR/iframe contexts.

### 4. Move ErrorBoundary above all providers (`App.tsx`)
Move the `ErrorBoundary` to wrap the entire component tree including `AuthProvider` and `ProjectsProvider`, so any remaining crashes show an error message instead of white screen.

### 5. Add `AppDomains` to manifest (`manifest.xml`)
Add the Supabase auth domain and the app domain to `<AppDomains>` so Word Online trusts navigation to these origins within the iframe.

## Files

| Action | File |
|--------|------|
| Create | `src/lib/safeStorage.ts` — memory fallback for localStorage |
| Modify | `src/main.tsx` — shim localStorage before app loads |
| Modify | `src/hooks/useProjects.tsx` — wrap localStorage in try-catch |
| Modify | `src/App.tsx` — move ErrorBoundary above providers |
| Modify | `manifest.xml` — add AppDomains for trusted origins |

