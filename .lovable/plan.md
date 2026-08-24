# source_nomination_v1 + verified source cache — architecture diagnosis

Read-only design. No code written. Replaces the previous `authority_nomination_v1` draft.

## 1. Where the current pipeline does each thing

All in `supabase/functions/legal-research-v1/`, orchestrated linearly by `index.ts`:

| concern | location | notes |
|---|---|---|
| analyzer | `stages/claimAnalyzer.ts` (index.ts:361) | claims, legal_area, answer_type, `answer_intent.output_shape` |
| research-mode detection | `stages/researchMode.ts`, consumed at index.ts:770 | modes: canonical_quote, specific_case, statute_section_definition, case_law_synthesis, practical_steps, doctrine_explanation, generic |
| planner | `stages/queryPlanner.ts` (index.ts:497) | mode-aware; emits `query_he` + role + expected_source_type |
| claim/subquestion decomposition | analyzer claims + `stages/claimFacetExpansion.ts` (index.ts:696) | facets with `AREA_LOCKS` |
| query generation | planner + required anchors (index.ts:672) + judgment discovery (`stages/judgmentDiscovery.ts`, index.ts:683) + facets + registry (index.ts:717) | five separate append points, **no merge/budget stage** |
| coreAuthorityRegistry | `stages/coreAuthorityRegistry.ts` | doctrine → canonical case seeding (≤2 queries) + statute-title normalization |
| statute-title normalization | same file, `normalizeStatuteTitles` (index.ts:722) | bounded linguistic rewrite |
| local retrieval | `stages/localRetrieval.ts` (index.ts:766+) | pgvector + text over `legal_documents` / `legal_document_chunks` |
| web retrieval | `stages/perplexityRetrieval.ts` (index.ts:887) | + `perplexityHygiene.ts` |
| candidate pool | `stages/candidatePool.ts` | applies source integrity at admission |
| source integrity | `stages/sourceIntegrity.ts` | tiering, judgment-vs-commentary classification, listing/institutional vetoes |
| body acquisition | `judgmentTextAcquisition.ts`, `statuteTextAcquisition.ts`, `canonicalAuthorityAcquisition.ts`, `specificCaseResolution.ts`, `courtFileUrls.ts`, `pdfExtractionPreflight.ts`, budgets in `retrievalBudget.ts` / `retrievalGovernor.ts` | |
| verifier | `stages/verifier.ts` (index.ts:1357) | per-claim support levels |
| claim-source-match | `stages/claimSourceMatch.ts`, inside `drafterV2` | drops refs whose claim/area don't match the block |
| sufficiency | `stages/sourceSufficiency.ts`, inside `drafterV2` | + `metadataOnlyHoldingGate.ts`, `negativeExistenceGuard.ts` |
| drafter | `stages/drafterV2.ts` (index.ts:1555) | structured blocks |
| footnote builder | `stages/footnoteBuilder.ts` (called from drafterV2) | rendering invariant, renumbering |

**The gap.** The planner answers *"what search strings should we run?"* — it paraphrases doctrine. Nothing in the pipeline answers *"what sources would a competent Israeli legal researcher expect to obtain here?"* The only component that ever names a concrete authority is the hand-maintained doctrine registry, which by construction covers only the doctrines someone typed in. For a question like "כיצד הזהות הלאומית מבוטאת במשפט הישראלי?" the pipeline never forms the intent to look for חוק-יסוד: ישראל — מדינת הלאום, בג"ץ 5555/18 חסון, or the scholarship around them.

## 2. Separate stage, not folded into the planner

Recommendation: **separate stage**, `source_nomination_v1`, running after the planner.

Reasons: different output type (source objects, not query strings); different failure mode (a bad nomination must be droppable without destabilising the query plan); the planner is already mode-conditioned and escalation-governed, and widening its schema risks the existing C1–C5 escalation triggers; and nomination must be independently skippable and independently measurable.

Nominates: statutes, statutory sections, regulations, judgments, doctrines, Knesset MMM research reports, State Comptroller reports, government reports, regulator guidelines, AG/prosecution guidelines, bills and explanatory notes, scholarship, books, chapters, policy papers, comparative sources.

## 3. Model

- **`openai/gpt-5-mini`**, strict JSON tool-call via the existing `lib/openai.ts` helper, `max_completion_tokens` capped (~1500).
- Cost: roughly one extra mini call per run — negligible next to the drafter/verifier calls already in the run.
- Latency: +2–5s. Acceptable against 90–210s runs.
- **Escalate to `openai/gpt-5` once** only when: schema validation fails; or mode is a complex research/memo question **and** nominations come back empty or all below confidence 0.5. Never more than one retry, matching `lib/escalation.ts` discipline.
- **Skip nomination entirely** for: profile E / citation_only, bibliography-only, `canonical_quote` (B8 must stay byte-identical), the fake-docket refusal branch (P02), and pure statute-section definition where required anchors already name the statute.

## 4. Pipeline placement

