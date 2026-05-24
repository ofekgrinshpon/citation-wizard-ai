
**Phase A.1 — Prompt-only placement patch (revised)**

Goal: reduce adjacent-marker clusters and end-paragraph dumps in the legal-research-v1 drafter, without changing any logic, source selection, or footnote shape. Source preservation strictly outranks placement aesthetics.

---

**Scope (only file touched)**
- `supabase/functions/legal-research-v1/stages/drafter.ts` — `SYSTEM_PROMPT` only.

No changes to: placement validator, deterministic repair, marker parser, repair guard, Rule 37 (still deferred), `Footnote` shape, `used_sources`, candidate pool, verifier, retrieval, frontend, telemetry.

---

**Prompt additions (Hebrew, appended to existing "מיקום הערות שוליים" block)**

Ordered so the source-preservation guardrail comes first and overrides every placement rule below it:

1. **קדימות שימור מקורות (overrides all placement rules):**
   - "אין לוותר על מקור מאומת או על הערת שוליים תומכת כדי לשפר את האסתטיקה של מיקום ההערות."
   - "אם לא ניתן להימנע ממקבץ סמן מבלי לאבד תמיכה במקור — השאר את המקבץ. שיפור מיקום לעולם לא מצדיק הסרת תמיכה."
   - "אין למחוק, לאחד, או לדלג על מספר מקור המופיע ברשימת המקורות שניתנה לך."

2. **חלוקת סמנים בפסקה (placement preferences, subject to #1):**
   - אם מספר מקורות תומכים באותה פסקה — פזר את הסמנים על פני המשפטים/הטענות הספציפיות שהם תומכים בהן.
   - אין לרכז את כל הסמנים בסוף הפסקה.
   - בפסקה הגדרתית פותחת — מקם כל סמן ליד המשפט שהוא תומך בו.

3. **טיפול במצב צפוף — שכתוב, לא השמטה:**
   - אם משפט בודד נושא כמה מקורות, העדף לפצל אותו לכמה טענות כך שכל סמן ייצמד לטענה נפרדת.
   - לחילופין: הזז כל סמן לטענה הקרובה ביותר שהוא תומך בה, או חזור על אותו מספר סמן מאוחר יותר במקום הנכון.
   - אם אף אחת מהאפשרויות לעיל אינה אפשרית מבלי לאבד תמיכה — השאר את הסמנים צמודים. עדיף לשלוח `¹²³` מאשר להשמיט מקור.

4. **חזרות סמוכות של אותו סמן:**
   - הימנע מחזרה מיידית מיותרת של אותו מספר סמן על משפטים סמוכים, אך אל תסיר סמן אם הוא נדרש לתמיכה. במקרה של ספק — השאר את הסמן.

5. **פורמט סמנים:**
   - השתמש תמיד בספרות עליונות יוניקוד (⁰¹²³⁴⁵⁶⁷⁸⁹) לכל ספרות הסמן, כולל מספרים דו-ספרתיים (למשל `¹⁰`, `¹¹`), לעולם לא בספרות ASCII רגילות כמו `10`.

The existing prohibition on internal IDs, the `used_sources` invariant, and the chronological-order rule stay as-is.

---

**Repair guard (unchanged, re-stated for the record)**

The conditional repair pass keeps the existing strict equality guards:
- if repair changes the `used_sources` set, candidate_id mapping, or footnote numbering → discard repair, ship original.
- if repair breaks `runMarkerValidation` → discard.
- if repair does not strictly improve placement metrics → discard.

No code added or removed in the repair pass.

---

**Evaluation — same 6 fixtures (L1–L6)**

Run `bun scripts/legal-research-v1-p5-runner.ts` and write `reports/legal-research-v1-p7-phaseA1-*.json` plus a summary. Report per fixture:
- `marker_validation.ok`
- `placement.ok`, `cluster_count`, `out_of_order_count`, `end_paragraph_dump_count`
- repair triggered / accepted / discarded
- `used_sources` count and whether subset of `verifier.usable`
- footnote count

Diff against Phase A summary:
- L5: expected to flip to `placement.ok = true` or materially fewer clusters.
- L2: expected material reduction in `cluster_count` (currently 14); some clustering may remain by design when ≥9 sources support one doctrine — that is acceptable per guardrail #1.
- L1, L3, L4, L6: no regression.

---

**Acceptance criteria**

Hard (block ship if violated):
- 6/6 `marker_validation.ok = true`
- 6/6 `internal_id_leak = false`
- 6/6 `used_sources ⊆ verifier.usable`
- For every fixture: `used_sources` count and footnote titles unchanged in structure (no silent source drops attributable to the prompt). Compared against Phase A reports.
- No legal-substance regression on spot-check of L2, L5, L6 answers.

Soft (success signal, not blockers):
- L5: `placement.ok = true` or `cluster_count = 0`.
- L2: `cluster_count` materially down from 14.
- No new end-paragraph dumps introduced anywhere.

---

**Out of scope (explicit)**
- Rule 37 / `שם` / `לעיל ה"ש N`
- short-form footnotes, new footnote numbering logic
- changes to placement validator, deterministic repair, marker parser, repair guard
- frontend, footnote shape, retrieval, verifier, source selection, candidate pool
- historical backfill

Stop after the Phase A.1 report. Phase B decision deferred until that report is reviewed.
