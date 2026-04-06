

# Add hover tooltip for full citation text in VerifiedSourcesTable

## Problem
The "ציטוט מלא" column truncates long citations (`max-w-[320px] truncate`), and there's no way to see the full text without editing.

## Solution
Wrap the citation cell content in a `HoverCard` (already available in the project) that shows the full citation text on hover.

## Changes

| File | Change |
|------|--------|
| `src/components/admin/VerifiedSourcesTable.tsx` | Import `HoverCard`, `HoverCardTrigger`, `HoverCardContent` from `@/components/ui/hover-card`. Wrap the `<RenderCitation>` on line 166 inside a `HoverCard` — the trigger stays as the truncated text, and the content shows the full citation in a wider popover with RTL direction and proper text wrapping. |

### Implementation detail
The cell on line 165-167 changes from:
```tsx
<td className="px-4 py-3 text-foreground max-w-[320px] truncate">
  <RenderCitation text={source.full_citation} />
</td>
```
To:
```tsx
<td className="px-4 py-3 text-foreground max-w-[320px] truncate">
  <HoverCard>
    <HoverCardTrigger asChild>
      <span className="cursor-pointer">
        <RenderCitation text={source.full_citation} />
      </span>
    </HoverCardTrigger>
    <HoverCardContent className="w-96 text-sm" dir="rtl" side="top">
      <RenderCitation text={source.full_citation} />
    </HoverCardContent>
  </HoverCard>
</td>
```

