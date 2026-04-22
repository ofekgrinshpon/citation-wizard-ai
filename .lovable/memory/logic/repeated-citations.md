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
