## Goal

Stop the drafter from throwing away a perfectly good Hebrew answer just because the model echoed internal claim labels (`C1 —`, `C2:`, `טענה C1:` …) as section headings. Keep all safety gates; add one narrow deterministic scrub step.

All changes are confined to `supabase/functions/legal-research-v1/stages/drafter.ts`. No retrieval, verifier, candidate pool, marker parser rewrite, footnote placement, Rule 37, or citation-format work.

---

## Root cause (recap)

1. `buildUserMessage` feeds claims to the model as `- (C1) טענה … [is_black_letter=…]` and each source carries `claim_ids: ["C1","C3"]`.
2. The SYSTEM_PROMPT mentions internal IDs once in a single bullet but does not forbid using them as headings.
3. GPT-5 reused those labels as natural-looking section openers (`C1 — …`, `C2 — …`).
4. `detectInternalIdLeak` correctly flagged `C#` → `marker_validation.ok = false` → pipeline returned the hard-coded `STUB_ANSWER`.

The `C\d+` tokens are scaffolding, not legal content. Removing the heading scaffolding does not touch any legal substance, footnote markers, `used_sources`, or footnote numbering.

---

## Plan

### 1. Prompt hardening (drafter.ts SYSTEM_PROMPT, ~line 176)

Replace the single bullet about internal IDs with a stronger, explicit block:

- Tokens like `candidate_id`, `claim_id`, `C1`, `C2`, `C#`, `S1`, `S#`, `LS#`, `cand_*`, `verifier` are internal scaffolding only.
- They must never appear anywhere in `answer_markdown` — not as section headings, not as labels, not in parentheses, not inline.
- Do not organize the answer by claim IDs. Use natural Hebrew section headings derived from the legal content (e.g. **הגדרה**, **יסודות העוולה**, **יישום**, **סייגים**) when structure is needed.
- Reference sources only via the superscript footnote numbers (`¹ ² ³ …`).

Also tighten `buildUserMessage` header from `טענות (claims):` to `טענות (לשימוש פנימי בלבד — אין להזכיר את מזהי הטענות בתשובה):`.

### 2. Narrow deterministic scrub (new helper in drafter.ts)

Add `scrubInternalClaimLabels(answer: string): { text: string; patterns: string[]; changed: boolean }`.

Only the following anchored, conservative patterns are removed (Hebrew + English, line-anchored or wrapped):

| # | Pattern | Action |
|---|---|---|
| a | `^\s*C\d+\s*[—\-:.)]\s+` (line start) | drop the prefix, keep the rest of the line |
| b | `^\s*\(C\d+\)\s*[—\-:.]?\s+` (line start) | drop the prefix |
| c | `^\s*(?:טענה|Claim)\s+C\d+\s*[:\-—]\s*` (line start, case-insensitive for "Claim") | drop the prefix |
| d | `\s\(C\d+\)(?=[\s.,;:!?\)\]]|$)` (standalone parenthetical) | drop the parenthetical |
| e | bold/heading wrappers around any of the above (`\*\*C1\*\*`, `__C1__`) when followed by `—`/`:` | drop wrapper + label |

Explicitly **not** removed: bare `C\d+` mid-sentence with no separator, `C1` inside quoted legal text, anything matching `S\d+` / `LS\d+` / `candidate_id` / `claim_id` / `cand_*` / `verifier`. If any of those leak, do not scrub — fall through to the existing rejection path.

Each successful pattern hit pushes its label (`line_prefix`, `paren_label`, `claim_word_prefix`, `standalone_paren`, `bold_label`) into the returned `patterns` array for telemetry.

### 3. Wire the scrub into the existing flow (drafter.ts, after each `runMarkerValidation` call)

There are two call sites — after the initial gpt-5-mini attempt (~line 710) and after the gpt-5 escalation (~line 759). At each site, in addition to today's `deterministicRepair` (which already handles numbering when there is **no** leak), add:

