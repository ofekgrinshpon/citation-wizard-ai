---
name: Foreign Bluebook Rule 36
description: 9 foreign source subtypes (36.1–36.9) — Bluebook-aligned templates, required fields, formatting
type: feature
---

Citation engine includes 9 structured foreign source types beyond the legacy `foreign` fallback:

- `foreign_constitution` (36.1) — `{jurisdiction} CONST. {division} {section}.`
- `foreign_statute_us` (36.2) — `[{statuteName}, ]{title} {code} § {section} ({year}).`
- `foreign_statute_uk` (36.3) — `{statuteName} {year}, [{regnalYear} {monarch} ]c. {chapter}[, § {section}].` Pre-1962 → regnal year + monarch required.
- `foreign_case_us` (36.4) — `[##{procPrefix}## ]{party1} v. {party2}, {volume} {reporter} {firstPage} ([{court} ]{year}).` Omit court for SCOTUS / state high court when reporter implies it.
- `foreign_case_other` (36.5) — `{party1} v. {party2} {volumeOrYear} {reporter} {firstPage} ({courtAndJurisdiction}).`
- `foreign_book` (36.6) — small caps authors+title; publisher only pre-1900 or non-original.
- `foreign_journal_article` (36.7) — italic article title, small caps journal; full Bluebook abbreviation list in notes.
- `foreign_book_chapter` (36.8) — `..., in ##{bookTitle}## {firstPage} (... eds., {year}).`
- `foreign_internet` (36.9) — `(@handle)` for social media; date format `Mar. 22, 2019`.

### Sync rule

Two registries must stay in sync manually (no auto-sync):
- `src/data/citationEngine.ts` (full notes + examples)
- `supabase/functions/_shared/citationEngine.ts` (Deno fork — required fields only)

Any change to a foreign rule must be ported to BOTH files. Field labels live in `src/data/abbreviations.ts` (`FIELD_LABELS`) and required-fields in `REQUIRED_FIELDS`.
