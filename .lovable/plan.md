## Goal

Add a controlled **Open Web Discovery** layer + **pre-drafting source safeguards** to the Legal Research pipeline. Single profile-driven pipeline preserved — every new stage is gated by a flag in `MODE_PROFILES`, no Fast/Deep code branches.

## Pipeline (final order)

```text
frame
  → legal_issue_router          (NEW, profile.legalIssueRouter; awaited or short-timeout-raced before decompose)
  → open_web_discovery          (NEW, conditional: triggers fire AND profile.openWebDiscovery !== "off")
  → entity_resolution           (NEW, pure merge)
  → decompose                   (existing, now consumes router-derived bias + entity_resolution exclusions)
  → retrieve                    (existing, now appends entity_resolution.expandedQueries)
  → rerank                      (existing, now applies topic-penalty + selective hard exclusion)
  → source_pack                 (existing, with source_tier field added)
  → coverage_gap                (existing instrumentation; outputs missing-slots summary)
  → targeted_retrieval_round_2  (NEW, profile.targetedGapRetrieval && retrievalRounds > 1)
  → source_pack_gate            (NEW, profile.sourcePackGate: "off"|"soft"|"strict")
  → claim_map                   (existing)
  → drafter                     (existing, injects answerTemplate by query_type + soft-gate banner)
  → statute_completion          (existing Stage 5e)
  → footnote_validate           (existing — UPGRADED to rollout-mode validator)
  → anchor_pass / critic / revision  (existing, profile-gated)
```

## Refinement-driven design decisions

### R1. Router gates decomposition (not parallel-with-fallback-to-stale)

Decomposition no longer races the router. Instead:

```ts
emitStage("legal_issue_router", "running");
const routePromise = modeProfile.legalIssueRouter
  ? routeLegalIssue(question)
  : Promise.resolve({ data: null, run: synthRun("skipped") });

// Short bounded wait so a slow router never starves decomposition.
const routeResult = await raceWithTimeout(routePromise, 12_000, "router_timeout");
emitStage("legal_issue_router", "complete",
  routeResult.data ? `${routeResult.data.query_type} (${routeResult.data.confidence.toFixed(2)})` : "fallback");

// Decompose ALWAYS waits for router (or its timeout). Router output biases the
// decomposition prompt deterministically.
emitStage("decompose", "running");
const decompResult = await decomposeAndPlan(question, routeResult.data ?? undefined);
```

`raceWithTimeout` returns the router's actual `{data, run}` if it completes in ≤12s; otherwise returns `{data: null, run: {...status: "timeout"}}` and decomposition runs with the legacy prompt (no bias). This bounds Fast-mode latency overhead to ≤12s router worst-case while still letting fast Gemini calls (~6–10s) actually influence decomposition. Discovery (which is conditional and slower) runs in parallel with decompose, joining at `entity_resolution`.

### R2. OpenWebDiscovery — discovery metadata only, no conclusions

Tightened tool-call schema and system prompt explicitly forbid:

- legal opinions, holdings, doctrines, "the rule is…", or any normative claim
- summaries of how courts ruled
- direct quotation of statutory text presented as authoritative

Allowed output is limited to:

```ts
export interface DiscoveryResult {
  resolved_entities: Record<string, string>;        // e.g. {"חוק החוזים": "חוק החוזים (חלק כללי), התשל\"ג-1973"}
  candidate_authoritative_sources: Array<{
    title: string;
    url?: string;
    host?: string;
    source_tier: SourceTier;                         // see R3
    why_relevant: string;                            // ≤120 chars, descriptive only
  }>;
  suggested_trusted_queries: string[];               // ≤8 strings, ≤80 chars each
  ambiguity_notes: string[];                         // factual disambiguation only
  confidence: number;
  must_verify_before_answering: boolean;
}
```

System prompt enforces ("אתה לא משיב על השאלה. אתה רק מזהה ישויות ושאילתות חיפוש מהימנות. אסור לכלול מסקנות משפטיות, הלכות, פרשנות חוקית, או ציטוט נורמטיבי."). A post-call sanitizer drops any field that includes regex hits for `נפסק|הלכה|קבע|מורה|אסור|מותר|זכאי|חייב` inside `why_relevant` or `ambiguity_notes`.

