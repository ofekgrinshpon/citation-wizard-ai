
## Root cause

The caselaw-filtered vector query returns 8 chunks but בג"ץ 18225-06-25 גילון doesn't make the cut because:

1. **Embedding mismatch**: The case's procedural prose ("בית המשפט הגבוה לצדק", motion language) embeds far from the conceptual query "האם אפשר לפטר את היועמשית" / "להדיח את היועצת המשפטית".
2. **No keyword path**: `search_legal_chunks_text` returned **0 results** in the last run because the case's title/citation/case_number/court fields don't contain the literal words "לפטר" or "היועמשית" — the AND-mode requires distinctive terms (length≥4) ALL to match the indexed fields, but those fields are short metadata, not full text.
3. **Caselaw quota fills with denser cases**: Family-court and corporate cases out-rank גילון because their metadata is more verbose.

## Fix strategy — three layers

### Layer 1: Index chunk content in keyword search (root cause fix)
Currently `search_legal_chunks_text` builds the tsvector from `title + citation + case_number + court` only. The actual case discussion lives in `legal_document_chunks.content`, never indexed. **Add `c2.content` to the tsvector source**, so a case mentioning "פיטור היועצת המשפטית" inside its body text becomes findable even when the metadata doesn't mention it.

This is the single highest-impact change — it unlocks every landmark case whose metadata is terse.

### Layer 2: Landmark-case direct injection
Add a small curated map in `legal-qa/index.ts`:
```ts
const LANDMARK_CASES = [
  { triggers: [/יועמ"?ש|יועצת המשפטית|יועץ המשפטי/], 
    case_numbers: ["18225-06-25", "4267/93"] },
  // extensible
];
```
When the question matches a trigger, fetch those documents by `case_number` and unconditionally inject them into the candidate pool **before** rerank. They still go through rerank, so off-topic landmarks get filtered.

### Layer 3: Loosen caselaw threshold + expand pool
- Drop `match_threshold` for the caselaw-filtered vector query from 0.4 → **0.25** (case law embeds lower than academic prose).
- Expand caselaw vector results from top 8 → **top 16**, keep top **6 in merge** (was 4).

### Layer 4 (diagnostic only)
Log the raw similarity and rank of any landmark case ID present in the candidate pool, so we can verify Layer 2 worked and see why rerank kept/dropped it.

## Expected impact
- Layer 1 alone should surface גילון via keyword if its body mentions "פיטור" / "היועצת המשפטית".
- Layer 2 guarantees it appears in the candidate pool even if both retrieval channels miss it.
- Layer 3 widens the net for borderline cases without flooding noise (rerank still gates).

## File changes
- **DB migration**: update `search_legal_chunks_text` to include `c2.content` in the tsvector (joined LATERAL already exists).
- **`supabase/functions/legal-qa/index.ts`**:
  - Add `LANDMARK_CASES` map + injection logic before merge.
  - Lower caselaw threshold to 0.25, expand to top 16 / keep 6.
  - Add diagnostic log for landmark case rank.

## Out of scope
- No changes to embedding model or re-ingestion.
- No changes to answer-body prompt or footnote matcher.
- No client changes.
