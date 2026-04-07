

# Enhance Rule 23 – ספרים (Books) with Full Sub-Rules + Rule 1.9

## Overview
The current `book` implementation is minimal — it has a basic template and 3 brief notes. The user provided the complete Rules 23.1–23.9 with detailed sub-rules for authors, titles, volumes, pinpoints, editions, editors, translators, and years, plus Rule 1.9 (comma separation). This plan enriches the existing implementation to cover all sub-rules accurately.

## What's changing

### 1. `src/data/citationEngine.ts` — Enrich `book` rule set
Expand the `components` array and `notes` to cover all sub-rules:

**Components to add/update:**
- `author` (23.2.1–23.2.4): First+last name as in source. Multiple authors: 2 = "ו"ו", 3 = commas + "ו"ו", 4+ = optional "ואח'". No titles (23.2.3). Institutional author if no person (23.2.4).
- `bookTitle` (23.3): Bold. No change needed.
- `volume` (23.4): Always cite volume number as printed, no bold, no geresh after letter-volumes.
- Pinpoint/`firstPage` (23.5): Multiple modes — page number without "בעמ'" (23.5.2), chapter/section with label (23.5.3), footnote/table with page+comma+label (23.5.4). No comma between title and pinpoint or between volume and pinpoint (unless Rule 1.9 applies).
- `edition` (23.6): Only if 2+ editions exist. Cite as in source. Comma before next item only per Rule 1.9.
- `editor` (23.7): Per 23.2 naming rules + "עורך/עורכת/עורכים/עורכות" or other title. Comma per 1.9.
- `translator` (23.8): Per 23.2 naming rules + "מתרגם/מתרגמת/מתרגמים/מתרגמות". Comma per 1.9.
- `year` (23.9): Hebrew-only → Hebrew. Gregorian-only → Gregorian. Both → Gregorian only. New edition → new edition year. Hebrew year starts with ה (no geresh).

**Updated notes array** covering all sub-rules with examples.

### 2. `supabase/functions/citation-chat/index.ts` — Enrich system prompt
- Update the `"ספר"` entry in `CITATION_ENGINE_TEMPLATES` to add detailed `notes` covering 23.1–23.9.
- Update the `ספרים (כלל 23)` formula line in the system prompt to include all sub-rules and examples.
- Add Rule 1.9 as a general formatting rule referenced throughout.

### 3. `src/data/citationEngine.ts` — Add Rule 1.9 to `GENERAL_RULES`
Update the existing `"1.9"` entry with the full comma-separation rule: consecutive numbers or consecutive words without distinguishing formatting require a comma separator.

### 4. `src/lib/citationValidation.ts` — Enhance book field extraction
Add extraction for `editor` and `translator` fields (detect "עורך/עורכת" and "מתרגם/מתרגמת" patterns inside parentheses). Add extraction for `edition` (detect "מהדורה" pattern). Improve `volume` extraction (detect "כרך" keyword).

## Key sub-rules to embed in system prompt

- **23.2.1**: Name as printed, abbreviations with geresh/gershayim (not dots)
- **23.2.2**: 2 authors = "ו", 3 = commas + "ו", 4+ = optionally first + "ואח'"
- **23.2.3**: No academic/military/other titles
- **23.2.4**: Institutional author (reports/committees) — cite institution name only
- **23.3**: Book title in bold
- **23.4**: Always cite volume number, as printed, not bold, no geresh after letter
- **23.5.2**: Page number as printed, no "בעמ'" prefix
- **23.5.3**: Chapter/section needs label; § allowed if consecutive numbering
- **23.5.4**: Footnote/table → page, comma, item label + number
- **23.6**: Edition only if 2+, as in source, comma per 1.9
- **23.7**: Editor names per 23.2 + "עורך/ת/ים/ות", comma per 1.9
- **23.8**: Translator names per 23.2 + "מתרגם/ת/ים/ות", no source language, comma per 1.9
- **23.9**: Hebrew year only → Hebrew (with ה, no geresh). Gregorian only → Gregorian. Both → Gregorian. New edition → new edition year.
- **1.9**: Comma separates consecutive numbers or consecutive words when no other visual separator exists

## Files modified
| File | Change |
|------|--------|
| `src/data/citationEngine.ts` | Enrich `book` components + notes; update Rule 1.9 in `GENERAL_RULES` |
| `src/lib/citationValidation.ts` | Add editor/translator/edition/volume extraction for `book` type |
| `supabase/functions/citation-chat/index.ts` | Enrich `"ספר"` template notes + system prompt book section with all sub-rules, Rule 1.9, and examples |

No new source types, no schema changes, no new fields in `abbreviations.ts` (editor/translator/edition/volume already exist as field labels).

