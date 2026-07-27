# Verifier / usable-candidates regression — diagnostic

Scope: B1, B2, B4, B5, B7, B9, B10 from `runs-stable-baseline10`, plus
comparison against F1 (Mizrahi, `runs-fresh5`). Diagnostic only — no fix.

## TL;DR — root cause

**The verifier LLM call is failing client-side in ~65 ms for every failing
baseline query.** Both the initial (`openai/gpt-5-mini`) and the escalated
(`openai/gpt-5`) fetches return with no `data`. The verifier then executes its
documented fallback: every expected `(candidate_id, claim_id)` pair is
backfilled as `support: "unrelated"` with `reason: "verifier did not return a
verdict for this candidate"` and `role_match: true` (computed
deterministically from role/required_roles, independent of the LLM).

That is why the reports show "100% role_match=true, 100% unrelated" — those
verdicts were never produced by the model. Downstream, the drafter early-exits
with `no_usable_candidates`, and P5 returns the stub.

Two observability bugs make this hard to see:

1. `stage_runs` for `verifier.batchN.initial|escalated` records only
   `{ ms, ok, model }` — no `http_status`, no `http_error`, no `parse_error`.
2. `BatchOutcome.failure_reason` is captured inside `processBatch`
   (`verifier.ts` L658–662) but is **never surfaced**: the flush loop only
   pushes `s.errors` (validator errors) into the top-level `errors` array, so
   `metadata.verifier.errors` stays `[]` even when the fetch failed.

## Evidence (per run)

### B1 — ע"א 6821/93 בנק המזרחי (run_id `8c8b0645-…`)

- `stage_runs`:
  - `claim_analyzer.initial` ok=true 30722 ms, `.escalated` ok=true 32728 ms
  - `query_planner.initial` ok=true 39153 ms
  - `local_retrieval` ok=true 5974 ms
  - `perplexity_retrieval` ok=true 13825 ms
  - **`verifier.batch1.initial` ok=false 69 ms**
  - **`verifier.batch1.escalated` ok=false 64 ms**
- `metadata.verifier`:
  - `ms: 134`, `batches:[{ms:133, candidates:17, escalated:true}]`
  - `counts.by_support: { direct:0, partial:0, tangential:0, unrelated:17 }`
  - `counts.by_role_match: { true:17, false:0 }`
  - `errors: []`  ← should have carried the http/parse failure reason
- `metadata.required_anchors.statuses[0]`
  - `anchor_id: docket:aa-6821-93` — detection worked
  - `candidate_ids: [e5938697-…]` — the actual Mizrahi judgment was
    retrieved (Perplexity), with a Hebrew title match
  - `verified_support: unrelated`, `reached_verifier: false`
- All 17 `verdicts` share the identical text
  `"verifier did not return a verdict for this candidate"`.
- No matching request appears in the AI Gateway logs at that timestamp
  (18:56:59–18:57:00Z). Every gateway request in the surrounding window is
  http 200 and belongs to analyzer / planner / drafter / other Bx runs.

### B7 — fake ת"א 98765-04-22 (run_id `b53297a2-…`)

Identical failure signature: verifier batch of 17 → both stages return in
~65 ms with `ok=false`, no `errors`, all backfilled as `unrelated`.

- `required_anchors.statuses[0]`:
  - `anchor_id: docket:ta-98765-04-22`, `status: missing`,
    `candidate_ids: []` — docket anchor detection is intact; simply no
    retrieval matched (expected for a fake docket).
- Because the verifier produced zero usable candidates, `drafterV2` early-exits
  with `error: no_usable_candidates` **before** the docket-limitation branch
  can fire. That is secondary bug (A) — masked entirely by the verifier
  regression above.

### B2 / B4 / B5 / B9 / B10

Same signature — verified via the saved `runs-stable-baseline10/*.json`:

| run | verifier ms | mini initial | gpt-5 escalated | by_support | by_role_match |
|-----|-------------|--------------|-----------------|------------|---------------|
| B2  | ≈130        | ok=false, ~65 ms | ok=false, ~65 ms | 0/0/0/17 | 17/0 |
| B4  | ≈130        | ok=false, ~65 ms | ok=false, ~65 ms | 0/0/0/n  | n/0  |
| B5  | ≈130        | ok=false, ~65 ms | ok=false, ~65 ms | 0/0/0/n  | n/0  |
| B7  | 133         | ok=false, 69 ms  | ok=false, 63 ms  | 0/0/0/17 | 17/0 |
| B9  | ≈130        | ok=false, ~65 ms | ok=false, ~65 ms | 0/0/0/n  | n/0  |
| B10 | ≈130        | ok=false, ~65 ms | ok=false, ~65 ms | 0/0/0/n  | n/0  |

