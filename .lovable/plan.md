
**Phase C.1 — Backend atomic normalization + validation (concrete plan)**

Scope: introduce `[[fn:N]]` as a deterministic, post-validation internal representation, and add an atomic validator. **Do not** expose atomic tokens to the UI yet. **Do not** touch Rule 37. **Do not** touch retrieval / verifier / source selection / Perplexity / URL hygiene / legal-qa / DB schema.

---

**Flag behavior**

Single env flag read once in `drafter.ts`:

- `LEGAL_RESEARCH_V1_ATOMIC_MARKERS`
  - `"off"` (default) — pipeline behavior identical to Phase B.1. No normalization runs. Response `n` is superscript. `marker_format = "legacy_superscript"`.
  - `"validate"` — normalization runs **in-memory only** for validation/telemetry. The shipped `n` is still superscript. Atomic validation result is reported in telemetry. **Safe to deploy to production** — users see exactly what they see today.
  - `"emit"` — pipeline ships atomic `n` (tokens `[[fn:N]]`). `marker_format = "atomic"`. **Must not be set in any environment until C.2 (UI renderer) is deployed and accepted.** Used only by the C.1 fixture runner via an explicit per-request header override.

Per-request override (test-only): runner may send header `x-atomic-markers: emit|validate|off`. Header is ignored unless the env flag is `"validate"` or `"emit"`, so prod can't be flipped accidentally by a client.

Default for the C.1 deploy: `"validate"`. This gives us atomic-validator telemetry on real traffic without changing user-visible output.

---

**Files touched (backend only)**

1. `supabase/functions/legal-research-v1/stages/drafter.ts`
   - Add `ATOMIC_RE = /\[\[fn:(\d+)\]\]/g`.
   - Add `normalizeToAtomic(answer: string, used: UsedSource[]): { atomic: string; ok: boolean; reason?: string }`
     - Uses the same per-char tokenizer as `extractMarkers` (one superscript char = one marker).
     - Replaces every superscript run with the concatenation of `[[fn:N]]` tokens.
     - Pure function. No side effects on `used_sources`.
     - Refuses (returns `ok:false`) if the input contains pre-existing `[[fn:` fragments or unknown marker numbers.
   - Add `extractAtomicMarkers(answer: string): number[]`.
   - Add `validateAtomicMarkers(answer: string, used: UsedSource[]): MarkerValidation`
     - Same shape as `runMarkerValidation`. Independent implementation — does not call superscript code.
     - Enforces: every `[[fn:N]]` resolves to a `used_sources[*].number`; every used source number appears ≥1 time; no duplicate footnote numbers in `used`; no internal-id leak (`candidate_id`, raw URLs, stray `[[fn:` or `]]` fragments outside well-formed tokens); no residual superscript digits in atomic mode.
   - Pipeline insertion point: **after** all existing superscript validation (including the placement repair pass), **before** the Rule 37 call site. Rule 37 stays disabled in C.1 — no change to its code path.
   - Build a `drafter.atomic` telemetry block:
     ```
     {
       mode: "off" | "validate" | "emit",
       normalize_ok: boolean,
       normalize_reason?: string,
       validation: MarkerValidation | null,
       used_sources_byte_equal: boolean,
       superscript_marker_count: number,
       atomic_marker_count: number,
     }
     ```
   - Emit decision:
     - mode `"off"` → ship superscript `n`, `marker_format = "legacy_superscript"`, atomic block omitted or `{mode:"off"}`.
     - mode `"validate"` → ship superscript `n`, `marker_format = "legacy_superscript"`, atomic block populated.
     - mode `"emit"` → require `normalize_ok && validation.ok && used_sources_byte_equal`. If any fail: fall back to superscript output and set `marker_format = "legacy_superscript_fallback"` with `atomic.emit_fallback_reason`.

