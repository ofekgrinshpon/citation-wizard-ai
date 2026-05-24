**Goal**

Match the `אזכור אחיד` (freetext) UX in `מחקר משפטי`: textarea pinned to the bottom, send arrow inside the input, paperclip moved inside, trash icon outside-left, and the loading panel appears below the top tabs (above the textarea) instead of immediately under it.

**Layout change**

Restructure `LegalResearchV1Panel` into a 3-row flex column (`h-full flex flex-col`):

```text
┌───────────────────────────────────────────────┐
│  tabs (מחקר משפטי | בקרה | סיכום | אקדמית)   │   ← parent
├───────────────────────────────────────────────┤
│  loading panel + error + result               │   ← top region, scrollable
│  (stage, progress bar, elapsed, cancel)       │
│                                               │
│  ↓ empty space pushes composer down ↓         │
├───────────────────────────────────────────────┤
│  [🗑]  [ textarea …………… 📎  ⇧ ]              │   ← sticky composer
│         file chips + "use as source" toggle   │
└───────────────────────────────────────────────┘
```

Wrapper in `LegalQAChat.tsx` (`<div className="py-4">` around `<LegalResearchV1Panel />`) becomes `className="flex-1 min-h-0 flex flex-col"` so the panel can occupy full height of the task pane.

**Composer (bottom)**

Mirrors the freetext input bar styling (`input-bar`, `input-field`, `btn-send`):

- Outer-left trash button (visible only when there is content to clear: question text, staged files, result, or error). On click, asks confirm via `sonner` toast when there's a result or long question, otherwise clears immediately. Clears: `question`, `files`, `result`, `error`.
- Textarea (existing `<textarea>`) inside the `input-field` rounded container.
- Inline **paperclip** icon button inside the input-field (right side in RTL = leading edge), opens the same hidden `<input type=file>`. Disabled while loading/uploading or when `files.length >= MAX_FILES`. Shows a small count badge when files are attached.
- Send button replaced from "שלח לחקירה משפטית" → arrow only (`⇧` character to match freetext, lucide `ArrowUp` for clarity is also acceptable; will use the same `⇧` glyph + `btn-send` class for visual parity). While uploading or loading, shows a spinner.
- File chips list + "השתמש בקבצים גם כמקור בתשובה" checkbox render directly under the input-field, inside the sticky container (compact). Drag/drop not required; existing click-to-add only.

**Loading / progress (top)**

Move the existing loading panel (`{loading && (...)}`) and error block and result block to the **top region** (above the composer). They render in normal flow at the top of the scrollable area, so they appear directly under the task tabs as requested. No visual changes to the loading panel itself (stage label, progress bar, elapsed, soft notices, cancel).

When neither loading nor result is present, the top region is empty and the composer sits near the top via natural flex; on `justify-end`-style flex with `mt-auto` on composer wrapper it will stick to the bottom regardless.

**Trash behavior**

- Visible if `question.trim() || files.length || result || error`.
- Active job (`loading === true`): trash is disabled; user must use the existing "בטל" inside loading panel first.
- On click: small `sonner` confirm toast ("לנקות הכל?") with מחק / ביטול actions when `result` exists or `question.length > 100`; otherwise clear immediately.

**Files / send unchanged**

- File limits, MIME/extension allow-list, per-file size cap, upload flow to `user-documents/{uid}/research/{token}/…`, `use_as_source` payload — all unchanged from current implementation.
- Footnotes / debug / result rendering unchanged in structure; only their position moves above the composer.

**Files to touch**

1. `src/components/LegalResearchV1Panel.tsx`
   - Wrap in `flex flex-col h-full`.
   - Move composer block to bottom (`mt-auto`), sticky if needed inside the scroll container.
   - Replace standalone "הוסף קובץ" Button with inline paperclip inside the input.
   - Replace "שלח לחקירה משפטית" Button with arrow-only `btn-send`-styled button inside the input.
   - Add outer trash button with `handleClearAll`.
   - Reorder JSX so loading/error/result render before the composer.

2. `src/components/LegalQAChat.tsx`
   - Change the `<div className="py-4">` wrapper around `<LegalResearchV1Panel />` to `className="flex-1 min-h-0 flex flex-col py-4"` so the panel can fill vertical space and the composer can dock at the bottom.

**Out of scope**

- No backend / edge function changes.
- No change to file size/count limits, attachment processing, footnote format, or debug block.
- No change to other task modes (case_summary, academic_writing, pleading_analysis).
- No design-system color changes.