### R3. `source_tier` taxonomy

Added to `LegalSourcePackItem` (`contracts.ts`) and to discovery candidates:

```ts
export type SourceTier =
  | "official"             // gov.il / supremedecisions / nevo statutory pages / Knesset / Reshumot
  | "primary_legal"        // primary case law from approved court systems / nevo case pages
  | "approved_secondary"   // mishpatim, tau, huji journals, hapraklit, other ApprovedDomains list
  | "open_web_untrusted";  // anything else; cannot be cited
```

Classifier `classifySourceTier(url, source_type, host)` lives in a new file `supabase/functions/legal-qa/sourceTier.ts`. **Trusted host alone is not enough** — the classifier also looks at URL path patterns (e.g. `nevo.co.il/law_html/...` vs `nevo.co.il/blog/...`), the `source_type` from local DB classification, and falls back to `open_web_untrusted` whenever uncertain.

`assembleSourcePack` populates `source_tier` for every item; `sourcePackGate` and `footnote_validate` consume it.

### R4. Discovery → source_pack pipeline (with hard defense-in-depth)

Discovery output never directly enters `sourceCards` or `sourcePack`. Instead:

1. `entity_resolution` pulls `suggested_trusted_queries` and `candidate_authoritative_sources.url` from discovery.
2. URLs from candidates flagged `official` / `primary_legal` are pushed into the existing **trusted retrieval layer** (Perplexity sonar-pro WITH `search_domain_filter: TRUSTED_LEGAL_DOMAINS`, plus local DB embedding lookup) as **seeds for round 1 retrieval**, not as final sources.
3. Only if that trusted re-fetch returns a usable chunk does the source enter `sourceCards` with proper `provenance` (`local` / `perplexity`) and a `source_tier` re-classified from the canonical fetched URL.
4. `assembleSourcePack` keeps a hard guard:

   ```ts
   for (const item of items) {
     if (item.metadata?.discovery_only === true) {
       throw new Error("[source-pack-invariant] discovery_only item leaked into pack");
     }
     if (item.provenance === "open_web_discovery") {
       throw new Error("[source-pack-invariant] open_web_discovery provenance not allowed");
     }
   }
   ```

   Throw → caught → logged to `qa_logs.metadata.invariant_violation`, item dropped silently in production.

### R5. `citationQualityGate` rollout modes

```ts
citationQualityGate: "off" | "log_only" | "enforce";
```

Initial defaults:

| Mode | Fast | Deep |
|------|------|------|
| citationQualityGate | `log_only` | `log_only` |

`log_only` runs the full validator and writes `qa_logs.metadata.footnote_validation = { dropped: [], dropped_count: N, kept_count: M, would_drop_in_enforce: [...] }` but does NOT mutate `finalFootnotes`. After ~1 week of telemetry, flip Deep → `enforce` based on real drop rates.

### R6. Domain exclusion as ranking penalty + narrow hard filter

Replace the simple post-rerank filter with a two-tier policy:

```ts
if (modeProfile.domainExclusion && resolvedTarget) {
  const beforeCount = rankedMatches.length;
  const penaltyHits: Array<{title:string; reason:string; score_delta:number}> = [];
  const hardDrops: Array<{title:string; reason:string}> = [];

  rankedMatches = rankedMatches.flatMap((m) => {
    const topicHit = matchAny(resolvedTarget.forbiddenTopics, m);
    const domainHit = matchAny(resolvedTarget.forbiddenDomains, m);
    // Hard drop ONLY when both topic AND legal domain are clearly wrong.
    if (topicHit && domainHit) {
      hardDrops.push({ title: m.document_title, reason: `topic+domain:${topicHit}|${domainHit}` });
      return [];
    }
    // Otherwise: ranking penalty (keep but downweight).
    if (topicHit || domainHit) {
      const delta = topicHit ? -0.25 : -0.15;
      penaltyHits.push({ title: m.document_title, reason: topicHit ?? domainHit!, score_delta: delta });
      return [{ ...m, similarity: (m.similarity ?? 0) + delta }];
    }
    return [m];
  }).sort((a,b) => (b.similarity ?? 0) - (a.similarity ?? 0));

  qaLogsMetadata.domain_exclusion = {
    before: beforeCount,
    after: rankedMatches.length,
    hard_drops: hardDrops,
    penalties: penaltyHits,
  };
}
```

