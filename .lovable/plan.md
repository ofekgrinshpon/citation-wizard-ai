## Goal

Insert a **review step** between "user enters sources" and "final footnote list". Each input gets its own mini-card preview where the user can validate, edit, change source classification, or replace text, and the engine re-runs that single citation on demand. Only when the user clicks **"אישור הכל"** (or per-card אישור) does the consolidated final list with repeated-citation rules (שם / לעיל) get assembled.

## New flow

```text
1. User fills inputs (existing 5-row UI)
2. Clicks "בנה הערות שוליים"  →  per-source draft (Perplexity calls run as today, in parallel)
3. NEW: Each result shown in a "review card" with status badge
        ┌─────────────────────────────────────────────┐
        │ #1  [סוג: פסיקה ▾]   ● ממתין לאישור        │
        │ קלט: ע"א 5587/93                            │
        │ פלט: דנציגר נ' …, פ"ד מט(1) 102 (1994)     │
        │ [✎ ערוך פלט] [🔄 חפש שוב] [✓ אשר] [✗ הסר]  │
        └─────────────────────────────────────────────┘
4. User can per card:
   - Edit the citation text inline
   - Change detected source type (dropdown) → triggers re-run
   - Edit the raw input → triggers re-run on demand
   - Mark "אשר" (locks card as approved)
5. "אשר הכל ובנה רשימה סופית" button — enabled only when all non-empty
   cards are approved. Clicking it:
   - Applies repeated-citation rules (שם / לעיל ה"ש) across approved citations
   - Runs bibliography sync
   - Shows the final consolidated list (existing output UI)
6. User can return to review (כפתור "חזור לעריכה") to tweak more.
```

## UI changes (`src/components/BatchFootnoteBuilder.tsx`)

- Add a new render mode: `phase: "input" | "review" | "final"`.
  - `input` — current input grid + "בנה" button (label changes to "בנה לבדיקה").
  - `review` — list of `ReviewCard` per cell that has output; final-list section hidden.
  - `final` — current output section as today; "חזור לעריכה" button returns to `review`.
- New component `FootnoteReviewCard.tsx` with:
  - Status pill (`ממתין` / `אושר` / `טוען מחדש` / `שגיאה`)
  - Read-only raw input + small "ערוך קלט" toggle
  - Source-type Select (reuse `SOURCE_TYPE_LABELS`)
  - Editable citation textarea (defaults to engine output)
  - Buttons: `🔄 הפק מחדש`, `✓ אשר`, `✗ הסר`
- Add per-card `regenerateOne(cellId)` that runs the same Perplexity path used in `processAllCells`, but for a single cell, preserving the user's edited source type / input override.
- Approval state stored on the cell as `approved: boolean` and `userEdited: boolean`.

## Logic changes

- Split current `processAllCells` into two phases:
  1. `draftAllCells()` — runs per-cell Perplexity (existing parallel loop), **without** `applyRepeatCitationRules`, bibliography sync, history insert, or verified-source persistence. Sets `phase: "review"`.
  2. `finalizeApproved()` — runs only on user click after all approved:
     - Applies `applyRepeatCitationRules` to the approved outputs in current order
     - Inserts citation_history rows
     - Calls `ensureVerifiedSources`
     - Triggers integrity-card queue for new legislation (existing flow)
     - Syncs bibliography
     - Sets `phase: "final"`, generates summary text
- `regenerateOne(cellId)` — sets that card to `loading`, runs single `invoke("citation-chat", …)`, replaces `output`, clears `approved`. Does not touch other cards.
- Editing the input text or changing source type clears `approved` and (optionally) auto-triggers `regenerateOne`. Editing the citation text directly does **not** re-call Perplexity — it just unlocks approval (`userEdited: true`) and requires a fresh click on אשר.
- Drag-and-drop reorder stays available in both `input` and `review` phases (affects future "שם / לעיל" numbering).

## State persistence

- Extend cell shape: add `approved`, `userEdited`, `phase` to the localStorage payload so refresh keeps the review state. Bump storage key suffix to avoid clashes with the old format (e.g. `footnote_cells_v2_<projectId>`).

## Files touched

- `src/components/BatchFootnoteBuilder.tsx` — phase state, split processing, new buttons
- `src/components/FootnoteReviewCard.tsx` — new
- No edge-function changes; uses existing `citation-chat` per-cell as today

## Out of scope

- No changes to the consolidated final-list rendering, copy/insert-to-Word, or bibliography UI.
- No backend / DB schema changes.
- No changes to the integrity card flow (still runs at finalize).
