# Phase C — Stage 2 party-lookup retry for Fast/Deep research caselaw

Mirror the chapter Stage 2 loop into the research-mode block (`legal-qa/index.ts` ~line 6446–6587). Add per-mode flags so the policy is data-driven and the Fast question ("worth the latency?") gets answered by the eval, not by guessing now.

## What ships in Phase C

### 1. New `MODE_PROFILES` flags (`supabase/functions/legal-qa/modeProfiles.ts`)

```ts
/** Enable Stage 2 Perplexity party-lookup retry on caselaw footnotes
 *  flagged needs_party_lookup. Off by default for Fast (latency-sensitive),
 *  on for Deep. */
partyLookupRetryEnabled: boolean;

/** When the retry succeeds but only a placeholder citation can be emitted,
 *  whether to keep it (`emit`) or drop it (`drop`). Mirrors the chapter
 *  best-effort policy. */
partyLookupPlaceholderPolicy: "emit" | "drop";

/** Hard ceiling on how many dockets we will batch into a single
 *  `lookupPartyNames` call per request. Bounds latency for caselaw-heavy
 *  questions. */
partyLookupMaxBatchSize: number;
```

Defaults:

| field | fast | deep |
|---|---|---|
| `partyLookupRetryEnabled` | `false` (will be flipped to `true` after eval, see Phase C.2) | `true` |
| `partyLookupPlaceholderPolicy` | `"emit"` | `"emit"` |
| `partyLookupMaxBatchSize` | `3` | `6` |

Rationale for "emit" on both: the user already chose `emit` for chapters because partial caselaw is more useful than no caselaw. Same product reasoning applies to research mode. The `placeholder_dominant` filter still acts as the final safety net.

### 2. Code changes in `supabase/functions/legal-qa/index.ts` (research-engine block ~6446–6587)

Restructure the existing single-pass loop to mirror the chapter block:

```text
research-engine block:
  ├── pass 1: classify + apply non-caselaw + apply legal_resolver(resolved)
  │           collect needs_party_lookup → pendingPartyLookup[]
  ├── if (modeProfile.partyLookupRetryEnabled && pending.length > 0):
  │     ├── lookupPartyNames(requests, capped at maxBatchSize)
  │     ├── for each pending: re-route with partyLookupRetry: true + hints
  │     │     ├── resolved + clean → mutate fn.citation, count recovered
  │     │     ├── resolved + placeholders:
  │     │     │     - if policy === "emit": mutate, count recovered_with_placeholders
  │     │     │     - if policy === "drop": leave original, count failed
  │     │     └── still unresolved → leave original, count failed
  │     └── populate research_engine.party_lookup{...}
  └── else if pending.length > 0 (flag off):
        apply original needs_party_lookup result, party_lookup stays null
```

Implementation notes:
- Reuse the chapter `applyRoutedResult` shape inline (no extraction to a helper — the two blocks have different telemetry counters).
- Research mode does **not** maintain `fnNumberToCard`, so:
  - First-pass router call stays hint-less (current Phase B behaviour).
  - Stage 2 retry passes only `party1Hint`, `party2Hint`, `fullDateHint`, `yearHint`, `partyLookupRetry: true` — no `titleHint`/`caseNumberHint`. That's consistent with Phase B's "honest baseline".
- Wrap the `lookupPartyNames` await in a per-call timeout already enforced inside `partyLookup.ts` (20s `AbortController`). No extra timeout needed.
- Cap `requests.length` to `modeProfile.partyLookupMaxBatchSize`. Excess pending entries get the same fallback as `flag off` (apply original `needs_party_lookup` result, count under `failure_reasons.skipped_over_batch_cap`).

### 3. Telemetry

Add to `metadata.research_engine`:

```jsonc
"party_lookup": {
  "attempted": N,
  "recovered": N,
  "recovered_without_full_date": N,
  "recovered_with_placeholders": N,
  "placeholder_fields": { "fullDate": N, "party1": N, ... },
  "failed": N,
  "failure_reasons": { "no_match": N, "retry_still_unresolved": N, "skipped_over_batch_cap": N, ... },
  "status": "ok" | "no_perplexity_key" | "request_failed" | "timeout" | "no_candidates",
  "wall_ms": N        // wall-clock time of the lookupPartyNames call only
}
```

Or `null` when the flag is off OR no candidates were found. Mode label flips from `"canonical_reemission"` → `"canonical_reemission+party_lookup"`. Log tag flips from `[research-engine][phase-b]` → `[research-engine][phase-c]`.

### 4. Validation matrix

Two eval batches, run sequentially so we can decide Fast independently:

**Deep (flag default-on):**
- `eval/deep-mode-q1-q6-q21.mjs` x2 repeats labelled `research-router-C-deep`.
- Acceptance:
  - `party_lookup.attempted > 0` on at least one of Q1/Q6.
  - At least one `recovered` OR `recovered_with_placeholders` across the two repeats — otherwise Phase C is a no-op (same ruling we made for the chapter `recovered_without_full_date` story).
  - `wall_ms` increase ≤ 30% vs the deep-baseline median measured before C.
  - No new `qa_guard.flags`. `placeholder_dominant` does not increase.

