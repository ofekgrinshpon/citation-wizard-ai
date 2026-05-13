
# Phase 6 — Card→Claim Citation Contract (revised)

Introduce an explicit contract where the drafter cites **source-card IDs** (`[cite:S3]`) instead of free-form citation strings, and final footnotes are built deterministically from `sourcePack` metadata. **All citation formatting reuses the existing ReLex citation engine** (`_shared/citationResolver.ts`, `_shared/articleCitationValidator.ts`, `_shared/chapterCitationRouter.ts`, `_shared/citationEngine.ts`); only a tiny last-resort fallback formatter lives in this phase. Legacy AI-footnote parsing remains as a fallback path. No CitationQualityGate enforcement, no strict pack gate, no removal of existing anchor enforcement.

---

## 1. Scope & guardrails

- **In scope**: stable source IDs, drafter prompt update, marker parser, deterministic footnote builder (engine-driven), telemetry, tests, fallback path.
- **Out of scope**: CitationQualityGate enforcement, strict `source_pack_gate`, removal of legacy parser/anchor enforcement, building any new citation formatter or duplicating Uniform-Citation logic.
- **Non-regressions**: existing post-process validators (Rule 8.3, legislation year completeness, Rule 37.5), `placeholder_dominant`/`broken_title` filters, `dropped_unanchored_count`, regression harness assertions, SSE streaming UI.

---

## 2. Files to add / change

**New**
- `supabase/functions/legal-qa/cardClaimContract.ts` — ID assignment, marker parser, deterministic footnote builder, telemetry shape, **thin adapter** that calls into the shared citation engine.
- `supabase/functions/legal-qa/cardClaimContract.test.ts` — unit tests (parser, builder, fallback, validation, engine-reuse).
- `eval/phase6-card-claim-contract-probe.mjs` — verification script (3 queries × Fast/Deep).

**Edited**
- `supabase/functions/legal-qa/legalSourcePack.ts` — assign stable `S#` IDs and a `canonicalCitation` per card during pack assembly, computed via the shared engine (see §4).
- `supabase/functions/legal-qa/index.ts` — render source list with `[S#]` headers in the drafter prompt; after draft, run `cardClaimContract.parse()` → if markers found use deterministic builder, else fall back to legacy. Splice telemetry under `metadata.research_safeguards.card_claim_contract`.
- `supabase/functions/legal-qa/contracts.ts` — extend `sourcePackV2` item shape with `id` and `canonicalCitation`.
- `supabase/functions/legal-qa/modeProfiles.ts` — add `cardClaimContract: "off" | "shadow" | "on"`. Phase 6 ships **`on`** for both Fast and Deep with legacy fallback always active.

**Reused, not duplicated**
- `_shared/citationResolver.ts` — `resolveCitation(text, declaredType, opts)` for statute / caselaw / basic-law / secondary-legislation cards.
- `_shared/articleCitationValidator.ts` — `validateArticleCitation` for journal articles.
- `_shared/chapterCitationRouter.ts` — `routeChapterFootnote(text)` to classify by type and pick the right validator/route.
- `_shared/citationEngine.ts` — `getRequiredFields`, `validateCitation`, `CITATION_RULES` for required-field discovery and post-validation.

---

## 3. Stable source IDs

In `legalSourcePack.ts`, after rerank/round-2 reassembly, walk the final pack in display order and assign `id`: `S1, S2, …` (stable for the request lifetime; persisted in telemetry). Drafter sees:
```
[S3] חוק החוזים (חלק כללי), התשל"ג-1973
Type: legislation
URL: https://…
Excerpt: …
```

---

## 4. `canonicalCitation` derivation — engine-first

For each card, derive `canonicalCitation` via this strict precedence:

1. **If the card already has a citation produced by an upstream resolver** (Perplexity-resolved cards, verified_sources hits, prior `resolveCitation` output), reuse it verbatim. This is the common case for Phase 5 rescued cards.
2. **Else, route by type via `routeChapterFootnote`** (or by `card.source_type` if already typed) and call the matching engine path:
   - `statute` / `caselaw` / `basic_law` / `secondary_legislation` → `resolveCitation(seedText, declaredType, hints)`. Seed text is built from card fields (`source_name`, `citation`, `case_number`, `title`) so the resolver has the same input it would normally see. Hints map: `caseNumberHint`, `decisionDateHint`, `titleHint`, `party1Hint`, `party2Hint`, `fullDateHint`, `yearHint`.
     - If `resolveCitation` returns `{resolved: true, canonical}`, use `canonical`.
     - If `{resolved: false}`, mark the card with `resolver_unresolved=true` plus the resolver's `reason` and `missingFields`. Fall through to step 4.
   - `journal_article` → `validateArticleCitation`. If a clean string is produced, use it. Else fall through.
   - `book` / `book_chapter` / `report` / `web_source` → light normalization (existing `chapterCitationRouter` "light" path). If it returns a usable string, use it. Else fall through.
