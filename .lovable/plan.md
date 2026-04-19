

## Root cause (verified against the live DB)

I generated the actual embedding for "האם אפשר לפטר את היועמשית" and called `match_legal_chunks` directly. Findings:

| Query                                              | Top similarity | Above 0.55 threshold? |
|----------------------------------------------------|----------------|------------------------|
| Original: "האם אפשר לפטר את היועמשית" (5 words) | **0.546**      | ❌ All 15 hits sit 0.528–0.546 |
| Expanded legal phrasing                            | **0.630**      | ✅ 10+ hits well above 0.55 |

So:
1. **Embedding generation is fine** — OpenAI returns a valid 768-dim vector.
2. **The DB function works** — 361,176 chunks have embeddings, dims match.
3. **The threshold (0.55) is just barely above the natural ceiling** for short Hebrew questions. Topical chunks score 0.53–0.55 — invisible at threshold 0.55.
4. **Query expansion didn't fire** because question is exactly 5 words / 26 chars, just outside the trigger (`< 5 OR < 25`). Had it fired, top similarity would have been **0.630** and we'd have ~10 strong local hits.

## Fix — `supabase/functions/legal-qa/index.ts` only

### 1. Loosen expansion trigger
Change from `< 5 words OR < 25 chars` to `≤ 7 words OR ≤ 40 chars`. This catches typical Hebrew legal questions (which average 5–7 words) and is the single highest-impact change.

### 2. Lower vector threshold from 0.55 → 0.45
Verified empirically: short Hebrew queries top out around 0.55. Dropping to 0.45 captures genuine matches; the AI re-ranker (already in place) filters noise downstream. We also already have a `slice(0, 12)` cap after merge, so prompt size is bounded.

### 3. Add explicit success/failure logging around the embedding call
Currently we only log on error. Add:
- `Embedding generated for query "<first 40 chars>...": dim=N, sample=[X.XX, X.XX, X.XX]` on success
- `Embedding returned null for query "..."` on null return
- `match_legal_chunks RPC error: <message>` if the RPC itself fails (currently silently `flatMap`'d away)

This makes future "0 results" investigations 1 minute instead of 20.

### 4. Surface RPC errors in the vector pipeline
Today: `vectorResults.flatMap(r => (!r.error && r.data) ? r.data : [])` silently drops errors. Change to log `r.error?.message` when present, before flatMapping.

### 5. (Bonus) Add a low-threshold safety net
If the expanded query still returns 0 after threshold 0.45, do **one** more retry at threshold 0.35 with `match_count: 8`. Logged as `Vector search safety-net retry at threshold 0.35`. This guarantees at least *some* local cards make it to the re-ranker, which is the gate that actually decides relevance.

## Expected impact for "האם אפשר לפטר את היועמשית"
- Expansion fires → second embedding generated → top sim ~0.63
- Threshold 0.45 → ~15 local vector hits
- Final source mix expected: **5–7 local / 4–6 perplexity** (today: 3 / 8)

## Out of scope
- No DB schema changes, no re-embedding
- No client changes
- No prompt-to-AI changes for the answer body
- No footnote matcher changes

## File changes
- `supabase/functions/legal-qa/index.ts` — items 1, 2, 3, 4, 5

