# Why the regression queries still fail (from qa_log `ce385139`)

The previous fix works at the pool level — the MMM "סחיטת דמי חסות / גביית דמי חסות" docs (`a6d79a7a`, `f70dbf19`) reach `anchor_kept` on 5/5 claims. But two general failures remain:

1. **The 2-slot reserve is layer-blind.** `mergedAnchorPool` always lists factual hits before concept hits. `filteredAnchors.slice(0, 2)` therefore burns both reserve slots on factual hits on every claim. `concept_anchor_candidates.injected_into_claims = 0` even when 8 unique concept docs were found. The journal-article anchor never gets a per-claim slot.

2. **Concept anchor terms are too narrow.** Planner emitted `["מחדל חקיקתי חלקי", "הזכות לחיים וביטחון"]`. The article we expect ("סעד החובה לחוקק") uses a synonymous framing ("חובה לחוקק"), so it never enters the concept pool at all. Same shape: a doctrinal question whose corpus uses a synonymous phrasing is silently missed.

The verifier verdicts show MMM hits landing as "tangential" (mostly), which is expected for recall-injected anchors — that's the verifier doing its job. The fix must stay in **retrieval recall**: get the right scholarship anchor *into* the pool and into the claim, then let the verifier judge.

No hardcoded ids, no per-document logic, no per-query strings. No changes to drafter / verifier / footnote builder / source pack / ledger / DB.

# Files

- `supabase/functions/legal-qa/core/retrieval.ts` — per-layer reserve, doctrine-synonym anchor expansion.
- `supabase/functions/legal-qa/core/prompts.ts` — broaden `concept_anchor_terms` instruction.
- `supabase/functions/legal-qa/core/runCore.ts` — telemetry only.

# F. Per-layer anchor reserve (retrieval.ts)

Currently `mergedAnchorPool` is a single flat list ingested factual-first. Replace the single 2-slot reserve with a per-layer split.

Constants:

```ts
const PER_CLAIM_ANCHOR_RESERVE = 2;   // unchanged total
const ANCHOR_RESERVE_PER_LAYER = 1;   // at least one slot per layer when that layer has candidates
```

Implementation (around lines 1141–1179):

- Keep `factualLayer.pool` and `conceptLayer.pool` separate; do not pre-merge.
- For each claim:
  - Re-tag each layer's pool with `metadata.factual_anchor = true` and `metadata.anchor_layer = "factual" | "concept"`.
  - Drop from each layer anything already in `byKey` (existing dedupe behaviour).
  - Apply the `needPrimary` filter (Section E) per layer independently.
  - Pick up to `ANCHOR_RESERVE_PER_LAYER` from each layer.
  - If one layer is empty after filtering, the unused slot falls through to the other layer (so a claim with only factual anchors still gets up to 2 factual slots — preserves current behaviour for non-doctrinal questions).
  - Total `anchorKept.length` stays bounded by `PER_CLAIM_ANCHOR_RESERVE`.

Telemetry change: `anchor_slots_used_per_claim[i]` adds `anchor_layers_used: ("factual" | "concept")[]`. Existing fields unchanged.

# G. Doctrine-synonym anchor expansion (retrieval.ts)

`supabase/functions/_shared/legalDoctrineSynonyms.ts` already exists with curated, purely-lexical doctrine vocabulary. It is **not currently wired into the anchor pre-pass.** Wire it in:

- Import `expandDoctrineTerms` from `_shared/legalDoctrineSynonyms.ts`.
- Compute `expansion = expandDoctrineTerms((plan.question || "") + " " + (plan.thesis || "") + " " + (plan.doctrinal_frame || ""))`.
- Merge `expansion.synonyms` into `conceptTerms` (after planner terms, deduped, capped at total 5 concept terms — existing cap behaviour). Factual terms are unchanged.
- Add one new entry to `DOCTRINE_SYNONYMS` in `_shared/legalDoctrineSynonyms.ts` for the broader category this regression exposed (still purely doctrinal vocabulary, no doc ids):

```ts
{
  id: "legislative_omission",
  trigger: /(מחדל\s*חקיקתי|חובה\s*לחוקק|הסדר\s*ראשוני|חסר\s*נורמטיבי)/,
  synonyms: [
    "מחדל חקיקתי",
    "מחדל חקיקתי חלקי",
    "חובה לחוקק",
    "סעד החובה לחוקק",
    "הסדר ראשוני",
    "חסר נורמטיבי",
    "בטלות יחסית",
  ],
},
```

These are doctrine triggers, not document titles. The same mechanism already exists for `basic_law_review`, `extortion`, `tort_negligence`, etc.

Telemetry: `concept_anchor_candidates.expansion_hits: string[]` (the `expansion.hits` ids) + `concept_anchor_candidates.expanded_terms: string[]` (the terms added beyond planner output).

# H. Broader concept_anchor_terms instruction (prompts.ts)

Current rule 13 in the planner prompt tells the planner to emit doctrinal anchor terms. Tighten the wording so the planner also emits **one alternate phrasing** of the central doctrine when an obvious synonym exists. General rule, no specific phrasings hardcoded:

> "בנוסף לפרישת המושג כפי שמופיע בשאלה, אם לדוקטרינה קיים ניסוח חלופי מקובל בספרות (לדוגמה — סעד מול חובה, מלא מול חלקי, פרוצדורלי מול מהותי), הוסף גם אותו. עד 5 ביטויים סך הכל."

Schema and cap stay the same (already cap 5 in retrieval.ts after merge with G).

# Telemetry (runCore.ts)

Surface in `metadata.core.retrieval`:

- `anchor_slots_used_per_claim[i].anchor_layers_used` (from F).
- `concept_anchor_candidates.expanded_terms`, `.expansion_hits` (from G).

Everything else in current telemetry is preserved.

# What stays untouched

- Citation engine, citation enrichment, drafter, verifier, ledger, footnote builder, Citation Review UI, Batch Footnote Builder.
- `legalSourcePack.ts` (its promotion gate isn't on the Core path).
- DB schema, RPC signatures, migrations.
- All existing recall layers (A vector reserve, B warmup + 57014 retry, C stub filter, D anchor-driven approved_web, E primary preservation) — kept as-is.

# Validation

Re-run both regression queries (`Q-extort` analog and the concept question) and inspect `qa_logs.metadata.core.retrieval`:

- `anchor_slots_used_per_claim[*].anchor_layers_used` contains `"concept"` on at least one claim of the doctrinal question.
- `concept_anchor_candidates.expanded_terms` non-empty for the legislative-omission question, `expansion_hits` includes `"legislative_omission"`.
- `concept_anchor_candidates.injected_into_claims >= 1` for the doctrinal question.
- Factual-only questions (e.g. Q-extort current run) still show `anchor_slots_used_per_claim[i].anchor_layers_used == ["factual"]` with `anchor_kept` up to 2 — no regression on factual-anchor questions.

# Acceptance

- No hardcoded document ids, titles, or per-query strings (the new doctrine entry uses doctrinal vocabulary that appears across many questions).
- Existing factual-anchor behaviour preserved when no concept layer is present.
- Verifier remains the relevance gate.
- No DB migration. No forbidden modules touched.
