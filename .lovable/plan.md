## Problem

In the chapter you got, two issues — both in `supabase/functions/legal-qa/chapterWriter.ts`:

1. **`[S1]…[S12]` markers instead of footnotes.** The prompt tells the model to write `[S<rank>]` in the body and forbids footnotes, and the response always returns `footnotes: []`. The frontend has nothing to render.
2. **Chapter is too short.** Prompt targets 800–1400 words, `max_tokens` is `4096`, and there's no length check after streaming. The model underfills (~450 words in your sample).

## What I will change (all inside `chapterWriter.ts`)

### A. Real footnotes — academic-search style (title + link)

The model keeps writing `[S<rank>]` (reliable grounding). After streaming completes, post-process:

1. Walk the text in order, collect every unique `[S<rank>]` that was actually used.
2. Assign sequential footnote numbers starting from `footnoteOffset + 1` (continuous numbering across chapters — `LegalQAChat.tsx` already passes this).
3. Replace each marker with the standard footnote anchor used elsewhere (so the existing renderer + DOCX export pick it up).
4. Build `Footnote[]` — one per used source. **Same shape as the academic-search source cards:**
   - `text`: the source title (e.g. `"חוק יסוד: ישראל – מדינת הלאום של העם היהודי"`).
   - `url`: the link from the source pool (Knesset / Nevo / Supreme Court / SSRN / etc.).
   - `source`: `"local"` or `"perplexity"` — drives the same badge the search UI uses.
   - No full Israeli citation is built. No author / year / volume / pages — just title + link, exactly like the search results panel.
5. Sources never cited in the body are dropped from the final footnote list (still returned in `sourcesUsed` for transparency).
6. Return `{ answer, footnotes, footnotes_count, source_urls, sourcesUsed, chapterMeta }` — same shape the rest of the chat already consumes, so no frontend changes needed.

Prompt edits:
- Keep "use `[S<rank>]` markers — never invent a source".
- Drop "do not include footnotes" (system builds them now).
- Add "every factual / doctrinal sentence carries a marker; markers may repeat".

### B. Make chapters reach target length

1. Raise `max_tokens` for `write_chapter` from `4096` → `6500`.
2. Tighten the prompt: target **1100–1600 words**, **5–8 body paragraphs**, each paragraph 5–8 sentences, plus a small sub-structure per flow tag (e.g. for "הדין המצוי": חקיקה → פסיקה מנחה → פסיקה מחייבת → הסדר נורמטיבי → מעבר).
3. After streaming, count words. If `< 850`, run **one** continuation pass:
   - Same system prompt + the partial draft + "המשך מהמקום שעצרת. הוסף 2–3 פסקאות נוספות שמרחיבות את הניתוח. אל תחזור על מה שכבר נכתב. השתמש רק במקורות מהמאגר."
   - Append continuation, then run footnote post-processing once on the combined text.
   - Emit a `stage` event `expanding` so the UI shows progress.
4. If still `< 700` words after the continuation, return as-is with `chapterMeta.lowLength: true` (no UI work this round).

### C. Small correctness fixes

- Honor the existing `footnoteOffset` from `LegalQAChat.tsx` so numbering is continuous across chapters.
- If `sources.length === 0`, do **not** emit `[S…]` markers — instruct the model to write a doctrinal draft and flag `chapterMeta.lowGrounding: true`. No fake footnotes appear.

## Files touched

- `supabase/functions/legal-qa/chapterWriter.ts` — prompt edits, post-processing, optional continuation pass, footnote builder (title + link only), response shape.
- No frontend changes. No DB changes. Intro/conclusion paths untouched.

## Out of scope

- Intro / conclusion length or footnotes.
- Citation-validation rules (`citationValidation.ts`) — body chapters reuse the existing renderer; since footnotes are now just title + link, validation will simply not flag them as "missing required fields".
- Per-chapter manual source picking.