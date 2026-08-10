# Fix: false "חסרים 1 רכיבי חובה: citation" alert + ungrounded "אחר" citations

## What actually happened

Verified from the citation history record for this query:

- Input: `החלטת הררי`, classified source type: **אחר (other)**, `is_verified = false`
- Output: `החלטה 40 של הכנסת "כינון חוקה לישראל" (13.6.1950).`

### 1. Why the alert appeared

The validator special-cases only two "אחר" sub-shapes: דברי הכנסת (`ד"כ`) and מועצת המדינה הזמנית. Our output matched neither, so it fell through to the generic `other` engine, whose single required component is a literal field named `citation` — a field the extractor never populates for `other`. Result: it is always reported missing, and because there is no Hebrew label for it, the raw key `citation` is printed.

So: **every "אחר" citation that isn't Knesset-protocol shaped shows this warning, regardless of quality.** It is a false positive, not a real gap.

### 2. How the answer was produced

`citation-chat` runs grounded Perplexity search branches only for case law, legislation, regulations, books and articles. There is **no search branch for "אחר" / governmental-body decisions (rule 15)**. This answer was written by the model from its own knowledge, with no trusted source anchoring — which is exactly why it is flagged unverified.

The output does correctly follow the rule-15 template (`החלטה {מספר} של {הגוף} "{שם}" ({תאריך})`), and the date 13.6.1950 matches the Harari resolution. The decision number `40` and the exact decision title were not verified against any source, and a Knesset plenum decision of that era is normally cited via דברי הכנסת (rule 8), e.g. `ד"כ 13.6.1950, {עמוד}` — so both the number and the chosen rule are open questions the system currently cannot answer.

## Plan

### A. Stop the false alert (frontend validation)

In `src/lib/citationValidation.ts`:
- Recognise a rule-15 decision shape (`החלטה [מספר] של ... "..." (DD.MM.YYYY)`) inside the `other` path and validate it against the government-decision rule set instead of the generic `other` engine — required: deciding body, quoted decision name, full date.
- For any remaining `other` output with no recognised sub-shape, do not emit the synthetic `citation` field as "missing"; treat it as complete-but-unclassified.
- Add a Hebrew label fallback so an unmapped field key can never be printed raw.

### B. Ground "אחר" / decision citations (backend)

In `supabase/functions/citation-chat/index.ts`:
- Add a search branch for governmental-body decisions and other Knesset-sourced material, using the existing `perplexityWithFallback` helper with a domain filter of `knesset.gov.il`, `gov.il`, `reshumot.gov.il`, `main.knesset.gov.il`.
- Feed retrieved snippets to the drafting step and require that the decision number, decision title and date each be supported by a retrieved source; anything unsupported is emitted as `[חסר: ...]` rather than guessed.
- When the source shows the item is a Knesset plenum decision recorded in דברי הכנסת, prefer the rule-8 form (`ד"כ {תאריך}, {עמוד}`) and surface the alternative rule-15 form as a note.
- Mark the result verified only when at least one trusted source is anchored.

### C. Verify the Harari citation specifically

Run the new grounded branch on `החלטת הררי` and report the anchored result — expected to resolve to the 13.6.1950 Knesset plenum decision on drafting a constitution, with the דברי הכנסת volume/page confirmed from a knesset.gov.il source, and the "החלטה 40" number either confirmed or dropped.

### Regression checks

`החלטת הררי`, a numbered government decision (`החלטה 1666 של הממשלה ה-30`), a דברי כנסת citation, and a מועצת המדינה הזמנית citation — none should show the raw `citation` missing-field warning, and the two existing sub-shapes must keep their current rule-8 / rule-8.2 validation.
