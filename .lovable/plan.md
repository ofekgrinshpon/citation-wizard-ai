

# Fix "הכנס ל-Word" Button — `insertFootnote` Not Available in Word Online

## Root Cause

The `insertFootnote` API requires **WordApi requirement set 1.5**. Word Online has limited support for this API — it may not be implemented at all or may throw `RichApi.Error: NotImplemented`. The manifest doesn't declare any requirement sets, so Office loads the add-in but the API simply isn't available at runtime.

This is a known Microsoft limitation: footnote APIs work on Desktop Word but are **partially or fully unsupported in Word Online**.

## Fix: Graceful Fallback

Since we can't guarantee `insertFootnote` works in Word Online, we need a two-tier approach:

1. **Try footnote first** — if `insertFootnote` succeeds (Desktop Word), use it
2. **Fall back to inline text insertion** — if it fails (Word Online), insert the citation as formatted text at the cursor using `insertOoxml` directly on the selection range, which is supported in WordApi 1.1

### 1. Update `insertCitationAsFootnote` (`src/lib/wordInsertion.ts`)

- Wrap the `insertFootnote` call in a try-catch
- On failure, fall back to `selection.insertOoxml(fullOoxml, "After")` which inserts the citation as inline text at the cursor position
- Show a different success message so the user knows it was inserted inline vs. as a footnote

### 2. Update the button handler (`src/components/MessageBubble.tsx`)

- Change the success toast to reflect whether it was inserted as a footnote or inline text
- The function will return a result indicating which method was used

## Files

| Action | File |
|--------|------|
| Modify | `src/lib/wordInsertion.ts` — add fallback from footnote to inline OOXML insertion |
| Modify | `src/components/MessageBubble.tsx` — update toast message based on insertion method |

