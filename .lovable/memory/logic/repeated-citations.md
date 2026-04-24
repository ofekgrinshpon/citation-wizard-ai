---
name: Repeated Citations Rule 37
description: Full implementation of Rule 37 (אזכור חוזר) — name selection, legislation exception, שם vs לעיל logic, בי"ת prefix, foreign sources
type: feature
---

Implementation of the Uniform Citation Rules (2021) Rule 37 for repeated citations across `src/data/citationEngine.ts` (`REPEATED_CITATION_RULES` keyed by 37.1–37.9) and `supabase/functions/legal-qa/index.ts`.

**37.2 — Name selection:**
- Legislation: law name only — strip year, ס"ח/ק"ת, [נוסח חדש].
- Case law: "עניין/פרשת/הלכת + identifying party" (avoid "מדינת ישראל", "פלוני", "היועץ המשפטי" if alternative exists). Priority: person > corporation > government body.
- Literature: surname only; add work title in quotes if same-surname authors clash.
- Formatting: parties/books **bold**; article titles in "quotes"; "עניין/פרשת/הלכת" and author names — neither bold nor quoted.

**37.5 — Legislation exception:** Never use "לעיל ה"ש N" for laws. Use `ס' [N] ל[law name].` instead. Post-processor in `legal-qa/index.ts` rewrites `<law>, לעיל ה"ש N, בס' X` → `ס' X ל<law>.`

**37.7 — שם vs לעיל:**
1. Same note as previous, no intervening source → `שם.`
2. Same note as previous, with intervening source → `[name], שם.`
3. Immediately following note, same source, no intervening → `שם.`
4. Otherwise → `[name], לעיל ה"ש N, בעמ' X.`

**37.8 — Pinpoint:**
- Mandatory בי"ת prefix: `בעמ'`, `בפס'`, `בס'` (not `עמ'`/`ס'`). Post-processor enforces this **only on short-form citations** (containing `שם` or `לעיל ה"ש`) — full citations keep their own formula (`פ"ד נד(1) 258, 263`).
- `שם, שם` is forbidden — collapsed to `שם` by post-processor.
- Law `שם` + different section → `שם, בס' [N].`

**37.9 — Foreign sources:** Source name in original language; foreign party names italicized via `##X##`; "לעיל ה"ש N" always in Hebrew. Examples: `הלכת Brown, לעיל ה"ש 39.`, `עניין ##Donoghue v. Stevenson##, לעיל ה"ש 52, בעמ' 580.`

**Preserved from earlier work:** content-aware back-ref validator (line ~2370+) and renumbering pipeline (line ~2280+) — Rule 37 cleanup runs after them, before `fixHebrewYearPrefix`.

## Rule 37 Short-Form Generator (server-side, Step 5d)

Runs in `legal-qa/index.ts` after the footnote-build loop normalises body markers to `[N]`, before `[N]` → superscript conversion. Solves the "same `[N]` appears multiple times in body" problem by giving every repeat its own NEW footnote with auto-generated short-form text.

**Algorithm:**
1. Build inverse map `fnNumberToCard` from `cardIdToNewNumber` + `sourceCards`.
2. Pre-compute `shortName` per footnote via `computeShortName()` (Rule 37.2 by `source_type` + heuristics):
   - Legislation: first segment up to `,`, strip `[נוסח חדש]` and trailing Hebrew year.
   - Foreign (Latin-dominant): preserve `##X##`, else first capitalized phrase.
   - Caselaw: bolded non-generic party (skip `מדינת ישראל`/`פלוני`/`יועמ"ש`), prefixed `עניין **X**`.
   - Article: `surname "title"`. Book: `surname`. Internet: `**site** "title"`.
   - Fallback: first ~40 chars at word boundary; counted in `shortname_fallback_count`.
3. Walk the body, find every `[N]`. Detect inline pinpoint in 40-char window via `BODY_PINPOINT_RE` (`בעמ'/בעמוד/בס'/בסעיף/בפס'/בפסקה`); strip from body when consumed.
4. First occurrence of a `firstFnNum` → keep `[N]` as-is. Repeats:
   - **Legislation (Rule 37.5):** `<pinpoint-stripped-of-ב> ל<lawName>.` if pinpoint, else **drop the marker entirely** (counted in `legislation_repeat_dropped_count`).
   - **Immediately adjacent to previous occurrence:** `שם.` / `שם, בעמ' X.`
   - **Otherwise:** `[shortName], לעיל ה"ש N.` / `[shortName], לעיל ה"ש N, בעמ' X.`
5. Each non-dropped repeat emits a brand-new footnote (`nextFnNum++`), inherits `source_type`/`url`/`source` from the original footnote, and the body marker is rewritten in-place. `oldIdToNewNumber.set(newFnNum, newFnNum)` keeps step 6's superscript conversion happy.
6. Reordering (Step 6b) renumbers everything by appearance order; the back-ref validator already updates `לעיל ה"ש N` cross-refs after reordering, so generated short-forms self-correct.

**Telemetry:** `qa_logs.metadata.rule37_short_forms = { total_repeats_expanded, shem_count, supra_count, legislation_section_count, legislation_repeat_dropped_count, shortname_fallback_count, samples[≤5] }`.

**Interaction with existing post-processors:** The Rule 37 cleanup at lines ~4632-4668 (`lawSupraRe`, `שם, שם` collapse, בי"ת prefix on short-forms) still runs and now mostly no-ops on generator output. AI-authored short-forms continue to be passed through untouched (detected via `SUPRA_FULL`/`\bשם\b`).