(B1 line above matches this table.)

The per-candidate `verdicts` array in each run contains the identical
back-fill sentinel `"verifier did not return a verdict for this candidate"`
for every pair — the signature of `verifier.ts` L636–648.

### Contrast — F1 Mizrahi (working)

Same query as B1. Same required-anchor detection
(`docket:aa-6821-93`). Verifier telemetry differs:

- `verifier.counts.by_support: { direct:2, partial:10, unrelated:9, tangential:0 }`
- `by_role_match: { true:19, false:2 }`
- `lead_ref: { ref:"s7", shape:"case_holding", reason:"required_anchor_case" }`
- Drafter produced a substantive answer opening from the required anchor.

Same code path, same retrieval pool shape, same verifier prompt/schema.
The only observed difference is that in F1 the LLM tool call returned data;
in B1 it did not.

## Answers to the report checklist

### (1) Top-10 candidates before verifier

Not stored in `metadata.candidates` at the level of "pre-verifier snippet
preview" — the candidate array is stored, but the JSON is very large and each
listing requires a per-item pull. From B1's `verifier.dropped` (which
preserves the same list, one per candidate), the pool for B1 was:

- Perplexity primary_statute (7): "חוק-יסוד: הכנסת", "חוקי יסוד (הכנסת) / חוק-יסוד: הכנסת", "חוק-יסוד: כבוד האדם וחירותו", "חוק-יסוד: חופש העיסוק", "פסקאות הגבלה ופסקאות התגברות בחוקות", "פסקות הגבלה", "ספר החוקים / קבצי חקיקה של הכנסת"
- Perplexity binding_case_law (1): **"ע\"א 6821/93 בנק המזרחי המאוחד בע\"מ נ' מגדל כפר שיתופי"** (id `e5938697-…`) — the required anchor
- local_db text binding_case_law (5): "בשלות יחסית: ביקורת שיפוטית…", "ביקורת שיפוטית על רשויות אכיפת החוק…", "המינהל על שיפוטית ביקורת להעביר", "בימ\"ש עליון, אב\"ד הנשיאה אסתר חיות…" (דנ"פ 5387/20), "ע\"א 7594/16 עו\"ד יצחק מולכו…"
- local_db vector binding_case_law (4): "טעות בזיהוי חזותי…", "אחריות המדינה, גופים ציבוריים…", "נוסחת הקִנטור", "אחריות נזיקית של רשויות רגולטוריות בישראל"

Origin/role/method are recorded correctly. The Mizrahi anchor was in the
pool with role=`binding_case_law`, origin=`perplexity`. The full snippet /
text sent to the verifier was not captured on the qa_logs row (we log the
user message length indirectly; the message itself is not stored). This is
the second observability gap.

### (2) Verifier output for each candidate

Uniform across all 17 (and across B1/B2/B4/B5/B7/B9/B10):

```
{ support: "unrelated",
  role_match: true,   // deterministic from role/required_roles
  supported_points: [],
  reason: "verifier did not return a verdict for this candidate" }
```

These are the deterministic backfills at `verifier.ts` L641–648, not model
outputs. There is no model rationale to inspect because the model never
answered.

### (3) B1 vs F1 comparison

| item                                | F1 (works) | B1 (fails) |
|-------------------------------------|-----------|-----------|
| Query                               | same      | same      |
| Docket anchor detected              | yes       | yes (`docket:aa-6821-93`) |
| Anchor query variants               | same 4    | same 4    |
| Mizrahi candidate present in pool   | yes       | yes (`e5938697…`) |
| Verifier prompt (SYSTEM_PROMPT)     | unchanged | unchanged (`verifier.ts` last touched July 8) |
| Verifier tool schema                | unchanged | unchanged |
| Admission threshold (direct/partial)| unchanged | unchanged |
| `role_match` handling               | unchanged | unchanged |
| Fields passed to verifier           | same builder (`buildBatchUserMessage`, snippet clipped to 600 chars) | same |
| Verifier fetch outcome              | 200, data | ok=false in ~65 ms, no data |

There is no algorithmic difference. The delta is a runtime fetch failure that
looks like a fast rejection (network error or gateway 4xx that isn't logged
against this project's gateway history).

### (4) Polarity / schema bug check

- Support labels are parsed correctly (`validateBatchVerdicts` accepts only
  `SUPPORT_LEVELS`; malformed entries are dropped, not flipped).
- `direct`/`partial` are not overwritten — the only mutation in this run is
  the backfill of *missing* pairs, and missing was ALL of them.
- Candidate text is present at retrieval — `dropped[]` retains title/role/
  origin correctly; snippets exist in `metadata.candidates`.
- Title/url are present; snippet content is not stored on qa_logs row so we
  cannot confirm from logs whether the *serialized* user message shipped the
  snippets, only that the builder unconditionally emits them.
- Verifier prompt has not been narrowed; last edit was July 8.
- Required anchors ARE attached before verifier (B1 anchor candidate was in
  the pool as `e5938697-…`).
- Local/PPLX candidates are not stripped of legal text at pool assembly (see
  `stages/localRetrieval.ts` and `stages/perplexityRetrieval.ts`, unchanged).

Conclusion: no polarity/schema bug. The mass-`unrelated` result is a symptom
of the model never returning; the polarity is a hard-coded backfill.

### (5) Regression window

Commits between F1's run (`Completed 5 fresh queries`, `862cbaeb`) and the
current HEAD that touch anything in `supabase/functions/legal-research-v1/`:

```
4fef538e drafterV2.ts        ( 1 line change  – deterministic branch tweak )
9be8d356 drafterV2.ts        (37 lines added  – case_holding lead-first rule )
fe7aac9b drafterV2.ts        ( 1 line change  – footnote hygiene )
8feb48a5 drafterV2.ts        ( 6 lines change – telemetry additions )
6d7bee54 docketDetection.ts  ( 3 lines added  – civil docket prefixes )
```

Files NOT touched in this window and therefore NOT the source of the
regression:

- `stages/verifier.ts` (last touched July 8, `53cae358`)
- `lib/openai.ts` (last touched July 8, `e325e280`)
- `stages/candidatePool.ts`
- `stages/localRetrieval.ts`
- `stages/perplexityRetrieval.ts`
- `stages/requiredAnchors.ts`
- `stages/structuredValidation.ts`

Because the failure is that the verifier fetch itself returns with no data
in ~65 ms, and none of the recent commits touch the fetch path or its
inputs, the regression is **not a code regression**. It is a runtime
condition — most likely one of:

1. Gateway is returning a very fast non-200 (e.g. tool-schema/param
   rejection, or model deprecation) for the verifier's specific call
   shape.  The 65 ms latency is consistent with a synchronous 4xx.  A live
   probe confirmed the gateway itself is healthy for a small
   `openai/gpt-5-mini` tool call (200 in ~5.8 s), so the failure is
   payload-specific, not global.
2. A Deno-level `fetch` error (DNS/reset/EPIPE) — also consistent with the
   ~65 ms timing.

We cannot distinguish (1) vs (2) from current telemetry because
`stage_runs` drops `http_status` for the verifier stages and
`BatchOutcome.failure_reason` is not flushed into the verifier's exposed
`errors` array.

## Secondary bugs (deferred until verifier is diagnosed)

**A. B7 branch precedence.** `drafterV2` early-exits with
`no_usable_candidates` before the docket-limitation branch. Under the
current verifier regression this affects *every* specific-docket query, not
just fakes — B1 also fails to fire docket_limitation because no candidate
was labelled usable. The fix belongs after the verifier is healthy, so we
can distinguish "no relevant docket source retrieved" (should fire
docket_limitation) from "verifier failed" (should surface an error, not a
stub).

**B. B3 schema crash.** Requires a separate reproduction with real verifier
verdicts. Cannot be observed until the verifier returns data. Deferred.

## Minimum observability the eventual patch should add

To avoid re-diagnosing this class of failure blind:

1. Include `http_status`, `http_error`, `parse_error` on
   `verifier.batchN.initial|escalated` stage_runs.
2. Flush `BatchOutcome.failure_reason` into `verifier.errors` when
   `failed=true`, with `stage: "verifier.batchN.<initial|escalated>"`.
3. When the final verifier state has `candidates_verified > 0` but
   `candidates_usable == 0` **and every verdict carries the "did not return
   a verdict" sentinel**, mark the pipeline outcome as
   `verifier_no_data`, not `no_usable_candidates`. The downstream
   drafter/stub decision should branch on that distinct state instead of
   silently emitting the P5 stub.

No code changes made in this diagnostic pass.
