## Problem

Compound footnotes (one marker covering multiple sources) lose their links. In `footnoteBuilder.ts` the compound branch sets `url: null` and joins titles with `;`, so the frontend renders one line with no link. Single-source footnotes still link correctly — but in practice many V2.1c footnotes are compound, so links appear "missing".

## Goal

For a compound footnote, render each source on its own line under the same number, each with its own link:

```
2. חוק-יסוד: כבוד האדם וחירותו; (link)
   חוק יסודות המשפט. (link)
```

Single-source footnotes keep current single-line look (with link).

## Changes

### 1. Backend — preserve per-source data on compound footnotes
`supabase/functions/legal-research-v1/lib/types.ts`
- Extend `Footnote` with optional `sources?: Array<{ title: string; url: string | null; source_type: string }>`. Backward compatible.

`supabase/functions/legal-research-v1/stages/footnoteBuilder.ts`
- When building each `MarkerEntry`, also attach `sources` (always populated, length 1 for single, ≥2 for compound).
- For compound: keep existing `title` (semicolon-joined) and `url: null` for legacy readers, but include the `sources` array so frontends can render per-source links.
- No change to markdown, marker placement, used_sources, schema, or builder_report. Adjacency invariant unchanged.

### 2. Frontend — render compound footnotes line-per-source
`src/components/LegalResearchV1Panel.tsx`
- Extend local `Footnote` type with the same optional `sources` field.
- Footnote list renderer:
  - If `fn.sources && fn.sources.length > 1`: render `{number}.` then one `<div>` per source with `title` and (if `url`) ` — <a>{url}</a>`. Sources separated by `;` after each except the last (which ends with `.`).
  - Else: keep existing single-line behavior.
- `handleCopyResult`: when `sources.length > 1`, emit each source on its own indented line in the copied text, matching the visual format.

### 3. No other changes
- No drafter prompt change, no schema change beyond the optional field, no retrieval/Perplexity/sources_only change, no V2.1c invariant impact.
- History rehydration unaffected: old footnotes without `sources` fall through to the legacy single-line branch.

## Validation

- Manual: run a query that produces both single and compound footnotes; verify single-source still shows one link, compound shows each source on its own line with its own clickable link; verify copy button output mirrors the visual layout.
- Existing builder adjacency test still passes (no markdown change).
