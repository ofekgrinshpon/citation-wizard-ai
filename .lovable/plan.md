

# Make Disambiguation Options Clickable

## What
When the AI presents multiple case law results (e.g., "1. ע"פ 7939/10 זדורוב נ' מדינת ישראל (2016)"), each option should be a clickable button. Clicking one sends it as a new user message, triggering the full citation flow for that specific case.

## Changes

| File | Change |
|------|--------|
| `src/components/MessageBubble.tsx` | 1. Add `onSelectOption` callback prop. 2. Detect numbered disambiguation lines (regex: `/^\d+\.\s+/`). 3. Render them as styled clickable buttons instead of plain text. |
| `src/pages/Index.tsx` | Pass an `onSelectOption` handler to `MessageBubble` that calls `handleSend` with the selected option text (sets `input` and triggers send). |

## Technical Details

**Disambiguation line detection** in MessageBubble's line renderer:
```typescript
const isDisambiguationLine = (line: string) => /^\d+\.\s+(?:ע|בג|ד|ר|ב|ת|ה)/.test(line.trim());
```

When detected, render as:
```tsx
<button
  onClick={() => onSelectOption?.(line.trim())}
  className="w-full text-right p-2 rounded-lg border border-primary/20 hover:bg-primary/10 transition-colors cursor-pointer"
>
  <FormattedCitation text={line} enableTooltips />
</button>
```

**In Index.tsx**, the `onSelectOption` handler:
- Sets `input` to the selected line text
- Calls `handleSend()` (or directly invokes the send logic with that text)

