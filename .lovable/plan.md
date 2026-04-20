

## Goal
Replace the Bibliography Generator's one-shot "paste → add" flow with a 3-step wizard: **Paste → Review & Fix → Add to Bibliography**. The user inspects every result before anything is added, can rewrite or replace each citation inline (just like in אזכור אחיד), pick disambiguation candidates, retry failed ones, and only then commits everything to the final list.

## Why
Today the lookups go straight into the bibliography even when they're broken (`[חסר: עמוד ראשון]`, wrong חוק, ambiguous case law). The user has no chance to fix them before they land in the categorized output. The "✓ הוסף" / "מחק" / "שינוי מקור" pattern from אזכור אחיד already solves this — we apply the same idea here.

## New flow

```text
Step 1: PASTE                Step 2: REVIEW (the fix)              Step 3: BIBLIOGRAPHY
┌─────────────────┐          ┌────────────────────────────────┐    ┌───────────────────┐
│ paste lines     │  ─────►  │ row per source:                │    │ existing grouped  │
│ [עבד רשימה]     │          │  • formatted citation          │    │ output (unchanged)│
└─────────────────┘          │  • ✓ מאומת / ⚠ חסר badges     │    │                   │
                             │  • [ערוך] inline textarea      │    │                   │
                             │  • [שינוי מקור] category picker│    │                   │
                             │  • [חפש שוב] re-runs lookup    │    │                   │
                             │  • [הסר]                       │    │                   │
                             │  • disambiguation: pick option │    │                   │
                             │ ─────────────────────────────  │    │                   │
                             │ [➕ הוסף הכל לביבליוגרפיה]    │ ─► │                   │
                             └────────────────────────────────┘    └───────────────────┘
```

## Changes

### `src/components/BibliographyGenerator.tsx`
- Add a `reviewItems` state — array of:
  ```ts
  { id; rawInput; status: "ok"|"needs_choice"|"error"|"loading";
    citation; isVerified; sourceType; options?; isMissingFields; isEditing }
  ```
- After `processInPool` finishes, push every result (ok / disambiguation / error) into `reviewItems` instead of writing straight into the bibliography. The existing `pendingDisambiguations` list is removed; disambiguation lives inline on the row.
- Each review row renders:
  - The citation via `<FormattedCitation enableTooltips highlightMissing />` (so `[חסר: …]` is highlighted in red exactly like today).
  - A small badge strip: `✓ מאומת` (green) when verified, `⚠ פרטים חסרים` (amber) when the citation contains `[חסר:`, `❓ דורש בחירה` when status is `needs_choice`.
  - Compact category chip + a "שינוי קטגוריה" button that opens a small popover (subset of `SOURCE_CATEGORIES` mapped to the 9 `BibSourceCategory` buckets) — overrides classification for that row.
  - Action buttons: **ערוך** (turns the line into a textarea so the user can rewrite the full citation), **חפש שוב** (re-invokes `bibliography-lookup` for the original `rawInput`, optionally with the user's edited query), **הסר**.
  - For `needs_choice`: the option list renders as click-to-pick buttons (current disambiguation UI, just inlined).
- A primary action at the bottom of the review panel: **➕ הוסף הכל לביבליוגרפיה** — calls `addEntries` with all rows where `status === "ok"`. Optional secondary: **הוסף רק את המאומתים**.
- A counter line: `נמצאו X · מאומתים Y · דורשים תיקון Z`.
- Empty `reviewItems` → fall back to existing empty/bibliography view.

### `src/hooks/useBibliography.tsx`
- Extend `addEntries` payload to optionally accept `sourceTypeOverride?: BibSourceCategory`. If provided, skip `classifyCitation` for that field. (Tiny change — keeps category picker honest.)

### Edge function — no changes
`bibliography-lookup` already returns the right shape. The "חפש שוב" button just re-invokes it; the "ערוך" path doesn't call the function at all (user provides the canonical text manually).

## Out of scope
- No DB schema changes.
- No new edge function.
- Footnote-driven entries (`syncFootnoteEntries`) keep their current direct-add behavior — the review step is only for the manual paste flow.
- Keeps verified-source priority + Perplexity fallback behavior intact.

## Outcome
- Pasted sources never silently land as broken entries; the user sees and approves each one.
- חוק החוזים coming back with `[חסר: עמוד ראשון]` → user clicks **חפש שוב** or rewrites it inline before adding.
- בנק המזרחי → user picks the correct case directly on the row, no separate panel.
- בג"ץ 18225-06-25 with missing parties → flagged amber, user fixes or removes before commit.
- Wrong category (חוק העונשין classified as "ספרות משפטית") → one-click fix via the category chip.

