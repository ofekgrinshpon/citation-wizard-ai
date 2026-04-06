
Fix the bug in three coordinated places, because the remaining warning is not just a frontend validation issue.

1. Align the edge-function system prompt with the new legislation search behavior
- Update `supabase/functions/citation-chat/index.ts` so the anti-hallucination instructions no longer say publication data may come only from the verified table or the user.
- Explicitly allow trusted legislation metadata injected by the Perplexity legislation lookup as a third approved source.
- Replace the old guidance that tells the model to output both `[חסר: מספר ס"ח]` and `[חסר: עמוד בס"ח]`, since Rule 2.8 now uses only one number after `ס"ח`: the first page.

2. Stop the sanitizer from destroying valid legislation publication data
- In `sanitizeHallucinatedPublicationData`, add awareness of when trusted legislation metadata was injected.
- Skip or narrow the `ס"ח`/`ק"ת` replacement logic when the response came from verified legislation search results, so a correct value like `ס"ח 128` is not rewritten or indirectly pushed back toward `[חסר]`.
- Keep the sanitizer active for truly unverified legislation replies to preserve the anti-hallucination protection.

3. Tighten missing-marker handling in frontend validation
- Update `src/lib/citationValidation.ts` so legislation validation prefers the actual parsed citation data when a valid `ס"ח 128` / `ק"ת 123` exists.
- Limit the generic `[חסר: ...]` deletion logic so a stale or overcautious missing marker does not wipe out `firstPage` when the citation line already contains the required page number.
- Keep the existing single-number regex for legislation.

4. Verify rule text stays internally consistent
- Review `src/data/citationEngine.ts` wording so all legislation examples, component descriptions, and notes consistently refer to one number after `ס"ח`/`ק"ת` for primary legislation page citation.
- Make sure no leftover copy still implies “issue number + page”.

Why this is still happening
- The logs show Perplexity is finding valid data such as `חוק התחרות הכלכלית, ס"ח 128, התשמ"ח`.
- But the edge-function system prompt still contains older instructions that forbid the model from trusting searched publication metadata and tell it to emit `[חסר]` unless data came from the verified table or the user.
- Even if the citation text is correct, the frontend validator can still mark it incomplete if a `[חסר]` marker remains and deletes `firstPage`.

Files to update
- `supabase/functions/citation-chat/index.ts`
- `src/lib/citationValidation.ts`
- `src/data/citationEngine.ts` (consistency pass)

Expected result
- A law citation like `חוק התחרות הכלכלית, התשמ"ח-1988, ס"ח 128.` should no longer produce:
  - `[חסר: עמוד בס"ח]`
  - `חסרים 1 רכיבי חובה...`
- The warning should appear only when the searched metadata genuinely lacks the first page.

Technical details
```text
Current conflict:
Perplexity search finds trusted page
        ↓
legislationHint injects trusted data
        ↓
SYSTEM_PROMPT still says “only verified table or user may supply page”
        ↓
model may still emit [חסר]
        ↓
frontend sees [חסר] and deletes firstPage
        ↓
warning is appended
```
