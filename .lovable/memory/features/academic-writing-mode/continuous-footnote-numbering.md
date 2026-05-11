---
name: Continuous Footnote Numbering Across Chapters
description: Each chapter ships footnoteOffset = sum of prior chapters' footnotesCount; backend shifts superscripts, citation back-refs ("לעיל ה"ש N"), and footnotes[].number by that offset after Step 6b
type: feature
---

Without this, every academic chapter restarts footnotes at 1, so the assembled paper has many duplicate "¹", "²", … markers. We now produce a single monotonically-increasing footnote sequence across the whole paper.

### Mechanism

1. **Frontend (`src/components/LegalQAChat.tsx`)**
   - `ChapterData` carries `footnotesCount?: number`, captured from `qaResult.footnotes_count` (fallback: `qaResult.footnotes.length`) after each `write_chapter` / `write_introduction` / `write_conclusion` response.
   - On the next chapter's request, frontend sums `footnotesCount` of every chapter that appears BEFORE the current one in **display order** (the `chapters` array is already stored in display order: תקציר → מבוא → bodies → סיכום ומסקנות) and ships it as `body.footnoteOffset`.
   - Abstract contributes `0` (memory rule: abstract is pure synthesis, no new citations).

2. **Backend (`supabase/functions/legal-qa/index.ts`)**
   - Destructures `footnoteOffset` from request body. Honored only when `taskMode === "academic_writing"` and `academicStep ∈ {write_chapter, write_introduction, write_conclusion}`. Clamped to `0..500`.
   - After Step 6b appearance reorder and all post-processing (right before `buildResponse`), if `effectiveFootnoteOffset > 0`:
     - **Superscripts in `answer`** rewritten via two-phase placeholder swap (avoids 1→11 collisions), descending-order pass.
     - **Textual back-references** matching `לעיל\s*,?\s*ה"ש\s+(\d{1,3})` inside each footnote `citation` are shifted by the offset (Rule 37.7 numbers stay valid).
     - **`footnotes[].number`** field shifted in place.
   - Response payload gains `footnotes_count` (always when chapter-class) and `footnote_offset_applied` (only when > 0).
   - Feature gate: `CONTINUOUS_FOOTNOTES_ENABLED` env (default true).

### Caveats

- Regenerating chapter K leaves K+1..N stale until each is regenerated — known limitation. No auto re-stitch yet.
- `שם` references carry no number — untouched.
- Paper Memory delta + coherence critic run on pre-shifted numbers (citations reference text, not numbers).
- Word add-in concatenates chapter HTML verbatim, so it inherits the shifted numbering automatically.

### Files

- `supabase/functions/legal-qa/index.ts` — accept `footnoteOffset`, post-Step-6b shift block, extended `buildResponse` extras.
- `src/components/LegalQAChat.tsx` — `ChapterData.footnotesCount`, offset computation in request, `footnotes_count` capture from response.
