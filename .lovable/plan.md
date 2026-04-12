

## Fix: Connect Citation Engine to Legal QA Footnotes

### Problem
The legal-qa edge function has a brief, hand-written 7-line summary of citation rules (lines 320-327) that misses most formatting details. The full citation engine (`src/data/citationEngine.ts`) already has comprehensive rules for every source type — templates, required fields, formatting instructions, notes, and examples. These two are not connected.

### Solution
Serialize the citation engine rules into the system prompt dynamically at build time, so the AI gets the full, authoritative formatting instructions for every source type — not a lossy hand-written summary.

### Changes

#### 1. Create a shared citation rules module for the edge function

**New file: `supabase/functions/legal-qa/citationRules.ts`**

Extract the key data from `src/data/citationEngine.ts` into a self-contained module that can be imported by the edge function (edge functions can't import from `src/`). This module will contain:
- A function `buildCitationInstructions(): string` that generates the full citation formatting block for the system prompt
- For each source type: template, example, required fields with descriptions, formatting notes, and the "no titles" rule
- Include the general rules (1.9 comma separation, 1.10 number ranges)
- Add the extra rules missing from the current prompt: no academic titles (23.2.3), Knesset Research paper formatting, no `[missing:]` placeholders

#### 2. Update legal-qa edge function

**File: `supabase/functions/legal-qa/index.ts`**

- Import `buildCitationInstructions` from the new module
- Replace lines 320-327 (the hand-written citation rules block) with `${buildCitationInstructions()}`
- Add length enforcement: "Write at least 800-1200 words. Each section must have 2-3 substantive paragraphs."
- Add rule: "Never use [missing:...] placeholders — omit the component entirely if unknown."
- Add sequential footnote numbering enforcement

#### 3. Deploy

Deploy the updated `legal-qa` edge function.

### What This Fixes
- Footnotes will follow the full citation engine rules (templates, formatting, required fields)
- No more academic titles in author names (פרופ', ד"ר, רו"ח)
- Knesset Research papers formatted correctly as articles
- No more `[missing:...]` placeholders
- Longer, more detailed memos
- Sequential footnote numbering with no gaps

### Files Changed
- **New**: `supabase/functions/legal-qa/citationRules.ts`
- **Edit**: `supabase/functions/legal-qa/index.ts`

