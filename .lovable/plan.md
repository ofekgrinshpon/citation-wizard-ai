

## Root cause confirmed
The re-rank threshold `score >= 4` (line 459 in `supabase/functions/legal-qa/index.ts`) is dropping 6 of 9 local docs even though they retrieved at high similarity. Multiple genuinely relevant local sources score 3 and get filtered. The +0.08 content-aware bonus added previously only affects retrieval similarity — it does NOT influence rerank scores, which is the real gate.

## Fix — `supabase/functions/legal-qa/index.ts` only

### 1. Lower rerank keep threshold from `>= 4` to `>= 3`
Line 459. Score 3 means "useful but not central" — exactly the supporting sources we want in a legal memo. Score < 3 still gets filtered, so noise (0–2) stays out.

### 2. Force-keep top-N local docs regardless of score
After scoring, always retain the **top 4 docs by rerank score** even if some scored < 3. This guarantees we never collapse below 4 local sources when retrieval found 30 hits. Today only `bestDocId` (single top doc) is force-kept.

### 3. Apply rerank-score bonus for action-verb topical match
Same `VERB_TOPIC_PAIRS` logic, but applied to the **rerank score** (e.g. +1 to the score) when the chunk content matches the question's action verbs. This means בג"ץ גילון-style docs that mention "פיטור" / "סיום כהונ" jump from score 3 → 4 and clear the threshold organically.

### 4. Tighten rerank prompt with concrete guidance
Add one explicit line to the prompt at line 394: clarify that a source scoring 3 is "תורם לרקע משפטי / עוסק בענף הדין הרלוונטי" and should be kept; only 0–2 are "off-topic." This re-calibrates the LLM upward without removing strictness.

### 5. Add diagnostic log
After filtering: `console.log("Local kept after rerank: X/Y (force-kept: Z)")` so we can verify the next run hits the 5–7 target.

## Expected impact for "האם אפשר לפטר את היועמשית"
With the recent run's scores `[0, 2, 0, 3, 3, 2, 3, 4, 7]`:
- Threshold ≥3 alone → **5 local kept** (the four 3s + the 4 + the 7)
- Plus verb bonus likely pushes one or two of the 2s up
- Plus force-keep top-4 floor → guaranteed minimum
- Final mix expected: **5–6 local / 5–6 perplexity**

## Out of scope
- No DB / schema / embedding changes
- No client changes
- No changes to the answer-body prompt or footnote matcher
- No removal of the existing similarity-based content bonus (keep both layers)

## File changes
- `supabase/functions/legal-qa/index.ts` — items 1, 2, 3, 4, 5

