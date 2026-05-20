# Deliverable 4 — Ledger

Plan mode is active, so I'm presenting this as a plan. Approve to switch to build mode and execute.

## Scope

Build the Ledger stage only. No drafter, no citation pass. Input = `RetrievalResult` + `VerificationResult` from the 3 pilots already on disk.

## New file: `supabase/functions/legal-qa/core/ledger.ts`

### Public API

```ts
buildLedger(args: {
  plan: PlanV1;
  retrieval: RetrievalResult;
  verification: VerificationResult;
}): LedgerResult
```

### Types (added to `core/types.ts`)

```text
LedgerSourceId      = `ls-${number}`
LedgerSource        = { ledger_source_id, candidate_id, claim_id, origin,
                        support: "direct" | "partial",
                        document_id?, url?, normalized_key,
                        title, citation, snippet, source_type,
                        is_primary: boolean }
LedgerClaim         = { claim_id, text, status: "supported" | "hedged",
                        direct_count, partial_count,
                        sources: LedgerSource[] }
LedgerResult        = { claims: LedgerClaim[],          // supported + hedged only
                        unsupported_claim_ids: ClaimId[],
                        unresolved_authority_ids: AuthorityId[],
                        totals: { supported, hedged, unsupported,
                                  sources, primary_sources, secondary_sources,
                                  by_origin: Record<CandidateOrigin, number> },
                        invariants: {
                          unresolved_authorities_in_ledger: number,  // must be 0
                          tangential_or_unrelated_in_ledger: number, // must be 0
                          duplicates_dropped: number },
                        duration_ms }
```

### Algorithm

```text
1. Build claim → verdicts map from verification.per_claim.
2. For each plan.claim:
   a. Keep only verdicts where support ∈ {direct, partial}.
   b. direct_count = #direct, partial_count = #partial.
   c. status:
        direct_count >= 1                    → "supported"
        direct_count == 0 && partial_count>0 → "hedged"
        else                                 → "unsupported" (drop)
3. For each kept verdict, hydrate from candidate via candidate_id:
     origin, document_id, url, title, citation, snippet, source_type.
4. Normalize key for dedup:
     key = document_id ?? normalizeUrl(url) ?? `${origin}:${candidate_id}`
     normalizeUrl: lowercase host, strip trailing slash, drop #fragment,
                   drop tracking query params (utm_*, ref).
5. Within a claim, group by key and pick ONE survivor with priority:
     (a) is_primary DESC  — see is_primary below
     (b) origin rank: exact_authority > approved_web > local_text > local_vector
     (c) support rank: direct > partial
     (d) longer snippet
   Count dropped duplicates → invariants.duplicates_dropped.
6. is_primary heuristic (origin-blind, content-based):
     primary if source_type ∈ {caselaw, statute, regulation, treaty}
       OR title matches DOCKET_RE (ע"א/בג"ץ/…)
       OR title matches LEGISLATION_RE (חוק|פקודה|תקנות|חוק-יסוד)
       OR url host ∈ {nevo.co.il, supreme*.court.gov.il, takdin.co.il,
                      reshumot.gov.il, fs.knesset.gov.il, justice.gov.il}.
     Everything else (journal articles, PDF commentary) = secondary.
   When duplicates exist (same key), step 5(a) picks primary over secondary.
7. Unresolved authorities:
     unresolved_authority_ids = retrieval.authority_resolutions
       .filter(a => !a.resolved).map(a => a.authority_id);
     These IDs are reported ONLY — they cannot enter the ledger because
     ledger sources come from verified candidates, not from planner hypotheses.
     Invariant check confirms zero leakage.
8. Sort sources within a claim: primary first, then by origin rank,
   then direct before partial.
9. Compute totals + invariants. Both invariant counters MUST be 0;
   if not, log a console.error so the runner can flag it.
```

### Why this satisfies each requirement

| Req | How |
|---|---|
| 1 — keep only direct/partial | step 2(a) filter |
| 2 — drop tangential/unrelated | same filter; invariant 2 verifies |
| 3 — status rules | step 2(c) |
| 4 — drop unsupported from drafter input | LedgerResult.claims excludes unsupported; ids exposed separately |
| 5 — partial-only = hedged | step 2(c) line 2 |
| 6 — preserve origin | LedgerSource.origin carried verbatim |
| 7 — no unresolved authorities | sources sourced from verified candidates only; invariant 1 verifies |
| 8 — dedup | step 4 + 5 |
| 9 — primary > secondary | step 5(a) + is_primary heuristic |

## Runner: `/tmp/run_ledger.ts`

Reuses `planner_run_v2.json` + the already-computed retrieval+verifier output. Won't re-call any API.

```text
- Load /tmp/verifier_run.json (has plan + retrieval_summary + verification per Q).
- BUT verifier_run.json only stores retrieval_summary (counts), not the raw
  candidate pool needed to hydrate ledger sources.
  → Rerun retrieval+verifier once to capture full packs and verdicts in memory,
    then call buildLedger and dump to /mnt/documents/ledger_run.json +
    /mnt/documents/ledger_report.md.
  (Same 3 pilots, same network cost as the previous run.)
```

If rerun cost is a concern, alternative: extend the existing runner to also dump full `packs` and `verdicts` JSON now, then ledger can be computed offline.

## Report format

For each of the 3 pilots:

```text
Q: <question>
  Status counts: supported=N hedged=N unsupported=N
  Unresolved authorities (reported, not cited): [A-ids]
  Invariants: unresolved_in_ledger=0  tang/unrel_in_ledger=0  dups_dropped=N

  -- C1 [supported|hedged] -- direct=N partial=N
     [P] DIRECT  approved_web    <title> [<domain>]
     [P] DIRECT  local_text      <title>
     [S] PARTIAL local_text      <title>
     ...
  -- C2 [supported|hedged] -- ...
  -- (omitted) C3 unsupported

Pilot summary:
  enough_for_drafting = (supported + hedged) ≥ ceil(plan.claims.length / 2)
                        AND total_sources ≥ 3
```

## Acceptance per pilot

I will report exactly the 8 items you listed:
1. supported claims
2. hedged claims
3. unsupported claims
4. sources per claim
5. source origin per source
6. unresolved authorities that entered ledger (must be 0)
7. tangential/unrelated survivors (must be 0)
8. enough_for_drafting flag

## Out of scope (explicitly)

- No drafter
- No citation pass / footnote builder
- No ledger persistence to `qa_logs` (in-memory + JSON dump only)
- No edge function deploy

## Files

- New: `supabase/functions/legal-qa/core/ledger.ts`
- Edit: `supabase/functions/legal-qa/core/types.ts` (Ledger* types)
- New: `/tmp/run_ledger.ts` (runner, not project source)
- Output: `/mnt/documents/ledger_run.json` + `/mnt/documents/ledger_report.md`
