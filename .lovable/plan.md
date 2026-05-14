
# Phase 6.7 — Discovery-Driven Research Planning

Goal: stop quarantining OpenWebDiscovery as prose-only. Make it structured research **guidance** that drives plan + round-1 retrieval, while preserving the absolute rule: **Discovery URLs/sources never become citeable SourceCards**.

Scope: `legal-qa` only. No changes to `cardClaimContract`, `citationEngine`, Rule 37 / post-processing, Gate V2 internals, or pricing/model routing.

---

## 1. Contract: extend Planner I/O

**File:** `supabase/functions/legal-qa/contracts.ts`

Add to `LegalResearchPlan`:
```ts
retrievalStrategy: "db_first" | "discovery_first" | "hybrid";
retrievalStrategyRationale: string;       // short Hebrew note (telemetry only)
discoveryAlignment?: {
  consumedEntities: string[];             // entity names the planner adopted
  consumedQueries: string[];              // suggested_trusted_queries adopted
  ignoredEntities: { value: string; reason: string }[];
  requiredVerificationTargets: string[];  // canonical names/titles to verify
};
```

Add new banned key: `"discoveryAlignment"` (internal-only, sanitized out of user payload like everything else under `BANNED_KEYS`).

**File:** `supabase/functions/legal-qa/legalResearchPlanner.ts`

- Replace prose-only Discovery injection (lines 328–343) with a **structured JSON block** in the planner prompt:
  ```
  <DISCOVERY_INPUT>
  { "resolved_entities":[...], "suggested_trusted_queries":[...],
    "candidate_authoritative_sources":[{title,url,type}...],
    "ambiguity_notes":[...] }
  </DISCOVERY_INPUT>
  ```
- Extend the planner's response schema (tool/JSON schema) to require `retrievalStrategy`, `retrievalStrategyRationale`, and (when DISCOVERY_INPUT is non-empty) `discoveryAlignment`.
- Strategy-selection rules baked into the system prompt:
  - **db_first** → router `query_type ∈ {applied, current_status_factual}` AND decomposition has clear statute/case anchors AND no theoretical/critical/policy framing.
  - **discovery_first** → theoretical / critical / institutional / reform / policy / academic-research / unclear-source-universe AND no obvious doctrinal anchor.
  - **hybrid** → mixed (e.g. doctrinal anchor exists but question is also normative/critical).
- Heuristic fallback (`buildHeuristicPlan`) gets the same field, derived from router signals (`query_type`, `requires_current_context`, low confidence) + decomposition flags.

Acceptance: planner unit tests assert the three example questions resolve to the expected strategies.

---

## 2. Wire structured Discovery into the planner call

**File:** `supabase/functions/legal-qa/index.ts` (~line 4716 `runLegalResearchPlanner` call)

- Continue passing `discovery: discoveryResult`. The planner module reads it as structured (no caller change needed beyond awaiting `discoveryPromise` before this call — already done by the gate ordering).
- Log `[role-plan] strategy=… discoveryAlignment=consumed:N/ignored:M` for observability.

---

## 3. Round-1 retrieval injection (Discovery-derived queries)

**Architectural note:** Today the planner runs *after* round-1. To inject Discovery queries into round-1 we have two choices:

- **3a (preferred, minimal):** Move ONLY the lightweight `retrievalStrategy + suggested_trusted_queries` decision earlier — by short-circuiting it from `discoveryResult` directly (no planner call yet). The full `runLegalResearchPlanner` still runs at its current site for role classification. We add a small `selectRetrievalStrategy(routerRoute, decomposedPlan, discoveryResult)` helper used **before** round-1 retrieval kicks off, and the planner's later `retrievalStrategy` is reconciled (logged if it disagrees, planner wins for telemetry).
- **3b (rejected):** Move the whole planner before round-1 — touches Track A and changes pipeline order. Out of scope per user constraint.

Implement **3a** in `index.ts`:

- After `discoveryPromise` settles (await it before round-1 starts when `modeProfile.openWebDiscovery !== "off"`; if discovery times out, treat as `db_first`).
- Compute `retrievalStrategyEarly` via the helper.
- Build `discoveryDerivedQueries[]` from `discovery.suggested_trusted_queries` (and, after planner runs, `planner.requiredVerificationTargets` are added in a tight round-1.5 micro-fan-out — see below).
- Cap by mode: **Fast = 3, Deep = 6** (new fields on `MODE_PROFILES`: `discoveryQueryCapRound1`).
- Dedup against: lowercased+normalized user `question`, `decomposedPlan.query_plan[].external_query`, and (when available) `planner.canonicalSearchTargets`.
- Run them through the existing `search_legal_chunks_text` + trusted-Perplexity fan-out used by round-1. **Discovery URLs themselves are NOT injected as cards** — only the resulting trusted/local matches become SourceCards via the normal path.

`requiredVerificationTargets` micro-pass:
- Runs after `runLegalResearchPlanner` returns, BEFORE the role-gap rescue block (~4808). Same RPC fan-out, same caps reduced by queries already used in round-1, same dedup.
- Telemetry recorded under `research_safeguards.retrieval_strategy.verification_targets_run`.

If `retrievalStrategy === "db_first"`, skip injection (cap = 0).

---

## 4. Discovery verification

**New helper:** `verifyDiscoveryTargets(discoveryResult, sourcePackV2)` in `openWebDiscovery.ts`.

