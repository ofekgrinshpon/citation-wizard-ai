# Continuous Footnote Numbering Across Chapters

## Goal
Today every chapter's footnotes restart at 1. When the user assembles the final paper, numbers collide (multiple "¹", "²", …). We want chapter N's footnotes to continue from where chapter N‑1 ended, so the final paper has a single monotonically-increasing footnote sequence.

## Current state (relevant pipeline)
- `LegalQAChat.tsx` sends `write_chapter` requests one chapter at a time and stores `ChapterData { content, paperMemoryDelta, … }`.
- `legal-qa/index.ts` parses the drafter output (Step 5), runs Rule 37 short-forms (5d), statute completion (5e), Rule 37 pass 2 (5f), converts `[N]→¹` (Step 6), then **renumbers by appearance order starting at 1** (Step 6b), and returns `{ answer, footnotes: [{ number, citation, … }] }`.
- The "starts-at-1" assumption is hardcoded in Step 6b and in the drafter prompt ("1. …", "2. …" in the footnotes block).

## Design

Keep the drafter and Step 6b unchanged (they produce a clean local 1..K sequence per chapter). Apply a **single offset shift at the very end of the chapter pipeline**, after Step 6b and all cleanups but before sending the response. This keeps internal validators (anchor pass, Rule 37, dedup, repeated citations) numerically simple and avoids touching dozens of regexes.

### Frontend (`src/components/LegalQAChat.tsx`)
1. Extend `ChapterData` with `footnotesCount?: number` (saved per chapter, persisted to `academic_sessions` like the rest of chapter data).
2. When building the request body for `write_chapter` / `write_introduction` / `write_conclusion`, compute:
   ```
   footnoteOffset = sum of footnotesCount for every chapter rendered BEFORE this one
                    in the final paper order (abstract → introduction → body chapters → conclusion)
   ```
   Use the same display ordering helper already in `LegalQAChat.tsx`. The **abstract** is special: it is generated last but appears first. Its offset is `0`; every other chapter's offset is computed assuming the abstract uses footnotes `1..abstractCount`. In practice, since the abstract is the **last** chapter generated and it carries no new citations (memory rule: abstract is pure synthesis, no new sources), we treat `abstractCount = 0` and just offset by the chapters that came before in display order.
3. On response, read the new field `footnotes_count` and store it on the chapter.
4. Re-emit `footnoteOffset` on regenerate / revise of a single chapter — and after a mid-paper regenerate, recompute downstream chapters' offsets (we expose a `recomputeFootnoteOffsets()` helper that reassigns numbers in the in-memory paper view; the saved chapter HTML keeps the offset embedded). For now, regenerating chapter K leaves K+1..N stale — surface a non-blocking toast "מספרי הערות בפרקים הבאים יתעדכנו בעת יצירה חוזרת". A full re-stitch pass can come later.

### Backend (`supabase/functions/legal-qa/index.ts`)
1. Accept `footnoteOffset?: number` in the request body (validate: integer ≥ 0, default 0). Only honored when `taskMode === "academic_writing"` and `academicStep ∈ {write_chapter, write_introduction, write_conclusion}`.
2. After Step 6b (and after the orphan-superscript cleanup around line 6767), if `footnoteOffset > 0`:
   - Build `shiftMap: oldNum → oldNum + offset` for every number in the final `footnotes` array.
   - Rewrite **superscripts in `answer`** using the same two-phase placeholder strategy Step 6b already uses (avoid 1→11 collisions). Reuse the existing `superscriptPattern` / `numToSuperscript` helpers.
   - Rewrite **textual back-references** inside footnote `citation` text matching Rule 37.7: `לעיל ה"ש (\d{1,3})` and the rarer `לעיל, ה"ש (\d{1,3})`. Apply the same shift map. (`שם` references carry no number — untouched.)
   - Rewrite the `number` field on every entry in the `footnotes` array.
3. Add to the response payload:
   ```ts
   footnotes_count: footnotes.length,
   footnote_offset_applied: footnoteOffset,
   ```
   Update `buildResponse(...)` signature + `BANNED_KEYS` is unaffected (these are intentional, user-facing).
4. Telemetry: add `qa_logs.metadata.footnote_offset = { offset, count, shifted_superscripts, shifted_backrefs }`.
5. Feature gate: env `CONTINUOUS_FOOTNOTES_ENABLED` (default `true`). When false, behave as today.

### Drafter prompt
No change. The model keeps emitting `1.`, `2.`, … locally. All offset math happens in TS. This is critical — moving the offset into the prompt would break Rule 37 short-form generation and the existing 1..K validators.

### Edge cases handled
- **Abstract**: offset always `0`. Memory rule already prevents new citations, so it contributes `0` to downstream offsets.
- **Regenerate single chapter**: caller passes the same offset that chapter previously used; downstream chapters become stale until regenerated (acknowledged via toast).
- **`[N]→[N+offset]` going over 99**: existing superscript map covers 0‑9 digits combinatorially; verified.
- **Dropped footnotes / dedup**: shift runs *after* drop/dedup, so `footnotes.length` is the truth source for `footnotes_count`.
- **Coherence critic & Paper Memory delta**: both run on pre-shifted numbers; nothing to change. The `paper_memory_delta.citations` already store citation text, not numbers.

## Files to touch
- `supabase/functions/legal-qa/index.ts` — accept `footnoteOffset`, add post-Step-6b shift block, extend response + telemetry, update `buildResponse` extras.
- `src/components/LegalQAChat.tsx` — store `footnotesCount` on `ChapterData`, compute and send `footnoteOffset`, persist `footnotesCount`, toast on regenerate.
- `.lovable/memory/features/academic-writing-mode/continuous-footnote-numbering.md` — new memory describing the shift mechanism, ordering rules, and regenerate caveat.

## Out of scope (note for follow-up)
- Auto re-stitch of all downstream chapters on mid-paper regenerate.
- Continuous numbering across **separate sessions** (only within one paper session).
- Editing the Word add-in export — it already concatenates chapter HTML verbatim, so it inherits the shifted numbering automatically.

