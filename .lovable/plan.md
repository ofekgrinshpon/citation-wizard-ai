# Plan: Charge credits for Legal Research (close the unlimited-access leak)

## Problem

Basic users currently get **unlimited** access to the most expensive feature — Legal Research (`legal-research-v1`).

Root cause, confirmed by reading the code:

- `supabase/functions/legal-research-v1/index.ts` (lines 220–240) has a **pre-flight credit check** that only verifies `included + topup >= 5` and returns `402 INSUFFICIENT_CREDITS` if below. It then runs the full multi-stage research pipeline (planner → retrieval → verifier → drafter).
- That function **never calls `consume_credits`** (confirmed: no `consume_credits`/`refund_credits` anywhere under `legal-research-v1/`). So credits are never decremented after a successful run.
- A basic user starts with 20 included credits. Since nothing is ever charged, the balance stays at 20 forever, and the `>= 5` pre-flight passes on every query — indefinitely.
- The frontend `LegalResearchV1Panel.tsx` has **no client-side credit gate** either (no `useCredits`/`useSubscription`/`hasEnough`).

By contrast, the other surfaces charge correctly:
- Citation wizard (`src/pages/Index.tsx` → `useSubscription.incrementCount` → `consume_credits`, 1 credit/citation).
- `legal-qa` `case_summary` (5 credits + 2 with grounding doc), with refund-on-failure.

So the leak is isolated to `legal-research-v1`.

## Fix

Mirror the proven `legal-qa` charge pattern inside `legal-research-v1/index.ts`:

1. **Charge at the start** (after the existing pre-flight, before heavy work): call `consume_credits({ _amount: RESEARCH_COST, _reason: "legal-research-v1", _request_id })` using the authenticated `userClient`.
   - `RESEARCH_COST = 5` (matches `CREDIT_COSTS.legalQa` and the existing `required: 5` pre-flight). Keep the cost in `src/lib/creditCosts.ts` as the single source of truth and reflect the same value in the edge function.
   - On `INSUFFICIENT_CREDITS` return `402` with `required`/`remaining_included`/`remaining_topup` (same shape `legal-qa` uses).
   - Capture `creditsCharged` + `creditRequestId` in hoisted outer state so the catch-all can refund on unexpected failure (same as `legal-qa`'s `refundAndPayload` pattern).
2. **Refund on failure**: if the pipeline throws, returns a stub/limitation, or fails a stage, refund via `refund_credits` (idempotent on server, like `legal-qa`). Only a successfully drafted answer should keep the charge.
   - The function already tracks terminal outcomes (draft success vs. `docket_limitation`/`insufficient_sources` refusals). Decide charge policy: charge-and-refund-on-refusal is safest and matches user expectation (no answer = no charge).
3. **Frontend gate** in `LegalResearchV1Panel.tsx`: add a `useCredits()` check before submit — if `!isAdmin && totalCreditsAvailable < RESEARCH_COST`, open the existing `InsufficientCreditsDialog` instead of invoking. Also surface a clear message when the edge function returns `402`.
4. Keep the existing `>= 5` pre-flight as a fast early-reject, but make it use the same `RESEARCH_COST` constant.

## Validation

- A basic user with < 5 credits gets `402`/dialog and cannot start research.
- A basic user with ≥ 5 credits: balance decrements by 5 on a successful draft; on a refusal/error the charge is refunded.
- Admin users: bypass charge (existing `admin` plan path).
- Run a couple of research queries via the panel and confirm the credit balance in `profiles` actually drops, then verify a refund path on a forced refusal (e.g., a docket that triggers `docket_limitation`).

## Notes / decisions to confirm

- **Refund on refusal policy**: I'll default to "refuse = refund, only a drafted answer keeps the charge" since that matches `legal-qa` and is the least surprising for users. Tell me if you'd rather charge for refusals too.
- **Cost**: I'll use 5 credits per research query (consistent with `legalQa` and the current pre-flight). If research should cost more given how heavy the pipeline is, say the number and I'll set it.
