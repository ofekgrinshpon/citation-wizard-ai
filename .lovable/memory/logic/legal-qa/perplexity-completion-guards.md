---
name: Perplexity Completion Guards (Stage E.5)
description: Two-guard model for validating Stage E.5 Perplexity completion candidates — citation-shape regex + URL allowlist; NO verified_sources cross-check
type: feature
---

Stage E.5 (Perplexity completion) fires when `coreSources.length < 2` after local source-pack assembly in `taskMode === "research"`. Each candidate returned by `sonar-pro` (json_schema mode) must clear exactly TWO guards in `validatePerplexityCandidate` (`supabase/functions/legal-qa/index.ts`):

1. **Citation-shape regex** — Hebrew-aware patterns:
   - `STATUTE_CITATION_RE` matches `ס"ח` or `ק"ת` + digit; statutes additionally require `HEBREW_YEAR_RE` (`התש...` form) in either citation or `year_hebrew`.
   - `CASE_NUMBER_RE` matches standard court prefixes (בג"ץ, ע"א, רע"א, דנ"א, תפ"ח, עע"מ, etc.) + `\d+/\d+`.
2. **URL allowlist** — `isTrustedLegalUrl` must accept the host against `TRUSTED_LEGAL_DOMAINS` (nevo.co.il, takdin.co.il, court.gov.il, knesset.gov.il, justice.gov.il, mishpatim.tau.ac.il, idi.org.il, etc.).

There is intentionally **no `verified_sources` cross-check**. `verified_sources` is a user-saved citations table — not an authority registry — so requiring a match would drop legitimate primary sources nobody has saved yet. Valid Israeli citation shape + allowlisted official-domain URL is sufficient evidence for citation-only anchoring.

Validated candidates are promoted to `sourceCards`/`sourcePack` with `provenance: "perplexity_completion"`, `usable_for_analysis: false`, `usable_for_citation: true`, `anchor_present: true`. The pack is re-assembled via `assembleSourcePack` so they bucket into `core` before Stage D (claim map). `mapAuthorityClass` in `legalSourcePack.ts` routes them to `primary_legislation` / `primary_caselaw` based on `completionType`, bypassing the URL fallback.

Telemetry: `qa_logs.metadata.retrieval_funnel.perplexity_completion` records `triggered`, `core_before`, `core_after`, `candidates_returned`, `candidates_kept`, drop reasons (`statute_citation_shape`, `missing_hebrew_year`, `caselaw_case_number_shape`, `url_not_allowlisted`, `unknown_type`), and a debug preview of up to 5 candidates.
