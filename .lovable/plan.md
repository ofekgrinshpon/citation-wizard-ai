## Remove "בדיקת מסמך" Feature

Remove the Document Check tab/page entirely from the app.

### Frontend changes
- `src/components/FootnotesSection.tsx`: remove the `DocumentCheckPage` import, the `"check"` tab entry (`{ id: "check", label: "בדיקת מסמך", icon: "📄" }`), and the conditional render block for `<DocumentCheckPage />`.

### Files to delete
- `src/components/document-check/DocumentCheckPage.tsx` (and the `document-check` folder if empty)
- `src/hooks/useDocumentCheck.tsx`
- `supabase/functions/document-check/index.ts` (edge function)
- Remove the `[functions.document-check]` entry from `supabase/config.toml`

### Verification
- Confirm no remaining references to `DocumentCheck` / `document-check` / `בדיקת מסמך` via ripgrep.
- Ensure default active tab in `FootnotesSection` still resolves correctly after the tab is removed.