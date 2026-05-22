---
name: factual-anchor-retrieval
description: Planner emits factual_anchor_terms (subjects) + concept_anchor_terms (doctrinal phrases); retrieveForPlan pre-pass runs FTS+vector PER TERM with doctrine synonym expansion and injects hits into every claim. Adds statute-section focused queries when authority has a section, replaces exact-authority statute snippet with the chunk containing that section, promotes approved_web hits to local DB rows when URL matches legal_documents, and records per-candidate audit (kept/dropped + reason).
type: feature
---

# Retrieval pre-pass + statute-section + web→local promotion

## Anchor pre-pass
- `factual_anchor_terms` (subjects from question) + `concept_anchor_terms` (doctrinal phrases) → merged with `expandDoctrineTerms()` synonyms (general dict in `_shared/legalDoctrineSynonyms.ts`, includes `legislative_omission`: `מחדל חקיקתי → חובה לחוקק / סעד החובה לחוקק / חסר נורמטיבי / חקיקה לוקה בחסר`).
- FTS runs PER TERM separately (each anchor gets its own focused query); vector pre-pass also per-term, capped to 6 terms.
- Combined cap raised to 12 unique terms.

## Statute-section retrieval
- When a linked authority is type `statute`/`regulation` AND has `section`, build queries `סעיף X ל<law>` / `ס' X <law>` / `X <law>` (generic, no hardcoded laws).
- `sectionVariants()` normalizes `סעיף 428א` / `ס' 428א` / `428א` / `428 א` / digit+Hebrew-letter combos.
- `exactAuthority`: when section present, overrides head-of-document snippet with the chunk containing that section via `findSectionChunkContent()` (ILIKE on `legal_document_chunks` per variant, first match by `chunk_index`).
- New `section_text` candidate stream ingested between `exact` and generic `local_text`.

## Web → local promotion
- `promoteWebCandidates()` runs after Perplexity returns. For each web hit with URL, looks up `legal_documents` by `source_url` or `pdf_url`. On match, swaps title/citation/source_type/url/snippet/document_id with the local row and tags `metadata.promoted_from_web=true` + `original_web_url`. Prevents weak web labels from shadowing richer DB rows (academic articles especially).

## Vector floor
- `match_threshold=0.35` retained for `localVector` (Hebrew text-embedding-3-small@768d typical 0.30-0.55).

## Per-candidate audit
- `RetrievalResult.candidates_audit: CandidateAuditEntry[]` records every candidate considered (kept/dropped), with `document_id`, `title`, `source_type`, `origin`, `url`, `drop_reason` (`per_claim_cap` | `deduped`), `section_query`, `promoted_from_web`.
- Surfaced under `qa_logs.metadata.core.retrieval.candidates_audit` (and `.factual_anchors` includes `synonym_hits` / `synonym_added`).

## Files
`core/retrieval.ts` (all helpers + orchestrator changes), `core/runCore.ts` (audit + anchors in metadata), `_shared/legalDoctrineSynonyms.ts` (legislative_omission entry).

## Verification signals
- `metadata.core.retrieval.candidates_audit[*]` includes the statute `document_id` with `section_query` set and `kept=true` when section-targeted.
- `metadata.core.retrieval.factual_anchors.synonym_added` non-empty when doctrine triggers fire.
- `candidates_audit` shows `promoted_from_web=true` when a web URL was rewritten to a local DB row.
