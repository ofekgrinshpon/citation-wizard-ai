

## UI Overhaul: Card-Style Task Selectors for Legal Assistant

### Layout Change

Replace the small ToggleGroup pills (lines 302-323) with 4 professional rectangular cards in a responsive row/grid, positioned at the top of the workspace below the disclaimer. Move the input bar to the very bottom of the screen. Results fill the middle area.

### Changes — `src/components/LegalQAChat.tsx`

**1. Update TASK_MODES with icons**
Add an `icon` field to each mode (using Lucide icons):
- `research` → `Search` icon
- `pleading_analysis` → `FileSearch` icon
- `case_summary` → `BookOpen` icon
- `argument_draft` → `PenTool` icon

**2. Replace ToggleGroup pills (lines 302-323) with Card grid**
- Render 4 cards in a `grid grid-cols-2 sm:grid-cols-4 gap-2` layout
- Each card contains: icon, title, sub-label
- Default style: white/light background with subtle border
- Selected style: `bg-primary text-primary-foreground border-primary shadow-sm`
- Cards are clickable, calling `handleModeChange`
- When results are showing, cards shrink slightly (smaller padding/text)

**3. Restructure the overall flex layout**
Current order: disclaimer → pills → input → results (scrollable)

New order:
```
┌─────────────────────────────┐
│ Disclaimer                  │
│ 4 Mode Cards (row/grid)     │
├─────────────────────────────┤
│ Results area (flex-1 scroll)│
│ or Empty state              │
├─────────────────────────────┤
│ File upload + Input bar     │
│ File indicator + Attribution│
└─────────────────────────────┘
```

- Move the input bar block (lines 326-401) to the bottom, pinned with `mt-auto`
- Results area becomes the scrollable middle section
- Empty state stays centered in the middle area

**4. Card interaction**
- Clicking a card triggers `handleModeChange` (preserving file warning logic)
- Dynamic placeholder still updates based on selected mode
- Sub-label visible on the card itself, remove the standalone `<p>` sub-label

### Files Modified
- `src/components/LegalQAChat.tsx` — only file changed

### No backend changes needed
Backend prompts were already updated in the previous implementation.

