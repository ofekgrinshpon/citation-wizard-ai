
## Goal

After a Legal QA answer renders, let the user open a **Citation Review** panel where every footnote becomes an editable mini-card (same affordance as `FootnoteReviewCard` in the Batch Footnote Builder). The user can:

1. Edit the raw input (case name, law name, free text).
2. Change the detected source type.
3. Click **🔄 השלם פרטים חסרים** to re-run the citation through Perplexity + the citation engine to fill `[חסר: שנה]`, missing volume/page, missing law year, etc.
4. Edit the canonical output directly.
5. Approve a citation (✓), or remove it.
6. When all approved, click **עדכן תשובה** → the answer text is re-rendered with the new footnote list (same superscript numbering, same Rule 37 שם/לעיל logic), and the final answer block updates in place.

No backend pipeline changes for Core/Research. This is a post-generation editing layer that re-uses the existing `citation-chat` edge function (single-citation formatter) and a thin new edge function for "fill missing fields via Perplexity".

## User flow

```text
Answer renders (existing)
        │
        ▼
"בדוק ציטוטים" button under footnote list
        │
        ▼
Citation Review panel opens (RTL, inline under answer)
  ┌──────────────────────────────────────────────┐
  │ [1] ✓ אושר            סוג: פסיקה ▾   ✕      │
  │ קלט:    בג"ץ 910/86 רסלר נ' שר הביטחון      │
  │ פלט:    בג"ץ 910/86 רסלר נ' שר הביטחון,    │
  │         פ"ד מב(2) 441 (1988).                │
  │ [🔄 השלם חסרים] [✎ ערוך] [✓ אשר]            │
  └──────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────┐
  │ [2] ⚠ דרוש בדיקה      סוג: חקיקה ▾   ✕      │
  │ פלט:    חוק יסוד: כבוד האדם וחירותו         │
  │         ([חסר: שנה]).                        │
  │ [🔄 השלם חסרים]                              │
  └──────────────────────────────────────────────┘
        │
        ▼
"עדכן תשובה" → re-render answer with new footnotes
```

## Files

### New: `src/components/legal-qa/CitationReviewPanel.tsx`
- Props: `{ answer, footnotes, onApply(updatedAnswer, updatedFootnotes) }`.
- Local state: `cells: ReviewCitationCell[]` (one per footnote, seeded from `result.footnotes`).
- Renders one `<CitationReviewCard>` per cell + a sticky footer with **עדכן תשובה / ביטול**.
- On **עדכן תשובה**: builds the new footnote array (sequential numbering preserved), runs the local re-render helper, calls `onApply`.

### New: `src/components/legal-qa/CitationReviewCard.tsx`
- Mirrors `FootnoteReviewCard.tsx` visually (status pill, source-type `Select`, editable input, editable output textarea, action buttons).
- Adds a **🔄 השלם פרטים חסרים** action button (instead of "הפק מחדש").
- Detects missing fields from the current output (`[חסר: שנה]`, `[חסר: …]`, empty volume/page parens) and surfaces a red hint `חסר: שנה, כרך`.
- Disabled "אשר" until output has no `[חסר: …]` placeholders (or user manually edits).

### New: `src/lib/legalQa/footnoteRerender.ts`
Pure helper, no network:
- `renumberFootnotes(answer, originalFootnotes, edited: EditedFootnote[]) → { answer, footnotes }`
- Re-runs the same superscript scanning logic the backend uses (greedy `¹²³⁴⁵⁶⁷⁸⁹⁰` parsing, mirroring `supabase/functions/legal-qa/core/footnotes.ts`).
- Drops removed citations and re-flows numbering left-to-right.
- Re-applies Rule 37 שם / לעיל ה"ש N for repeated same-source markers.

### New: `supabase/functions/citation-refill/index.ts`
Thin edge function, JWT-protected, costs 1 credit (same as a citation-chat call):
- Input: `{ current_citation, source_type, missing_fields: string[], raw_hint?: string }`.
- Calls Perplexity (`sonar-pro`, same provider used in `legalSourcePack.ts`) with a tight prompt: "given this citation, return ONLY the missing fields as JSON: { year?, volume?, page?, full_date?, official_publication? }". Uses `search_domain_filter` with the existing supremedecisions/nevo/knesset allowlist.
- Merges the returned fields into the input using the existing `_shared/citationEngine.ts` resolver → returns the new canonical citation + which fields were actually filled.
- No DB writes; logging only into `qa_logs.metadata.refill_calls` is **out of scope** for V1.

### Refactor: `src/components/LegalQAChat.tsx`
- Add a small toggle button near the "הערות שוליים" header: **"בדוק ציטוטים"** (only when `result.footnotes.length > 0` and we are in research/research-deep mode — not for case-summary).
- When toggled, render `<CitationReviewPanel>` inline beneath the footnote list.
- On `onApply`, replace `result.answer` and `result.footnotes` in local state. Mark the result as user-edited (`result.user_edited = true`) so downstream copy/insert uses the edited version. **No qa_logs update** — keep it client-side for V1.

### Reused (no changes)
- `citation-chat` edge function — used by `🔄 השלם פרטים חסרים` only as a fallback when refill fails to produce a clean canonical (so we still leverage its full source-type-aware formatting).
- `FormattedCitation` — for the live preview line under each card.
- `SOURCE_TYPE_LABELS`, `detectSourceType` from `src/data/abbreviations.ts`.

## Behavior rules

- **Numbering invariant**: review never breaks superscript-to-footnote alignment. The renumber helper is the only place that rewrites both. Unit-test with adjacent multi-digit cases (¹²/³⁴/⁵⁶) — same logic as the eval harness patch.
- **Removed citation**: any superscript pointing to it is stripped from the answer text.
- **Repeated source**: short forms are regenerated by the helper, never by Perplexity.
- **Quality gates stay client-side**: V1 trusts the user's manual edits. Backend post-processing gates (`bare-reporter`, `journal_pipe_unresolved`, `ציטוט חסר`) are only re-checked as soft warnings on the card; the user can still approve through them.
- **No retrieval re-run**: this is editing, not new research. We never re-query the ledger or run Core again.

## Out of scope for V1
- Persisting edited answers back into `qa_logs` (read-only history stays the raw model output).
- Re-running CitationQuality / verifier on user edits.
- Bulk "refill all missing fields" action — V1 is one card at a time, keeps the credit cost transparent.
- Mobile-optimized layout — desktop only first, same as Batch Footnote Builder today.

## Validation
1. Type-check edge function + frontend.
2. Manual: open any S1–S10 smoke answer with `[חסר: שנה]` (S1/S4/S6/S7 currently have them), open review, click **🔄** on a card, confirm year fills, approve, click **עדכן תשובה**, confirm the answer rerenders with the year visible and superscripts still aligned.
3. Edge case: remove footnote #3 from a 7-footnote answer → superscripts ⁴⁵⁶⁷ should renumber to ³⁴⁵⁶ and all subsequent שם/לעיל references must update.
4. Adjacent multi-digit (¹²) regression: same case the eval harness now handles correctly.