### R7. `sourcePackGate` for `statutory_amendment_comparison`

Required slots (strict mode blocks, soft mode warns):

```ts
function gateForStatutoryAmendmentComparison(target, pack): GateResult {
  const missing: string[] = [];

  // (a) Identified statute/section/amendment OR current statutory text in pack
  const hasStatuteIdentity = !!(target.statute?.name && (target.statute.section || target.statute.amendment));
  const hasCurrentText = pack.coreSources.some(s =>
    s.source_tier === "official" || s.source_tier === "primary_legal");
  if (!hasStatuteIdentity && !hasCurrentText) missing.push("identified_statute_or_current_text");

  // (b) ≥1 official/primary/approved source for the amendment or current text
  const hasAuthoritative = pack.coreSources.some(s =>
    ["official","primary_legal","approved_secondary"].includes(s.source_tier));
  if (!hasAuthoritative) missing.push("authoritative_source_for_amendment");

  // (c) Case-law baseline (REQUIRED only when question asks whether doctrine changed)
  const asksDoctrineChange = target.query_type === "statutory_amendment_comparison" &&
    /הלכה|דוקטרינה|שינוי מהותי|מהות/.test(target.originalQuestion ?? "");
  if (asksDoctrineChange) {
    const hasCaseBaseline = pack.coreSources.some(s => s.authorityClass === "primary_caselaw");
    if (!hasCaseBaseline) missing.push("case_law_baseline");
  }

  // (d) Prior statutory text — STRONGLY PREFERRED, NOT ALWAYS BLOCKING.
  // Only blocks (in strict mode) when no reliable explanatory secondary material exists.
  const hasPriorText = pack.coreSources.some(s =>
    /נוסח קודם|לפני התיקון|בנוסחו הקודם/.test(s.title + " " + (s.excerpt ?? "")));
  const hasExplanatory = pack.supportingSources.some(s =>
    s.source_tier === "approved_secondary" &&
    /תיקון|דברי הסבר|הצעת חוק/.test(s.title + " " + (s.excerpt ?? "")));
  if (!hasPriorText && !hasExplanatory) {
    missing.push("prior_text_or_explanatory_material"); // soft-only signal
  }

  const blockingMissing = missing.filter(m => m !== "prior_text_or_explanatory_material");
  return { ok: blockingMissing.length === 0, missing, blockingMissing };
}
```

Strict mode rejects when `blockingMissing.length > 0`. Soft mode never rejects but produces `softGateBanner` from the full `missing` list.

### R8. Discovery in Fast — conservative trigger set

`shouldRunDiscovery` is identical for both modes; the *profile* difference is just the `openWebDiscovery` flag.

| Field | Fast | Deep |
|-------|------|------|
| openWebDiscovery | `"conditional"` | `"conditional"` |
| `shouldRunDiscovery` thresholds | router.confidence < **0.7** AND (current/ambiguous/latest hit OR amendment="latest") | router.confidence < **0.75** OR any single trigger fires |

So in Fast, discovery only fires when the router is genuinely uncertain AND the question signals current-context. Deep is more permissive. Implementation:

