

## Goal
Fix the Bibliography Generator's "הזנה ידנית" so each pasted source is processed independently, hits the verified-source DB on its own, falls back to a Perplexity web search when not verified, and lets the user resolve case-law ambiguity inline.

## Problems being solved
1. **Verified hits get lost**: pasting 4 sources sends ONE batched AI call. The verified lookup runs on the jumbled combined text → known laws (חוק העונשין, חוק-יסוד: כבוד האדם וחירותו) come back with `[חסר: עמוד ראשון]`.
2. **No web fallback**: when a source isn't in the verified DB (e.g. חוק החוזים), the AI guesses or returns placeholders instead of looking it up online.
3. **Disambiguation freezes mid-list**: "נמצאו מספר פסקי דין תואמים…" gets dumped as static text in one bibliography row — the user can't pick.

## Approach

### 1. Per-source processing (`src/components/BibliographyGenerator.tsx`)
Replace the single batched prompt with one call per pasted line, run in parallel via `Promise.allSettled` (cap at ~5 concurrent). Each line gets:
- Its own clean verified-source short-circuit (so חוק העונשין → returns the canonical `ס"ח 226` citation).
- Its own disambiguation context.
- A clean single-line prompt — no `---BIB N---` delimiters.

UI: progress indicator `מעבד 2 מתוך 4...` while parallel calls run.

### 2. Perplexity fallback when not in verified DB
Add a new edge function `bibliography-lookup` that:
- Takes a single `rawSource` string.
- First runs the verified-source lookup (reuse logic from `citation-chat`).
- If no verified hit, calls Perplexity (`sonar` model, `search_mode: 'academic'`, Israeli legal-domain bias) asking for the canonical citation per the Uniform Citation Rules — including ס"ח/ק"ת publication, opening page, year.
- Returns `{ citation, source: 'verified' | 'web', disambiguation?: string[] }`.

`PERPLEXITY_API_KEY` is already configured. No new secrets needed.

`BibliographyGenerator` calls this new function instead of `citation-chat` for each line. 1 credit consumed per line via `consume_credits` RPC (refund on failure).

### 3. Inline disambiguation resolver
When the response contains `disambiguation` options, do NOT add the line to the bibliography. Instead, push it into a new `pendingDisambiguations` state and render a card above the bibliography list:
- Title: `בחר את פסק הדין הנכון עבור: <rawInput>`
- Buttons styled like `MessageBubble`'s disambiguation rows — one per option.
- Click → adds the chosen citation to the bibliography.
- "דלג" button → removes the pending item.

### 4. Verified badge only
Per the user's instruction, **do not surface where the data came from** unless it's a verified source.
- Verified DB hit → small green ✓ מאומת chip after the citation.
- Everything else (Perplexity web result OR plain AI knowledge) → no chip, displayed as a normal bibliography entry.

Stored on `BibliographyEntry` as a new optional `isVerified: boolean` field.

### 5. Toast summary
After processing finishes:
`<X> מקורות נוספו, <Y> דורשים בחירת פסק דין, <Z> כפילויות הוסרו`
(no mention of Perplexity / web source.)

## Technical changes

**New file**: `supabase/functions/bibliography-lookup/index.ts`
- JWT auth gate (mirror `verify-source`).
- Verified-source lookup helper (reuse the relevant block from `citation-chat`).
- If no hit → Perplexity call with system prompt: `"אתה מומחה לכללי האזכור האחיד הישראלי (מהדורה שלישית, 2021). החזר את האזכור התקני המלא של המקור המתואר, בשורה אחת, עם כל הרכיבים: שם מלא, שנה עברית–לועזית, ס"ח/ק"ת, עמוד פתיחה. אם מדובר בפסק דין שעלול להתבלבל עם הליכים נוספים, החזר רשימה ממוספרת של עד 4 חלופות."`
- Structured JSON response: `{ citation, isDisambiguation, options[] }`.
- Consume 1 credit via `consume_credits` RPC; refund on failure.

**Edited**: `supabase/config.toml` — register `bibliography-lookup` with `verify_jwt = false` (matches the existing pattern; auth handled in code).

**Edited**: `src/components/BibliographyGenerator.tsx`
- New `processSourceLine(line)` helper invoking `bibliography-lookup`.
- Replace batched flow with `Promise.allSettled` per-line + concurrency cap.
- New state: `pendingDisambiguations: { rawInput: string; options: string[] }[]`.
- Render disambiguation cards.
- Pass `isVerified` through `addEntries`.
- Render the ✓ מאומת chip only when `isVerified === true`.

**Edited**: `src/hooks/useBibliography.tsx`
- Add `isVerified?: boolean` to `BibliographyEntry` and to the `addEntries` input shape.

## Out of scope
- No changes to `citation-chat` (Footnote Builder and all other flows untouched).
- No UI changes outside the Bibliography panel.
- No new secrets.

## Outcome
- חוק העונשין / חוק-יסוד: כבוד האדם וחירותו → return canonical verified citations with correct ס"ח pages, marked ✓ מאומת.
- חוק החוזים → fetched silently from the web; appears as a regular entry with no source label.
- ע"א 6821/93 בנק המזרחי → inline picker; click adds the chosen case to "פסיקה – ביהמ"ש העליון".
- The user only sees a "verified" signal when it actually means something; everything else looks like normal AI output.