For each discovery `resolved_entity` and `candidate_authoritative_source`, attempt to match an item in the final `sourcePackV2` (any tier) by:
- normalized title equality / containment,
- canonical citation containment,
- URL host+path match (against `item.url`),
- entity-identifier match (e.g. statute name token).

Output:
```ts
{
  discovered_targets: string[],
  verified_targets: { target: string; method: "local_db"|"trusted_perplexity"|"allowlist"; sourceId: string }[],
  unverified_targets: string[],
}
```

Called once after the role-gap rescue block, before the gate-banner is finalized.

---

## 5. Drafter banner — unverified discovery coverage

**File:** `index.ts` where the soft gate banner is appended to drafter task instructions (`buildRoleUsageBlock` / banner section).

When `unverified_targets.length > 0` AND `retrievalStrategy !== "db_first"`:
append a Hebrew advisory line, e.g.:
> ⚠ גילוי רשת פתוחה זיהה יעדים פוטנציאליים שלא אומתו במאגר/מקורות מהימנים: X, Y. אין להסתמך עליהם כסמכות; אם רלוונטי — הסתייג בתשובה.

Hard rules in the same banner block:
- Do NOT cite Discovery sources.
- Do NOT introduce X/Y as anchors; only mention as "טרם אומת".

The banner is **soft** (informational); never blocks; never injected as a card.

---

## 6. Telemetry

In `index.ts` qa_logs metadata writer:

```ts
metadata.research_safeguards.retrieval_strategy = {
  selected_early,                  // from helper, pre-planner
  selected_planner,                // from runLegalResearchPlanner
  rationale,                       // planner's retrievalStrategyRationale
  discovery_query_count,           // queries actually injected into round-1
  db_query_count,                  // queries from decomposedPlan + question
  verification_targets_run,        // count of planner.requiredVerificationTargets executed
  cap_used,                        // mode cap (3 or 6)
};
metadata.research_safeguards.discovery_verification = {
  discovered_targets,
  verified_targets,
  unverified_targets,
  consumed_by_planner: discoveryAlignment.consumedEntities + consumedQueries,
  injected_into_retrieval: discoveryDerivedQueries,
  source_pack_matches: verified_targets.map(v => ({ target: v.target, sourceId: v.sourceId })),
};
```

Both are stripped from user payload (already covered by `sanitizeResponse` strip of `research_safeguards.*` internals — verify; if not stripped today, add to BANNED keys traversal).

---

## 7. Validation probes (no baseline retune)

Add `eval/phase6.7-discovery-driven-probe.mjs` running:

- **A.** `"האם בית המשפט מתנהל באקטיביזם שיפוטי ביחס לסכסוכי עוברים מוקפאים?"`
  - assert `retrieval_strategy.selected_planner ∈ {hybrid, discovery_first}`
  - assert `discovery_query_count >= 1` (when discovery returned ≥1 suggested query)
  - assert planner `requiredRoles` includes at least one of `theoretical_anchor | academic_commentary | counter_position`
  - assert final body contains qualifying language (regex over hedging vocabulary) when `unverified_targets.length > 0`

- **B.** `"האם נכון לפצל את תפקיד היועמ״ש?"`
  - assert strategy ∈ {hybrid, discovery_first}
  - assert `discovery_verification.verified_targets` non-empty when discovery surfaced AG/committee materials AND they exist locally
  - assert no SourceCard has `provenanceInternal === "discovery"` (Discovery never escapes)

- **C.** `"מה נקבע באפרופים?"`
  - assert `retrieval_strategy.selected_planner === "db_first"`
  - assert `discovery_query_count === 0`

Plus full regression harness: `newFailures === 0`. Do not retune baselines.

---

## Files touched

- `supabase/functions/legal-qa/contracts.ts` — extend `LegalResearchPlan`, add banned key.
- `supabase/functions/legal-qa/legalResearchPlanner.ts` — structured Discovery input, schema fields, heuristic fallback, strategy rules.
- `supabase/functions/legal-qa/openWebDiscovery.ts` — add `verifyDiscoveryTargets` helper.
- `supabase/functions/legal-qa/modeProfiles.ts` — add `discoveryQueryCapRound1` (Fast 3, Deep 6).
- `supabase/functions/legal-qa/index.ts` — early `selectRetrievalStrategy`, await discovery before round-1 when active, round-1 injection, post-planner `requiredVerificationTargets` micro-pass, `verifyDiscoveryTargets` call, banner extension, telemetry blocks.
- `eval/phase6.7-discovery-driven-probe.mjs` — new.
- Unit tests: extend `legalResearchPlanner` (strategy mapping) and `openWebDiscovery` (verification matcher).

## Out of scope (untouched)

- LegalResearchPlanner role-classifier internals (Track A).
- Source role classifier, Gate V2 logic (only its banner text grows).
- Card→Claim contract, citation engine, Rule 37, post-processing.
- CitationQualityGate enforcement (stays disabled).
- Pricing / model routing / drafter prompt structure beyond the banner addition.

## Risk + mitigations

- **Risk:** Awaiting `discoveryPromise` before round-1 adds latency on Fast.
  **Mitigation:** Tight timeout (use existing discovery timeout). On timeout → `db_first` + `discovery_query_count=0`; round-1 proceeds as today.
- **Risk:** Planner schema change destabilizes existing planner JSON parsing.
  **Mitigation:** New fields are optional in the parser; heuristic fallback fills `retrievalStrategy` if absent.
- **Risk:** Injected queries cause noisy SourceCards.
  **Mitigation:** All injected queries flow through the existing trusted retrieval + dedup; URLs from Discovery itself are never promoted.