3. **Run `validateCitation` from `citationEngine.ts`** against the engine output to confirm it satisfies `getRequiredFields(sourceType)`. Missing fields are recorded in telemetry but the citation is still kept (the existing post-process validators may inject `[חסר: ...]` markers downstream as they already do today — we do not duplicate that logic here).
4. **Last-resort fallback (only if engine could not resolve at all)** — a minimal deterministic stringifier in `cardClaimContract.ts` that assembles `source_name + url` (or `title + url`) and tags every required-but-missing field as `[חסר: <field>]` using `getRequiredFields(sourceType)`. This fallback never invents data and is the ONLY new formatter in this phase. Telemetry marks `formatter: "fallback_minimal"` so we can measure how often it fires and prioritize engine coverage gaps in a later phase.

The decision is logged per card under `metadata.research_safeguards.card_claim_contract.formatter_usage`:
```
{ engine_resolved: 12, engine_unresolved_then_fallback: 1, reused_existing: 4, fallback_minimal: 1 }
```

---

## 5. Drafter prompt update

In `index.ts` where the drafter prompt is built (Fast structured + Deep), add:

> שימוש בציטוטים: לכל טענה משפטית מהותית הוסף סמן [cite:S#] (אפשר רב-מקורי [cite:S1,S3]).
> אסור להמציא מזהי מקור. אסור לכתוב פוטנוטים בעצמך — הם ייבנו אוטומטית.
> אם לטענה אין מקור תומך מהרשימה — או השמט את הטענה או נסח אותה כדעה.

The "write a footnote block" instructions remain in code but only fire on the legacy fallback branch.

---

## 6. Marker parser

`cardClaimContract.parseMarkers(answerBody, sourcePack)` returns:
```
{
  markers: [{ raw, sourceIds: ["S3"], position, surroundingClaim }],
  uniqueSourceIds: Set<string>,
  invalidSourceIds: string[],
}
```
- Regex: `\[cite:(S\d+(?:\s*,\s*S\d+)*)\]`.
- `surroundingClaim`: ~120 chars before the marker, trimmed at sentence boundary.
- Invalid IDs are stripped from the body and recorded.

---

## 7. Deterministic footnote builder

`cardClaimContract.buildFootnotes(markers, sourcePack)`:
1. Walk markers in body order; first occurrence of an ID emits a footnote `{ number, citation: card.canonicalCitation, source_name, source_type, url, source: card.provenance, source_id: card.id }`.
2. Replace each `[cite:S#]` with the matching superscript number(s).
3. Run **existing Rule 37 / repeated-citation logic** unchanged (so `שם` / `לעיל ה"ש`, legislation skip, all behave identically).
4. Run **existing post-process validators** (Rule 8.3 cleanup, legislation year completeness) on the deterministic citations — they only strip / inject markers, never synthesize.
5. Run **existing filter pipeline** (`placeholder_dominant`, `broken_title`, length thresholds) — a deterministic footnote with a fallback-minimal citation that is dominated by `[חסר: ...]` and lacks anchor proof is still dropped.

If a card lacks anchor (no `url` and no real provenance), the footnote is dropped and counted under existing `dropped_unanchored_count`.

---

## 8. Fallback path

```
const parsed = parseMarkers(body, pack);
if (parsed.markers.length === 0) {
  // legacy: existing AI-footnote pipeline runs unchanged
  contract = { used: false, legacy_fallback: true, reason: "no_cite_markers_found", ... };
} else {
  const { newBody, footnotes, missingMetadata, formatterUsage } = buildFootnotes(parsed, pack);
  // run rule37 + validators + filters on `footnotes` (existing modules)
  contract = { used: true, legacy_fallback: false, ... };
}
```
Legacy parser, anchor enforcement, and validators remain bit-for-bit unchanged on the fallback branch.

---

## 9. Telemetry

`qa_logs.metadata.research_safeguards.card_claim_contract`:
```
{
  used: boolean,
  legacy_fallback: boolean,
  reason?: "no_cite_markers_found" | "all_invalid_ids" | null,
  markers_found: number,
  unique_source_ids_used: number,
  invalid_source_ids: string[],
  claims_with_sources: number,
  generated_footnotes: number,
  missing_metadata: [{ source_id, missing_fields: string[] }],
  source_id_usage: { S1: 3, S2: 1, ... },
  formatter_usage: {
    reused_existing: number,
    engine_resolved: number,
    engine_unresolved_then_fallback: number,
    fallback_minimal: number
  },
  resolver_failures: [{ source_id, source_type, reason, missing_fields: [] }]
}
```

---

## 10. Validation rules

- Unknown `S#` → strip marker, push to `invalid_source_ids`, no footnote built.
- All markers invalid → fall back to legacy.
- Marker present but engine returns unresolved AND fallback-minimal output is too thin to anchor → drop and log under `missing_metadata`. Anchored cards (real URL / real provenance) keep their footnote with `[חסר: ...]` markers, consistent with the existing `anchored-partial-citations` rule.

---

## 11. Tests (`cardClaimContract.test.ts`)

- Parses `[cite:S1]` and `[cite:S1,S3]` (with whitespace variants).
- Rejects `[cite:S99]` when `S99` not in pack; logs invalid.
- **Engine reuse**: stub a card with statute fields → assert `resolveCitation` is invoked and its `canonical` string is used verbatim; assert no minimal-fallback path runs.
- **Fallback path**: stub a `web_source` card the engine cannot resolve → assert `fallback_minimal` is used and required-but-missing fields appear as `[חסר: ...]`.
- Body marker order preserved across multi-paragraph input.
- Repeats produce one footnote, with Rule 37 applied on subsequent body refs.
- Legislation cards never converted to `לעיל ה"ש`.
- No markers → legacy fallback, `used=false, reason="no_cite_markers_found"`.
- Anchored card with weak metadata → footnote kept with `[חסר: ...]`; unanchored card → dropped.

---

## 12. Verification (`eval/phase6-card-claim-contract-probe.mjs`)

Three queries × Fast + Deep (6 runs total), unique `evalRunId` each:

A. `"האם התיקון האחרון לחוק החוזים מהווה שינוי מהותי מההלכה הקיימת בפרשנות חוזים?"` (mixed)
B. `"האם ביבי כבישים שינתה את הלכת אפרופים?"` (caselaw-heavy)
C. `"מה הדין לגבי תנאי מקפח בחוזה אחיד?"` (legislation-heavy)

Per run, fetch `qa_logs.metadata.research_safeguards.card_claim_contract` and assert:
- `used = true` (expected on all 6)
- `markers_found ≥ 2`, `invalid_source_ids = []`
- `generated_footnotes ≥ 2` and ≤ `markers_found`
- every footnote has `source_id` matching a pack item
- `formatter_usage.fallback_minimal` low (target 0–2; report if higher so we know which source types need engine coverage)
- `dropped_unanchored_count = 0` on the deterministic path
- `legacy_fallback = false`
- answer body still renders (non-empty, no orphan `[cite:` strings, superscripts present)

If any run drops to legacy, dump `reason` + first 5 markers + first 5 IDs in pack.

---

## 13. Rollout sequence

1. Land `cardClaimContract.ts` (with engine adapter) + tests; run `bunx vitest` / Deno tests.
2. Wire IDs + `canonicalCitation` into `legalSourcePack.ts` (telemetry only first — no prompt change). Confirm `formatter_usage` numbers across queries.
3. Update drafter prompt + parse/build wiring + telemetry.
4. Deploy `legal-qa`.
5. Run `phase6-card-claim-contract-probe.mjs`; report results.
6. Run regression harness — confirm baselines unchanged. The deterministic path should pass `SHAPE_TRUNC`, `SHAPE_NAKED_ANAPHORA`, `SHAPE_MIN_TOKENS` more reliably; do not retune `known_failing_assertions` in this phase.

---

## Technical notes

- `S#` IDs assigned **after** Phase 5 round-2 reassembly so rescued cards get IDs.
- Multi-source marker `[cite:S1,S3]` renders as two adjacent superscripts — existing renumbering handles this.
- Deterministic builder bypasses fuzzy-URL matching entirely; the marker IS the anchor.
- Shadow A/B logger untouched.
- Eval-only forced-gap hook from Phase 5 unaffected.
- The minimal fallback formatter is intentionally tiny (~30 lines). If `formatter_usage.fallback_minimal` becomes non-trivial in production, that's a signal to extend the shared engine, not to grow the fallback.
