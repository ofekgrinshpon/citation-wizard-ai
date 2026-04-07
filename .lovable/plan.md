

# Fix Missing Inline Footnote Numbers

## Problem
The AI model is not reliably inserting superscript footnote numbers (¹²³...) into the answer text. The frontend parser expects Unicode superscript characters but the model either omits them or uses regular numbers/brackets instead.

## Solution
Two-layer fix: strengthen the prompt AND add server-side post-processing to guarantee superscript numbers appear in the text.

## Changes

### 1. Edge Function Post-Processing (`supabase/functions/legal-qa/index.ts`)
After parsing the AI tool call response, add a post-processing step:
- For each footnote in the `parsed.footnotes` array, verify its superscript number exists in `parsed.answer`
- If missing, attempt to find likely insertion points (end of sentences referencing that source) and inject the superscript
- As a fallback, convert any `[N]` or `(N)` patterns in the answer to their Unicode superscript equivalents
- Map digits 0-9 to their Unicode superscript counterparts (⁰¹²³⁴⁵⁶⁷⁸⁹) for numbers above 9

### 2. Prompt Refinement (`supabase/functions/legal-qa/index.ts`)
- Add explicit examples showing multi-digit superscripts (e.g., `¹⁴`, `¹⁵`)
- Emphasize that EVERY footnote MUST have its corresponding superscript number embedded in the answer text
- Add a rule: "If you define footnote N, the character sequence for N in superscript MUST appear exactly once in the answer text"

### 3. Frontend Fallback (`src/components/LegalQAChat.tsx`)
- Expand the superscript regex to also catch `[N]` or `^N` patterns as fallback
- Add superscript `⁰` to the character map for multi-digit numbers like ¹⁰, ²⁰

## Result
Footnote numbers like ¹⁴, ¹⁵, ¹⁶ will reliably appear inline at the end of sentences (after punctuation), matching the reference screenshot.