```ts
export function shouldRunDiscovery(route, question, depth: ResearchDepth): boolean {
  const triggers = {
    requires_current: route.requires_current_context === true,
    amendment_latest: route.target_amendment === "latest",
    keyword_hit: /האחרון|התיקון האחרון|ההלכה החדשה|המצב כיום|לאחרונה|עדכני/.test(question),
    low_confidence: route.confidence < (depth === "fast" ? 0.7 : 0.75),
    ambiguous_terms: Object.keys(route.ambiguous_terms ?? {}).length > 0,
  };
  if (depth === "fast") {
    // Fast: low confidence AND at least one current-context signal
    return triggers.low_confidence && (triggers.requires_current || triggers.amendment_latest || triggers.keyword_hit);
  }
  // Deep: any single trigger
  return Object.values(triggers).some(Boolean);
}
```

The full `triggers` object is written to `qa_logs.metadata.discovery_decision` regardless of outcome — see R9.

### R9. Telemetry

All new telemetry lands under `qa_logs.metadata.research_safeguards`:

```ts
{
  router: {
    ran: boolean,
    timed_out: boolean,
    duration_ms: number,
    query_type: string | null,
    confidence: number | null,
    forbidden_domains: string[],
    forbidden_topics: string[],
  },
  discovery: {
    triggered: boolean,
    triggers: { requires_current, amendment_latest, keyword_hit, low_confidence, ambiguous_terms },
    duration_ms: number | null,
    candidate_count: number,
    by_tier: { official: n, primary_legal: n, approved_secondary: n, open_web_untrusted: n },
    sanitized_fields: number,    // count of fields stripped by post-call sanitizer
  },
  domain_exclusion: {
    before: number,
    after: number,
    hard_drops: Array<{ title, reason }>,
    penalties: Array<{ title, reason, score_delta }>,
  },
  source_pack_gate: {
    mode: "off" | "soft" | "strict",
    ok: boolean,
    missing: string[],
    blocking_missing: string[],
  },
  footnote_validation: {
    mode: "off" | "log_only" | "enforce",
    kept_count: number,
    dropped_count: number,         // 0 in log_only
    would_drop_in_enforce: Array<{ citation, reason }>,
  },
}
```

A small helper `pushSafeguardTelemetry(qaLogsMetadata, key, value)` keeps the call sites compact.

## File-by-file changes

### New: `supabase/functions/legal-qa/legalIssueRouter.ts`
Single Gemini Flash call. Returns `LegalIssueRoute` with the contract above (R1). 12s hard timeout enforced by caller (`raceWithTimeout`).

### New: `supabase/functions/legal-qa/openWebDiscovery.ts`
- `shouldRunDiscovery(route, question, depth)` — R8.
- `discoverOpenWeb(question, route)` — sonar-pro, NO `search_domain_filter` (the only such call), JSON schema response, post-call sanitizer that strips conclusion-shaped text (R2).
- Tags every candidate with `source_tier` via `classifySourceTier` (R3).

### New: `supabase/functions/legal-qa/entityResolution.ts`
- `resolveTarget(question, route, discovery, plan): ResolvedTarget`
- `identifyMissingSlots(target, packV2)` — used by round 2.
- `buildRound2Queries(target, gaps)` — used by round 2.
- `checkSourcePackGate(target, packV2, mode)` — implements R7 (returns `{ok, missing, blockingMissing}`).
- `buildSoftGateBanner(missing): string`
- `buildAnswerTemplate(query_type, target): string` — R7's narrative scaffold.

### New: `supabase/functions/legal-qa/sourceTier.ts`
- `classifySourceTier(url?, source_type?, host?): SourceTier` — R3.
- `OFFICIAL_HOSTS`, `PRIMARY_LEGAL_HOST_PATHS`, `APPROVED_SECONDARY_HOSTS` constants colocated.

### Edited: `supabase/functions/legal-qa/contracts.ts`
- Add `SourceTier` type.
- Add `source_tier?: SourceTier` to `LegalSourcePackItem`.
- Add `discovery_only?: boolean` to `metadata` shape (used by the invariant guard).

### Edited: `supabase/functions/legal-qa/legalSourcePack.ts`
- `assembleSourcePack` populates `source_tier` per item via `classifySourceTier`.
- Add the R4 hard invariant guard (throws → caught upstream → logged → item dropped).

