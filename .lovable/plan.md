
## What you asked

For בג״ץ 4769/24 the engine returned:
> בג"ץ 4769/24 **התנועה למען איכות השלטון בישראל** נ' **היועצת המשפטית לממשלה** (אר"ש 26.6.2025).

The real parties are **משמר הדמוקרטיה הישראלית נ' ועדת השרים לענייני חקיקה**. Three earlier runs of the same docket returned `[חסר: שמות צדדים]` (good), then this one slipped through (bad).

## Where Perplexity is searching today (citation-chat / case-number branch)

1. **Tier-1** — `sonar-pro` with `search_domain_filter = [nevo.co.il, court.gov.il, supreme.court.gov.il, takdin.co.il, lite.takdin.co.il, psakdin.co.il]`. Hebrew system prompt asks for `{party1, party2, date, court, isPublished, padi_*, databaseName, year, confidence}`.
2. **Tier-2 open-web fallback** — only fires if (a) env flag `CITATION_CHAT_OPENWEB_FALLBACK=on` AND (b) Tier-1 returned 0 trusted citations. Gated by a docket-anchor check: ≥1 trusted URL must reference the docket (via `urlContainsDocketVia`: plain `NUM/YY`, supreme `HebrewVerdicts/YY/sec/first/`, supreme `NetVerdicts/...-YYYY-x-NUM-…`, or supreme filename `YY{first}{second}.ext`). **This flag is currently OFF in prod, so Tier-2 didn't run for 4769/24.**
3. **Secondary calls** if Tier-1 succeeded: `verifyPadiPublication` (PADI volume / page double-check), `reconcilePublishedDate` (real decision date for published cases).
4. `partyLookup.ts` exists as a batched backfill helper, but it's used by `legal-research-v1`, **not** by `citation-chat`.

## Guards already in place on the final output

- **Tier-2 docket anchor** — rejects open-web Tier-2 unless a trusted URL contains the docket.
- **`databaseName` normalization** — derived from the citation hostnames (`lite.takdin → תקדין`, `supremedecisions → אר״ש`, etc.), so free-form model strings get overridden.
- **PADI override sanity** — overriding to "published" needs known volume + year-in-window + docket-in-citation.
- **Party–source agreement check** — when the model returns parties, the code keeps only the `search_results` whose URL `urlContainsDocket(docket)` and then requires either both parties in that anchored snippet/title, or one party within 40 chars of a caption marker (`נ׳ / נגד / העותרים / המשיבים / …`). On failure → drops parties, renders `[חסר: שמות צדדים]`.
- **Data-quality gate** — empty/placeholder fields are rejected.

## What caused the wrong parties on 4769/24

The party–source agreement check has a silent loophole. In `citation-chat/index.ts` ~lines 1284–1330:

```text
anchored = search_results.filter(r => urlContainsDocket(r.url, docketAnchor))
if (anchored.length === 0) {
  partyVerification = "no_anchor";        // ← just sets the label
  // partyMismatch stays false, party1/party2 are NOT dropped
} else {
  // require BOTH parties in anchored snippet OR caption-marker proximity
  // otherwise drop parties → [חסר: שמות צדדים]
}
```

So when Perplexity returns a result set whose URLs do **not** contain the docket in any recognized encoding (e.g. a `court.gov.il` search-results page, an opinion PDF with a non-standard filename, or only `nevo.co.il/Login`-style landing pages), the anchor list is empty, the guard skips entirely, and **whatever the model wrote in `party1/party2` is accepted verbatim**. Perplexity then confabulated parties from a different real petition by the same well-known petitioner (התנועה לאיכות השלטון has dozens of HCJ filings), and it shipped.

Three other 4769/24 runs returned `[חסר:…]` because the data-quality gate caught empty parties — the failure mode here is specifically *confident hallucinated* parties paired with no anchored URL.

Secondary contributors:
- `caseLawOverrideLabel = "פסיקה (מאגר)"` was forced because the same model said `isPublished: false`, which is also wrong: HCJ 4769/24 is reported on supremedecisions / אר״ש; if anchored URLs had matched, `normalizeDatabaseName` would still be correct, but the date `26.6.2025` likewise came from the hallucinated branch.
- Tier-2 is off, so when Tier-1's authoritative search returns nothing useful for this docket, there's no second engine to cross-check against open-web sources.

## What still needs to be done

### 1 — Close the `no_anchor` loophole (critical, small)
In `citation-chat/index.ts`, treat `anchored.length === 0` exactly like `insufficient_snippet`: set `partyMismatch = true`, clear `party1/party2`, set `confidence = "low"`. Also clear `date`, `court`, `isPublished` and `databaseName` derived from non-anchored sources for the same reason — none of those facts were grounded in a URL that even mentions this docket.

### 2 — Require a docket anchor on Tier-1, not only Tier-2
The Tier-1 result is currently accepted with no anchor requirement at all. Add the same docket-anchor gate (`anyUrlContainsDocketVia(citations ∪ search_results, docketAnchor)`) to Tier-1. On miss: drop all model-supplied facts and fall through to:

### 3 — Enable Tier-2 fallback by default for the case-number branch
`CITATION_CHAT_OPENWEB_FALLBACK=on` is already wired with the docket-anchor gate. Flip it on for the case-number branch only (keep current behavior elsewhere). This buys recall for cases that supremedecisions hosts under non-standard URLs.

### 4 — Add a cross-source confirmation pass before persisting parties
Before writing parties into `caseLawHint`, run a focused re-query on the single anchored URL (or call `verify-case-fulltext` which already exists for the "סיכום פסיקה" feature) and require the returned parties to appear in the official document text. If the two passes disagree → drop parties.

### 5 — Honest "verified" flag in `citation_history`
`is_verified` is currently `false` for all four 4769/24 rows. Wire the anchor + cross-source result into `is_verified` so the UI can visibly mark unverified outputs and prompt the user.

### 6 — Telemetry on the failure mode
Log a structured `[case-law]` event when parties are dropped due to `no_anchor` vs `insufficient_snippet` vs `caption_marker_only`, so we can measure how often this fires after the fix and whether Tier-2 actually rescues cases.

### Out of scope of this plan
- Changes to `legal-research-v1` perplexity stages (`perplexityRetrieval.ts`, `queryPlanner.ts`, `verifier.ts`).
- Changes to `citation-refill`, `bibliography-lookup`, or the `partyLookup` helper.
- UI work beyond surfacing `is_verified` in the citation history row.

## Technical reference

Files involved:
- `supabase/functions/citation-chat/index.ts` — case-number branch lines 1224–1456 (the guard to fix), 1334–1399 (PADI verify), 1401–1412 (date reconcile + DB normalize).
- `supabase/functions/_shared/trustedHosts.ts` — `urlContainsDocketVia` channels (`plain`, `supreme_hebrew_verdicts`, `supreme_net_verdicts`, `supreme_filename`).
- `supabase/functions/verify-case-fulltext/index.ts` — already does PDF/DOCX fetch + party extraction for HCJ dockets; can be reused as the cross-source confirmer.
- `supabase/functions/_shared/partyLookup.ts` — reference implementation of strict batched party lookup with trusted-domain filter (already used by `legal-research-v1`).
