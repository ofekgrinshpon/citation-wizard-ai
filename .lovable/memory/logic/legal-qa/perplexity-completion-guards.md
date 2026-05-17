---
name: Perplexity Completion Guards (Stage E.5)
description: Two-guard model for Stage E.5 — citation-shape regex + URL allowlist; TRUSTED_LEGAL_DOMAINS capped at 20 (Perplexity hard limit on search_domain_filter)
type: feature
---

Stage E.5 (Perplexity completion) fires when `coreSources.length < 2` after local source-pack assembly in `taskMode === "research"`. Candidates from `sonar-pro` must clear TWO guards in `validatePerplexityCandidate` (`supabase/functions/legal-qa/index.ts`):

1. **Citation-shape regex** — `STATUTE_CITATION_RE` (ס"ח/ק"ת + digit + Hebrew year) and `CASE_NUMBER_RE` (court prefixes + `\d+/\d+`).
2. **URL allowlist** — `isTrustedLegalUrl` matches against `TRUSTED_LEGAL_DOMAINS` (exact host or subdomain).

### CRITICAL: 20-domain cap on TRUSTED_LEGAL_DOMAINS

Perplexity's `search_domain_filter` has a **hard limit of 20 entries**. Exceeding it returns `400: search_domain_filters has a max length of 20` and kills the entire Perplexity call — Stage E.5 returns 0 candidates. **Never add a 21st domain** without removing one first.

The same list is also used as the URL-allowlist guard (Guard 1). Subdomains match automatically, so collapse where possible (`knesset.gov.il` covers `main.*` and any other subdomain; `takdin.co.il` covers `lite.takdin.*`; `ssrn.com` covers `papers.ssrn.com`).

### Current 20-domain list

`CASELAW_DOMAINS` (7) — judgment DBs only, also used by case disambiguation + verify-case-fulltext:
nevo.co.il, supreme.court.gov.il, supremedecisions.court.gov.il, takdin.co.il, lite.takdin.co.il, psakdin.co.il, din.org.il.

`TRUSTED_LEGAL_DOMAINS` (20 = CASELAW_DOMAINS + 13):
- Legislation: knesset.gov.il, main.knesset.gov.il, reshumot.gov.il, justice.gov.il
- Regulators: mevaker.gov.il, competition.gov.il, privacy.org.il, tax.gov.il, mof.gov.il
- Think tanks: idi.org.il, kohelet.org.il, vanleer.org.il, taubcenter.org.il, inss.org.il
- Academia / Jewish law: ssrn.com, jstor.org, scholar.google.com, daat.ac.il, hebrewbooks.org, sefaria.org

**Intentionally NOT in the list** (subdomains covered by parent, or removed to stay under cap):
- `fs.knesset.gov.il` — bill drafts; not currently in list (removed to fit cap; subdomain matching by `knesset.gov.il` may catch it depending on Perplexity's behavior).
- `tau.ac.il`, `huji.ac.il` — Israeli law-school journals; removed to fit cap. Article retrieval still happens via local DB + ssrn.com.
- `court.gov.il` (broad) — returns mostly press releases (spokmanship_court paths), not judgments. Use `supreme.court.gov.il` + `supremedecisions.court.gov.il`.

Note: there is intentionally **no `verified_sources` cross-check** — that table is user-saved citations, not an authority registry.

Validated candidates are promoted to `sourceCards`/`sourcePack` with `provenance: "perplexity_completion"`, `usable_for_analysis: false`, `usable_for_citation: true`, `anchor_present: true`. `mapAuthorityClass` routes them to `primary_legislation` / `primary_caselaw` so they bucket into `core` before Stage D.

Telemetry: `qa_logs.metadata.retrieval_funnel.perplexity_completion` records `triggered`, `core_before`, `core_after`, `candidates_returned`, `candidates_kept`, drop reasons (`statute_citation_shape`, `missing_hebrew_year`, `caselaw_case_number_shape`, `url_not_allowlisted`, `unknown_type`), plus Milestone C engine fields (`engine_resolved_count`, `engine_unresolved_count`, `engine_drop_reasons`).

**Keep in sync:** `verify-case-fulltext/index.ts:319` mirrors `CASELAW_DOMAINS` manually (separate edge function, no shared import).
