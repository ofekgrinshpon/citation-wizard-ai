# Pipeline rebuild: Think broadly, prove narrowly

**Guiding rule:** Stage 1 explores the open web freely. Stages 3+ verify strictly against local DB + trusted allowlist. Unsupported claims are **omitted by default**.

---

## Phase 0 — Blocking bug fixes (ship first, in their own commit)

The current Deep run produces 227-char truncated answers because gpt-5 / gpt-5-mini reject the `reasoning: { effort }` block on Chat Completions (HTTP 400) and the streaming drafter silently falls back to Gemini Flash. Pipeline work cannot be validated until this is fixed.

### F1. `supabase/functions/legal-qa/aiProvider.ts`
- Line ~342–344 (streaming drafter): replace `body.reasoning = { effort: "medium" }` with `body.reasoning_effort = "medium"`.
- Line ~525–533 (non-streaming drafter): same swap; refresh the comment to state that Chat Completions accepts only the top-level `reasoning_effort` snake_case field. Keep the existing `reasoningEffort → reasoning_effort` conditional at line ~158 unchanged.

### F2. `supabase/functions/legal-qa/index.ts`
- Line ~2432 (academic `suggest_topics` planner): replace `reasoning: { effort: "minimal" }` with `reasoning_effort: "minimal"`.

### Verify F1/F2 before pipeline work
- Re-run the failing question in Deep mode. Expect `text_len > 1500` and no `[drafter:stream:http_error]`.
- Run Q-contract-amendment + full regression (`eval/regression/run-regression.mjs`); `newFailures === 0`.

---

## The pipeline (5 stages)

```
1. Issue Map        — broad open web, descriptors only, never cited
2. Candidate Claims — non-citeable hypotheses extracted from Issue Map
3. Verification     — local DB + trusted allowlist ONLY
4. Claim Ledger     — supported / partially_supported / unsupported
5. Drafter          — only ledger claims; only verified SourcePack citations
```

---

## Stage 1 — Issue Map (broad open web)

**New file:** `supabase/functions/legal-qa/issueMap.ts`. Wired in `index.ts` after decomposition, in parallel with the existing router.

- Provider: existing `openWebDiscovery` infrastructure (Perplexity sonar / sonar-pro). **No `search_domain_filter`.** Broad web is intentional here.
- Output (added to `contracts.ts` as `IssueMap`):
  ```ts
  {
    framing: string;
    doctrines:           { name: string; summary: string }[];
    leading_cases:       { name: string; docket?: string; relevance: string }[];
    statutes:            { name: string; year?: string; relevance: string }[];
    secondary_sources:   { author?: string; title?: string;
                           type: "academic"|"committee"|"report"|"news"|"other";
                           relevance: string }[];
    competing_positions: { stance: string; rationale: string }[];
    open_questions:      string[];
  }
  ```
- **Descriptors only.** No URLs, no quotes, no "according to X" passthrough. Raw URLs and snippets stay in telemetry (`qa_logs.metadata.issue_map_raw`) for audit only.
- Mode caps (`MODE_PROFILES.issueMap`): Fast = `"lite"` (8s, sonar); Deep = `"full"` (15s, sonar-pro).
- Timeout / parse error → empty IssueMap; pipeline degrades to today's behavior with no regression.

## Stage 2 — Candidate Claims (hypotheses, not citations)

**New file:** `supabase/functions/legal-qa/candidateClaims.ts`. Runs immediately after Stage 1.

- Input: question + decomposition + IssueMap.
- Output: `CandidateClaim[]`, each:
  ```ts
  { id, statement, kind: "doctrinal"|"empirical"|"normative"|"procedural",
    required_evidence: ("statute"|"case"|"academic"|"committee"|"news")[],
    generated_search_queries: string[],
    source_hint: "issue_map" }   // marks them as non-citeable hypotheses
  ```
