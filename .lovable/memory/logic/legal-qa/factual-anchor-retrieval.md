---
name: factual-anchor-retrieval
description: Planner emits factual_anchor_terms (subjects) + concept_anchor_terms (doctrinal phrases). Retrieval runs FTS+vector on both as a pre-pass, splits the per-claim 2-slot anchor reserve into ≥1 per layer, and expands concept terms via _shared/legalDoctrineSynonyms.
type: feature
---

# Anchor retrieval pre-pass + per-layer reserve + doctrine-synonym expansion

## Layers

- **`factual_anchor_terms`** — concrete subjects from the question ("דמי חסות", "פרוטקשן"). Surfaces gov/Knesset MMM reports.
- **`concept_anchor_terms`** — doctrinal key phrases ("חובה לחוקק", "מחדל חקיקתי"). Surfaces academic articles whose titles use a synonymous framing.

Both run independent FTS+vector passes via `runAnchorLayer` with per-document diversity (`ANCHOR_MAX_DOCS_PER_LAYER=8`). Combined cap: `CONCEPT_ANCHOR_TERMS_MAX=5` for concept, 8 for factual.

## Per-layer anchor reserve (Section F)

`PER_CLAIM_ANCHOR_RESERVE=2` total slots per claim. `ANCHOR_RESERVE_PER_LAYER=1` guarantees one slot to each layer that has candidates, then the remainder spills to whichever layer has more. Splitting by `metadata.anchor_layer` prevents factual hits (which always sort first in the merged pool) from starving concept candidates. Factual-only questions still fill both slots from factual via the spillover phase.

Telemetry: `anchor_slots_used_per_claim[i].anchor_layers_used: ("factual"|"concept")[]`.

## Doctrine-synonym expansion (Section G)

`_shared/legalDoctrineSynonyms.ts` (`expandDoctrineTerms`) is wired into `retrieveForPlan` and merged into `conceptTerms` before the anchor pass. The dictionary is keyed by doctrine triggers (regex over question+thesis+frame) and yields purely-lexical synonyms (e.g. `legislative_omission` → `מחדל חקיקתי`, `חובה לחוקק`, `סעד החובה לחוקק`, `הסדר ראשוני`). No document-specific hardcoding. Synonyms append after the planner's terms and are capped to 5 total.

Telemetry on the concept layer: `expanded_terms`, `expansion_hits`.

## Existing recall layers (preserved)

- A: per-claim anchor reserve (now per-layer in F).
- B: cold-HNSW vector warmup + 57014 retry in `localVector`.
- C: approved_web stub filter (`isApprovedWebStub`).
- D: anchor-driven Perplexity queries (gov hosts for factual, scholarship subset for concept) when local recall is thin or scholarship required.
- E: primary-law preservation — when `requiresBindingLaw(claim) && primaryLocalCount<2`, only primary anchors compete for the reserve.

## Vector path

`localVector` threshold `0.35`. `makeInstrumentedEmbed` captures `embed_health`. `vectorWarmup` fires once before any per-claim/anchor RPC.

## Files

`core/types.ts` (`PlanV1.concept_anchor_terms`), `core/prompts.ts` (rule 13 — alternate phrasing instruction), `core/retrieval.ts` (per-layer reserve, doctrine expansion, vector path, approved_web extensions), `core/runCore.ts` (telemetry pass-through), `_shared/legalDoctrineSynonyms.ts` (new `legislative_omission` entry).

## Verification signals in qa_logs.metadata.core.retrieval

- `anchor_slots_used_per_claim[*].anchor_layers_used` includes `"concept"` on at least one claim of a doctrinal question.
- `concept_anchor_candidates.expanded_terms` and `expansion_hits` non-empty when triggers fire.
- `concept_anchor_candidates.injected_into_claims > 0` for doctrinal questions.
- Factual-only questions still show `["factual"]` with `anchor_kept` up to 2.