**Fast (flag default-off baseline first, then toggle on):**
- Step 1: `eval/fast-parity-q1-q6-q21.mjs` x1 with flag OFF — `party_lookup === null`, output byte-identical to Phase B baseline. Pure regression test that the gate works.
- Step 2: Flip `partyLookupRetryEnabled = true` for fast in a follow-up code change AND re-run `eval/fast-parity-q1-q6-q21.mjs` x2 labelled `research-router-C-fast-on`. Acceptance to keep it on:
  - Median `wall_ms` increase ≤ 5 seconds (user's "few seconds" bar).
  - At least one `recovered` or `recovered_with_placeholders` across the two repeats AND that recovered citation survives the `placeholder_dominant` / `missing_parties` filters into `validFootnotes`. Recovery that gets dropped downstream doesn't count as "meaningful improvement".
  - If both criteria hold → leave Fast flag = `true` and update `mem://logic/legal-qa/research-router.md`. If either fails → revert Fast flag to `false`, document outcome.

This matches the user's tradeoff: "few seconds AND meaningful output quality improvement = keep it on".

## Files touched

- `supabase/functions/legal-qa/modeProfiles.ts` — add three flags + Fast/Deep defaults, expand the JSDoc on the LOCKED DEFAULT block to reflect Phase C.
- `supabase/functions/legal-qa/index.ts` — restructure research-engine block from single-pass into pass-1 + Stage 2 retry + telemetry.
- `.lovable/memory/logic/legal-qa/research-router.md` — new memory file documenting research-mode router + per-mode policy + Fast eval outcome.
- `.lovable/plan.md` — update Phase C status to SHIPPED with the eval results.

## What we explicitly are NOT changing

- Chapter pipeline (lines ~6272–6444): unchanged, separate counters, separate telemetry.
- `MODE_PROFILES` drafting envelopes (word ranges, footnote floors, anchor pass): unchanged.
- Drafter prompts.
- The final `reasonFor` filter: still the gate. Stage 2 placeholder-emitted citations carry `source = "perplexity"` from `lookupPartyNames`, which makes them anchored, so they survive `placeholder_dominant` (same invariant as chapters).
- React-side citation engine — Stage 2 stays Deno-only.
- Phase D (bibliography canonicalization, memo mode) — still deferred.

## Phase C.2 — Fast-on probe outcome (2026-04-25, run `phase-c-fast-on-0e91a9a7`)

**Decision: REVERTED. Fast keeps `partyLookupRetryEnabled = false`.**

Probe: Q1 + Q6 × 2 reps each, depth=fast, flag flipped on, batch cap=3, placeholder policy=emit.

| metric | value |
|---|---|
| wall_ms median | 26.2s (Fast-on) vs ~57s reference baseline — DELTA was negative because the reference was taken from richer Phase B fast runs; latency was NOT the blocker |
| Stage 2 attempted | 6 (across 4 runs; one Q6 rep had 0 candidates) |
| recovered (clean) | **0** |
| recovered_with_placeholders | **0** |
| failed | **6** (all `failure_reasons.no_candidates` from Perplexity) |
| caselaw with parties or placeholders surviving in `validFootnotes` | **0** |

**Root cause** (verified by inspecting raw `qa_logs.footnotes`): Fast's drafter emits malformed / non-Supreme-Court docket strings — examples from Q1 r1:
- `2592/20 (בית המשפט העליון).` — bare docket, missing `בג"ץ`/`ע"א` prefix that Perplexity's prompt requires.
- `18225-06-25 (בית המשפט, לעיל ה"ש 3.` — district-court docket format (`NNNN-MM-YY`), not on `supreme.court.gov.il`/`nevo`.

Stage 2 cannot recover these — Perplexity correctly returns empty `results` when it can't verify a docket on a trusted source. The fix has to be **upstream**: either (a) teach Fast's drafter to emit canonical docket prefixes, or (b) widen Perplexity's `lookupPartyNames` system prompt to accept district-court records. Until then, Fast Stage 2 is pure latency cost with zero improvement.

**Acceptance criteria evaluation:**
- ❌ "At least one recovered or recovered_with_placeholders that survives into validFootnotes" — failed (0).
- ✅ "Median wall_ms increase ≤ 5s" — held (Stage 2 added ~1.4–2.2s when it ran), but irrelevant because recovery criterion failed.

**Action taken:** Reverted `MODE_PROFILES.fast.partyLookupRetryEnabled = false` with a JSDoc comment recording the failure mode and reopen criteria. Deep stays ON (Phase C still shipped for Deep). `mem://logic/legal-qa/research-router.md` updated.

**Reopen when:** Fast drafter learns canonical docket prefixes, OR `lookupPartyNames` is widened to district-court records. Re-run `eval/phase-c-fast-on-probe.mjs` and re-evaluate.
