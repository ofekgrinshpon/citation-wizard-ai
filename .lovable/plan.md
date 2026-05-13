## Goal

Move "בדיקת מסמך" out of the top mode tabs and nest it as an internal sub-toggle inside the existing "הערות שוליים" section. Users land on "בניית הערות שוליים" (current behavior) and can switch to "בדיקת מסמך" without leaving the section.

## UX

Inside the הערות שוליים tab, render a small pill toggle at the top of the section, above the existing builder UI:

```text
[ בניית הערות שוליים ]  [ בדיקת מסמך ]
```

- Default: בניית הערות שוליים (no behavior change for existing users)
- Selecting בדיקת מסמך swaps the body to the DocumentCheckPage flow (upload → confirm → review)
- Switching back restores the builder state (component stays mounted, or sub-state lives in the wrapper)
- Hebrew RTL, semantic tokens, same visual language as existing mode tabs (smaller scale)

## Implementation

1. **Remove the top-level `documentcheck` mode** from `src/pages/Index.tsx`:
   - Revert `AppMode` to `"freetext" | "batch" | "bibliography" | "legalqa"`
   - Remove the `documentcheck` entry from `MODES`
   - Remove the `mode === "documentcheck"` render branch
   - Replace the `<BatchFootnoteBuilder />` render with `<FootnotesSection />`
   - Drop the now-unused `DocumentCheckPage` import from `Index.tsx`

2. **New wrapper** `src/components/FootnotesSection.tsx`:
   - Local state `subMode: "build" | "check"` (default `"build"`)
   - Persist last choice in `localStorage` (`footnotes_submode`) so it sticks across reloads
   - Renders the pill toggle, then either `<BatchFootnoteBuilder />` or `<DocumentCheckPage />`
   - Keeps both children mounted via CSS `hidden` so builder cell state is preserved when toggling

3. **No changes** to `BatchFootnoteBuilder`, `DocumentCheckPage`, the `useDocumentCheck` hook, the edge function, or the DB schema.

## Out of scope

- Sidebar entries
- Renaming the parent tab
- Any change to extraction, analysis, credits, or review behavior

## Files

- New: `src/components/FootnotesSection.tsx`
- Edited: `src/pages/Index.tsx`
