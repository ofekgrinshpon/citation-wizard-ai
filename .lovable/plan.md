Plan:

1. Fix the fallback gate in `citation-chat`
   - The previous change only helped after a Perplexity response is accepted.
   - The current failure happens earlier: Tier-2 is still discarded because `perplexityWithFallback` only checks docket anchoring in citation URLs, not in trusted result titles/snippets.
   - Update the Tier-1/Tier-2 anchor check to accept either:
     - docket in URL, or
     - trusted legal result URL + docket in title/snippet.

2. Reuse one shared anchor helper
   - Add a small helper so the fallback gate and party-verification gate use identical logic.
   - This prevents future mismatch where one stage accepts snippet anchors and another rejects them.

3. Add a narrow old-case safety fallback
   - For Supreme Court dockets with two-digit years before 1995, allow the open-web fallback to consider trusted legal/publication mirrors only when they explicitly mention the exact docket.
   - Keep modern-case protection unchanged so adjacent-case contamination remains blocked.

4. Deploy and validate the backend function
   - Deploy `citation-chat` after the code change.
   - Re-test:
     - `ע״א 248/86` should no longer return blank parties if an anchored trusted snippet is found.
     - `ע״א 1554/95` should remain correct.
     - A fake old docket should still return missing fields rather than hallucinated details.