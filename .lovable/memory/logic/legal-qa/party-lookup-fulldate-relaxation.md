---
name: Stage 2 caselaw retry — relaxation + placeholder emission
description: Deno-resolver-only policy that lets case_law_database citations recovered via the Stage 2 Perplexity party-lookup retry emit even when not fully resolved — first by dropping the fullDate requirement when caseType+caseNumber+parties+year are present, and second by filling remaining required fields with `[חסר: ...]` markers when the case is at least meaningfully identifiable. Statutes and first-pass resolution are unchanged.
type: feature
---

## Scope

This policy lives in `supabase/functions/_shared/citationResolver.ts` and is gated by `ResolveCitationOptions.partyLookupRetry`. It is set ONLY by the Stage 2 retry loop in `supabase/functions/legal-qa/index.ts` (`chapter-router` block), after a successful Perplexity `lookupPartyNames` hit.

It applies to **`case_law_database` only**. First-pass resolves, statutes (`primary_legislation`, `basic_law`, `secondary_legislation`), and `case_law_published` are not affected.

## Layered behavior

There are two layers, evaluated in order:

### 1. Strict relaxation (drop `fullDate` from required)
When all of the following hold, `fullDate` is removed from the missing set and a `(year)` template variant is used:
- `partyLookupRetry === true`
- `sourceType === "case_law_database"`
- `caseType`, `caseNumber`, `party1`, `party2` all present and non-empty
- at least one of `fullDate` or `year` present
- after dropping `fullDate`, `missing.length === 0`

Telemetry counter: `recovered_without_full_date` (per chapter, in `qa_logs.metadata.chapter_engine.party_lookup`).

### 2. Placeholder emission
When strict relaxation didn't clear `missing` but the case is still meaningfully identifiable, emit a best-effort canonical citation with `[חסר: ...]` markers:
- `partyLookupRetry === true`
- `sourceType === "case_law_database"`
- `caseNumber` present (no docket → no meaningful identity)
- at least ONE of `party1`, `party2`, `fullDate`, `year` present (otherwise the citation would be just a docket + 4 placeholders, which has no informational value)

Each remaining required field is replaced with a Hebrew-labeled placeholder using the engine's `description` text:
- `caseType` → `[חסר: סוג ההליך]`
- `caseNumber` → `[חסר: מספר התיק]` (in practice never triggered — `caseNumber` is a precondition)
- `party1` → `[חסר: שם צד א']`
- `party2` → `[חסר: שם צד ב']`
- `fullDate` → `[חסר: תאריך מלא]`

Template selection:
- If only `year` (no `fullDate`, no `database`): use `(year)` form.
- If neither `fullDate` nor `database`: collapse to `({fullDate})` placeholder form.
- Otherwise: use the canonical engine template and let placeholders fill the gaps.

The result is `resolved: true` with a non-empty `placeholders: string[]` listing the field keys that were filled with markers.

## Telemetry (per chapter, under `chapter_engine.party_lookup`)

- `attempted` — Stage 2 retries attempted
- `recovered` — retries that returned `resolved: true` (clean OR placeholder)
- `recovered_without_full_date` — subset of `recovered` where `fullDate` relaxation was the reason
- `recovered_with_placeholders` — subset of `recovered` where one or more required fields were filled with `[חסר: ...]`. Clean resolves are NOT counted here.
- `placeholder_fields` — `Record<fieldKey, count>` breakdown of which fields were placeholder-filled
- `failed` — retries that did not resolve at all (no Perplexity hit OR even placeholder emission was impossible)
- `failure_reasons` — breakdown:
  - `no_match` / `no_candidates` / etc. — Perplexity returned nothing usable
  - `retry_still_unresolved` — Perplexity returned a hit, but the resolver still couldn't emit even a placeholder citation (precondition failed: missing docket OR missing all four of party1/party2/fullDate/year)

## Why placeholders over hard fail

The `after4d` repeat runs showed the strict-relaxation path was a no-op in practice — Perplexity's hits don't usually match the exact "only fullDate missing, parties + year present" shape. But useful partial information was being discarded as `retry_still_unresolved` rather than surfaced to the user.

The placeholder policy treats Stage 2 as best-effort: if Perplexity recovered enough to *identify* the case (a docket + at least one anchor), the user sees the citation with explicit holes rather than nothing at all. Honest telemetry distinguishes clean recoveries, placeholder recoveries, and true failures.

## What this is NOT

- Not applied to statutes (any of the three legislation types).
- Not applied to `case_law_published` (Rule 18) — the in-print series schema is too rigid for placeholder substitution.
- Not applied to first-pass resolution. `partyLookupRetry` is set only on the Stage 2 retry call.
- Not ported to the React-side `src/data/citationEngine.ts` / `src/lib/citationValidation.ts`. Stage 2 only exists in the Deno resolver path.
