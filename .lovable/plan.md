**Plan**

1. **Fix the real Perplexity failure**
   - The current `TRUSTED_LEGAL_DOMAINS` list is still over Perplexity’s 20-domain hard limit, so the main Perplexity call still fails with `search_domain_filters has a max length of 20`.
   - I will reduce the actual runtime list to exactly 20 domains, not just the documented list.
   - I will also remove redundant subdomains where the parent domain already covers them, especially:
     - `main.knesset.gov.il` because `knesset.gov.il` covers it
     - `lite.takdin.co.il` because `takdin.co.il` covers it

2. **Keep your requested removals enforced**
   - Ensure these remain excluded from the main trusted list:
     - `tau.ac.il`
     - `huji.ac.il`
     - `fs.knesset.gov.il` / the typo version you wrote is not present either
   - Update the stale code comments that still say `tau.ac.il` is included.

3. **Make Perplexity search less fragile**
   - Replace all `search_domain_filter: TRUSTED_LEGAL_DOMAINS` calls with a capped 20-domain constant so a future accidental addition cannot break the API again.
   - Keep the broader allowlist check separate if needed, but never send more than 20 entries to Perplexity.

4. **Improve why only 4 weak sources survive**
   - The logs show Perplexity returned zero because of the 400 error, then local retrieval found sources but the reranker/pruning path reduced the final usable set.
   - I will adjust the source-pack path so URL-only Perplexity citations, once the API works again, can contribute as citation anchors instead of being ignored as weak external references.
   - I will keep citation safety guards intact: no blogs/law-firm sites, no broad `court.gov.il`, no hallucinated citation fields.

5. **Validate after changes**
   - Count the exact outgoing Perplexity domain list and confirm it is 20 or fewer.
   - Re-check the logs/code paths for the same query class to confirm the previous 400 error cannot recur.
   - Update the project memory note so future changes do not reintroduce the over-limit list.