### Edited: `supabase/functions/legal-qa/decomposition.ts`
- `decomposeAndPlan(question, route?)` — when `route` provided, prepend a 4-line preamble: `target_statute`, `legal_domain`, `ambiguous_terms` disambiguation, `forbidden_topics`. Schema unchanged.

### Edited: `supabase/functions/legal-qa/modeProfiles.ts`
Add to `ModeProfile`:

```ts
legalIssueRouter: boolean;
openWebDiscovery: "off" | "conditional" | "always";
sourcePackGate: "off" | "soft" | "strict";
domainExclusion: boolean;
citationQualityGate: "off" | "log_only" | "enforce";   // R5
targetedGapRetrieval: boolean;
```

| Field | Fast | Deep |
|-------|------|------|
| legalIssueRouter | true | true |
| openWebDiscovery | conditional | conditional |
| sourcePackGate | soft | strict |
| domainExclusion | true | true |
| citationQualityGate | log_only | log_only |
| targetedGapRetrieval | false | true |

### Edited: `supabase/functions/legal-qa/index.ts`
- Imports for the new modules.
- `STAGE_LABELS` extended with the 5 new keys.
- Replace the current `decompPromise` parallel block with R1's serialized router → decompose; discovery launched in parallel with decompose.
- Insert `entity_resolution` join + retrieval-query expansion + R6 ranking-penalty block.
- Insert `targeted_retrieval_round_2` after source_pack v2 (gated).
- Insert `source_pack_gate` before claim_map (gated).
- Wire `buildAnswerTemplate(...)` and `softGateBanner` into the structured drafter system prompt.
- Upgrade `footnote_validate` to consult `modeProfile.citationQualityGate` (R5) — `log_only` writes `would_drop_in_enforce`, `enforce` mutates.
- Aggregate all R9 telemetry into `qa_logs.metadata.research_safeguards`.

### New tests
- `legalIssueRouter.test.ts` — contracts-law amendment Q produces `query_type: "statutory_amendment_comparison"`, contract_law domain, family_law in forbidden_domains.
- `entityResolution.test.ts` — merge precedence, `checkSourcePackGate` for the strict statutory_amendment_comparison contract (R7), `shouldRunDiscovery` Fast vs Deep matrix (R8).
- `sourceTier.test.ts` — `nevo.co.il/law_html/...` → `official`, `nevo.co.il/blog/...` → `open_web_untrusted`, supremedecisions → `official`, mishpatim → `approved_secondary`, random ynet → `open_web_untrusted`.
- `eval/contracts-amendment-Q.mjs` — end-to-end: asserts `metadata.research_safeguards.router.query_type === "statutory_amendment_comparison"`, no family-law titles in retrieved set, `source_pack_gate.ok === true` (or transparent uncertainty in strict).

## Phased implementation

| Phase | Deliverable | Files | Validation |
|-------|-------------|-------|------------|
| 1 | Router + bias decomposition | `legalIssueRouter.ts`, `decomposition.ts` (route param), `modeProfiles.ts` (legalIssueRouter flag), `legalIssueRouter.test.ts`, minimal index.ts wiring (router → decompose serialized via `raceWithTimeout`), R9 router telemetry | New router test passes; eval Q1 still answers correctly; `qa_logs.research_safeguards.router.query_type` populated. |
| 2 | EntityResolution + query expansion + topic ranking penalty | `entityResolution.ts`, `sourceTier.ts`, `contracts.ts` (SourceTier + source_tier field), `legalSourcePack.ts` (populate source_tier + invariant guard), `entityResolution.test.ts`, `sourceTier.test.ts`, index.ts wiring for retrieval-query expansion and R6 ranking penalty | Eval Q1 expandedQueries appear in retrieval logs; family-law matches downweighted (visible in `domain_exclusion.penalties`); zero invariant violations. |
| 3 | OpenWebDiscovery (metadata-only) + discovery → trusted re-fetch path | `openWebDiscovery.ts`, index.ts wiring (parallel-with-decompose discovery), R9 discovery telemetry | Discovery fires for "התיקון האחרון" Q; sanitizer drops zero conclusion-shaped fields on a clean run; candidate URLs surface in next round of trusted Perplexity retrieval. |
| 4 | source_pack_gate (soft Fast / strict Deep) + answer template injection + soft banner | `entityResolution.ts` (`checkSourcePackGate`, `buildAnswerTemplate`, `buildSoftGateBanner`), index.ts wiring, R9 gate telemetry | Eval Q1 in Deep returns either grounded answer or transparent uncertainty; in Fast, soft banner present when slots missing. |
| 5 | Targeted retrieval round 2 (Deep only) | `entityResolution.ts` (`identifyMissingSlots`, `buildRound2Queries`), index.ts wiring | Round-2 queries differ from round 1; Deep `coverage_gap` claims_anchored % improves on the eval suite. |
| 6 | Citation quality gate in `log_only` for both modes | index.ts `footnote_validate` upgrade, R9 footnote_validation telemetry | `would_drop_in_enforce` counts written for ≥50 production responses across one week; review before flipping Deep → `enforce`. |

