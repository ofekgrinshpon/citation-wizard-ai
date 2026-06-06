# Plan — Tier-2 open-web fallback in `citation-chat` (Variant B)

Shipped: flag-gated, off by default.

## Source hierarchy (intentional, do not collapse)

- **Tier 1** = current behaviour with `search_domain_filter` over high-authority Israeli legal/court/database sources only. Unchanged.
- **Tier 2** = single retry with the SAME prompt minus `search_domain_filter`, then post-hoc trust gate over `TRUSTED_LEGAL ∪ TRUSTED_PUB`. Fires only when Tier-1 returns zero trusted citations. Never invoked when Tier-1 succeeds — preserves source authority and avoids near-neighbor substitution (e.g. Barak title drift seen in the experiment).
- **No Tier 3.** Open web without trust gate is rejected for production.

## Flag

- `CITATION_CHAT_OPENWEB_FALLBACK` env var on the `citation-chat` function. `"on"` enables Tier-2; anything else (including unset) disables it. Default = off, so the deploy is behaviour-identical to today until the flag is flipped.

## Trust gate

`supabase/functions/_shared/trustedHosts.ts`:
- `TRUSTED_LEGAL` — nevo, court.gov.il + subdomains, supremedecisions, takdin/lite.takdin, psakdin, din.org.il, knesset.gov.il, reshumot.gov.il, gov.il.
- `TRUSTED_PUB` — curated academic/policy hosts: TAU/HUJI/BIU/Haifa/IDC/Colman/Mishpat faculty & journals, IDI, NLI, knesset publishing subdomains, SSRN.
- Explicit exclusions: Wikipedia, Scribd, img.mako.co.il, a7.org, lawprofsforum, law-firm blogs, podcasts.
- `isTrustedHost`, `countTrustedCitations`, `untrustedHosts` helpers.

## Wired call sites in `citation-chat/index.ts`

Wrapped with `perplexityWithFallback`:
1. Case-number search (`sonar-pro`, allowlist).
2. Party-name search (`sonar-pro`, allowlist).

Deliberately NOT wrapped (kept strictly Tier-1):
- `verifyDecisionDate` — already-identified case, must not pull academic substitutes.
- PADI publication re-verification (both call sites) — same reason; near-neighbor substitution is exactly what we're avoiding.

Out of scope (currently no allowlist, already open-web with no trust gate — separate decision):
- Legislation / regulation / book / article free-form searches.

## Validators preserved

- Case-law `pub-guard` (year-vs-docket, trusted-pub URL check, halfPub) still runs over any Tier-2 result.
- `reconcilePublishedDate` still runs.
- Party-lock + spacing instructions still injected.
- No relaxation of the existing JSON validation paths.

## Telemetry

Per-request console logs include:
- `tier` (`tier1` | `tier2_openweb_fallback`)
- `tier1_trusted`, `tier2_fired`, `tier2_trusted`
- `tier2_dropped_hosts` (untrusted hosts the gate refused to admit)

## Rollback

Unset `CITATION_CHAT_OPENWEB_FALLBACK`. No code revert needed.

## Untouched

`legal-qa`, `legal-research-v1`, `citation-refill`, `bibliography-lookup`, `case-law-search`, citation engine (`citationEngine.ts`/`citationResolver.ts`), article validator, React app.

---

# Addendum — Tier-2 fallback in `citation-refill` (footnote section)

Shipped: flag-gated, off by default. Independent flag, independent rollout.

## Flag

- `CITATION_REFILL_OPENWEB_FALLBACK` env var on `citation-refill`. `"on" | "true" | "1" | "enabled"` (trimmed/case-insensitive) enables Tier-2; anything else disables it.

## Behaviour

- Tier-1 unchanged: same `sonar-pro` call with `search_domain_filter = ALLOWED_DOMAINS`.
- Tier-2 fires only when Tier-1 returns no trusted citations OR no content.
- Tier-2 retries the SAME prompt without `search_domain_filter`, then trust-gates citations against `TRUSTED_LEGAL ∪ TRUSTED_PUB`.
- **Docket-anchor gate (refill-specific)**: if the input has a docket, at least one TRUSTED Tier-2 citation URL must literally contain that docket (`urlContainsDocket`) — otherwise Tier-2 is discarded and Tier-1's (empty) result stands. This protects against Barak-style near-neighbor substitution that the citation-chat plan worried about.
- For non-docket inputs (bibliographic refill), trust gate alone is enough.

## Validators preserved

- `urlContainsDocket` party-anchor check still runs on the final accepted output.
- Docket-change rejection still runs (model cannot silently substitute one docket for another).
- Sanitised-input fallback on `verified: false` unchanged.

## Telemetry

Per-request console log line includes:
`tier`, `tier1_trusted`, `tier2_fired`, `tier2_trusted`, `tier2_dropped_hosts`, `docket_only`.

## Rollback

Unset `CITATION_REFILL_OPENWEB_FALLBACK`. No code revert needed.
