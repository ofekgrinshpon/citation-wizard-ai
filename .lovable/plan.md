**What I found**

Recent academic-writing telemetry confirms the run did use the style guide and Deep chapter profile:
- `style_guide.enabled = true`
- `style_guide.version = v1.0-final`
- `profile_used_academic.step = chapter`
- `inheritsFrom = deep`
- `draft_path = claim_map`

But the output still starts with **שורה תחתונה** because the current prompt fix is too weak: the academic scaffold says `**פתיחה (ללא כותרת)**`, which is itself a literal heading, and the research scaffold with `**שורה תחתונה**` still remains in the same prompt-building function. The model is likely following the older, stronger section-heading pattern.

The loading issue persists because the UI still shows `ResearchProgress` until the first SSE stage arrives. That fallback uses generic research/fast-looking placeholders, so users see the old loading copy before the streamed academic Deep panel appears.

**Plan**

1. **Make the academic structure impossible to confuse with research memo structure**
   - In `supabase/functions/legal-qa/index.ts`, change the academic chapter scaffold so the opening is described as plain prose, not a bold pseudo-heading.
   - Remove any literal `**פתיחה (ללא כותרת)**` output cue.
   - Add a hard instruction that the first visible heading in academic chapter output must be `**מסגרת נורמטיבית**`.
   - Add an explicit ban on `**שורה תחתונה**`, `**השלכות מעשיות**`, and `**מסקנה**` for academic chapters; only `**סיכום הפרק**` is allowed as the closing heading.
   - Keep research Fast/Deep scaffolds unchanged.

2. **Add a post-generation guard for academic chapter headings**
   - After the draft is generated and before it is saved/returned, detect real academic chapters whose body contains `שורה תחתונה` or `השלכות מעשיות` as headings.
   - Apply a deterministic cleanup:
     - remove the `שורה תחתונה` heading while preserving its paragraph as the opening paragraph;
     - rename `השלכות מעשיות` to an academic heading only if needed, or fold it into the surrounding analysis;
     - rename a final memo-style `מסקנה` heading to `סיכום הפרק`.
   - Log the cleanup in `qa_logs.metadata.chapter_style_cleanup` so we can verify whether the guard fired.

3. **Fix the loading fallback for academic chapter writes**
   - Update `ResearchProgress` to accept a mode prop, similar to `StageProgressList`.
   - Add academic-specific loading text such as `כותב פרק אקדמי במנוע Deep...`, `ממפה את טענת הפרק...`, `בוחר מקורות לפרק...`, `מלטש את המשלב האקדמי...`.
   - Pass `mode="academic_chapter"` from `LegalQAChat` even before SSE events arrive, so the old research/fast placeholders never appear during chapter writing.

4. **Map streamed stage labels for academic mode**
   - Keep backend stage IDs unchanged.
   - In `StageProgressList`, when mode is `academic_chapter`, display academic labels for stages, for example:
     - `source_pack` → `בחירת מקורות לפרק`
     - `claim_map` → `מיפוי טענות הפרק`
     - `drafter` → `כתיבת טיוטת הפרק`
     - `anchor_pass` → `עיגון הציטוטים בפרק`
   - This prevents the Deep engine from looking like generic legal research.

5. **Verify after implementation**
   - Query the latest `qa_logs` again to confirm `style_guide.version = v1.0-final`, `inheritsFrom = deep`, and whether `chapter_style_cleanup` fired.
   - Search the modified code to confirm no academic branch still mandates `שורה תחתונה` or `השלכות מעשיות`.

**Expected result**

The next academic chapter Deep run should not show `שורה תחתונה`, and the loading panel should immediately read as academic Deep writing instead of generic Fast/research placeholders.