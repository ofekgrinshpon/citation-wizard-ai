# authority_nomination_v1 + verified authority cache

Direction change: stop growing a hand-maintained landmark-case list. Nominate authorities dynamically, search official sources for them, validate identity inside the acquired body, and remember what worked in a persistent verified-authority cache.

## 1. Landmark-case registry seeding: disable, don't delete

- `coreAuthorityRegistry.ts` currently does two things: doctrine → canonical case seeding, and statute-title normalization. They get split.
- **Case seeding → telemetry-only.** Keep the doctrine match and the `authority_candidates` telemetry, but stop appending case-name queries to the plan (`queries_added` becomes 0 for case authorities). Flag: `CASE_SEEDING_MODE = "telemetry_only"`. Keeps the D1–D6 comparison baseline readable without a code delete.
- **Statute-title normalization stays on.** It is a bounded linguistic normalization layer (informal name → official title), not case recall.
- **`canonicalAuthorityAcquisition.ts` (the type=4 / archive-probe lane) is retired from the run path** once nomination + official search is live. Its per-probe telemetry helpers move into the new discovery stage. No manual 20-URL fallback table is introduced.

## 2. Verified authority cache — schema

Two tables in the backend, written only by the edge function (service role), read by it too. No client access.

**`verified_legal_authorities`**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| authority_type | text | `judgment` \| `statute` |
| normalized_docket | text | canonical `prefix/number/year` form, null for statutes |
| case_prefix | text | בג"ץ / ע"א / עה"ס … |
| canonical_title | text | recovered from body, not from search snippet |
| party_names | text[] | |
| court | text | |
| year | int | |
| official_url | text | the URL the body actually came from |
| source_host | text | |
| source_kind | text | `official_court` \| `official_translation` \| `official_gov` \| `high_trust_mirror` |
| language | text | `he` \| `en` |
| is_translation | bool | |
| body_text_hash | text | sha-256 of normalized body |
| body_chars | int | |
| identity_terms_matched | text[] | docket / party / court tokens found inside the body |
| identity_validated | bool | only `true` rows are citable |
| acquisition_method | text | `official_search` \| `exact_body` \| `local_corpus` \| `other` |
| status | text | `verified` \| `stale` \| `failed` \| `blocked` \| `identity_mismatch` |
| verified_at / last_success_at / last_used_at | timestamptz | |
| failure_count | int | |
| last_failure_reason | text | |
| created_at / updated_at | timestamptz | updated_at trigger |

Indexes: unique `(authority_type, normalized_docket, body_text_hash)` for dedupe; btree on `normalized_docket`; trigram on `canonical_title` for title/party lookup; partial index on `status = 'verified'`.

**`verified_authority_texts`** — `id`, `authority_id` fk cascade, `chunk_index`, `text`, `source_url`, `created_at`, and `embedding vector(1536)` **nullable and left null in v1**. Unique `(authority_id, chunk_index)`.

Grants: `service_role` only (no anon/authenticated grants), RLS enabled with no permissive policy — the function reaches it through service role, the client never does.

## 3. Runtime flow

```text
claims/facets
  └─ authority_nomination_v1        → candidate authorities (statute+section, docket, doctrine)
       └─ cache lookup              → normalized_docket, then title/party trigram
            ├─ hit (verified)       → inject cached body/chunks as a candidate; touch last_used_at
            └─ miss                 → official search-first discovery (bounded, official hosts only)
                 └─ acquire body    → existing caps, PDF preflight, extraction ledger
                      └─ identity validation inside body (docket + party/court tokens)
                           ├─ pass  → inject candidate + write cache row + chunks
                           └─ fail  → write status row (blocked/identity_mismatch/failed), no cache body
```

Everything injected — cached or fresh — then flows through the unchanged gates: source-integrity, verifier, claim-source-match, sufficiency, metadata-only-holding.

Cache-entry rules: never write block pages, listing pages, metadata-only pages, or identity-mismatch bodies. Negative outcomes are recorded as status rows with `failure_count` so a repeatedly blocked docket is skipped early (cheap negative caching) but never cited. `verified` rows go `stale` after 180 days and are re-validated on next use.

## 4. Guardrails (unchanged invariants)

- A nomination is never a citation. Citation requires body/substantive text plus `identity_validated`.
- No holding from metadata-only or listing-only sources.
- No broad crawling: discovery is search-first against an allowlist of official hosts, capped at N queries and M fetches per run inside the existing retrieval governor budget.
- No unbounded PDF extraction — existing preflight and extraction ledger apply to cache-miss paths; cache hits cost zero extraction.
- P02 (fake docket → refusal), R02 (exact body), B8 (byte-identical canonical quote) must be unchanged.

## 5. Cost impact

- Storage: a Hebrew judgment body is ~40–300 KB. 500 cached authorities ≈ 50–100 MB of text — negligible on the current plan.
- Embeddings: **skipped in v1.** The column exists but stays null; lookup is by docket/title, and retrieval reuses the stored body directly. If added later, ~500 authorities × ~30 chunks ≈ 15k embeddings, a one-off cost of a few cents.
- Savings: each cache hit removes 1 search + 1–4 fetches + one extraction slot from the run — this is the main win, since extraction slots are the scarce resource that has been killing runs.
- Dedupe by `(normalized_docket, body_text_hash)` prevents duplicate bodies when the same judgment is reached via different URLs.

## 6. Minimal v1 implementation scope

1. Migration: the two tables, grants, RLS, updated_at trigger, indexes.
2. `stages/authorityNomination.ts` — from claims/facets, propose statutes+sections and judgment candidates (docket and/or party-name form) with confidence and area; caps per run; full telemetry.
3. `stages/verifiedAuthorityCache.ts` — `lookup()`, `recordSuccess()`, `recordFailure()`, chunking, hashing, staleness.
4. `stages/officialJudgmentSearch.ts` — search-first discovery over official hosts, reusing existing acquisition + preflight + block-page classification; replaces the archive-guessing lane.
5. Identity validation inside the body, reusing `specificCaseIdentity.ts` matchers.
6. `coreAuthorityRegistry.ts`: case seeding flag-off (telemetry-only), statute normalization retained.
7. `index.ts` wiring + telemetry block `authority_nomination` / `verified_authority_cache` (hit/miss/write/reject counts).

Not in v1: embeddings, statute caching beyond metadata, admin UI over the cache, cross-project sharing.

## 7. Validation plan

Sequential, no parallel runs.

- Cold pass D1–D6 (empty cache): record nominations, discovery attempts, bodies acquired, identity outcomes, cache writes, footnotes, runtime, terminal status.
- Warm pass D1–D6 (populated cache): expect cache hits, lower runtime, zero extraction on hits, identical-or-better footnote quality.
- Controls: R02 exact body still resolves; P02 fake docket still gives the deterministic refusal with zero cache writes; B8 quote byte-identical; NOISE triggers no nomination-driven fetch.

Acceptance: every run terminal, no CPU kills; ≥1 canonical judgment body acquired and cited across D1–D6 where one exists (today: 0); zero dangling markers, zero orphan rows, zero metadata-only holdings; zero cached rows that are block/listing/mismatch pages; warm-pass runtime lower than cold.
