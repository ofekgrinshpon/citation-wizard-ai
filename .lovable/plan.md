## Why the wrong author came back

The caselaw branch was hardened last round (docket anchor + Tier-2 fallback + party verification), but the **article (`מאמר`) and book (`ספר`) branches** in `supabase/functions/citation-chat/index.ts` were left untouched. They have three gaps that together produce confident-but-wrong authors:

1. **No source anchoring.** The Perplexity call (lines ~2122 / ~2230) uses bare `sonar` with no `search_domain_filter` and never inspects `citations` / `search_results`. Whatever JSON the model returns is written straight into the hint that is fed to Gemini.
2. **No author verification.** Unlike caselaw (where `partyMismatch` / `anchored.length === 0` now drops `party1/party2`), the article branch has no equivalent — the model's `author` field is trusted verbatim even when no source actually mentions it.
3. **Weak model + weak sources.** `sonar` (not `sonar-pro`) on the open web is exactly the regime where Perplexity confabulates a plausible Israeli legal academic. For "Property and the Human Flourishing" / מאוטנר-style article titles, it picked an adjacent academic from the same field.

The result for the last query: Perplexity returned `author: "אלון חסון"`, the hint reached Gemini as a verified fact, and Gemini emitted it.

## Plan

Mirror the caselaw hardening into the article and book branches. Out of scope: caselaw, legislation, regulation, comment, web, religious branches; `legal-research-v1`; `citation-refill`; `bibliography-lookup`; UI changes beyond surfacing `is_verified`.

### 1. Anchor article/book results to real sources
- Switch the article and book Perplexity calls from `sonar` to `sonar-pro`.
- Add `search_domain_filter` aimed at Hebrew academic legal sources (nevo.co.il, takdin, law.tau.ac.il, law.huji.ac.il, law.biu.ac.il, idc.ac.il / runi.ac.il, colman.ac.il, mishpatim.huji.ac.il, hebrew-lawreview style hosts, books.google.com, jstor.org, ssrn.com, academia.edu, wikipedia.org/he).
- Read `data.search_results` and `data.citations` from the response.

### 2. Title-anchor gate (analogous to the docket-anchor gate)
Build a normalized matcher that requires the article/book **title** (Hebrew, ignoring quotes/punctuation/niqqud) to appear in at least one returned citation URL slug **or** snippet. If `anchored.length === 0`:
- Drop `author`, `year`, `publisher`, `journalName`, `volume`, `firstPage`.
- Emit a hint that forces Gemini to render `[חסר:מחבר]`, `[חסר:שנה]`, etc., instead of inventing them.
- Log `[article] title_anchored=false` / `[book] title_anchored=false`.

### 3. Author cross-check pass
When the title is anchored, run one focused follow-up Perplexity query restricted to the anchored URL(s) asking only: "מי המחבר של המאמר/הספר הזה?" with `response_format` json_schema `{author: string, confidence: "high"|"low"}`. Accept the author only if:
- The follow-up returns the same author as the first call (string-normalized), **and**
- The author string actually appears in at least one citation snippet/URL.

On disagreement → drop the author, set `[חסר:מחבר]`, log `[article] author_mismatch first=… second=…`.

### 4. Tier-2 fallback for articles/books
Add the same `forceOpenWebFallback` path already used for case-number search: if Tier-1 (filtered domains) returns no title-anchored result, retry once with the open web before giving up. Keep the title-anchor gate active on Tier-2 too.

### 5. Honest `is_verified` + telemetry
- Wire `title_anchored && author_confirmed` into the `is_verified` flag written to `citation_history` for article/book outputs (caselaw already does this for parties).
- Add `[article]` / `[book]` log lines for `title_anchored`, `author_confirmed`, `tier`, and the final decision (`accepted` / `dropped_author` / `dropped_all`).

### Files to change
- `supabase/functions/citation-chat/index.ts` — article branch (~lines 2195–2330), book branch (~lines 2098–2193), and the `is_verified` write site.
- Possibly extract the shared "title-anchor + cross-check" logic into a small helper inside the same file (no new files).

### Verification after build
- Re-run the exact failing query and confirm logs show `title_anchored=true` and the returned author either equals מנחם מאוטנר or the output renders `[חסר:מחבר]` rather than אלון חסון.
- Spot-check one known-good article (correct author should still come through unchanged) and one nonsense title (should drop to `[חסר:...]` cleanly).
