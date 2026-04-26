## Scope

Narrowed to research-mode (`legal-qa`) only. **No changes to `citation-chat`.** The plan attaches `procedure_type` to dockets where it matters most: when we hand them to Stage 2 (party-lookup → Perplexity) and when we serialize case-law cards for the drafter.

If this fix unblocks Phase C.2 Fast (i.e. the Fast-on probe now shows non-zero recoveries), we'll have confirmed citation-chat doesn't need touching.

## What's broken (research-mode only)

In `legal-qa/index.ts` the case-law card builder (≈line 3094) constructs the rich citation as:

```
${case_number} ${title} (${court}, ${date})
```

For our two test docs this emits:

- `18225-06-25 ...` — bare district-style docket, no `בג"ץ` prefix.
- `2592/20 ...` — bare Supreme docket, no `בג"ץ` prefix.

Even though `legal_documents.procedure_type = "בג"ץ"` for both rows, the prefix is dropped. Downstream:

- The card's `case_number` field (line 3142) is also stored bare, so Stage 2's `caseTypeHint` (line 6352, sourced from regex-parsing the citation) is empty.
- `partyLookup` then sends Perplexity bare `18225-06-25` with no hint. Perplexity assumes district court, fails, returns `no_candidates`. This matches the Phase C.2 root cause we documented.

Compounding nuance from the DB audit: `procedure_type` is sometimes a true docket prefix (`בג"ץ`, ≈99 rows) and sometimes a subject category (`משפחה`, `פלילי`, ≈10k rows). The fix must distinguish these.

## The change

### 1. `supabase/functions/legal-qa/index.ts` — case-law card builder (≈3079–3145)

Add a small helper `formatDocketForCaseLaw(meta)`:
- If `meta.procedure_type` looks like a docket prefix (`looksLikeDocketPrefix`: short string containing gershayim `״`/`"`, e.g. `בג"ץ`, `ע"א`, `רע"א`), return `${procedure_type} ${case_number}`.
- Otherwise return bare `${case_number}` (today's behaviour) and surface `procedure_type` separately as a category hint.

Use it to build `richCitation` and to populate `SourceCard.case_number`. Also store `SourceCard.procedure_category` (new optional field) for the non-prefix case so Stage 2 can pass it as a court-context hint.

### 2. `SourceCard` / `InternalSourcePackEntry` shape (index.ts + legalSourcePack.ts)

Add optional `procedure_category?: string` to both. Wire it through `assembleSourcePack`'s `toItem` mapper. The field is internal — it's already covered by the `BANNED_KEYS` sanitizer pattern (we'll keep it under `metadata` if needed, no contract leak).

### 3. Stage 2 hint (≈line 6345–6354)

When building the `lookupPartyNames` request, always derive `caseTypeHint` from the card first, falling back to the regex-parsed `partial.caseType`:

```
caseTypeHint:
  card?.docket_prefix          // when looksLikeDocketPrefix(procedure_type)
  ?? p.partial.caseType        // existing fallback
  ?? card?.procedure_category  // weaker, but better than nothing
```

This means a card built from a `legal_documents` row with `procedure_type = "בג"ץ"` makes Stage 2 send Perplexity `1. בג"ץ 18225-06-25` rather than bare `1. 18225-06-25`.

### 4. `supabase/functions/_shared/partyLookup.ts` — prompt strengthening

Tiny prompt tweak: when `caseTypeHint` is present, prepend it to the docket so the formatted line is `${caseTypeHint} ${caseNumber}` rather than `${caseNumber} (${hints})`. Keeps `courtHint` in the parenthetical. This makes the docket Perplexity sees self-consistent (prefix + number, like a real Israeli citation).

No interface change — `PartyLookupRequest` already has `caseTypeHint`.

### 5. `assembleSourcePack` (legalSourcePack.ts)

Pass through `procedure_category` (and the prefixed-case_number) on `toItem`. No bucket-logic change. Mostly a passthrough so the field survives into the V2 contract for any future stage that wants it.

## Validation

1. **Re-run `eval/phase-c-fast-on-probe.mjs`** after the fix, with `MODE_PROFILES.fast.partyLookupRetryEnabled = true` (only for the probe — revert before commit if results are inconclusive).
   
   Expected outcome if Fix C is the right diagnosis:
   - Stage 2 attempts > 0
   - `recovered + recovered_with_placeholders > 0` for at least Q1 (which involves landmark cases including `18225-06-25`)
   - Wall-time delta still in the few-seconds range

2. **Targeted spot-check via `supabase--curl_edge_functions`** with the exact two dockets the user reported (`בג"ץ 18225-06-25`, `בג"ץ 2592/20`) in research mode, and inspect `metadata.research_engine.party_lookup` + `validFootnotes` for whether the prefix appears in the final citation text.

3. **Deep regression**: re-run `eval/phase-c-probe.mjs` Deep×2 reps to confirm the existing Stage 2 recovery rate doesn't regress.

4. **Telemetry sanity**: confirm `qa_logs.metadata.research_engine.party_lookup` gains no new failure_reasons, and that `caseTypeHint`-derived prompts don't increase `parse_failed`.

If results 1–3 are clean, propose a separate one-line PR to flip `MODE_PROFILES.fast.partyLookupRetryEnabled = true` and update `.lovable/plan.md` Phase C.2 to SHIPPED.

## Files touched

- `supabase/functions/legal-qa/index.ts` — case-law card builder, `SourceCard` type, Stage 2 hint construction.
- `supabase/functions/legal-qa/legalSourcePack.ts` — `InternalSourcePackEntry` + `toItem` passthrough.
- `supabase/functions/_shared/partyLookup.ts` — prompt construction (caseTypeHint placement).
- `.lovable/memory/logic/legal-qa/research-router.md` — note Phase C.2 reopen prerequisite is now satisfied; awaiting probe re-run.
- `.lovable/plan.md` — record Fix-C done; Fast Phase C re-eval queued.

## Out of scope

- `citation-chat` (per your instruction).
- DB rewrite of `verified_sources` rows with mismatched prefixes.
- Any change to how non-caselaw sources serialize.
