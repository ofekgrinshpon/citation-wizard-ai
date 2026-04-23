

# Milestone A.5 — Fix source-pack classification (with relevance gate)

## Direct answer to your question

**You are right to push back.** The current `anchorPresent && usableForAnalysis` checks are too weak to gate a promotion to `core`:

- `anchor_present` = "the chunk came from local DB or has a URL" — tells us nothing about topical fit.
- `usable_for_analysis` = "excerpt is longer than 300 chars" — substance check, not relevance check.

A journal article that mentions the topic in a single passing footnote would pass both. So we MUST add a **relevance gate** before promotion. Plan updated accordingly.

---

## What gets promoted to `core` and under what conditions

Promotion to `core` for a `knesset_research` or `journal_article` item requires **all four**:

1. `provenance === "local"` (not Perplexity, not document)
2. `anchor_present === true` (already enforced)
3. `usable_for_analysis === true` (excerpt > 300 chars — already enforced)
4. **NEW: `relevance_score >= 0.55`** — derived from the chunk's retrieval similarity, computed as the higher of (vector cosine similarity) or (BM25 ts_rank normalized), already produced by `match_legal_chunks` / `search_legal_chunks_text`. We just need to carry it through.

If a `knesset_research` / `journal_article` item passes 1–3 but fails 4, it stays in `supporting` (current behavior).

Threshold rationale: `0.55` is the same threshold the existing rerank stage uses to pass a chunk through to the source pool at all, so anything below that wouldn't be in the candidate set in the first place; promoting starts at "well above the floor." We can tune it with one production run after deploy.

For `caselaw`, the rule is stricter and unchanged: source_type=`caselaw` from the DB → `primary_caselaw` → `core`. The DB already vetted these; no relevance gate needed because they're primary authority by definition.

---

## Code changes

### 1. `supabase/functions/legal-qa/index.ts`

**a. Carry the chunk's similarity score onto the source card** (line ~1911 area, where `sourceCards.push` happens for local matches): add `relevance_score: m.similarity` to the pushed card. The merged `m` object already has `similarity` from the hybrid retrieval merge.

**b. Carry it onto the internal SourcePackEntry** (line ~1984, the `sourcePack = sourceCards.map(...)` block): add `relevance_score: sc.relevance_score ?? 0` to the entry.

**c. Strengthen `classifyAuthority` for caselaw:** when `source_type === "פסיקה"` (the labeled value used here) OR the underlying DB `source_type === "caselaw"`, return `primary_caselaw` unconditionally. Today the regex-only check misses any caselaw whose `citation` field doesn't start with `בג"ץ`/`פ"ד`/etc. We trust the DB classification, not the citation string.

**d. Add per-source-type counts** to the `source_pack_summary` metadata block (line ~3724 area): emit `{caselaw: N, israeli_law: N, knesset_research: N, journal_article: N, perplexity: N, document: N}` alongside the existing `{core, supporting, secondary}` counts. This gives us instant diagnosis next time `core` looks wrong.

### 2. `supabase/functions/legal-qa/contracts.ts`

Add an optional field to `LegalSourcePackItem`:
```ts
/** INTERNAL — retrieval-stage similarity (0–1). Used for promotion gating. */
relevanceScore?: number;
```

Add it to `BANNED_KEYS` so it never leaks to the user-facing payload.

### 3. `supabase/functions/legal-qa/legalSourcePack.ts`

**a. Extend `InternalSourcePackEntry`** with `relevance_score?: number`.

**b. Map it through in `toItem`:** `relevanceScore: entry.relevance_score`.

**c. Extend `assembleSourcePack` promotion logic.** Today the switch is purely on `authorityClass`. New logic:

```ts
// Inside the per-item loop in assembleSourcePack:
const PROMOTION_THRESHOLD = 0.55;
const isPromotable =
  (item.authorityClass === "secondary_official" ||   // knesset_research
   item.authorityClass === "secondary_academic") &&  // journal_article
  item.anchorPresent &&
  item.usableForAnalysis &&
  (item.relevanceScore ?? 0) >= PROMOTION_THRESHOLD &&
  item.provenanceInternal === "local";

if (isPromotable) {
  core.push(item);
  continue;
}
// ...existing switch unchanged for everything else
```

This means: knesset_research / journal_article items still default to `supporting`; they get promoted to `core` only when they're locally-retrieved, anchored, substantive, AND topically relevant.

---

## Why this fixes `core=0` without over-promoting

From the production sample (12 recent runs), the typical retrieved set per query is 8–11 chunks at similarity 0.55–0.85. Today **every** journal/knesset chunk lands in `supporting` even at sim=0.85. After A.5:

- A journal_article hit at sim=0.78 with a 600-char excerpt → promoted to `core`.
- A journal_article hit at sim=0.51 (weak topical fit, scraped past the rerank floor) → stays in `supporting`.
- A knesset_research hit at sim=0.62 with the right keyword density → promoted to `core`.
- A Perplexity-derived URL → stays in `secondary` (doesn't pass `provenance === "local"`).
- A caselaw chunk regardless of citation regex → `primary_caselaw` → `core`.

Expected effect on Q1/Q6/Q21: `core` rises from 0 → typically 3–7 on the same retrieved chunks. No new external calls. No new latency.

---

## Diagnostic exposure

The new `source_type_counts` block in `qa_logs.metadata` lets us answer "did the model receive enough core authority?" in one SQL query, instead of inferring it from indirect evidence. Next regression takes 30 seconds to diagnose, not an hour.

---

## Verification plan after deploy

Single 9-shot stability run (Q1 / Q6 / Q21 × 3) with one extra metric pulled from the new metadata: average `core.length` per run. Pass criteria:
- `core.length >= 2` on at least 7 of 9 runs.
- `anchored citations in body >= 3` on at least 7 of 9 runs.
- No regression in wall time (target: stays under 65s avg).
- `dropped_unanchored_count` from Milestone A stays at the v7.8 baseline (~3.6 avg) or lower.

If `core.length` stays low on Q6/Q21 even after A.5, we've proven the corpus genuinely lacks coverage on those topics, and Milestone B (Perplexity completion) is justified.

---

## Files to edit

- `supabase/functions/legal-qa/index.ts` — carry `similarity` onto cards/entries; strengthen `classifyAuthority` for caselaw; emit per-source-type counts in metadata.
- `supabase/functions/legal-qa/contracts.ts` — add `relevanceScore` field; add to `BANNED_KEYS`.
- `supabase/functions/legal-qa/legalSourcePack.ts` — promotion logic with relevance gate.
- `eval/stability-v7.9-run.mjs` — adapt the v7.8 runner to also pull `source_type_counts` and `core.length`.
- `.lovable/memory/logic/legal-qa/source-pack-classification.md` — new memory doc capturing the promotion rules and threshold.

## What this plan does NOT do

- No model swaps.
- No prompt changes.
- No new external API calls.
- No new database migrations.
- No frontend changes.

Pure source-pack bookkeeping. Smallest possible diff that makes the `core` bucket honest.

