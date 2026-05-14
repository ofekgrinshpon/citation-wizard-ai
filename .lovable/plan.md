
# Pipeline rebuild: Think broadly, prove narrowly (with strict relevance)

Phase 0 (F1/F2) is in. Drafter no longer truncates. But the current source-first flow still cites tangential verified sources (חוק בית המשפט לימאות, fibromyalgia case, property exchange appeal) for a frozen-embryo question. Fix: introduce a 5-stage pipeline where **only direct/partial support of the specific claim** counts.

---

## Stage 1 — Issue Map (broad open web, never cited)

**New file:** `supabase/functions/legal-qa/issueMap.ts`. Runs in parallel with decomposition.

- Provider: existing `openWebDiscovery` (Perplexity sonar / sonar-pro). **No `search_domain_filter`** — broad web is intentional here.
- Output (added to `contracts.ts` as `IssueMap`): `framing`, `doctrines[]`, `leading_cases[]`, `statutes[]`, `secondary_sources[]`, `competing_positions[]`, `open_questions[]` — descriptors only, no URLs, no quotes.
- Raw URLs/snippets stored in `qa_logs.metadata.research_safeguards.issue_map_raw` for audit only — never reachable by drafter or SourcePack.
- Mode caps (`MODE_PROFILES.issueMap`): Fast `"lite"` (8s, sonar); Deep `"full"` (15s, sonar-pro).
- Failure → empty IssueMap, pipeline degrades to today's behavior.

## Stage 2 — Candidate Claims (hypotheses, not citations)

**New file:** `candidateClaims.ts`. Runs after Stage 1.

- Input: question + decomposition + IssueMap.
- Output: `CandidateClaim[]` with `id`, `statement`, `kind`, `required_evidence[]`, `generated_search_queries[]`, `source_hint: "issue_map"`.
- Model: `gpt-5-mini` structured tool call (now working post-F1).
- Caps: Fast = 4 claims, Deep = 8.
- System prompt explicitly states: claims are hypotheses; verifier may reject; unverified ⇒ cannot be asserted.

## Stage 3 — Per-Claim Verification (strict: DB + trusted allowlist only)

**New file:** `claimVerification.ts`. Reuses `search_legal_chunks_text` + `match_legal_chunks` RPCs and the existing trusted-Perplexity fan-out (Stage E.5 allowlist).

For each candidate claim, in parallel (mode-capped):

1. Run `claim.generated_search_queries` against local DB (text + vector).
2. Same queries through Perplexity **with `search_domain_filter` = trusted allowlist**. Open web forbidden.
3. **Per-claim relevance scoring** (Gemini-Flash, same pattern as `sourceRoleClassifier.ts`). Hard rubric the model is forced to follow:

   ```
   direct_support  — the source DIRECTLY discusses the claim's specific subject
                     (e.g. frozen-embryo dispute / נחמני / Article 5 of הסכם הורות משותפת)
                     and supports the asserted proposition.
   partial_support — the source discusses the same legal doctrine or issue
                     (e.g. judicial activism in family-law disputes broadly,
                     or general right-to-parenthood doctrine) but does not
                     prove the claim about the specific subject.
   tangential      — the source is legally adjacent or analogical only
                     (different statute, different domain, same court).
                     ANTI-PATTERN: if the only justification is
                     "although this source does not directly discuss X,
                     it illustrates Y" — score is tangential.
   unrelated       — does not address the claim's subject or doctrine.
   ```

4. **Verdict rule (HARD):**
   - `supported` ⇔ ≥1 `direct_support` from local DB or trusted allowlist.
   - `partially_supported` ⇔ no direct_support, but ≥1 `partial_support`.
   - `unsupported` ⇔ nothing better than `tangential`. **Tangential and unrelated never support a claim.**

5. Only direct/partial hits feed the SourcePack via `addToSourcePack` — tangential/unrelated are dropped (logged in telemetry).

**Hard invariant:** Issue-Map URLs never enter the SourcePack. The Stage-3-→-SourceCard codepath has zero read of `issueMap.*`.

## Stage 4 — Claim Ledger

Stored at `qa_logs.metadata.research_safeguards.claim_ledger` (BANNED_KEYS-stripped from user payload):

```
{ claims: [{ id, statement,
             verdict: "supported"|"partially_supported"|"unsupported",
             sourceIds: number[], evidenceNotes }] }
```

Drafter contract:
- `supported` → may be asserted directly with listed source ids.
- `partially_supported` → must be hedged (`יש הסוברים`, `נטען כי`, `עמדה אחת גורסת`); citation required.
- `unsupported` → **omitted by default**. Rare gap-disclosure escape: a single sentence `יצוין כי טענת X לא אומתה במקור מהימן ועל כן אינה נכללת בניתוח להלן` — no footnote.

