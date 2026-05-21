## What the user saw

Footnote in the answer:
`ע"א 1726/21 (supremedecisions.court.gov.il)`

After clicking "🔄 השלם פרטים חסרים", refill returned:
`ע"א 1726/21 איילון חברה לביטוח בע"מ נ' פלונית [חסר: כרך] [חסר: עמוד פתיחה] (פורסם בנבו, 6.6.2023)`

The real case behind that docket is **מוחמד בכרי נ׳ ניסים מגנאגי**. Perplexity hallucinated the parties.

## Two distinct bugs

### Bug 1 — Refill hallucinates parties when only the docket is known

`supabase/functions/citation-refill/index.ts` sends `current_citation` to Perplexity with a generic "fill the missing fields" instruction. When the only real fact in the input is the docket (`ע"א 1726/21`) and there are no parties, the model invents parties that "look right" for that case number. Nothing in the prompt or the post-processing forces Perplexity to *prove* the docket matched.

Today's prompt also tells the model to keep `[חסר: …]` placeholders only for fields it cannot find — it does NOT tell it to refuse to invent party names, and it does not verify that the URL Perplexity cites actually contains the docket.

### Bug 2 — `(supremedecisions.court.gov.il)` is leaking into citation text

In `supabase/functions/legal-qa/core/citations.ts` (lines 200‑203), `passthroughCitation` appends `(${host})` to any citation whose canonical template could not be resolved:

```
if (text && ls.origin === "approved_web" && ls.url) {
  const h = hostOf(ls.url);
  if (h && !text.includes(h)) text = `${text} (${h})`;
}
```

That is a debug breadcrumb meant to say "we have a docket and an approved URL but no parties / year". It then gets shipped to the user as part of the citation string, which is why so many footnotes end with `(supremedecisions.court.gov.il)`, `(www.nevo.co.il)`, etc. It also pollutes the input that Bug 1 then sends to Perplexity.

## Plan

### Fix A — Make refill refuse to invent parties (`citation-refill/index.ts`)

1. **Sanitize input.** Before sending to Perplexity, strip a trailing `(<host>)` suffix from `current_citation` so the model doesn't treat the host as content.
2. **Detect "docket-only" inputs.** A regex over the sanitized text: has a docket (`ע"א\|בג"ץ\|רע"א\|...` + `NNNN/NN`) but no `נ'` and no party-shaped Hebrew text → mark `mode = "docket_lookup"`.
3. **Stronger prompt in docket mode.** Replace the current free-form Hebrew system prompt with explicit rules:
   - "מצא את התיק לפי מספר תיק מדויק בלבד. אסור להמציא שמות צדדים."
   - "אם לא מצאת את התיק עם בדיוק אותו מספר, החזר את הקלט כפי שהוא + הערה `אין אישור`. אסור להחליף לתיק אחר."
   - "ה-URL שתחזיר חייב להכיל את מספר התיק. אחרת — אל תחזיר שמות צדדים."
4. **Server-side verification (cheap, no extra call).** After Perplexity responds, check that at least one URL in `citations[]` literally contains the docket number (e.g. `1726/21` → `1726-21` or `1726%2F21`). If none does, **discard the model's party names** and return the sanitized original + `verified: false` + a Hebrew note `"לא נמצאו פרטים מאומתים — שמור על הקלט"`. Surface that note in the card as a yellow "לא ניתן לאמת" pill.
5. Same checks (lighter) for non-docket modes: if the model produced a string whose docket disagrees with the input docket, reject.

### Fix B — Stop leaking the host into the citation text

In `passthroughCitation` (`core/citations.ts`):

- Remove the `text = `${text} (${h})`` line.
- Instead, attach the host as a separate field on the returned object (e.g. `source_host: h`) and surface it in the footnote payload as `source_host`, not inside `citation`.
- `CitationReviewCard` already gets `url`; render the host as a small chip next to the status pill ("מקור: supremedecisions.court.gov.il"). The citation textarea stays clean.

This also automatically improves Fix A — refill will now see `ע"א 1726/21` only, with no host noise to anchor on.

### Out of scope (explicitly NOT changing here)

- The upstream pipeline that fails to resolve parties for these dockets (Stage E.5 / party-lookup). That is a known limitation already tracked in memory (`party-lookup-fulldate-relaxation`, `case-disambiguation-relevance`). Improving it is a larger separate task.
- Removing existing `(host)` strings from historical `qa_logs` rows. Only new answers will be clean.
- Any change to `legal-qa` Core or Deep pipelines.

## Files touched

- `supabase/functions/citation-refill/index.ts` — sanitize, docket-mode prompt, post-response verification.
- `supabase/functions/legal-qa/core/citations.ts` — stop inlining `(host)`, expose `source_host` instead.
- `supabase/functions/legal-qa/index.ts` — propagate `source_host` into the footnote object emitted to the client (1‑line mapping).
- `src/components/legal-qa/CitationReviewCard.tsx` — render `source_host` as a chip; render `verified: false` warning pill.
- `src/components/legal-qa/CitationReviewPanel.tsx` — pass `source_host` + `verified`/`refillWarning` through state.
- `src/lib/legalQa/footnoteRerender.ts` — preserve `source_host` field through re-render.

## Validation

1. Deploy `citation-refill`, then call it with:
   - `{current_citation: "ע\"א 1726/21", source_type: "case_law_published"}` → expect either correct parties (מוחמד בכרי נ׳ ניסים מגנאגי) **with** a citing URL containing `1726/21`, OR `verified:false` and the input unchanged. Must NOT return "איילון נ' פלונית".
2. Re-run a fresh Deep query that previously produced `(supremedecisions.court.gov.il)` footnotes; confirm the citation string no longer contains the host and that a host chip appears in the review card instead.
3. Confirm `rerenderAnswer` keeps `source_host` on surviving footnotes.

No DB migrations. No new secrets.