```text
analyzer → planner → source_nomination_v1 → query_merge_and_budget
  → verified-source cache lookup (identifier-bearing nominations only)
  → retrieval / official discovery (cache misses)
  → body acquisition (existing caps, preflight, extraction ledger)
  → identity / bibliographic validation → cache write
  → candidate pool → source integrity → verifier
  → claim-source-match → sufficiency → drafter → footnote builder
```

Cache lookup: **option A for identifier-bearing candidates** (docket, statute+section, title+author+year, institution+title+date) — checked before any live discovery, because a hit removes a search, up to four fetches and an extraction slot. Nominations with only a `topic_query` and no identifier skip the lookup and go straight into normal retrieval (option B behaviour) — there is nothing stable to key on.

## 5. Nomination output schema

The schema in the request is adopted as-is, with these hardening rules:

- Strict JSON tool schema: every property present in `required`, optional fields nullable rather than omitted, `additionalProperties: false`.
- `docket` may be non-null **only** at `confidence >= 0.8`; below that the model must nominate by party/case name and `topic_query`. A `docket` at lower confidence is stripped deterministically after parsing, not trusted to prompt compliance.
- Same rule for `authors`, `journal_or_publisher`, `year` on scholarship — dropped below threshold rather than passed downstream, so nothing invented can leak into a label.
- `must_verify` is always forced to `true` regardless of model output.
- Nominations carry `nominated_by: "source_nomination_v1"` in candidate metadata all the way through, so a nominated source can never be counted as retrieved evidence by itself, and so telemetry can attribute every citation.

## 6. query_merge_and_budget

A new deterministic stage that becomes the **single** funnel for all five current query-append points (planner, required anchors, judgment discovery, facets, registry) plus nomination.

Behaviour: normalize (whitespace, niqqud, quote marks, Hebrew morphology reuse from `specificCaseIdentity.ts`) → exact dedupe → near-dedupe by token-set similarity → priority sort by question type (§7) → per-mode caps → emit, with a skip reason recorded for everything dropped.

V1 caps: ≤5 nominated sources total; ≤2 judgment candidates to official discovery; ≤2 statute/section; ≤2 scholarship/institutional; ≤4 nomination-added queries; tighter for simple modes; zero for the skip list in §3.

Telemetry: `planner_queries_count`, `nomination_candidates_count`, `nomination_queries_count`, `queries_added_from_nomination`, `queries_skipped_duplicate`, `queries_skipped_low_confidence`, `queries_skipped_budget`, `final_query_count`, `source_type_mix`.

## 7. Source policy by question type

| type | priority | ceiling |
|---|---|---|
| legal rule / holding / standard of review | statutes, regulations, judgments | scholarship + reports background only; no primary authority → limitation notice |
| academic / theoretical | primary law + scholarship | scholarship may be central but never labelled binding |
| policy / empirical / institutional | MMM, State Comptroller, government reports, regulator materials, scholarship | primary law still pulled when doctrine is involved |
| practical / compliance | statutes, regulations, official guidance, regulator pages | |
| comparative | foreign sources only when the question asks for them | never as Israeli binding law |

Enforcement is by existing machinery: `sourceIntegrity` tiers + `claimSourceMatch` area/claim binding + `sourceSufficiency`. Nomination sets `role_in_answer`, which is carried as an additional signal into those gates — it never overrides them.

## 8. `verified_legal_sources` cache — schema

Two service-role-only tables, RLS enabled with no permissive policy, no client access.

`verified_legal_sources` — the field list from the request is adopted verbatim (id, source_category, source_type, authority_type, normalized_docket, case_prefix, canonical_title, party_names[], statute_title, statute_section, authors[], journal_or_publisher, court, institution, year, official_url, source_host, source_kind, language, is_translation, body_text_hash, body_chars, identity_terms_matched[], identity_validated, bibliographic_validated, acquisition_method, status, verified_at, last_success_at, last_used_at, failure_count, last_failure_reason, created_at, updated_at).

Constraints and indexes: unique `(source_category, coalesce(normalized_docket,''), coalesce(statute_title,''), coalesce(statute_section,''), body_text_hash)` for dedupe; btree on `normalized_docket`; btree on `(statute_title, statute_section)`; trigram on `canonical_title`; partial index on `status = 'verified'`; `updated_at` trigger.

`verified_legal_source_texts` — id, source_id (fk cascade), chunk_index, text, source_url, created_at, `embedding vector` **nullable, null in v1**. Unique `(source_id, chunk_index)`.

## 9. Cache runtime behaviour

Lookup keys by category: judgments → normalized docket, else title+party trigram; statutes → title+section; scholarship → title+author+year; reports → institution+title+date.

Hit (`status = 'verified'`, `identity_validated`) → inject stored body/chunks as a candidate, touch `last_used_at`, still run every downstream gate. Miss → official/high-trust discovery → body acquisition under existing caps → validation → write.

Validation before write: judgments need docket/party/court terms inside the body; statutes need title+section text; scholarship needs bibliographic metadata plus abstract/substantive excerpt if relied on substantively; reports need institution/title/date plus body.