If the **entire Ledger is unsupported** for the question, drafter must produce a short qualified answer stating that the verified-source corpus does not contain material directly addressing the issue, and may only describe doctrine in general terms without per-claim footnotes.

## Stage 5 — Constrained Drafter

`index.ts` drafter prompt + `cardClaimContract.ts`.

Inject:
- IssueMap `framing`, `doctrines`, `competing_positions` as **background only** (never cited).
- Claim Ledger as a hard contract block:

  ```
  <CLAIM_LEDGER>
  C1 [supported]            "..." → src=[3,7]
  C2 [partially_supported]  "..." → src=[5]
  C3 [unsupported]          "..." → src=[]   // omit unless gap-disclosure
  </CLAIM_LEDGER>
  ```

- Hard system rules:
  1. Do not introduce any claim absent from the Ledger.
  2. Do not cite any source absent from the SourcePack.
  3. IssueMap material is **not** a source — never cited, never paraphrased as if verified.
  4. `unsupported` claims omitted by default.
  5. Tangential/unrelated sources are **not** in the SourcePack — physically impossible to cite.

Existing `[CARD:n]` markers, anchor pass, footnote parser, Rule 37, citation engine — unchanged.

---

## Mode profile (`modeProfiles.ts`)

| Field | Fast | Deep |
|---|---|---|
| `issueMap` | `"lite"` (8s, sonar) | `"full"` (15s, sonar-pro) |
| `candidateClaimsCap` | 4 | 8 |
| `claimVerificationParallel` | 3 | 6 |
| `claimVerificationDbCap` | 4 | 6 |
| `claimVerificationAllowlistCap` | 2 | 3 |

---

## Telemetry (`qa_logs.metadata.research_safeguards`, all stripped from response)

- `issue_map`: counts, status, ms, raw URLs (audit only).
- `candidate_claims`: count, by-kind histogram.
- `claim_ledger`: full `[{id, verdict, sourceIds}]`.
- `verification_summary`: `{ supported, partially_supported, unsupported, db_hits, allowlist_hits, dropped_tangential, dropped_unrelated }`.
- `discovery_isolation_check`: assertion that no SourcePack item has `provenanceInternal === "issue_map"`.
- `relevance_scores`: per-claim, per-source `{claimId, sourceId, score, rationale}` for audit (also stripped).

---

## Files

**New**
- `supabase/functions/legal-qa/issueMap.ts`
- `supabase/functions/legal-qa/candidateClaims.ts`
- `supabase/functions/legal-qa/claimVerification.ts`
- `supabase/functions/legal-qa/issueMap.test.ts`
- `supabase/functions/legal-qa/claimVerification.test.ts` — covers verdict logic, the explicit anti-pattern ("although this source does not directly discuss…"), and tangential rejection.
- `eval/issue-map-pipeline-probe.mjs` — runs the failing question + Phase 6.7 examples.

**Edited**
- `supabase/functions/legal-qa/index.ts` (Stages 1–5 wiring + telemetry)
- `supabase/functions/legal-qa/contracts.ts` (`IssueMap`, `CandidateClaim`, `ClaimLedger`; add to `BANNED_KEYS`)
- `supabase/functions/legal-qa/modeProfiles.ts` (new caps)
- `supabase/functions/legal-qa/cardClaimContract.ts` (Claim-Ledger drafter block)

**Deprecated (left as no-ops one release)**
- `selectRetrievalStrategy` early-injection
- `discoveryDerivedQueries` round-1.5 micro-pass

---

## Validation

Run target question: **"האם בית המשפט מתנהל באקטיביזם שיפוטי ביחס לסכסוכי עוברים מוקפאים?"**

Pass criteria:
1. **No** חוק בית המשפט לימאות in footnotes.
2. **No** fibromyalgia / property-exchange / unrelated-health cases in footnotes.
3. If no verified frozen-embryo sources (נחמני וכו') exist in DB or allowlist → answer is qualified ("המקורות המאומתים הזמינים אינם מספקים תשובה ישירה…") with no fabricated footnotes.
4. Every footnote present must be `direct_support` or `partial_support` for the adjacent claim per the relevance log.
5. Q-contract-amendment regression — green.
6. Full regression harness (`eval/regression/run-regression.mjs`) — `newFailures === 0`.

---

## Risks

- **Latency**: Stage 1 parallel with router; Stage 2 starts on Stage 1 return; Stage 3 parallel and capped. Net Deep cost ≈ +1.5–2 s.
- **Verifier false-negatives** dropping real material: mitigated by `partial_support` tier and gap-disclosure escape.
- **Open-web leakage**: structurally prevented — IssueMap schema has no URL field reachable by drafter/SourcePack; `discovery_isolation_check` telemetry catches regressions.
- **Empty SourcePack**: drafter is allowed (and instructed) to produce a qualified answer rather than fabricate citations.
