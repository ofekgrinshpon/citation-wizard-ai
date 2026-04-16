

# Fix: Footnote-Body Mismatches in Legal QA

## The Problem
The AI writes superscript numbers (¹²³) directly in the body text and then writes a separate footnotes section — but the numbers don't match. For example, the body says "חוק יסוד: הממשלה¹" (about Basic Law) but footnote 1 is about a completely unrelated Knesset committee discussion. This is a **numbering alignment problem**, not a hallucination problem.

## Root Cause
The prompt (line 734-736) tells the AI: "Don't use [X] brackets — use superscript numbers directly." But the AI is bad at maintaining consistent numbering between inline superscripts and the footnotes section. The post-processing code (Step 6) was designed to convert `[X]` bracket references to superscripts, but since the AI already writes superscripts, this conversion never fires — so the system relies entirely on the AI getting the mapping right, which it doesn't.

## Fix: Force bracket markers, convert to superscripts server-side

### Step 1: Change the prompt to require `[X]` markers
Replace the "superscript" instruction (lines 734-740) with instructions to use `[1]`, `[2]`, etc. in the body text, matching the footnote numbers in the footnotes section. This gives the post-processing deterministic control over the mapping.

### Step 2: Add a consistency check after parsing
After parsing both the body references and the footnotes section, verify that each `[X]` in the body corresponds to footnote X in the list. If a mismatch is detected (body mentions a source by name but the footnote is about something else), log it for debugging.

### Step 3: Convert brackets to superscripts server-side
The existing Step 6 code already does this (`answer.replace(/\[(\d{1,2})\]/g, ...)`). It just wasn't being used because the AI was writing superscripts directly. Now it will work as designed.

### Step 4: Strip any raw superscripts the AI might still produce
Add a safety pass that converts any remaining Unicode superscript characters back to `[X]` format before the main conversion, ensuring consistent processing regardless of AI behavior.

## Files to Change
- `supabase/functions/legal-qa/index.ts` — prompt rewrite (lines 734-740) + add superscript-to-bracket normalization before Step 6

## Technical Detail
```
Current flow:  AI writes ¹²³ directly → post-processing can't control mapping → mismatches
Fixed flow:    AI writes [1][2][3] → post-processing maps to source cards → converts to ¹²³
```

## Expected Result
- Each superscript in the body will reliably point to the correct footnote
- The server controls the numbering, not the AI
- No more "חוק יסוד¹" pointing to an unrelated Knesset committee document

