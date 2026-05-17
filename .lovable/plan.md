## Pass D coverage for all drafter paths + Deep async frontend wiring

### Scope (no changes to retrieval, citation engine, Rule 37, baselines)

---

### 1. Backend — Pass D must apply to every drafter path

**Problem.** Pass D currently rewires only `drafterSourceCatalog` / `drafterCombinedContext`, which are consumed by `buildCompactStructuredPrompt()`. The legacy `systemPrompt` (built at line 5672) embeds the *full* `sourceCatalog` / `combinedContext` and is used whenever:
- `useStructuredDrafterPath` is false (no claimMap, or `claimMapAllowedCount < 1`), or
- the structured call falls back to legacy (Gemini fallback in `aiProvider.ts`).

Result: the ledger-trimmed payload is bypassed and the drafter sees the full 30–40k catalog.

**Fix (single file: `supabase/functions/legal-qa/index.ts`).**
1. Change `const systemPrompt` → `let systemPrompt` (line 5672).
2. Immediately after the Pass D block (after line 6070), when `passDTelemetry.used === true`:
   - `systemPrompt = systemPrompt.split(sourceCatalog).join(drafterSourceCatalog).split(combinedContext).join(drafterCombinedContext);`
   - Log: `[pass-d:legacy-rewrite] systemPrompt ${before}→${after} chars`.
3. In the `useStructuredDrafterPath ? compact : systemPrompt` branch (line 6407–6409): no change — the rewrite above means the legacy branch now also carries the compact payload.
4. Update `passDTelemetry.prompt_chars_before` to reflect the savings on *whichever* prompt was emitted (already does via the additive delta — verify after rewrite).
5. Telemetry addition: `passDTelemetry.applied_to = useStructuredDrafterPath ? "structured" : "legacy"`.

**Q2 ledger-empty residual.** Phase 7 didn't run for `564eec2c` because the gate at line 5468 requires `sourcePackV2 && decompositionV2`, which were null in that async path. That's a *separate* diagnosis the user said is OK to leave for now ("Do not change retrieval"). We will only log a clearer skip reason at line 5470 so the next investigation is one query away:
- Before the `if (...)` block, emit `console.log("[phase7:gate]", { enableDeepPipeline, claimLedgerMode, hasSourcePack: !!sourcePackV2, hasDecomp: !!decompositionV2 })`.

No verification logic, no retrieval rounds, no budgets touched.

---

### 2. Fast sync sanity check

After deploy:
- Curl `POST /functions/v1/legal-qa` with `{ question: "מהם התנאים למתן צו מניעה זמני?", depth: "fast", taskMode: "research" }`.
- Confirm: HTTP **200** (not 202), body contains `answer`+`footnotes`, no `run_id`, total wall < 90s.
- Confirm one Pass D telemetry row appears with `applied_to` populated.

If Fast accidentally trips the async dispatcher, the dispatcher condition will be tightened (`depth === "deep" && !req.headers.get("accept")?.includes("text/event-stream")`).

---

### 3. Frontend — Deep async flow

**Files:**
- `src/components/LegalQAChat.tsx` (the non-SSE Deep submit path at line ~1744).
- New small helper: `src/lib/legalQaPolling.ts`.

**Flow.**
1. Deep submit calls `legal-qa` as today. If response is **HTTP 202** with `{ run_id, poll_endpoint }`:
   - Set message state to "running", store `run_id` on the pending assistant bubble.
   - Start polling `legal-qa-status?runId=<id>` every 2s (cap 10 min, backoff to 4s after 60s).
   - On each tick, update a small progress strip under the bubble: current `checkpoint` (Hebrew label map) + completed stages count.
2. On `status: "completed"`: hydrate the bubble with `answer` + `footnotes` + `metadata` exactly like the sync path; stop polling; persist normally.
3. On `status: "failed"`: render a clean inline error card with `reason` (e.g. `gateway_timeout`, `background_crash`) and a "נסה שוב" button. No retry loop.
4. AbortController integration: existing "Stop" button cancels the poller (does not kill the background job — documented in tooltip).
5. SSE Deep (existing streaming branch) is **untouched**; only the non-stream Deep fetch handles 202.

**Checkpoint → Hebrew label map** (frontend-only, no backend coupling):
```text
queued                 → "בתור"
running                → "מעבד"
legal_issue_router     → "מסווג שאלה"
decomposition          → "מפרק לשאלות-משנה"
open_web_discovery     → "סריקת מקורות"
retrieval              → "אחזור מקורות"
claim_map              → "מפת טענות"
claim_verification     → "אימות טענות"
drafting               → "ניסוח תשובה"
anchor_pass            → "עיגון ציטוטים"
```

No visual redesign — reuse the existing skeleton/spinner component plus a single `<p className="text-xs text-muted-foreground">` line.

---

### 4. Validation

1. Fast sanity (above).
2. Deep Q1 ("צו מניעה זמני"): expect 202 → polling → final answer renders, `pass_d_compact.applied_to` populated (structured or legacy).
3. Deep Q2 (סחיטת דמי חסות): expect 202 → polling → final renders; even if ledger is empty, no crash; if Gemini-fallback fires, telemetry shows `applied_to="legacy"` *and* compact catalog was emitted.
4. Failed-path simulation: confirm the inline error card renders when `legal-qa-status` returns `status: "failed"`.

---

### Out of scope (per user)
- Phase 7 source-pack/decomposition gating fix (separate next pass).
- Drafter model routing changes.
- Any retrieval, citation-engine, Rule 37, or baseline edits.