# V2 Drafter Prompt — Style Diagnosis

Scope: diagnosis only. No code, prompt, schema, retrieval, verifier, admission,
footnote-builder, citation, model, denylist, QA, frontend, or DB changes.
Target file (read-only for this report): `supabase/functions/legal-research-v1/stages/drafterV2.ts`.

Trigger: GPT-5 V2 answers still surface unnatural Hebrew compounds such as
"מכניזמים משפטיים", "סיגנוניהם המשמעיים", "מעמד על־תיקתי",
"מרכיבי זהות מדגמית", "פורמליזציה מדודה", "עמידות חוקתית". Hypothesis:
prompt is pushing the model toward translated-academic register, not model
quality alone.

---

## 1. Current prompt (verbatim)

### 1a. System prompt (`SYSTEM_PROMPT_V2`, lines 31–93)

```
אתה חוקר משפט ישראלי הכותב תזכיר מחקר קצר ומקצועי בעברית עבור עורך/ת דין מנוסה.

חשוב מאוד — פורמט פלט מבני (לא Markdown חופשי):
- אתה מחזיר *רק* קריאה לכלי emit_structured_draft עם אובייקט {blocks: [...]}.
- כל פסקה היא בלוק נפרד מסוג "paragraph" עם שדה text ושדה source_refs.
- כותרות הן בלוק "heading" (level 2 או 3) עם שדה text בלבד, ללא source_refs.
- פריט רשימה הוא "list_item" עם text ו-source_refs.
- בשדה text **אסור בהחלט** לכלול ספרות עליונות (¹²³…), אסור [N] בסוגריים מרובעים, אסור [[fn:N]], ואסור כל סימן הערת שוליים שהוא. הקוד מוסיף את הסימנים אחר־כך — אם תוסיף סימנים בעצמך, התשובה תיפסל לחלוטין.
- source_refs מכיל מזהי מקור כפי שניתנו לך (s1, s2, s3, … או u1p1 וכד'). מותרים אך ורק מזהים שהופיעו ברשימת המקורות. אם תפנה למזהה שלא קיים — התשובה תיפסל.
- אם פסקה היא פתיחה כללית, מעבר, או מסקנה שאינה מוסיפה טענה משפטית חדשה, אפשר source_refs: [].
- אם כמה מקורות תומכים יחד באותה טענה בפסקה — הוסף את כולם ל-source_refs של אותו בלוק. הקוד ייצור הערת שוליים מורכבת אחת.
- אל תוסיף את אותו מקור פעמיים באותו בלוק.
- מקסימום 3 מקורות לבלוק (אם נדרשים יותר — פצל לשני בלוקים נפרדים).

כללי כתיבה משפטית — סגנון:
- **פתיחה תזה־קודמת:** פסקה ראשונה משיבה ישירות על השאלה במשפט אחד או שניים. אל תפתח בהקדמה על התחום.
- **עברית משפטית טבעית:** כתוב כפי שכותב משפטן ישראלי. הימנע מתרגום מאנגלית, ממטא־שפה ריקה, ומפיגומים מלאכותיים.
- **ודאות מכוילת:** הבחן בין מסקנה מבוססת, מגמה רווחת, ואי־ודאות...
- **דיוק דוקטרינרי:** הבחן בין חוק, פסיקה, הנחיה מנהלית וספרות. אל תזכיר דוקטרינה שאינה נדרשת לתשובה.
- **מבנה מותאם:** השתמש בכותרות **bold** רק כשהן באמת עוזרות...
- **המקורות משרתים את הטיעון:** אל תארגן את התשובה כסקירת מקורות...
- **משמעת אורך:** אורך נגזר מהמקורות ומהשאלה...

שימור עוגנים משפטיים קונקרטיים (קריטי):
- ...אל תחליף עוגנים משפטיים קונקרטיים בהפשטה כללית...
- תשובה טובה אינה רשימת יסודות מופשטת או "כרטיס הגדרה"; עליה לשמר את העוגנים המשפטיים שמעניקים לדין את הדיוק והניואנס שלו...
- עדיף לכלול דוגמה פסיקתית אחת קונקרטית או הבחנה דוקטרינרית אחת מדויקת...

כללים נוספים:
- השתמש אך ורק במקורות שסופקו...
- אל תזכיר מזהים פנימיים...
- אל תכתוב כותרות עם # ## ###...
- כל הפניה למקור נעשית אך ורק דרך source_refs...

איכות לשונית, דיוק משפטי והגנה מפני זליגה פנימית:
כתוב בעברית משפטית ישראלית טבעית, כפי שעורך דין ישראלי היה מנסח. אל תמציא מונחים, אל תתרגם ביטויים משפטיים מאנגלית מילה־במילה, ואל תייצר שמות פעולה או צירופים שאינם מקובלים בשפה המשפטית...

[exact-phrase denylist instructions + party-label instructions + foreign-word ban + official-name-fidelity, lines 70–91]

זכור: אם תכניס סימן עילי כלשהו לתוך text, התשובה תיפסל.
```

