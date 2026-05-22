# Retrieval recall fix — consolidated A+B+C+D+E

General-purpose changes to `core/retrieval.ts` and `core/runCore.ts` only. No DB migration. No changes to citation engine, drafter, verifier, ledger, footnote builder, Citation Review UI, or Batch Footnote Builder. No query-specific or document-id hardcoding.

## A. Anchor reserve in per-claim candidate selection

`retrieval.ts:830-871` currently dedupes via `byKey` Map (ingest order: exact → text → vector → anchor → web) then slices `localKept.slice(0, localBudget)` where `localBudget = PER_CLAIM_CAP - webKept.length`. Result: anchors are appended last to the Map and routinely sliced off when text hits already fill the budget. Telemetry shows `injected_into_claims` incrementing even when the anchor was sliced.

Changes:
- New constant `PER_CLAIM_ANCHOR_RESERVE = 2`.
- After ingest, partition `all` into `webAll`, `anchorAll` (anchors carry `metadata.factual_anchor === true`), and `localOther` (everything else).
- `anchor_kept = anchorAll.slice(0, min(PER_CLAIM_ANCHOR_RESERVE, anchorAll.length))`.
- `localBudget = max(0, PER_CLAIM_CAP - webKept.length - anchor_kept.length)`.
- Final `candidates = [...localOther.slice(0, localBudget), ...anchor_kept, ...webKept]`.
- Anchor candidates carry their original `origin` (`local_text` / `local_vector`), so verifier treats them as ordinary local hits. Anchor reserve is recall-only — verifier remains the relevance gate.
- Fix `injected_into_claims` to increment only when an anchor candidate is in the final `candidates` array (not merely in `byKey`).

## B. Vector warmup + 57014 retry

Edge logs show `C0-factual-0` and `C0-concept-0` timing out with Postgres `57014` (statement timeout), then later calls succeed. Cold-HNSW load on the very first call.

Changes in `retrieval.ts`:
- New `vectorWarmup(supabase, signal)` helper called once at the top of `assembleSourcePack`, before any anchor or per-claim vector RPC. Fires `match_legal_chunks` with `match_count=1`, `match_threshold=0.99`, a zero-vector. Errors swallowed. Records `vector_health.warmup_status = "ok" | "failed:<code>"`.
- In `localVector`, on RPC error with `code === "57014"`: retry once with `match_count = ceil(match_count / 2)`. Record `vector_health.retries_57014` counter and final outcome. Existing diagnostics (`calls`, `ok`, `failed`, `last_rpc_error`, `last_embedding_length`, `threshold_probe_top_similarity`) stay intact.

## C. Drop approved_web stubs before they reach the candidate pool

In `approvedWeb` (around line 617), after parsing each Perplexity candidate, drop it when the citation looks like a stub. New per-claim counter `approved_web_stubs_dropped`.

Drop rules (applied to the Perplexity-returned `citation` / `title` strings, NOT to local DB hits):
- **Standalone placeholder titles** (exact-match, ignoring leading/trailing whitespace and quotes): `"פסק דין"`, `"החלטה"`, `"פס\"ד"`, `"פסה\"ד"`, `"פסק־דין"`.
- **Caselaw with no party indicator**: `source_type === "caselaw"` AND citation lacks `נ'`, `נ׳`, `נגד`, or `v.` AND the remaining title text is shorter than 6 chars.
- **Bare docket fragments**: citation matches `^\d+([./]\d+){1,2}\s*(\([^)]*\))?$` with no party text (e.g. `"24.7.9396 (בתי המשפט המחוזיים)"`).
- **Generic too-short citation**: trimmed citation length < 20 chars AND no recognisable Hebrew word ≥ 4 chars in the title.

Each drop is counted into `approved_web_stubs_dropped` and the candidate is excluded from the returned `candidates` array. No changes to anything downstream.

## D. Extend factual/concept anchors to approved_web

Same `factual_anchor_terms` / `concept_anchor_terms` the planner already emits drive an additional approved_web query when warranted. Behaviour is general, not domain-specific.

