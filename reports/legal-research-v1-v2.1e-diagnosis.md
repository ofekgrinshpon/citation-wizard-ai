# V2.1e — Diagnosis of remaining prose/legal-correctness issues

Scope: diagnosis only. No code changes, no prompt changes, no denylist
changes, no retrieval/verifier/admission/footnote/schema changes. The four
defects below were not surfaced by the V2.1e telemetry; this report classifies
each one by mechanism so a future patch can be targeted correctly.

Source of truth: `qa_logs` rows for the V2.1e run, footnotes column (compound
footnotes carry the full `sources[]` per segment).

---

## Q2 — תקנת השוק במיטלטלין (run `d14a161e…`)

**Excerpt (opening תמצית + ¶"יסוד חוקי"):**
> "תקנת השוק בסעיף 12 לחוק המיטלטלין חלה כאשר הרוכש רכש בתום לב ובתמורה…"¹
> "הבסיס החוקי הוא סעיף 12 לחוק המיטלטלין הנוסח 'בתום לב ובתמורה'…"²

**Sources attached to that segment** (footnotes 1–2, compound):
- חוק המיטלטלין, תשל״א-1971 — knesset PDF (primary legislation)
- "תקנת השוק: התפתחותה של תקנה ופיתוחו של דין" — HUJI law review
- "תקנת השוק במיטלטלין: בעקבות ע״א 8922/22 מכון ז׳בוטינסקי…" — TAU law review post

**Do the sources support the proposition?**
No. The classical Israeli statutory anchor for תקנת השוק במיטלטלין is
**סעיף 34 לחוק המכר, תשכ״ח-1968**, not סעיף 12 לחוק המיטלטלין. סעיף 12 לחוק
המיטלטלין deals with מסירה / חזקה, not with rescuing a good-faith buyer.
חוק המכר is **not in the candidate pool** for Q2 (no חוק המכר source in any of
the 8 footnotes — only חוק המיטלטלין + academic articles about תקנת השוק).
The academic articles do discuss the doctrine, but the structured drafter
collapsed "תקנת השוק" + "חוק המיטלטלין (in pool)" into a fabricated section
reference.

**Classification:** **C + D — source-pack mismatch compounded by drafter
compression.** Retrieval brought the wrong statute (חוק המיטלטלין instead of
חוק המכר §34), and the drafter, forced to anchor the doctrine on a primary-
statute citation, invented "סעיף 12" by pattern-matching the only statute it
had. The article titles in the pool reference the correct doctrine but not the
correct section number, so the drafter filled the gap.

**Fix surface:** prompt-only is **not sufficient**. This needs either
(a) retrieval/exact-authority routing that recognizes "תקנת השוק במיטלטלין →
חוק המכר §34", or (b) a verifier rule that flags primary-statute citations
that are not present in the candidate pool. A denylist will not catch this.

---

## Q7 — צו מניעה זמני (run `73927d8c…`)

**Excerpt (opening תמצית):**
> "בקצרה: **לנוטריון לבית המשפט** דרושים בדרך-כלל חמישה יסודות מצטברים…"

**Sources attached to ¶1 of the body** (footnote 1, compound):
- החלטה בתיק רע״א 2407/19 — Supreme Court PDF
- עיוני משפט — journal landing page
- המשפט — journal landing page

The phrase "לנוטריון לבית המשפט" appears **only in the תמצית**, which carries
no footnote. None of the source titles or snippets contain "נוטריון". The
drafter clearly intended "**להענקת/למתן צו מניעה זמני** דרושים…" and produced
a hallucinated noun substitution (Hebrew "נוטריון" = notary, legally
meaningless here). The rest of the body uses correct phrasing ("מתן הצו",
"סעד זמני").

**Do the sources support it?** Not applicable — the phrase is a generation
artifact, not a sourced proposition.

**Classification:** **A — occasional model word glitch (Hebrew noun
substitution) in the opening summary line.** Not source contamination; not
systematic misuse.

