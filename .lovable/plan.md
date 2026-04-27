## What's happening today

In Step 2 of the Bibliography Generator, each row already has a **"Source type ▾"** popover (line 605–632 in `src/components/BibliographyGenerator.tsx`). Picking an item — even the same one again — only changes the **display label / sort bucket**. It does **not**:

1. Re-run the lookup with that hint, so the citation stays as Perplexity returned it (incl. the bad article-validator decoration like `[חסר: שם כתב העת]`).
2. Tell the lookup pipeline to skip the article-citation validator for non-article picks.

So when חוק החוזים comes back mangled, clicking "חקיקה ראשית" feels like it should fix it, but nothing actually re-runs.

## Fix — make the source-type pick a real signal

Treat the user's pick as an authoritative hint that re-runs the lookup with that category locked in, and the validator pipeline respects it.

### 1. UI — `src/components/BibliographyGenerator.tsx`

- In `onChangeCategory`, after setting `sourceTypeOverride`, automatically call `retryLookup(item.id)` so the row is re-fetched with the new hint. Even re-picking the *same* category triggers a refresh — exactly what the user described ("even if I click again חקיקה ראשית").
- Pass the `sourceTypeOverride` into `lookupOne` → into the `bibliography-lookup` edge function call body as a new field, e.g. `sourceTypeHint: "legislation_primary"`.
- Show a tiny "✓ סוג מקור: חקיקה ראשית — מחפש שוב…" toast/inline hint while it re-runs (re-uses existing loading state).

### 2. Edge function — `supabase/functions/bibliography-lookup/index.ts`

- Accept the new optional `sourceTypeHint` field on the request body.
- When present, prepend a short, hard instruction line to the Perplexity user message, e.g.:
  > "המשתמש אישר שסוג המקור הוא **חקיקה ראשית** — נסח את האזכור לפי כלל 2 (חוק/פקודה/חוק-יסוד) בלבד; אל תתייחס למקור כמאמר/ספר/פסיקה."
- After Perplexity returns: route through the article validator **only** when `sourceTypeHint` is missing or explicitly an article/literature category. For `legislation_primary | legislation_secondary | caselaw_*` skip `validateArticleCitation` entirely (it's the function that injects `[חסר: שם כתב העת]`).
- Verified-source matching is unchanged.

### 3. No changes to the validator itself

`articleCitationValidator.ts` stays as-is. The fix is purely "don't run the article validator on something the user just told us is legislation/case-law".

## Result

- Click "חקיקה ראשית" on the broken חוק החוזים row → row re-runs → Perplexity is told this is primary legislation → article validator is skipped → row updates to a clean `חוק החוזים (חלק כללי), התשל"ג–1973, ס"ח 118.`
- Re-clicking the same category again triggers another fresh search (same fix, idempotent).
- Other rows (real journal articles) are unaffected because the validator still runs for `literature` / `unknown` / no-hint.

## Files touched

- `src/components/BibliographyGenerator.tsx` — pass `sourceTypeHint`, auto-retry on category click.
- `supabase/functions/bibliography-lookup/index.ts` — accept hint, gate the article validator on it, add hint sentence to Perplexity prompt.

No DB / RLS / auth changes.