Never cached as a body: block/WAF pages, listing pages, metadata-only pages, identity mismatches. Those are recorded as negative rows (`blocked` / `failed` / `identity_mismatch` / `bibliographic_mismatch`) with `failure_count` and a **cooldown** (e.g. 7 days, doubling to a 60-day ceiling) — never permanent suppression, never citable.

Staleness: `verified` → `stale` after 180 days for judgments (still usable when `body_text_hash` exists, revalidated opportunistically); 30 days for statutes and regulator guidance, which change.

## 10. Discovery rules by source type

- **Judgments** — official court/gov hosts first, search by docket *and* case name, parse result URLs instead of guessing archive object codes (the diagnosed root cause of the current 0/5 recall), prefer the Hebrew original, allow official English only marked `official_translation`.
- **MMM / Knesset** — local corpus first, then official Knesset hosts; validate institution/title/date/body.
- **Scholarship** — local corpus first, then university repositories / journal sites / SSRN; no invented bibliographic detail; citation requires reliable metadata, substantive reliance requires body or abstract.
- **Government / regulator** — official domains only; validate title/institution/date.

No broad crawling. No unbounded PDF extraction. No mirror fallback in v1.

## 11. coreAuthorityRegistry disposition

- **Disable landmark-case query seeding** behind a flag (`CASE_SEEDING_MODE = "telemetry_only"`). Keep the doctrine match and `authority_candidates` telemetry so nomination quality can be compared against the old hand list.
- **Keep `normalizeStatuteTitles` active** — bounded linguistic normalization, not case recall.
- **Do not grow the case list. Do not add a URL override table.**
- **Retire `canonicalAuthorityAcquisition.ts` from the run path** once official search-first discovery lands; salvage its per-probe/block-page telemetry into the new discovery stage. Delete nothing yet.

## 12. Guardrails (unchanged)

Nomination is never citation. No citation without body/substantive text or category-appropriate reliable bibliographic metadata. No holding from metadata-only or listing-only sources. No fabricated docket in a final answer. Scholarship and MMM reports are never binding law. Legal-rule questions with only secondary sources produce the Hebrew limitation notice. P02 fake-docket refusal, R02 exact-body, B8 byte-identical quote all intact. No crawling, no unbounded extraction, no loosening of verifier / source-integrity / drafter / footnote gates.

## 13. Cost impact

Per run: +1 mini call, plus up to 4 extra bounded queries. Cache hits *reduce* cost — each removes a search, 1–4 fetches, and one extraction slot (the scarce resource that has been killing runs). Storage: 500 cached sources ≈ 50–100 MB of text. Embeddings deferred; if added later, ~15k chunks is a few cents one-off.

## 14. Minimal v1 implementation plan

1. Migration: the two tables, indexes, `updated_at` trigger, service-role grants, RLS with no permissive policy.
2. `stages/sourceNomination.ts` — mini call, strict schema, deterministic post-parse hardening (confidence thresholds, docket/author stripping, `must_verify` force).
3. `stages/queryMergeAndBudget.ts` — funnels all six query producers, dedupe, priority, caps, skip telemetry.
4. `stages/verifiedSourceCache.ts` — `lookup`, `recordSuccess`, `recordFailure`, chunking, hashing, staleness, cooldown.
5. `stages/officialSourceDiscovery.ts` — search-first, per-category host allowlists, reusing acquisition + preflight + block-page classification.
6. Validation hooks: identity validation reusing `specificCaseIdentity.ts`; bibliographic validation for scholarship/report categories.
7. `coreAuthorityRegistry`: case seeding to telemetry-only; statute normalization kept.
8. `index.ts` wiring + telemetry blocks `source_nomination`, `query_merge`, `verified_source_cache`.

Deferred: embeddings and semantic cache lookup, book/chapter acquisition, comparative-source discovery beyond nomination, admin UI over the cache, mirror fallback, extraction-priority reordering (revisit only if cache hits don't already relieve the extraction budget).

## 15. Validation plan

Set: A–F from the request, D1–D6, MAYA, MAYA-AMIR, R02, P02, B8, NOISE. Sequential runs only. Cold pass (empty cache) then warm pass (populated).

Per run record: planner queries; nominations and their categories; filtered nominations; added queries; cache hits/misses; discovery attempts and URLs; body acquired; identity/bibliographic result; cache writes; warm-pass reuse; sources cited; role respected; `citations_without_body_acquired`; metadata-only holdings; runtime/cost delta; CPU/stale/stub/verifier failures.

Acceptance: broad questions nominate plausible sources unprompted; more than case law nominated where appropriate; MMM/institutional reports nominated for policy questions; no nominated source cited without acquisition and validation; no invented docket in any answer; no scholarship or report treated as binding law; cache writes only verified sources; warm pass reuses cache and runs faster; P02/R02/B8 intact; zero metadata-only holdings, CPU kills, stale jobs, stubs, dangling markers, orphan rows or verifier failures.
