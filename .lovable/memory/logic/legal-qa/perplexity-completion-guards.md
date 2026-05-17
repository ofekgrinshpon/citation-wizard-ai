---
name: Perplexity Completion Guards (Stage E.5)
description: Two-guard model for Stage E.5 candidates — citation-shape regex + URL allowlist (TRUSTED_LEGAL_DOMAINS, 30+ domains across caselaw/legislation/regulators/think tanks/academia); CASELAW_DOMAINS subset for disambiguation
type: feature
---

Stage E.5 (Perplexity completion) fires when `coreSources.length < 2` after local source-pack assembly in `taskMode === "research"`. Each candidate returned by `sonar-pro` must clear TWO guards in `validatePerplexityCandidate` (`supabase/functions/legal-qa/index.ts`):

1. **Citation-shape regex** — `STATUTE_CITATION_RE` (ס"ח/ק"ת + digit + Hebrew year) and `CASE_NUMBER_RE` (court prefixes + `\d+/\d+`).
2. **URL allowlist** — `isTrustedLegalUrl` matches against `TRUSTED_LEGAL_DOMAINS` (exact host or subdomain).

### Two exported lists (legal-qa/index.ts)

`CASELAW_DOMAINS` — judgment DBs only, used for case disambiguation + verify-case-fulltext:
nevo.co.il, supreme.court.gov.il, supremedecisions.court.gov.il, takdin.co.il, lite.takdin.co.il, psakdin.co.il, din.org.il.

`TRUSTED_LEGAL_DOMAINS` — wide allowlist (caselaw + everything else), used for Source Pack / Stage E.5 / all wide Perplexity calls. Includes CASELAW_DOMAINS plus:
- Legislation: knesset.gov.il, main.knesset.gov.il, fs.knesset.gov.il, reshumot.gov.il, justice.gov.il
- Regulators: mevaker.gov.il, competition.gov.il, privacy.org.il, tax.gov.il, mof.gov.il
- Think tanks: idi.org.il, kohelet.org.il, vanleer.org.il, taubcenter.org.il, inss.org.il
- Academia: huji.ac.il, tau.ac.il (covers mishpatim.tau.ac.il), ssrn.com (covers papers.ssrn.com), jstor.org, scholar.google.com
- Jewish law: daat.ac.il, hebrewbooks.org, sefaria.org

**`court.gov.il` (broad) was intentionally removed** — it returned mostly press releases (spokmanship_court paths), not actual judgments. Use `supreme.court.gov.il` + `supremedecisions.court.gov.il` for Supreme Court rulings.

Note: there is intentionally **no `verified_sources` cross-check** — that table is user-saved citations, not an authority registry.

Validated candidates are promoted to `sourceCards`/`sourcePack` with `provenance: "perplexity_completion"`, `usable_for_analysis: false`, `usable_for_citation: true`, `anchor_present: true`. `mapAuthorityClass` routes them to `primary_legislation` / `primary_caselaw` so they bucket into `core` before Stage D.

Telemetry: `qa_logs.metadata.retrieval_funnel.perplexity_completion` records `triggered`, `core_before`, `core_after`, `candidates_returned`, `candidates_kept`, drop reasons (`statute_citation_shape`, `missing_hebrew_year`, `caselaw_case_number_shape`, `url_not_allowlisted`, `unknown_type`), plus Milestone C engine fields (`engine_resolved_count`, `engine_unresolved_count`, `engine_drop_reasons`).

**Keep in sync:** `verify-case-fulltext/index.ts:319` mirrors `CASELAW_DOMAINS` manually (separate edge function, no shared import).
