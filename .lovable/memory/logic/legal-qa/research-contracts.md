---
name: research-contracts
description: Formal camelCase JSON contracts (decomposition, source pack, claim map, drafting input) between legal-research pipeline stages; sanitizeResponse strips internal fields silently.
type: feature
---

The legal-research pipeline uses 4 formal camelCase contracts defined in `supabase/functions/legal-qa/contracts.ts`:

- **LegalResearchDecomposition** — `mainIssue`, `subIssues[]`, `questionType` (normative|applied|interpretive|current_status|comparative|mixed), `requiresLegislation/Caselaw/SecondarySources/CurrentSources`, `userDocumentsRelevant`. Built by `mapToDecompositionV2` from snake_case `decomposeAndPlan` output.
- **LegalSourcePack** — `{ coreSources, supportingSources, secondarySources }` of `LegalSourcePackItem`s. Authority class collapsed to 7 values (primary_legislation, primary_caselaw, secondary_official, secondary_academic, external_reference, user_document, unknown). `sourceId` is `"src-${id}"` string. Built by `assembleSourcePack`.
- **LegalClaimMap** — `{ claims, uncoveredSubIssues }`. Each claim has `statementMode: "direct"|"qualified"|"omit"` derived from snake_case `support_strength`+`allowed_to_state` (strong→direct, partial→qualified, weak→qualified+note, !allowed→omit). Built by `mapToClaimMapV2`.
- **LegalDraftingInput** — bundles all of the above for the drafter. Gate: built only when `claimMapV2.claims.filter(c => c.statementMode !== "omit").length >= 2`.

The drafter prompt prefers V2 (statementMode language) when `draftingInput` exists; otherwise falls back to legacy snake_case prompt or — if no claim map at all — fully legacy path.

**Provenance hardening**: `BANNED_KEYS` (in contracts.ts) lists internal-only keys. `sanitizeResponse` in `index.ts` deep-strips them from the payload silently in production; logs `console.warn` in dev (`DENO_ENV !== "production"`). Never throws — no 500 to user from a leak.

**Mode gate**: `RESEARCH_MODE = "research"` constant at top of `index.ts` is the single source of truth. Frontend currently sends `"research"` (not `"legal_research"`).

**Models** (centralized in `legalResearchModels.ts`): decomposition `gpt-5-mini`/Gemini Flash Lite, claimMap `gpt-5-mini`/Gemini Flash, drafting `gpt-5`/Gemini Flash. `aiProvider.ts` re-exports `MODEL_CONFIG` derived from this config.