### 1b. User template (`buildUserMessage`, lines 121–168)

Wraps: `שאלת המשתמש: …`, a frame-preservation reminder, claims list (with
`claim_id`), source list (one block per source with `ref/title/url/source_type/
role/best_support/supported_points/snippet`), optional soft user-doc context,
and a closing reminder to call `emit_structured_draft` without footnote
markers. The user template is mechanical/structural — not the style driver.

---

## 2. What in the prompt likely pushes academic / translated register

The prompt is unusually long (≈63 lines of system content) and is structured
as a stack of *defensive* rules. Several drift the model upward in register:

### 2a. Mixed identity — "חוקר משפט" + "תזכיר מחקר"
Line 31: `אתה חוקר משפט ישראלי הכותב תזכיר מחקר קצר ומקצועי`.
"חוקר משפט" + "תזכיר מחקר" reads to the model as an academic/research-memo
register, not a practitioner brief. Practitioners in Israel say
"חוות דעת משפטית" / "תשובה משפטית" / "מענה משפטי" — not "תזכיר מחקר".
This is the single strongest register anchor and it points the wrong way.

### 2b. Heavy meta-vocabulary in the rules themselves
The rules use words the model then mirrors back in the answer:
- `דוקטרינרי`, `דוקטרינה` (appears 3×)
- `מטא־שפה`, `פיגומים מלאכותיים`
- `ודאות מכוילת`, `מבנה מותאם`, `משמעת אורך`
- `שימור עוגנים משפטיים קונקרטיים`, `הפשטה כללית`, `מדרגי יסוד נפשי`
- `כרטיס הגדרה`, `הבחנה דוקטרינרית`

These are themselves abstract-academic compounds. LLMs absorb the register
of their instructions; telling the model in "מטא־שפה" not to use "מטא־שפה"
is self-defeating. The user's observed artifacts ("פורמליזציה מדודה",
"עמידות חוקתית", "מרכיבי זהות מדגמית", "מעמד על־תיקתי") are exactly the
kind of nouns a model produces when its instructions are written in that
register.

### 2c. Bold-headed bullet "framework" stack
Lines 46–52 are six bold-headed rules: **פתיחה תזה־קודמת**, **עברית משפטית
טבעית**, **ודאות מכוילת**, **דיוק דוקטרינרי**, **מבנה מותאם**,
**המקורות משרתים את הטיעון**, **משמעת אורך**. The model is being shown a
"framework" template — and then produces answers in framework form
(headings → sub-headings → abstract noun-phrases per section).

### 2d. Two contradicting pulls on headings
- Line 50: כותרות `**bold**` רק כשהן באמת עוזרות.
- Lines 36, 64: כותרות = בלוק `heading` (level 2 או 3).

The schema (see 2e) advertises `heading` as a first-class block with two
levels. The model reads this as "headings are encouraged" and overrides the
"only when truly helpful" hedge. Real practitioner answers are usually
heading-light or heading-free; the structured schema is implicitly
heading-heavy.

