

# Add hover tooltips to SourceCategoryView + fix bold rendering

## Problem
1. The "פלט" column in `SourceCategoryView.tsx` (used for all category tabs) truncates long text with no way to see the full citation on hover.
2. Both `SourceCategoryView` and `VerifiedSourcesTable` display raw `**bold**` markdown instead of rendering it as bold text. The `RenderCitation` component (which parses `**` into `<strong>`) exists in `VerifiedSourcesTable.tsx` but is not used in `SourceCategoryView`.

## Changes

| File | Change |
|------|--------|
| `src/components/admin/SourceCategoryView.tsx` | 1. Import `HoverCard`, `HoverCardTrigger`, `HoverCardContent` from hover-card. 2. Copy or import the `RenderCitation` helper (parses `**text**` into `<strong>`). 3. Wrap the פלט cell (line 148) in a `HoverCard` with full-text hover content, using `RenderCitation` for both the truncated cell and the hover popover. |
| `src/components/admin/VerifiedSourcesTable.tsx` | No structural changes needed — already has `HoverCard` and `RenderCitation`. Just confirm bold rendering works (it does, since `RenderCitation` is already used). |

### Detail for SourceCategoryView line 148

From:
```tsx
<td className="... max-w-[300px] truncate">{cit.formatted_output}</td>
```
To:
```tsx
<td className="... max-w-[300px] truncate">
  <HoverCard>
    <HoverCardTrigger asChild>
      <span className="cursor-pointer"><RenderCitation text={cit.formatted_output} /></span>
    </HoverCardTrigger>
    <HoverCardContent className="w-96 text-sm whitespace-pre-wrap break-words" dir="rtl" side="top">
      <RenderCitation text={cit.formatted_output} />
    </HoverCardContent>
  </HoverCard>
</td>
```

To avoid code duplication, I'll extract `RenderCitation` into a small shared utility file (`src/components/admin/RenderCitation.tsx`) and import it in both table components.

