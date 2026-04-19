

## Issue
Footnote URLs in the legal-qa response point to sources that don't match the citation text. This is the same root cause as the previous bug — `matchFootnoteToCard` in `legal-qa/index.ts` is too permissive and pairs an AI-generated citation with the wrong source card from the retrieved results, then attaches that card's `source_url` to the footnote.

## Root cause (already known from previous plan)
In `supabase/functions/legal-qa/index.ts`, when the AI emits a footnote citation, the function tries to match it back to one of the retrieved source cards (local DB or Perplexity) to attach the canonical URL. The current matcher accepts:
- Keyword overlap as low as 2 of 3 short words
- Perplexity excerpt overlap of 2 of 4 words
- A "safety fallback" that keeps unmatched footnotes as "unverified" with whatever URL got attached

Result: a footnote about case A can get glued to card B's URL because two generic Hebrew words overlap (e.g. "בית", "המשפט"). The user clicks the link and lands on a completely unrelated source.

## Fix — single file: `supabase/functions/legal-qa/index.ts`

This extends the previous (already-approved) fix with **explicit URL-attachment hardening**:

### 1. Strict-only matching in `matchFootnoteToCard`
- **Tier 1 (accept):** exact case-number match (`\d+/\d+`), or exact normalized title match, or normalized URL substring match.
- **Tier 2 (accept):** ≥3 significant-word overlap (words ≥4 chars, excluding stopwords like בית/המשפט/של/את/לפי).
- **Remove** the Perplexity excerpt-overlap branch entirely.
- If no tier matches → return `null`.

### 2. Never attach a URL from a non-matched card
When `matchFootnoteToCard` returns `null`:
- Drop the footnote entirely (do not keep as "unverified" with a wrong URL).
- Strip the corresponding `[N]` marker from the body so the renumber pass doesn't leave dangling superscripts.

### 3. Remove the "keep all as unverified" safety fallback
The existing block that keeps every footnote when matching fails is the main path for wrong URLs leaking through. Drop unmatched footnotes instead.

### 4. Raise rerank threshold
Change retrieval `score >= 3` → `score >= 5` so weakly-relevant cards never reach the AI in the first place.

### 5. Prompt hardening against duplicate `[N]` markers
Add to the system prompt: "כל מספר הפניה [N] יופיע פעם אחת בלבד בגוף הטקסט. אם אותו מקור תומך בכמה טענות, השתמש ב-'שם' או 'לעיל ה"ש N' — אל תחזור על אותו מספר הפניה."

### 6. Body-side dedup of repeated `[N]` markers
Before renumber, if any `[N]` appears >2 times in the body, keep only the first occurrence; remove the rest (so the user doesn't see "several ¹").

## Out of scope
- No client-side changes (`LegalQAChat.tsx` rendering stays as-is).
- No DB schema changes.
- No academic-mode logic.

## File changes
- `supabase/functions/legal-qa/index.ts` — items 1-6 above.