### 2e. Schema as a style signal
`DRAFTER_V2_TOOL_PARAMETERS` (lines 95–119) exposes `kind ∈ {heading,
paragraph, list_item}` and `level ∈ {2,3}`. There is no `kind: "summary"` /
`"answer"` / `"explanation"` — only structural primitives. A schema that
foregrounds *heading + level* over *answer + reasoning* nudges the model
toward a sectioned, sub-sectioned, encyclopedia-style layout. The schema is
not the root cause, but it amplifies §2c.

### 2f. Long "do-not" stack drowns the "do" line
The single positive style line ("עברית משפטית ישראלית טבעית, כפי שעורך דין
ישראלי היה מנסח") appears once in line 68, surrounded by ~25 negative rules
(don't invent words, don't use foreign words, don't use scaffold IDs, don't
use specific phrases, don't mislabel parties, don't break official names,
don't truncate source labels…). The model optimizes against the long
negative list and loses the one positive register anchor.

### 2g. "עוגנים קונקרטיים" block pushes density, not naturalness
Lines 54–59 ("שימור עוגנים משפטיים קונקרטיים") tell the model to pack in
specific case names, statute sections, exceptions, mental-state gradations,
burden-of-proof distinctions, open questions, etc. This is correct for
*content* but is phrased in academic register ("מדרגי יסוד נפשי",
"הבחנות בקשר סיבתי", "כרטיס הגדרה"). The model resolves the tension between
"be dense with anchors" and "be natural" by producing dense *academic* prose
rather than dense *practitioner* prose.

---

## 3. Word-frequency audit (user-requested triggers)

Counts inside `SYSTEM_PROMPT_V2` only:

| Trigger word | Count | Notes |
|---|---|---|
| academic / אקדמי | 1 | line 80, used as a *negative* ("אקדמי־עמום") — fine |
| synthesis / סינתזה | 0 | clean |
| theoretical | 0 | clean |
| conceptual | 0 | clean |
| normative framework / מסגרת נורמטיבית | 0 | clean |
| doctrinal / דוקטרינרי / דוקטרינה | 3 | "דיוק דוקטרינרי", "הבחנה דוקטרינרית", "דוקטרינה שאינה נדרשת" |
| comprehensive | 0 | clean |
| high-level | 0 | clean |
| in-depth | 0 | clean |
| מחקרי / חוקר / מחקר | 3 | "חוקר משפט", "תזכיר מחקר", appears as identity anchor |
| המשגה | 0 | clean |

So the explicit "academic-vocabulary" triggers are *not* the leak vector.
The leak vectors are subtler:

1. Identity = "חוקר משפט" + output = "תזכיר מחקר" (§2a).
2. Rule-vocabulary itself is abstract-academic (§2b).
3. Schema + bold-headed rule stack push framework layout (§2c, §2e).
4. Positive register anchor is one line vs ~25 negatives (§2f).

---

## 4. Is the structured schema itself part of the cause?

Partially, yes — but not on its own.

- Block types are *purely structural* (`heading`, `paragraph`, `list_item`)
  with no semantic role. The model is free to pick any layout, and combined
  with §2c it picks a sectioned one.
- `level: 2|3` actively invites sub-sectioning. Most practitioner answers
  use level-2 sparingly and no level-3.
- The schema does *not* force any abstract noun — those come from the
  prompt's own register and from the model's training prior. The schema
  amplifies but does not originate the academic feel.

A schema-side change is **not** part of the minimal proposal below; the
prompt is the cheaper lever.

---

## 5. Minimal prompt-only style revision (proposal — not implemented)

Goal: change *register*, preserve every legal-correctness, citation-marker,
party-label, official-name, frame-preservation, and source-discipline rule
exactly as-is.

### 5a. Targeted edits (six changes, all in `SYSTEM_PROMPT_V2`)

**Edit 1 — Identity line (line 31).** Replace
> `אתה חוקר משפט ישראלי הכותב תזכיר מחקר קצר ומקצועי בעברית עבור עורך/ת דין מנוסה.`

with
> `אתה עוזר/ת מחקר משפטי/ת בכיר/ה הכותב/ת מענה משפטי קצר, מדויק וישיר בעברית עבור עורך/ת דין מנוסה. כתוב/י כפי שמשפטן/ית ישראלי/ת מנוסה היה/יתה כותב/ת בחוות דעת קצרה — לא כפי שמאמר אקדמי היה כותב.`

Why: removes "חוקר משפט" / "תזכיר מחקר" register, replaces with
practitioner register. Adds the positive anchor up front (it currently
appears only on line 68).

**Edit 2 — Insert a one-paragraph register anchor as the third block, before "כללי כתיבה משפטית — סגנון" (after line 44).**

> `סגנון לשוני (הכלל הראשון, גובר על כל השאר חוץ מדיוק משפטי ומשמעת מקורות):
> כתוב/י עברית משפטית ישראלית טבעית, פשוטה ומדויקת. אל תנסה/י להישמע אקדמי/ת, מרשים/ה, "סינתטי/ת" או "תיאורטי/ת". אל תמציא/י שמות עצם מופשטים או צירופים מלומדים (למשל "פורמליזציה", "המשגה", "מכניזם משפטי", "עמידות חוקתית", "מרכיבי זהות מדגמית", "מעמד על־תיקתי") — אם אין למושג שם מקובל בעברית משפטית, הסבר/י אותו במשפט פשוט. העדף/י את המונח המקובל ("הסדר", "כלל", "מבחן", "סעיף", "פסיקה", "תכלית החוק") על פני מונח מלומד. אל תתרגם/י ניסוחים משפטיים מאנגלית מילה־במילה.`

Why: positive, specific, with anti-examples drawn from the actual failure
set. Placed *before* the rule stack so the model reads it as the dominant
register before everything else.

**Edit 3 — Re-tone the six bold-bullet rules (lines 46–52).** Keep the
substance, drop the academic vocabulary:
- `**ודאות מכוילת**` → `**ודאות מדויקת**`
- `**מטא־שפה ריקה, ופיגומים מלאכותיים**` → `**מילים ריקות וניסוחים מלאכותיים**`
- `**משמעת אורך**` → `**אורך מותאם**`
- `**דיוק דוקטרינרי**` keep, but rewrite body: `הבחן/י בין חוק, פסיקה, הנחיה מנהלית וספרות. אל תזכיר/י דוקטרינה או הלכה שאינה נדרשת לתשובה.` (drop "דוקטרינרי" as adjective.)

Why: stops the prompt from modeling the register it is trying to forbid.

**Edit 4 — Headings rule, tighten (line 50, plus echo in user message).**
Replace the hedge with a hard default:
> `**ברירת מחדל: ללא כותרות.** השתמש/י בבלוק heading רק אם התשובה באמת מתפצלת לשני נושאים מובחנים או יותר. תשובה של 3–6 פסקאות בדרך כלל אינה זקוקה לכותרת. אל תיצור/י כותרות־משנה (level 3) אלא במקרה חריג.`

Why: directly counteracts §2c+§2e schema pull toward sectioned layout.

**Edit 5 — Concrete-anchors block (lines 54–59), re-tone.** Keep every
substantive instruction but rewrite in practitioner register. Specifically:
- `"שימור עוגנים משפטיים קונקרטיים (קריטי):"` → `"דיוק קונקרטי (קריטי):"`
- `"מדרגי יסוד נפשי"` → `"דרישת יסוד נפשי, לפי המקור"`
- `"כרטיס הגדרה"` → `"תקציר מילוני"`
- `"הבחנה דוקטרינרית"` → `"הבחנה משפטית"`

Why: preserves the "anchor specifics, not abstractions" requirement without
the academic vocabulary.

**Edit 6 — Closing line (line 93).** Add one final positive anchor after
the existing footnote-marker warning:
> `מבחן עצמי לפני שליחה: האם זה נשמע כמו עוזר/ת מחקר משפטי/ת ישראלי/ת מקצועי/ת, או כמו תרגום של מאמר אקדמי? אם השני — שכתב/י בפשטות.`

Why: gives the model an explicit final self-check in the right register.

### 5b. What deliberately stays unchanged

- All structural format rules (lines 33–43): block kinds, source_refs
  semantics, footnote-marker prohibition, max 3 refs per block.
- Every existing legal-correctness rule: invented-term ban, foreign-word
  ban, official-name fidelity, party-label by procedure type, scaffold-ID
  ban, frame-preservation, source-only constraint.
- The full exact-phrase denylist in lines 70–71 and 82–91.
- The user-message template (`buildUserMessage`) — purely mechanical.
- The schema (`DRAFTER_V2_TOOL_PARAMETERS`) — keep as-is; revisit only if
  prompt-only revision fails to fix headings/layout.
- The footnote builder, verifier, retrieval, admission, denylist, QA
  buckets, model selection, and DB schema — all out of scope.

### 5c. Expected net effect

- Identity register flips practitioner-side.
- The model's *own* rule-vocabulary stops modeling the failure mode.
- Headings become rare instead of routine.
- The positive anchor moves from one buried line to three reinforced
  positions (top, middle, end).
- No change to: citation cleanliness, footnote counts, schema compliance,
  unknown-ref protection, party-label discipline, official-name fidelity,
  or scaffold-leakage protection.

---

## 6. Validation plan (for the next turn, not now)

Per user instruction — **do not implement yet**. When approved, the
validation should run, with all other components frozen:

1. The national-identity codification question (the prompt that surfaced
   the user's examples).
2. Five additional real fixtures from `eval/legal-research-v1/fixtures.json`
   (suggest: Q2, Q7, Q14, Q15, Q-extort — covers civil/tort, admin,
   procedural, criminal-adjacent, and the V2.1e known-defect set so we can
   confirm no regression on the bucketed defects).
3. For each: run V2 with the current prompt and with the revised prompt,
   same model (GPT-5), same retrieval/verifier/admission outputs (cache or
   freeze upstream stages).
4. Side-by-side comparison metrics:
   - **Natural Hebrew:** human read + a small targeted scan for the user's
     observed compound class ("פורמליזציה", "המשגה", "מכניזם", "סינתזה",
     "תיאורטי", "קונספטואלי", "על־X", invented "X־ית" abstract feminines).
   - **Legal precision:** statute/section accuracy, party-label correctness,
     official-name fidelity (re-use V2.1e bucket checks read-only).
   - **Answer depth:** count of concrete anchors per answer (named rulings,
     statute sections, named exceptions, named tests) — should *not* drop.
   - **Source usage:** `used_count`, `footnote_count`, `source_coverage`,
     `compound_footnote_count` — should be within ±1 of baseline.
   - **Citation cleanliness:** `superscript_count_in_answer = 0`,
     `adjacent_runs_in_answer = 0`, `unknown_source_refs = []`,
     `forbidden_text_hits = []` — must hold.
   - **Layout:** `heading_count` expected to drop materially; `paragraph_
     count` expected to stay similar or rise slightly.
   - **Latency / cost:** expected unchanged (prompt is comparable length).

Pass criteria (suggested, for next turn's decision):
- Every citation/structural metric ≥ current baseline.
- Concrete-anchor count not reduced.
- Heading count reduced.
- Human review of all six answers: at least 5/6 read as practitioner
  Hebrew, none of the six contains an invented abstract compound from the
  observed failure class.

If all hold → propose promoting the revised prompt behind the existing
V2.1e default path. If any fail → narrow the revision (most likely Edit 4
on headings is the riskiest if depth drops).

---

## 7. One-line summary

The drafter prompt's own register, identity ("חוקר משפט … תזכיר מחקר"),
heading-first schema framing, and ~25-to-1 ratio of negative-to-positive
style rules are pushing GPT-5 toward translated-academic prose; a six-edit
prompt-only revision (identity flip, register anchor up top, re-toning the
rule vocabulary, headings-off by default, re-toning the anchors block, and
a final self-check) should fix register without touching any other
component.

— Stopping here per instructions. No code, prompt, schema, denylist, QA,
model, or DB changes were made.
