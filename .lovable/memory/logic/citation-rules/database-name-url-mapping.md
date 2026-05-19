---
name: Database Name URL Mapping (Rule 19.1 extended)
description: Maps Perplexity source URL host to canonical Hebrew database name for case_law_database citations
type: feature
---

For `case_law_database` citations, the database name (Rule 19.1) is derived from the host of the Perplexity `source_url` / `citations[]`, overriding free-form values like "המאגר של בית המשפט העליון":

| Host | Canonical name |
|---|---|
| `lite.takdin.co.il`, `takdin.co.il` | תקדין |
| `supremedecisions.court.gov.il` | אר״ש |
| `nevo.co.il` | נבו |
| `psakdin.co.il` | פסקדין |

Allowed canonical names: נבו, פדאור, דינים, תקדין, אר״ש, פסקדין.

Implementation: `normalizeDatabaseName()` helper at top of `supabase/functions/citation-chat/index.ts`, applied in:
- Primary case-number path (uses `pData.citations`)
- Party-search results loop (uses each result's `source_url`)
- Re-normalized after pub-guard flips `isPublished=true → false`

Also mirrored in:
- `src/lib/citationValidation.ts` (field extraction regex)
- `src/data/citationEngine.ts` + `supabase/functions/_shared/citationEngine.ts` (component description)