```text
if (parsed.ok && !marker.ok && marker.internal_id_leak
    && marker.leaked_tokens.length === 1
    && marker.leaked_tokens[0] === "C#") {
  const scrub = scrubInternalClaimLabels(answer);
  scrub_attempted = true;
  scrub_patterns  = scrub.patterns;
  if (scrub.changed) {
    const candidate = scrub.text;
    const m2 = runMarkerValidation(candidate, used);
    // Accept only if all gates pass and footnotes/used_sources are unchanged.
    if (m2.ok
        && !m2.internal_id_leak
        && extractMarkers(candidate).length === extractMarkers(answer).length) {
      answer = candidate;
      marker = { ...m2, repaired: true };
      scrub_accepted = true;
    } else {
      scrub_rejected_reason =
        !m2.ok ? "marker_validation_failed"
        : m2.internal_id_leak ? "residual_leak"
        : "marker_count_changed";
    }
  } else {
    scrub_rejected_reason = "no_pattern_matched";
  }
}
```

Guarantees from the gate:
- `used_sources` is never touched (we only edit `answer_markdown`).
- Footnote marker **count** is preserved → numbering and `footnote_count == used_sources` are preserved.
- Only runs when `C#` is the *only* leaked token type → other leaks still fail closed.
- Runs **before** the gpt-5 escalation on attempt 1 (saves the ~133s second call when scrub is enough) and again after the escalation as a final safety net.

### 4. Telemetry (drafter.ts → DrafterResult & index.ts drafterMeta)

Extend `marker_validation` (or add a sibling `scrub` object on `DrafterResult`) with:

- `internal_id_scrub_attempted: boolean`
- `internal_id_scrub_accepted: boolean`
- `internal_id_scrub_patterns: string[]`
- `internal_id_scrub_rejected_reason?: "no_pattern_matched" | "marker_validation_failed" | "residual_leak" | "marker_count_changed"`

These bubble up into `drafterMeta` in `legal-research-v1/index.ts` (single field add — no other change to that file).

### 5. Validation

- **Unit test** `supabase/functions/legal-research-v1/stages/drafter.scrub.test.ts` with synthetic answers:
  - `C1 — טקסט\nC2 — טקסט` → cleaned, validation passes.
  - `(C1) טקסט` standalone paren → cleaned.
  - `טענה C1: טקסט` → cleaned.
  - `C1` mid-sentence with no separator → **not** touched, leak still flagged.
  - Mixed leak (`C#` + `S#`) → scrub skipped, original rejection preserved.
  - Bold wrapper `**C1** — טקסט` → cleaned.
- **Fixture re-run** of L1–L6 via the existing `scripts/legal-research-v1-p7-phaseE5-baseline.ts` runner; diff `marker_validation.ok` and `footnote_count` vs the saved baseline. Expect no regressions.
- **Live re-run** of the failing user question (job `b1f77b7b…`) via `scripts/deep-smoke.ts` or a one-off smoke-mode call; confirm `drafter.ok = true`, `scrub_accepted = true`, footnotes intact.

### Acceptance

- `marker_validation.ok = true` on the previously failing answer.
- No `C\d+` survives in `answer_markdown`.
- `footnote_count == used_sources.length`; `used_sources ⊆ verifier.usable` (unchanged).
- L1–L6 unchanged.
- If scrub cannot fix the answer, current rejection + STUB_ANSWER behavior is preserved.

---

## Side note (no code change in this plan)

You also asked whether the `STUB_ANSWER` fallback should be replaced with a user-friendly error. Recommendation: **yes, eventually** — today a drafter failure surfaces as a confusing "[stub] התשובה תיווצר בשלב P5…" Hebrew message that implies the feature is unfinished. A better UX would be a clear error like *"לא הצלחנו להפיק תשובה מהמקורות שאותרו. נסו לנסח את השאלה אחרת או לצמצם את ההיקף."* plus a 422 status from the edge function so the client can render it as an error card instead of a chat answer. Out of scope for this plan; flag for a separate small task.
