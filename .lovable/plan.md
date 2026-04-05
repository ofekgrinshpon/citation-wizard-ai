

# Add "Insert All to Word" Button in Batch Footnote Builder

## What

Add an "Insert to Word" button in the batch footnote output section that inserts all generated footnotes into Word sequentially — each as a footnote (Desktop) or inline text (Word Online). The button only appears when running as an Office add-in.

## How

### 1. Modify `src/components/BatchFootnoteBuilder.tsx`

- Import `useOffice` and `insertCitationAsFootnote` 
- Add an "Insert all to Word" button next to the existing "Copy All" button in the output section header (line ~437-444)
- The button is only visible when `isOfficeAddin` is true
- On click, iterate through all `outputCells` in order, calling `insertCitationAsFootnote` for each cell's output
- Show a loading state while inserting, and a toast with the result count when done
- Also add a per-cell insert button (next to the existing copy button, line ~472-477) for inserting individual footnotes

### 2. Insertion logic

- Loop through output cells sequentially (not parallel — Word API requires sequential `Word.run` calls)
- For each cell, call `insertCitationAsFootnote(cell.output)` 
- Track how many succeeded as footnote vs inline
- Show summary toast: "הוכנסו X הערות שוליים ל-Word"

## Files

| Action | File |
|--------|------|
| Modify | `src/components/BatchFootnoteBuilder.tsx` — add bulk + per-cell Word insert buttons |