**Fix surface:** prompt-only is **partially sufficient** (a "no introduced
legal-instrument nouns in תמצית" instruction would help), but the more
reliable fix is a tiny structural QA rule on the תמצית sentence: it must
echo the question's main concept (`צו מניעה זמני`) and may not introduce a
new legal-instrument noun absent from both the question and the source
titles. Adding "נוטריון" to a denylist would be a false generalization
(נוטריון is a perfectly valid term elsewhere) — the right signal is
"noun appears in opening line but not in question, source titles, or source
snippets".

---

## Q14 — ביקורת שיפוטית על החלטות רשויות אכיפה (run `e9cb03cf…`)

**Excerpt (¶"תקן הביקורת"):**
> "…בית המשפט שואף לזהות **שגיאות מוסיקליות של מהות ההחלטה** או חוסר סבירות
> קיצוני שמצדיק התערבות."³

**Sources attached to that segment** (footnote 3, compound):
- בג״ץ 5658/23 התנועה לאיכות השלטון נ׳ הכנסת — pasak din via toledano.co.il
- בג״ץ 8236/19 מרים גבאי נ׳ היועמ״ש — pasak din via toledano.co.il

**Do the sources support it?** The doctrine being expressed — שגיאות
**מהותיות** or חוסר סבירות קיצוני as a trigger for התערבות — is supported by
both rulings. But the adjective rendered is "**מוסיקליות**" (musical), which
is nonsensical. This is a homophone/typo-class substitution for "**מהותיות**"
(or possibly "מהותיות־ערכיות"). No source title or snippet contains
"מוסיקליות".

**Why V2.1e quality_warning did not flag it:**
- `broken_hebrew` bucket is exact-phrase, not morphological — "שגיאות
  מוסיקליות" is not in the list.
- `foreign_word_in_hebrew` only catches Latin-script tokens (e.g. `alcance`);
  "מוסיקליות" is valid Hebrew script, just semantically absurd in context.
- `wrong_official_name`, `wrong_party_label_civil`, `truncated_source_fragment`,
  `scaffold_leakage` — none apply.

There is no current bucket that detects "real Hebrew word used in a
semantically impossible legal collocation". This is exactly the failure mode
the user predicted: telemetry zero-hits ≠ prose clean.

**Classification:** **A — model word glitch (semantic homophone substitution
of מהותיות → מוסיקליות).** Not source contamination, not systematic.

**Fix surface:** prompt-only **may help but is not sufficient on its own**.
The systematic answer is a small collocation/whitelist check: adjectives
modifying "שגיאות" / "פגמים" / "טעויות" in a legal context should be drawn
from a closed list (`מהותיות`, `יסודיות`, `קלות`, `חמורות`, `פרשניות`,
`עובדתיות`, `שבסמכות`, etc.). Anything outside that list is suspect. A
denylist of `מוסיקליות` alone would only patch this one instance and miss
the next homophone (e.g. `מוסריות` → `מוסיקליות` → `מוסקליות`).

---

## Q15 — עמימות סיבתית / אובדן סיכוי (run `a2f53f52…`)

**Excerpt (opening תמצית):**
> "…להפעיל כלים פרוצדורליים המאפשרים להקל על הנטל הראייתי או לקבל סעד חלופי
> כגון **זיכוי על אובדן סיכוי**."

…and again in ¶"חלוקת אחריות":
> "פתרון המוכר בדוקטרינה של אובדן סיכוי…"² (correct phrasing here)

**Sources attached to footnote 2** (compound):
- "דוקטרינת הנזק הראייתי" — Porat, TAU PDF
- "הסיבתיות במשפט הנזיקין הישראלי - בחינה מחודשת" — HUJI law journal

**Do the sources support the proposition?** Yes for the underlying doctrine
(אובדן סיכוי as a civil-tort remedy producing פיצוי, not זיכוי). The body of
the same answer consistently uses "פיצוי" / "סעד" / "חישוב אובדן סיכוי" — only
the opening תמצית uses "זיכוי" (acquittal — a criminal-law verb, wrong by
two doctrinal categories: wrong verb *and* wrong branch of law).

**Why V2.1e quality_warning did not flag it:**
- `wrong_party_label_civil` looks at `הנאשם` in civil contexts; it does not
  look at criminal-verb leakage (`זיכוי`, `הרשעה`) in civil contexts. The
  symmetric rule is missing.
- Source snippets do not contain "זיכוי" attached to "אובדן סיכוי" — this is
  drafter-side, not source contamination.

**Classification:** **B — systematic legal-term misuse (criminal verb in
civil-tort context), single occurrence in this run but the same family as the
`נאשם`-in-civil bucket V2.1e already addresses.** The bucket was built one-
sided (party labels only) and missed the symmetric verb-leakage case.

**Fix surface:** prompt-only could plausibly fix this single phrase, but the
durable fix is to **extend the existing `wrong_party_label_civil` bucket into
a `wrong_criminal_term_in_civil` family** that also covers verbs/nouns:
`זיכוי`, `הרשעה`, `כתב אישום`, `עונש`, `גזר דין` (when not already carved
out), etc., when the question + source context is civil/tort. This is the
same heuristic already implemented for `הנאשם` — just widened.

---

## Cross-cutting summary

| Q | Defect | Where it originates | Class | Prompt-only fix enough? |
|---|---|---|---|---|
| Q2 | wrong statutory anchor (§12 חוק המיטלטלין vs §34 חוק המכר) | retrieval pool missing חוק המכר → drafter pattern-matches the only statute it has | **C + D** (source-pack mismatch + drafter compression) | **No** — needs retrieval routing or a "primary-statute must exist in pool" verifier |
| Q7 | hallucinated noun "לנוטריון לבית המשפט" in תמצית | model generation, opening summary line, no footnote attached | **A** (model word glitch) | Partial — better handled by a structural rule on the תמצית line |
| Q14 | "שגיאות מוסיקליות" (homophone for מהותיות) | model generation, real Hebrew word in impossible collocation | **A** (model word glitch) | Partial — durable fix is a small adjective whitelist for legal-error nouns, not a denylist |
| Q15 | "זיכוי על אובדן סיכוי" (criminal verb in civil-tort summary) | model generation, opening summary line; body uses correct "פיצוי" | **B** (systematic class — same family as the `נאשם`-in-civil rule) | No — extend the existing party-label bucket into criminal-term-in-civil |

### What this means for the V2.1e telemetry result

V2.1e telemetry reported 0 hits across all buckets. That is **technically
correct** — none of the four defects above are covered by the V2.1e bucket
definitions:

- Q2 is not a Hebrew/foreign-word/party-label issue at all — it's a
  doctrinal-citation mismatch the prose-level buckets were never designed to
  catch.
- Q7 and Q14 are model word glitches that happen to use valid Hebrew tokens
  not on any denylist; the V2.1e denylist is intentionally exact-phrase and
  cannot generalize to "noun X in context Y".
- Q15 is the symmetric case of a bucket V2.1e already implements one-sidedly.

The user's hypothesis is confirmed: **telemetry-only / denylist-only patches
have reached their ceiling for this class of defect.** Two of the four
(Q7, Q14) are class A (occasional glitch) and would be best caught by a
small structural QA rule on the opening תמצית sentence rather than by
broader prompting. One (Q15) is class B and is a clean extension of an
existing bucket. One (Q2) is class C+D and is the only defect that requires
touching retrieval/verifier — and is also the only legally consequential one
of the four (wrong primary-statute citation, which the V2.1d/V2.1e
architecture explicitly tried to prevent on the citation-cleanliness side
but does not check on the section-number side).

### Recommendation envelope (for discussion, not for implementation in this turn)

1. **Q2** is the priority — wrong statute is the only defect that produces a
   substantively wrong legal answer. Address via retrieval (route
   "תקנת השוק במיטלטלין" → חוק המכר §34 as exact_authority) and/or a
   verifier rule "no `סעיף N לחוק X` may appear in the answer unless חוק X
   is in the candidate pool". Out of scope per current instructions.
2. **Q15** is a one-line bucket extension (criminal-term-in-civil), low risk,
   no retrieval impact.
3. **Q7 + Q14** are best handled together by a single structural rule on the
   opening תמצית sentence (no new legal-instrument nouns, no adjectives
   outside a small whitelist for "שגיאות/פגמים/טעויות"). Denylist additions
   would not generalize.

Stopping here per instructions. No code, prompt, or denylist changes were
made.
