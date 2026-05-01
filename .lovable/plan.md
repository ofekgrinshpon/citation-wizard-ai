**What I found**

The current guard is still too permissive. It accepts results because Perplexity echoed docket numbers inside its own JSON/text, not because the specific docket is independently proven by the cited source. In this example, Perplexity returned four “found” results, including the correct `158/77`, but the other three were not real matches for `רבינאי נ' מן שקד`. The code then labeled all four as “verified” because it mined docket fingerprints from the response text itself.

There is also a second issue: the Supreme Court download URLs are opaque/encoded. A URL like `...fileName=09083200_w16.txt` anchors docket `8320/09`, but does not prove the parties or פ"ד metadata for every result Perplexity places next to it. So URL-level trust is not enough.

**Plan**

1. **Remove self-referential verification**
   - In `supabase/functions/citation-chat/index.ts`, stop accepting a party-search result merely because its docket appears in `psContent` / the model’s JSON.
   - Only treat a result as grounded when the docket is proven by a trusted URL or by raw search snippets returned from the Search API, not by the LLM’s generated answer.

2. **Add deterministic party-search verification**
   - After Perplexity proposes candidate case-law results, run a separate raw search verification per candidate using a query like:
     - exact docket
     - both party names
     - trusted domains only where possible
   - Accept a candidate only if the same raw search item/snippet contains:
     - the exact normalized docket, and
     - meaningful tokens from both parties (`רבינאי` and `מן שקד`), or an authoritative citation/publication snippet tying them together.
   - Reject candidates such as `1456/22`, `5131/10`, and `8320/09` when they do not contain both parties together in the verified snippet.

3. **Handle Supreme Court encoded dockets explicitly**
   - Add a helper to decode Supreme Court `fileName` / `path` patterns into docket fingerprints where possible:
     - `09083200_w16` → `8320/09`
     - `22014560` → `1456/22`
     - `10051310` → `5131/10`
   - This prevents false positives from vague URL matching and helps log why a candidate was accepted or dropped.

4. **Prefer exact legacy/publication hit for this pattern**
   - For short Hebrew party-name queries where one candidate has a classic published citation (`פ"ד לג(2) 283`) and others only have unrelated/opaque database links, rank the published, party-matching candidate first.
   - If only one candidate survives verification, return the citation directly instead of a disambiguation list.

5. **Add a fail-closed response**
   - If no candidate can be independently verified, return a safe message asking for an exact docket number instead of showing model-generated options.
   - Do not fall back to the general citation generator with unverified case-law data.

6. **Improve logs for debugging**
   - Log, per candidate, the verification status and reason:
     - accepted because exact docket + both parties found in raw snippet/source
     - rejected because docket not proven
     - rejected because parties not tied to the docket
     - rejected because publication metadata unverified

7. **Regression check**
   - Test `רבינאי נגד מן שקד` after deployment and confirm the only accepted result is `ע"א 158/77`, or that the system safely asks for the exact docket if external search cannot verify it.
   - Also test selecting a candidate from the list to ensure it cannot generate a hallucinated citation when verification fails.