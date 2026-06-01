## V2.1e — Hebrew/Legal Prose Polish (narrow patch)

V2.1d stays default. No changes to footnoteBuilder, schema, retrieval, verifier, admission, source selection. No retry, no controlled failure, no runtime blocking. Telemetry-only warnings + prompt hygiene additions.

### Scope

Two files touched:

1. `supabase/functions/legal-research-v1/stages/drafterV2.ts`
   - Append a focused "Hebrew quality + role labels + official names" block to `SYSTEM_PROMPT_V2`.
   - Extend `computeQualityWarning()` with new exact-phrase hits and a context-aware `נאשם` check.

2. `reports/legal-research-v1-v2.1e-validation.md` (new) — validation report after re-running the 15-question set.

No changes elsewhere.

### Prompt addition (drafterV2 system prompt)

Add a tight block reinforcing existing rules. Key points:

- אל תמציא מילים בעברית. אם אינך בטוח שצירוף קיים בעברית משפטית — נסח בפשטות.
- אל תכניס מילים לועזיות (אנגלית/ספרדית/לטינית) לתוך תשובה בעברית, למעט מונחים משפטיים מקובלים וכשהכרחי.
- שמות חוקים רשמיים — בדיוק כפי שהם. דוגמה: `חוק-יסוד: כבוד האדם וחירותו` (לא "חוק-יסוד של כיבוד האדם והחירות", לא "כיבוד האדם והחירות").
- תוויות בעלי דין לפי הקשר:
  - הליך אזרחי/נזיקי → `תובע` / `נתבע` (לא `נאשם`).
  - הליך פלילי → `מאשימה` / `נאשם`.
  - הליך מנהלי → `עותר` / `משיב`.
- הימנע מצירופים מומצאים סביב סמכות מנהלית (אל תכתוב "הבטחה מנהירת סמכויות", "המשרוק" וכד'). אם הכוונה ל"הבטחה מנהלית" — כתוב כך.
- העדף עברית משפטית פשוטה ונכונה על פני ניסוח מרשים-לכאורה. אל תשתמש בביטויים כמו "מום פרשני", "שווה לנקוט", "משקל תקף נמוך יותר" — נסח במונחים מקובלים.

The existing denylist and `גזר דין` carve-out from V2.1d remain untouched.

### Telemetry additions (computeQualityWarning)

Extend the existing buckets — telemetry-only, never blocks output.

New exact-phrase hits added to `BROKEN_HEBREW_DENYLIST` (bucket `broken_hebrew`):

- `סמלייים`
- `סמליומית`
- `הבטחה מנהירת סמכויות`
- `המשרוק`
- `מום פרשני`
- `שווה לנקוט`
- `משקל תקף נמוך יותר`

New bucket `wrong_official_name`:
- `כיבוד האדם והחירות` (the correct form is `כבוד האדם וחירותו`)

New bucket `foreign_word_in_hebrew`:
- word-boundary regex for `alcance` (case-insensitive). Structure allows adding more later; we deliberately keep it tight, not a generic Latin-letter sweep (URLs/refs contain Latin).

New bucket `wrong_party_label_civil`:
- Heuristic: if the question text OR concatenated `inputSources` titles/snippets contain civil/tort markers (`נזיקין`, `רשלנות`, `תביעה אזרחית`, `נזק`, `פיצויים`, `תובע`, `נתבע`) AND do NOT contain criminal markers (`פלילי`, `כתב אישום`, `הרשעה`, `גזר דין`, `עונש`, `מאסר`, `קנס פלילי`), then any occurrence of `הנאשם` or `נאשם` in the answer is flagged.
- Implementation: pass `question` and a small context string into `computeQualityWarning` (signature change is internal to drafterV2.ts; callers already in same file). Telemetry only.

All new hits flow through the existing `quality_warning` field on `DrafterV2Result` → already persisted via telemetry into `qa_logs.metadata`. No schema change.

### Validation

Re-run the same 15 questions used for V2.1c/V2.1d validation via the existing harness (`scripts/legal-research-v1-v2.1c-default-validation.ts` pattern — invoke the live edge function with the saved fixtures). Collect new run IDs.

Write `reports/legal-research-v1-v2.1e-validation.md` with:

- Per-question rating (good / acceptable / weak / bad).
- Warning hit counts per bucket, V2.1d vs V2.1e (broken_hebrew, scaffold_leakage, truncated_source_fragment, wrong_official_name, foreign_word_in_hebrew, wrong_party_label_civil).
- Concrete before/after examples for each flagged phrase the user listed.
- Confirmation that:
  - source lists remain complete (footnotes still carry full title/url/source_type, including compound footnotes),
  - citation cleanliness unchanged (no adjacent markers, no markers inside text),
  - sources_used distribution unchanged materially,
  - latency delta < ~5% (drafter ms median + p90),
  - no new awkward Hebrew surfaced in spot reads.

### Acceptance

- V2.1d-level citation cleanliness preserved.
- No source-usage regression.
- Listed broken phrases drop to zero in the new run; new warning buckets fire on any residual hits.
- Official name `חוק-יסוד: כבוד האדם וחירותו` used correctly.
- Civil-context answers use `נתבע`, not `נאשם`.
- No meaningful latency change.

Stop after the V2.1e validation report.