- Model: gpt-5-mini, structured tool call (uses fixed `aiProvider.ts`).
- Caps: Fast = 4 claims, Deep = 8 claims.
- The system prompt explicitly states: **claims are hypotheses; the verifier may reject any; an unverified claim cannot be asserted.**

## Stage 3 — Per-Claim Verification (strict: DB + trusted allowlist only)

**New file:** `supabase/functions/legal-qa/claimVerification.ts`. Reuses `search_legal_chunks_text` + `match_legal_chunks` RPCs and the existing trusted-Perplexity fan-out (Stage E.5 allowlist).

For each candidate claim, in parallel (mode-capped):
1. Run `claim.generated_search_queries` against local DB (text + vector).
2. Run the same queries through Perplexity **with `search_domain_filter` = trusted allowlist**. Open web is forbidden here.
3. Score each hit against the claim with a Gemini-Flash relevance pass (same pattern as `sourceRoleClassifier.ts`): `direct_support | partial_support | tangential | unrelated`.
4. Verdict:
   - `supported` → ≥1 `direct_support` from local DB or trusted allowlist.
   - `partially_supported` → only `partial_support` matches.
   - `unsupported` → nothing better than `tangential`.
5. Supporting hits feed into the **existing SourcePack** via `addToSourcePack`, so Rule 37 / Card→Claim / citation engine work unchanged.

**Hard invariant:** Issue-Map URLs never enter the SourcePack. The pipeline that converts Stage 3 hits → SourceCards has zero codepath that reads `issueMap.*`.

## Stage 4 — Claim Ledger

Stored as `qa_logs.metadata.research_safeguards.claim_ledger` (BANNED_KEYS-stripped):

```
{ claims: [
    { id, statement, verdict: "supported"|"partially_supported"|"unsupported",
      sourceIds: number[], evidenceNotes: string }
  ] }
```

Drafter contract:
- `supported` → may be asserted directly with the listed source ids.
- `partially_supported` → may be asserted with hedging vocabulary (`יש הסוברים`, `נטען כי`, `עמדה אחת גורסת`); citation required.
- `unsupported` → **omit by default.** Only retain when omission would create a misleading gap; in that case the drafter writes a single sentence in the form `יצוין כי טענת X לא אומתה במקור מהימן ועל כן אינה נכללת בניתוח להלן` — no footnote marker, no claim assertion.

## Stage 5 — Drafter

`index.ts` drafter prompt + `cardClaimContract.ts`.

