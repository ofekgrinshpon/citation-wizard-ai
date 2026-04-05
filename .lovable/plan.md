

# Fix Word Insertion + Remove Unwanted Button

## Problems

1. **"הכנס ל-Word" button in טקסט חופשי** — user doesn't want it there. Remove it from `MessageBubble.tsx`.

2. **Word Online insertion fails** — the error `OSF.DDA.RichAPI.RichApi.ExecuteRichApi.RequestAsync is not a function` means Word Online doesn't support the `Word.run` Rich API. The current code uses `Word.run` which only works on Word Desktop. For Word Online, we need to use the Office Common API: `Office.context.document.setSelectedDataAsync()`.

3. **"0 footnotes inserted"** — because every `insertCitationAsFootnote` call throws (due to the above), the `catch {}` silently swallows it, so `count` stays 0.

## Plan

### 1. Remove "Insert to Word" from MessageBubble (`src/components/MessageBubble.tsx`)
- Delete the Word insert button (lines 271-290) from the free text chat section
- Keep only the copy button

### 2. Fix `insertCitationAsFootnote` for Word Online (`src/lib/wordInsertion.ts`)
- Try `Word.run` first (Desktop)
- If `Word` global doesn't exist or throws, fall back to `Office.context.document.setSelectedDataAsync()` with `Office.CoercionType.Ooxml`
- If OOXML coercion isn't supported, fall back to `Office.CoercionType.Text` with plain text
- This ensures it works in both Desktop and Word Online

### 3. Fix bulk insert error handling (`src/components/BatchFootnoteBuilder.tsx`)
- Log errors in the catch block instead of silently swallowing
- Show a toast if all insertions fail

## Files

| Action | File |
|--------|------|
| Modify | `src/components/MessageBubble.tsx` — remove Word insert button |
| Modify | `src/lib/wordInsertion.ts` — add Office Common API fallback |
| Modify | `src/components/BatchFootnoteBuilder.tsx` — improve error handling in bulk insert |