Trigger (per claim, after local retrieval, before the existing approved_web call):
- "Thin local recall" = `localKept.length + anchor_kept.length < 4` after section A runs, OR
- claim's `required_evidence` includes one of: `scholarship`, `doctrinal_definition` (concept anchors get scholarship route), OR
- factual_anchor pool produced documents but **0** were retained for this claim after A (signal that the factual topic isn't well covered locally).

When triggered:
- Build a Perplexity query as `claim.text + " " + selected_anchor_terms.join(" ")`, where `selected_anchor_terms` are 1–3 terms drawn from `factual_anchor_terms` (factual route) and/or `concept_anchor_terms` (concept route).
- Factual route: pass `search_domain_filter = TIER_A_DOMAIN_FILTER` filtered to gov/regulator hosts present in TIER_A (knesset.gov.il, mevaker.gov.il, justice.gov.il, reshumot.gov.il, competition.gov.il, tax.gov.il, mof.gov.il, supreme*.gov.il). No scholarship hosts here.
- Concept route: only fires when `required_evidence` contains `scholarship` or `doctrinal_definition`. Uses TIER_A scholarship subset (huji.ac.il, tau.ac.il, biu.ac.il, ssrn.com, jstor.org).
- These extra hits go through the SAME approved_web normalization and the same C-stage stub filter.
- Counts written to telemetry as `approved_web_anchor_queries` (per claim: `{ factual_terms, concept_terms, factual_hits, concept_hits }`).

Local DB still wins: the existing local-DB metadata override (line 899+) is unchanged and applies to these new anchor-web hits exactly the same way — if a Perplexity URL matches a row in `legal_documents`, the local title/citation/source_type override Perplexity's metadata.

Anchor-web hits are still subject to per-claim cap math from A (they enter via `webKept`).

## E. Preserve source-quality hierarchy

Anchor reserve is for recall; primary law must still come first for doctrinal claims.

Implementation inside the anchor-reserve partition in A:
- Tag each anchor candidate with `is_primary_law` based on `source_type`:
  - **primary**: `statute`, `legislation`, `regulation`, `caselaw` originating from Supreme Court (heuristic: `court` field includes `"עליון"` or `"Supreme"`) OR `exact_authority` origin.
  - **secondary**: `knesset_research`, `journal_article`, `book_chapter`, `policy_paper`, `mmm_report`, `scholarship`, plus caselaw from lower courts.
- For each claim, compute `primary_local_count` = number of `localOther` candidates with `is_primary_law === true` already in the budget.
  - If `primary_local_count >= 2`: anchor reserve admits both primary and secondary anchors (existing behaviour, reserve=2).
  - If `primary_local_count < 2` AND the claim's `required_evidence` includes a binding-law kind (`binding_caselaw`, `statute_section`, `regulation`): anchor reserve admits **only primary-tier anchors**, and any secondary anchor that would have taken a slot is deferred. The freed slot returns to `localOther` so a primary local hit gets it.
- Telemetry per claim: `anchor_slots_used`, `anchor_source_types: string[]`, `primary_count`, `secondary_count`, `anchor_displaced_primary: boolean` (true if reserve consumed a slot that would have gone to a primary local candidate — i.e., `localOther.length > localBudget` AND any of the displaced ones had `is_primary_law`).

This is general (heuristic on `source_type` + `court`), with no per-document or per-query hardcoding.

## Telemetry consolidation (runCore.ts)

Surface in `qa_logs.metadata.core.retrieval`:
- `vector_health` — existing fields + `warmup_status`, `retries_57014`.
- `anchor_slots_used_per_claim: Array<{claim_id, anchor_kept, anchor_doc_ids, anchor_source_types, anchor_displaced_primary}>`.
- `per_claim[*].primary_count`, `per_claim[*].secondary_count`.
- `approved_web_stubs_dropped_per_claim: Array<{claim_id, dropped_count}>`.
- `approved_web_anchor_queries: Array<{claim_id, factual_terms, concept_terms, factual_hits, concept_hits}>` — empty array when never triggered for a claim.

Existing telemetry (`factual_anchor_candidates`, `concept_anchor_candidates`, `local_metadata_overrides`) stays as-is.

## Files

- `supabase/functions/legal-qa/core/retrieval.ts` — A (anchor reserve), B (warmup+retry), C (stub filter), D (anchor-driven approved_web), E (primary/secondary partition + displacement logic).
- `supabase/functions/legal-qa/core/runCore.ts` — telemetry surfacing only.

No other files touched. No DB migration.

## Validation

Re-run both regression queries (server-side, after deploy) and inspect `qa_logs.metadata.core.retrieval`:

**Query 1 — דמי חסות / פרוטקשן:**
- `vector_health.warmup_status === "ok"` and `failed === 0` (or `retries_57014 ≥ 1`).
- `factual_anchor_candidates.document_ids` non-empty (existing behaviour preserved).
- ≥1 claim's `anchor_slots_used_per_claim[i].anchor_doc_ids` contains a Knesset MMM document id.
- `approved_web_stubs_dropped_per_claim` shows ≥1 drop on caselaw claims; no footnote text contains standalone `"פסק דין"` or bare-docket-only citation.
- `total_footnotes ≥ 10` with full party names + citations.

**Query 2 — מחדל חקיקתי / חובה לחוקק:**
- `concept_anchor_candidates.document_ids` non-empty.
- ≥1 claim with `required_evidence` including `scholarship` or `doctrinal_definition` has the local journal article in its candidates, OR `approved_web_anchor_queries` shows the concept route fired AND `local_metadata_overrides ≥ 1` (Perplexity URL resolved to local DB metadata).
- No footnote uses only "משפטים (המאמר באתר כתב העת משפטים…)" placeholder when the local article is in candidates.

**Acceptance:**
- No hardcoded ids/titles/terms.
- Existing `factual_anchor_terms` / `concept_anchor_terms` behaviour preserved (additive).
- Verifier still gates relevance.
- No DB migration.
- Forbidden modules untouched.
