## Why article/book is currently too narrow

Two stacked filters are clamping recall harder than intended:

1. **Tier-1 `search_domain_filter = BIBLIO_TRUSTED_DOMAINS`** — a ~25-host allowlist (mostly university law faculties + a few aggregators). Real Israeli legal scholarship lives in many places this list doesn't cover: specific journal sites (`din-online.info`, `iyunei-mishpat`, `mishpatim` subdomains, `colman.ac.il/research`, `hapraklit`, `mishpat-vmimshal`), publisher pages, Open Access PDFs, faculty SSRN mirrors, blog series (ICON-S-IL, ההסדרה), `gov.il` reports, news/opinion pieces for newspaper-article citations.
2. **Tier-2 open-web is gated by `TRUSTED_LEGAL ∪ TRUSTED_PUB`** in `perplexityWithFallback`. That allowlist was designed for caselaw (Nevo, supremedecisions, takdin, court.gov.il…). Academic article hits on, say, `tau.ac.il/~author/paper.pdf` or `ssrn.com/abstract=…` may not be in it, so Tier-2 returns are silently discarded and we fall back to the Tier-1 result anyway. Net effect: the "fallback" rarely actually helps for biblio.

The safety mechanism we built last turn (`anchorTitleInSources` + `verifyBiblioAuthor` + `authorAppearsInSources`) is what actually prevents hallucinations. It works regardless of which host the citation lives on. So the domain allowlist is no longer load-bearing for safety — it's mostly load-bearing for *cutting recall*.

## Plan: open up biblio search, keep the safety net

Out of scope: caselaw branches, legislation/regulation branches, `legal-research-v1`, UI.

### 1. Drop the Tier-1 domain filter for articles/books
- Article and book Perplexity calls run on full open web from the start, still on `sonar-pro`.
- Remove `search_domain_filter: BIBLIO_TRUSTED_DOMAINS` from both bodies.
- Remove the `forceOpenWebFallback`/Tier-2 call for these two branches — it becomes a no-op once Tier-1 is already open web. (One call instead of two = faster + cheaper, same recall.)

### 2. Keep BIBLIO_TRUSTED_DOMAINS as a *preference signal*, not a *filter*
- Use the list only inside `verifyBiblioAuthor` and inside the author-cross-check to **prefer** matches from those hosts when scoring. If anchor hits exist on a trusted host, we treat `author_confirmed` as stronger; if anchor hits only exist on weaker hosts (random blogs, content farms), we still accept but log `anchor_quality=weak`.
- Concretely: extend `anchorTitleInSources` to return `{anchored, anchorUrls, trustedAnchorUrls}` and use `trustedAnchorUrls.length > 0` as a "high-confidence" flag in logs, without blocking on it.

### 3. Tighten the safety net to compensate for the wider search
Wider search = more chance of catching the *wrong* paper with a similar title. So strengthen anchoring:
- **Stricter title match in `anchorTitleInSources`**: require either (a) a contiguous 5+ Hebrew-word window from the title to appear, or (b) a 3-word window AND the author's last name in the same snippet/URL. Today the threshold is 3-word windows alone.
- **Require explicit confirmation when title anchor is weak**: if the only anchor is a 3-word window (no last-name co-occurrence), force `verifyBiblioAuthor` to anchor on its own citations too. If neither agrees, drop the author.
- **Reject one-result wonders**: if Tier-1 returns only a single citation and that citation is from a content-farm host (not in BIBLIO_TRUSTED_DOMAINS and not a `.ac.il` / `.gov.il` / known publisher), require `verifyBiblioAuthor` agreement before accepting any field.

### 4. Apply the same opening up to legislation/regulation (optional, ask before doing)
The legislation/regulation branches use `sonar` with their own narrow filters. Same logic applies — but they were not in scope for the bug report, so I'd leave them unless you confirm.

### Files
- `supabase/functions/citation-chat/index.ts` — biblio helper block and the two branches.

### Verification
- Re-run the מאוטנר article: should now find it on the open web (likely `law.tau.ac.il` or SSRN), title-anchor on a 5-word window, author cross-check passes, returns מנחם מאוטנר.
- Re-run a deliberately obscure / nonsense title: anchor fails → `[חסר: מחבר]`, no hallucination.
- Re-run a previously-working query (something on a faculty page) to confirm no regression.

### Question for you
Do you want me to **also** open up legislation/regulation the same way in this same change, or keep that scoped to a follow-up?