2. `supabase/functions/legal-research-v1/lib/types.ts`
   - Add `marker_format: "legacy_superscript" | "legacy_superscript_fallback" | "atomic"` to the response type.
   - Add `AtomicReport` interface (the telemetry block above).
   - No change to `Footnote`, `UsedSource`, `MarkerValidation`.

3. `supabase/functions/legal-research-v1/index.ts`
   - Pipe `marker_format` and `atomic` block through to the response and `qa_logs.metadata`.
   - No logic change.

4. `supabase/functions/legal-research-v1/lib/telemetry.ts`
   - No code change; `metadata` already free-form.

Frontend: **untouched** in C.1. `LegalResearchV1Panel.tsx` keeps rendering `result.answer` (superscripts) exactly as today.

---

**Validation runner**

New file: `scripts/legal-research-v1-p7-phaseC1-runner.ts` (parallel to `phaseB1-runner.ts`).

- Sends `x-atomic-markers: emit` per request (force-emit for fixture run only) and `x-rule37: 0` (Rule 37 explicitly off).
- 6 fixtures L1–L6.
- For each fixture, writes `reports/legal-research-v1-p7-phaseC1-L{N}.json` with:
  - `marker_validation.ok` (pre-atomic, superscript)
  - `atomic.normalize_ok`, `atomic.validation.ok`
  - `used_sources` count and `used_sources_byte_equal`
  - atomic vs superscript marker counts (must match)
  - `internal_id_leak` (from atomic validation)
  - `marker_format` in response
  - rule37 status (must be disabled / no-op)
- Writes aggregate `reports/legal-research-v1-p7-phaseC1-summary.json`.

Acceptance gates (block ship if any fail):
- 6/6 `marker_validation.ok = true` (superscript layer unchanged)
- 6/6 `atomic.normalize_ok = true`
- 6/6 `atomic.validation.ok = true`
- 6/6 `used_sources_byte_equal = true`
- 6/6 atomic marker count == superscript marker count
- 6/6 `internal_id_leak = false`
- 6/6 Rule 37 reports `enabled: false` or `applied: false` with `discarded_reason: "disabled"`
- No regression vs Phase B.1 superscript metrics (compared report-to-report)

---

**Deployment guard (user-visibility)**

- Production env flag value at C.1 ship: `"validate"`. Users see superscripts as today. Atomic tokens never reach the browser.
- The `"emit"` mode is reachable only via the fixture runner's explicit header override, which itself only works when the env flag is already `"validate"` or `"emit"`. Header alone cannot promote `"off"` → emit.
- After C.2 (UI renderer) is accepted, a separate deploy flips the env flag to `"emit"`. That promotion is its own change with its own validation; it is **not** part of C.1.

---

**Rollback behavior**

- Code-level: every new function is additive. The pipeline branch on `mode === "off"` is byte-identical to the Phase B.1 path. Setting the env flag to `"off"` (or unsetting it) fully restores Phase B.1 behavior without redeploy if the platform supports runtime env edits, otherwise via a one-line env change + redeploy.
- Data-level: nothing is written to the DB that isn't already free-form metadata. No migration to roll back.
- If atomic validation fails in `"emit"` mode at runtime, the function auto-falls back to superscript output (`legacy_superscript_fallback`) and logs the reason. No user-visible breakage even if the flag is mis-flipped.
- If a regression is observed post-deploy, immediate mitigation is `LEGAL_RESEARCH_V1_ATOMIC_MARKERS=off`. Code can stay in place.

---

**Out of scope for C.1 (explicit)**

- Rule 37 changes — deferred to C.3.
- UI renderer — deferred to C.2.
- Drafter prompt changes — none. The model keeps emitting superscripts.
- DB schema — no migration.
- Retrieval, verifier, source selection, Perplexity, URL hygiene, footnote shape, legal-qa — untouched.
- Historical answer rewriting / backfill — none. Legacy rows remain as-is.

Stop after the Phase C.1 report. C.2 is a separate approval.
