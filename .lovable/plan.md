# Map Perplexity source URL → canonical database name

## Problem

For unpublished case law, Perplexity returns free-form values like `"המאגר של בית המשפט העליון"` for `databaseName`. Two issues:

1. The string isn't a valid database name per Rule 19.1, so the citation validator flags `"חסר: שם המאגר"`.
2. The actual database can be inferred deterministically from the `source_url` Perplexity already returns.

## Mapping

Derive `databaseName` from the host of `parsed.source_url` (case-insensitive), overriding whatever string Perplexity returned:

| Host contains | databaseName |
|---|---|
| `lite.takdin.co.il` or `takdin.co.il` | `תקדין` |
| `supremedecisions.court.gov.il` | `אר״ש` |
| `nevo.co.il` | `נבו` |
| `psakdin.co.il` | `פסקדין` |
| `pador` / `padaor` | `פדאור` |

If no `source_url` or host doesn't match, keep Perplexity's string only if it's already one of the canonical names; otherwise leave empty so the existing `[חסר: שם המאגר]` warning still fires (better than a wrong name).

## Changes

### 1. `supabase/functions/citation-chat/index.ts`

Add a small helper `normalizeDatabaseName(url, fallback)` near the existing `isTrustedPubUrl` (~line 1249). Call it right after parsing the Perplexity JSON, in BOTH branches that read `parsed.databaseName`:

- Primary path (~line 1007), before the `details += \`מאגר: ${parsed.databaseName}\`` line.
- Party-search fallback path (~line 1363), same treatment.

The helper:
```ts
const DB_BY_HOST: Array<[RegExp, string]> = [
  [/(^|\.)lite\.takdin\.co\.il$/i, "תקדין"],
  [/(^|\.)takdin\.co\.il$/i, "תקדין"],
  [/(^|\.)supremedecisions\.court\.gov\.il$/i, 'אר״ש'],
  [/(^|\.)nevo\.co\.il$/i, "נבו"],
  [/(^|\.)psakdin\.co\.il$/i, "פסקדין"],
];
const ALLOWED = new Set(["נבו","פדאור","דינים","תקדין",'אר״ש',"פסקדין"]);
function normalizeDatabaseName(url, fallback) { /* parse host, match, else allowed-fallback, else "" */ }
```

Also update the system prompts (~line 920, ~line 1080, ~line 1090) so Perplexity is told to return `databaseName` only from the allowed set `נבו/תקדין/אר״ש/פדאור/דינים/פסקדין` — this is belt-and-suspenders; the URL mapping is authoritative.

### 2. `src/lib/citationValidation.ts` (line 131–138)

Extend the regex set so `case_law_database` recognizes the additional canonical names:

```ts
if (/נבו/.test(response)) fields.database = "נבו";
else if (/תקדין/.test(response)) fields.database = "תקדין";
else if (/אר["״]ש/.test(response)) fields.database = 'אר״ש';
else if (/פדאור/.test(response)) fields.database = "פדאור";
else if (/דינים/.test(response)) fields.database = "דינים";
else if (/פסקדין/.test(response)) fields.database = "פסקדין";
```

### 3. `src/data/citationEngine.ts` (line 176) and `supabase/functions/_shared/citationEngine.ts`

Update the `database` component description to reflect the expanded list:
`"שם המאגר (נבו, תקדין, אר״ש, פדאור, דינים, פסקדין)"`. Memory `mem://logic/citation-rules/...` should also be updated to note that `תקדין` and `אר״ש` are accepted when the source URL proves the provenance.

## Verification

Re-run `ע"א 9308/20`. Edge logs should show the Perplexity result still returns `"המאגר של בית המשפט העליון"` but the citation now reads `… (אר״ש 20.10.2021)` (since supremedecisions.court.gov.il is the source) or `… (תקדין …)` if the result actually came from lite.takdin. The `⚠️ חסרים … שם המאגר` warning should disappear.

## Out of scope

- Changing Perplexity model / search filter.
- Promoting unpublished → published (separate Rule 20 path, already handled).
- Editing the bilingual citation rules document itself.