Inject (in addition to today's prompt):
- Issue Map's `framing`, `doctrines`, `competing_positions` (descriptors, no URLs).
- The Claim Ledger as a hard contract:
  ```
  <CLAIM_LEDGER>
  C1 [supported]            "..."  → src=[3,7]
  C2 [partially_supported]  "..."  → src=[5]
  C3 [unsupported]          "..."  → src=[]      // omit unless gap-disclosure required
  </CLAIM_LEDGER>
  ```
- Hard system rules:
  1. Do not introduce any claim absent from the Ledger.
  2. Do not cite any source absent from the SourcePack.
  3. Issue-Map material is **not** a source. Never cite it. Never paraphrase a passage from it as if it were verified.
  4. `unsupported` claims are omitted by default; gap disclosure is rare and never carries a footnote.

Existing `[CARD:n]` markers, anchor pass, footnote parser, Rule 37, citation engine — unchanged.

---

## Mode profile (`modeProfiles.ts`)

| Field | Fast | Deep |
|---|---|---|
| `issueMap` | `"lite"` (8s, sonar, broad web) | `"full"` (15s, sonar-pro, broad web) |
| `candidateClaimsCap` | 4 | 8 |
| `claimVerificationParallel` | 3 | 6 |
| `claimVerificationDbCap` (per claim) | 4 | 6 |
| `claimVerificationAllowlistCap` (per claim) | 2 | 3 |

---

## Telemetry (`qa_logs.metadata.research_safeguards`, all stripped)

- `issue_map`: counts per category, `status`, `ms`, raw URLs (audit only).
- `candidate_claims`: count, by-kind histogram.
- `claim_ledger`: full `[ {id, verdict, sourceIds} ]`.
- `verification_summary`: `{ supported, partially_supported, unsupported, db_hits, allowlist_hits, dropped_unrelated }`.
- `discovery_isolation_check`: assertion that no SourcePack item has `provenanceInternal === "issue_map"` (must always be true; logged for audit).

---

## Backward compatibility

- Phase 6.7 is subsumed: `selectRetrievalStrategy` and `discoveryDerivedQueries` are replaced by Stages 1–3. The `verifyDiscoveryTargets` helper is reused inside Stage 3 against `issueMap.leading_cases + statutes + secondary_sources`.
- LegalResearchPlanner / SourceRoleClassifier / Gate V2 / Card→Claim / Rule 37 / CitationEngine — **untouched**.
- `verified_sources` table is not the citeable allowlist (it is a user-saved table). The trusted-Perplexity allowlist remains the gate.
- Failures in Stage 1 or 2 → graceful fallback to today's pipeline.

---

## Validation

- Failing question (`האם בית המשפט מתנהל באקטיביזם שיפוטי...`) → non-truncated answer with ≥3 footnotes, all from local DB / trusted allowlist; no `(טרם אומת)` line unless it is a genuine gap.
- Q-contract-amendment regression — green.
- Full regression harness — `newFailures === 0`.
- New unit tests:
  - `issueMap.test.ts` — schema + heuristic fallback + URL-leak guard.
  - `claimVerification.test.ts` — verdict logic edge cases; allowlist enforcement.
  - `cardClaimContract.test.ts` — drafter must not emit `[N]` for `unsupported` claims; must not cite an Issue-Map-only entity.
- New probe `eval/issue-map-pipeline-probe.mjs` covering Phase 6.7's three example questions, asserting (a) Issue Map non-empty for theoretical/critical questions, (b) zero Issue-Map URLs in SourcePack, (c) `db_first` behavior on the narrow doctrinal question (`"מה נקבע באפרופים?"`).

---

## Files

**New**
- `supabase/functions/legal-qa/issueMap.ts`
- `supabase/functions/legal-qa/candidateClaims.ts`
- `supabase/functions/legal-qa/claimVerification.ts`
- `supabase/functions/legal-qa/issueMap.test.ts`
- `supabase/functions/legal-qa/claimVerification.test.ts`
- `eval/issue-map-pipeline-probe.mjs`

**Edited**
- `supabase/functions/legal-qa/aiProvider.ts` (F1)
- `supabase/functions/legal-qa/index.ts` (F2 + Stages 1–5 wiring + telemetry + isolation check)
- `supabase/functions/legal-qa/contracts.ts` (`IssueMap`, `CandidateClaim`, `ClaimLedger`; add to `BANNED_KEYS`)
- `supabase/functions/legal-qa/modeProfiles.ts` (new caps)
- `supabase/functions/legal-qa/cardClaimContract.ts` (Claim-Ledger drafter block + tests)

**Deprecated (left as no-ops one release for safety)**
- `selectRetrievalStrategy` early-injection
- `discoveryDerivedQueries` round-1.5 micro-pass

---

## Risks

- **Latency**: Stage 1 (broad web) runs in parallel with router/decomposition; Stage 2 starts as soon as Stage 1 returns; Stage 3 is parallel and capped. Net Deep cost ≈ +1.5–2 s.
- **Verifier false-negatives** silently dropping real material: mitigated by the `partially_supported` tier and by the gap-disclosure escape hatch in Stage 4.
- **Open-web leakage**: enforced structurally — Issue Map output schema contains no URL field reachable by drafter or SourcePack; the discovery_isolation_check telemetry assertion catches regressions.
