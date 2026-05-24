
# P6.3 — Drafter Style-Only Refinement

Single, very narrow change. Goal: make answers read as natural, polished Hebrew legal-academic prose without changing any grounding, selection, validation, or pipeline behavior.

## Scope

**One file, prompt-only edit:** `supabase/functions/legal-research-v1/stages/drafter.ts`
- Edit the `SYSTEM_PROMPT` style block (lines ~69–73) and the closing line in `buildUserMessage` (line ~202).
- No code changes. No new LLM call. No new pass. No schema/tool changes.

## What changes

### SYSTEM_PROMPT — "כללי כתיבה — סגנון" block

Replace current style bullets with refined Hebrew-natural guidance:

- כתוב עברית משפטית טבעית, מדויקת ואקדמית — כפי שכותב משפטן ישראלי, לא כתרגום מאנגלית. הימנע מתחביר מסורבל, מצירופים מתורגמים, ומחזרות מיותרות.
- העדף מינוח משפטי ישראלי מקובל (למשל "השתק פלוגתא", "צו מניעה זמני", "פיצוי מוסכם", "סבירות", "הבטחה מנהלית"). השתמש במונח לועזי רק כשהוא מקובל בפועל בשיח המשפטי הישראלי או כשאין לו חלופה עברית טבעית.
- התאם את המבנה לסוג השאלה: שאלת דוקטרינה תיענה בהגדרה→יסודות→יישום→סייגים; שאלת פרשנות סעיף תיענה בלשון הסעיף→תכלית→פסיקה; שאלה השוואתית או עובדתית תיענה במבנה שמתאים לה. **אל תכפה תבנית דוקטרינרית קשיחה כאשר היא לא מתאימה לשאלה.**
- שאף לכתיבה רציפה וקוהרנטית: פסקאות מתפתחות, מעברים טבעיים, ולא רשימות מקוטעות. השתמש ברשימות (•/-) רק כשהן באמת מבהירות את התוכן.
- אורך התשובה ייקבע מעומק המקורות. אל תקצר באופן מלאכותי ואל תמתח באופן מלאכותי.

### `buildUserMessage` closing line

Replace with:
> "כתוב תשובה משפטית בעברית טבעית ומדויקת, מבוססת אך ורק על המקורות שסופקו, עם הערות שוליים בכתב עילי. התאם את מבנה התשובה לאופי השאלה, ושמור על כתיבה רציפה וקוהרנטית."

## What stays untouched (explicit)

All grounding & guardrail rules in SYSTEM_PROMPT remain verbatim:
- "השתמש אך ורק במקורות שסופקו" / no invention.
- Every substantive legal proposition carries a footnote marker.
- partial → qualify or omit.
- No internal id leaks (candidate_id / claim_id / C# / S# / LS# / "verifier").
- Source names only if explicit in title/supported_points.
- **bold** for emphasis; no `#` headings.
- emit_draft tool schema and used_sources contract.

No changes to:
- Retrieval, candidate pool, Perplexity admission, URL hygiene.
- Verifier (logic, batching, role_match, usable/dropped).
- `buildInputSources`, validation, marker validation, deterministic repair, internal-id leak detector.
- Escalation to gpt-5.
- Footnote rendering, citation formatting, bibliography, "שם" / "לעיל ה״ש".
- Frontend (`LegalResearchV1Panel.tsx`), `legal-qa/index.ts`, DB schema, Fast/Deep, DoctrineClassifier, SourceRequirements.

## Validation

Re-run the same 6 fixtures (L1–L6) via the existing `scripts/legal-research-v1-p6.2b-runner.ts` (or a thin p6.3 copy), persist to `reports/legal-research-v1-p6.3-L{1..6}.json` + `summary.json`. Acceptance:

- `marker_validation.ok` true on all 6.
- `internal_id_leak` false on all 6.
- `used_sources` ⊆ `verifier.usable` on all 6.
- L3 still cites סעיף 15 footnote; L4 issue-preclusion only (no promissory-estoppel drift); L6 still completes.
- Word counts within roughly ±25% of P6.2b — no bloat, no over-shrinking.
- Qualitative spot-check per fixture (1–2 sentences): reads as natural Hebrew legal-academic prose; structure adapted to question type; no awkward translated phrasing; no rigid template forced.

**Stop condition.** If any fixture regresses on grounding (leak, missing/extra markers, used not in usable, drift), revert prompt and report instead of shipping.

## Order

1. Apply prompt edit.
2. Deploy `legal-research-v1`.
3. Run 6-fixture smoke; persist reports.
4. Post summary with per-fixture qualitative note + acceptance table.

## Out of scope

retrieval, Perplexity, URL hygiene, citation formatting, footnote renderer, marker parser, frontend, verifier, legal-qa, schema, streaming, Fast/Deep.
