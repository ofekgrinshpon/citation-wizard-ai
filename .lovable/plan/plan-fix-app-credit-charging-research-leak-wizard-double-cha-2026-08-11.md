# Plan: Fix app credit charging (research leak + wizard double-charge)

## Current credit model

Plans: Basic 20 / Pro חודשי 250 / Pro סמסטר 1100 / Pro שנתי 3600 / Admin ∞. Monthly/period reset.

| Section | Function | Credits actually charged | Status |
|---------|----------|--------------------------|--------|
| Citation Wizard — AI path | `citation-chat` | 2 (server 1 + client `incrementCount` 1) | ⚠️ double-charge |
| Citation Wizard — verified hit | — | 1 (client only) | OK |
| Batch Footnote Builder (per source) | `citation-chat` | 1 | OK |
| Bibliography Generator (per source) | `bibliography-lookup` | 1 | OK |
| Case Summary | `legal-qa` | 5 (+2 with doc) | OK |
| Academic short steps (outline/topics/validate) | `legal-qa` | 0 free | OK |
| Academic chapter write | `legal-qa` | 8 (offline 503) | disabled |
| **Legal Research** | `legal-research-v1` | **0 — pre-flight only, never `consume_credits`** | ⚠️ leak |

## Two bugs to fix

### Bug 1 — Legal Research never charges (unlimited access)
`legal-research-v1/index.ts` (lines 220–240) has a pre-flight that only checks `included + topup >= 5` and returns `402` if below, but **never calls `consume_credits`** (confirmed: no consume/refund anywhere in the function). A basic user's 20 credits never deplete, so the `>= 5` gate passes on every query forever — effectively unlimited research, the most expensive pipeline in the app.

Fix (mirror the proven `legal-qa` charge pattern):
1. After the pre-flight, before heavy work, call `consume_credits({ _amount: RESEARCH_COST, _reason: "legal-research-v1", _request_id })` via the authenticated `userClient`.
   - `RESEARCH_COST = 5` (matches `CREDIT_COSTS.legalQa` and the current `required: 5`). Add `research: 5` to `src/lib/creditCosts.ts` as the single source of truth and use it in the function.
   - On `INSUFFICIENT_CREDITS` return `402` with `required`/`remaining_included`/`remaining_topup`.
   - Hoist `creditsCharged` + `creditRequestId` in outer state so the catch-all refunds on unexpected throws (same as `legal-qa`'s `refundAndPayload`).
2. **Refund on refusal/failure**: when the pipeline ends in a `docket_limitation` / `insufficient_sources` refusal or a stage error, refund via `refund_credits` (idempotent). Only a successfully drafted answer keeps the charge. (Default: "no answer = no charge", matching `legal-qa`.)
3. **Frontend gate** in `LegalResearchV1Panel.tsx`: add `useCredits()`; if `!isAdmin && totalCreditsAvailable < RESEARCH_COST`, open the existing `InsufficientCreditsDialog` instead of invoking. Surface a clear message on a `402` response.
4. Make the existing `>= 5` pre-flight use the same `RESEARCH_COST` constant.

### Bug 2 — Citation Wizard double-charges
`src/pages/Index.tsx` calls `callAPI()` → `citation-chat` (which consumes 1 credit server-side at index.ts:1722), **and then** calls `await subscription.incrementCount()` (line 376 etc.), which consumes another 1 credit client-side. Result: 2 credits per AI citation instead of 1.

Fix:
- Remove the redundant client-side `incrementCount()` calls on every path that goes through `callAPI()`/`citation-chat` (lines 355, 376, 432, 499, 625, 690). The server already charges and refunds on failure.
- Keep `incrementCount()` only on the two paths that do **not** call `citation-chat` (verified-source direct hit at line 355/471 and `handleSuggestionAccept` at 471), since those have no server-side charge.
- Verify each path so we don't end up charging zero on the AI path.

## Validation

- Basic user with < 5 credits: research shows dialog, cannot start.
- Basic user with ≥ 5 credits: balance drops by 5 on a successful research draft; refunded on refusal/error.
- Citation wizard AI path: balance drops by exactly 1 per citation (not 2); refunded on technical failure (server path already does this).
- Verified-source hit path: still 1 credit.
- Admin: bypassed.

## Decisions to confirm

- **Refund on research refusal policy**: default "refuse = refund, only a drafted answer keeps the charge". Confirm or change.
- **Research cost**: 5 credits (consistent with case summary and current threshold). If research should cost more given pipeline weight, say the number.
- **Citation cost**: keep at 1 per AI citation (after removing the duplicate), or change.
