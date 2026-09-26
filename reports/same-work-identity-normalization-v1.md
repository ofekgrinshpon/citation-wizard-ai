# Scholarly same-work recovery — decorated-title normalization + bounded original-work enrichment

## Root cause (confirmed)
Live run `1d833e16-e4e3-4e22-859b-cc37c9ad84d3`: `law.haifa.ac.il/.../b2_6.pdf` returned a WAF HTML block page (HTTP 200) → `unusable_body`. Same-work recovery triggered correctly, but the original work's identity was the raw discovery string
`"זכויות יוצרים ותחרות – משוק עותקים למשטר רישוי | ניבה אלקין-קורן (כרך ב)"` — a title with no structured author. Result: 6 candidates seen, 5 rejected `title_only_insufficient`, 0 equivalent, 0 fetch attempts, candidate enrichment never eligible (decorated title failed the similarity gate).

## Files changed
- `supabase/functions/legal-research-v2/shared/decoratedTitle.ts` (new) — `splitDecoratedScholarlyTitle()`
- `supabase/functions/legal-research-v2/tools/sameWorkRecovery.ts` — identity building, `enrichOriginalIdentity()`, telemetry, stats folding
- `supabase/functions/legal-research-v2/agent/researchAgent.ts` — records normalization diagnostics into run stats
- `src/test/decoratedTitleIdentity.test.ts` (new) — T1–T7

## Normalization logic (deterministic, conservative)
- Splits **only** on an unmistakable separator: `|` / `｜`. Never on hyphens, en-dashes, colons, commas.
- The suffix becomes `authors` only if it parses as a personal name: 2–3 tokens, letters plus `' . ‑ ־` only; no digits/@/URLs; no venue words (journal, review, press, university, repository, PDF, download…); no function words; Latin tokens capitalized; rejected by the existing `isGarbageAuthorValue`.
- Volume/issue decorations (`(כרך ב)`, `חלק`, `מהדורה`, `Vol. 2`, `no.`, `part`, bare years 1900–2099) are stripped only inside the bibliographic suffix. A pure volume suffix is removed without inventing an author.
- The core title must stay usable (≥8 chars, ≥3 words), otherwise the raw title is returned unchanged.
- Intentionally unsupported: bylines with no `|` ("Title — by Author"), comma-separated multi-author suffixes, "Author, Title" order, single-token surnames.

## Original-work identity enrichment
Runs at most **once per failed work**, before query building, and only when the original has a usable title but no author, year and DOI, and a metadata dependency exists. One `fetchTitleMetadata` call (Crossref / OpenAlex via the existing abstraction). Fields are accepted only when `titleSimilarity(original.title, result.title) >= MIN_TITLE_SIMILARITY` (0.7, unchanged). Adds authors (≤6), year, journal, DOI with provenance. Ambiguity, mismatch, error or empty result → identity unchanged; the run never fails.

## Trust invariants preserved
`isSameWork()` unchanged. `MIN_TITLE_SIMILARITY` unchanged. Metadata and search results are identity, never evidence — nothing is quotable, citable or storable from them. Hints still excluded from equivalence. Alternative copies still pass the ordinary `runFetch` / document / span / support verification path. No host-specific code, no allowlists, no paywall bypass.

## Telemetry (diagnostic only)
`same_work_original_title_raw`, `_title_normalized`, `_author_from_title`, `_enrichment_attempted`, `_enrichment_success`, `_fields_after_enrichment`, `_field_provenance`; per-round `original_enrichment_*` on the recovery telemetry.

## Verification
T1–T7 pass (8 tests). Full suite: **1184 tests / 100 files passed**. Typecheck and build clean. `legal-research-v2` deployed.