## Out of scope (deferred)

- New AI model integrations (uses existing Gemini Flash + Perplexity sonar-pro).
- New DB tables (everything goes in `qa_logs.metadata.research_safeguards`).
- UI changes (StageProgressList already de-dups by stage name; new stages show up via `STAGE_LABELS`).
- Word add-in (no `stream: true` from add-in; same JSON contract).
- Flipping `citationQualityGate` to `enforce` (Phase 6 ships log-only; enforce flip is a separate config-only PR after telemetry review).

## Risks + mitigations

- **Router timeout adding latency to Fast.** 12s hard cap; on timeout, decomposition runs unbiased and the question still answers (with the legacy quality bar). `router.timed_out` telemetry catches systematic regressions.
- **Discovery sanitizer over-stripping useful entity fields.** `sanitized_fields` count surfaces this; if >10% of discovery responses lose ≥3 fields, the conclusion-blocker regex is too aggressive.
- **R7 strict gate rejecting too many Deep responses.** Soft gate ships first; flip to strict only after `source_pack_gate.ok` rate baseline.
- **Source-tier classifier mis-tagging trusted hosts.** Unit tests cover the obvious cases; for edge cases the default is `open_web_untrusted` (safe — never citable).
- **Invariant guard throwing on legitimate items.** Caught + logged + dropped silently in production; admin diagnostic surfaces `invariant_violation` count for triage.

## Files

### New
- `supabase/functions/legal-qa/legalIssueRouter.ts`
- `supabase/functions/legal-qa/openWebDiscovery.ts`
- `supabase/functions/legal-qa/entityResolution.ts`
- `supabase/functions/legal-qa/sourceTier.ts`
- `supabase/functions/legal-qa/legalIssueRouter.test.ts`
- `supabase/functions/legal-qa/entityResolution.test.ts`
- `supabase/functions/legal-qa/sourceTier.test.ts`
- `eval/contracts-amendment-Q.mjs`

### Edited
- `supabase/functions/legal-qa/modeProfiles.ts` (6 new flags incl. `citationQualityGate` enum)
- `supabase/functions/legal-qa/contracts.ts` (`SourceTier` + `source_tier` field)
- `supabase/functions/legal-qa/decomposition.ts` (optional `route` param)
- `supabase/functions/legal-qa/legalSourcePack.ts` (populate `source_tier` + invariant guard)
- `supabase/functions/legal-qa/index.ts` (orchestration: ~250 net new lines across the listed insertion points; STAGE_LABELS extension; footnote_validate rollout-mode upgrade; R9 telemetry aggregation)

### Memory updates (after Phase 6)
- `mem://logic/legal-qa/legal-issue-router`
- `mem://logic/legal-qa/open-web-discovery`
- `mem://logic/legal-qa/source-tier-taxonomy`
- `mem://logic/legal-qa/source-pack-gate`
- `mem://logic/legal-qa/citation-quality-gate-rollout`
- update `mem://features/legal-qa/research-depth-modes` with the 6 new profile flags
