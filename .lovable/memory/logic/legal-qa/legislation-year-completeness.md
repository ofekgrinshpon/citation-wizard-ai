---
name: Legislation year completeness
description: Legislation/Basic Law citations must include the Hebrew year before ס"ח/ק"ת; auto-validator inserts [חסר: שנה] when missing
type: feature
---

Per Rules 2.4 / 2.8, every legislation citation (חוק, פקודת, תקנות, צו, **חוק-יסוד**) must include the Hebrew year before the publication-source page reference. Required form:

- Regular law: `חוק החוזים (חלק כללי), התשל"ג-1973, ס"ח 118.`
- Basic Law: `חוק-יסוד: הממשלה, ס"ח התשס"א 158.`

**Forbidden**: `חוק-יסוד: הממשלה, ס"ח 150.` (year missing) — the previous prompt example modeled this and led to year-stripped Basic-Law citations.

**Auto-validator (legal-qa post-processing)**: Scans every footnote (skipping short-form "שם"/"לעיל ה"ש"). If it matches `<law>, ס"ח|ק"ת <num>` without a Hebrew year (`ה?תש...`) anywhere before the gazette token, it inserts `[חסר: שנה]` between the comma and the gazette token. Combined with the `placeholder_dominant` filter, unanchored legislation citations missing the year are dropped automatically.

**Prompt instruction** (legal-qa system prompt): explicitly forbids `ס"ח [number]` without a year when the year is known; offers `[חסר: שנה]` as the only acceptable placeholder when an external anchor exists.
