
# P6.2 — Verifier latency + drafter depth

Two scoped, independent changes. No retrieval / Perplexity / URL hygiene / footnote rendering / marker parser / frontend / citation formatting / legal-qa changes.

---

## P6.2a — Batch verifier

**Problem.** Verifier runs N sequential LLM calls (one per claim). With 4–6 claims and gpt-5-mini at ~15–25s each, verifier alone is ~80–120s and dominates wall time.

**Change scope.** Single file: `supabase/functions/legal-research-v1/stages/verifier.ts`. Public signature of `runVerifier(question, claims, candidates)` and `VerifierResult` shape unchanged. Output verdict schema unchanged. `role_match` still computed deterministically in code (untouched).

### New batching strategy (hybrid)

1. Build one **combined batch payload** containing:
   - The question
   - All claims (`claim_id`, `text_he`, `required_roles`, `is_black_letter`)
   - All candidates with their `claim_id` (so the model knows which claim each candidate was retrieved for)
2. **Threshold rule** (deterministic, in code):
   - Let `P = total candidates passed to verifier`.
   - If `P ≤ 24` → **1 batch call**.
   - If `P > 24` → **2 batch calls**, partitioning candidates by claim (whole claims kept together; pack claims greedily into 2 buckets balanced by candidate count). Never split a single claim across batches.
   - Hard ceiling: if any single claim has > 24 candidates on its own, that one claim gets its own dedicated call and the rest are batched as above (rare; keeps prompt size bounded).
3. **One escalation per batch** to `gpt-5` if the batch response is invalid/short, mirroring current per-claim escalation. `escalated_claims` is populated from whichever claims were in an escalated batch.

### Prompt changes (verifier.ts SYSTEM_PROMPT)

- Adjust to "you receive multiple claims and a pool of candidates; each candidate is tagged with the claim_id it was retrieved for; emit one verdict per (candidate_id, claim_id) pair you were given."
- Keep all existing quality rules verbatim:
  - direct/partial/tangential/unrelated definitions
  - role-specific guidance (statute / case law / scholarship / factual reports)
  - explicit rejection of noisy exact_authority hits (Ottoman associations law, AG conventions, ministerial pensions, etc.) when the claim is about פיצוי מוסכם / סעיף 15 לחוק החוזים תרופות
  - issue-preclusion vs promissory-estoppel guard for L4

### Tool schema

Same `emit_verdicts` shape, but the array now spans all (candidate, claim) pairs the model was given in that batch. Validation:
- Each returned `(candidate_id, claim_id)` must appear in the input set for that batch.
- Missing pairs are backfilled deterministically as `support: "unrelated"` with reason "verifier did not return a verdict for this candidate" — same as today.
- Unknown ids logged in `errors[]`, same as today.

### Aggregation (unchanged)

- Per-candidate best/worst support, `usable` vs `dropped`, "tangential preferred over unrelated for reason text" logic — all kept as-is.
- `role_match` filled by the existing `rolesMatch()` after the batch returns.

### Telemetry

- `stage_runs` entries become `verifier.batch1.initial`, `verifier.batch1.escalated`, `verifier.batch2.*`, plus optional `verifier.oversized.<claim_id>.*`.
- `per_claim_ms` kept for back-compat: each claim_id mapped to the ms of the batch it was in.

### Validation (re-run the 6 P5 fixtures)

For each of L1–L6 compare against P5.1a baseline:

- `verifier.ms` — expect material drop (target: ≥50% reduction on multi-claim runs).
- `total wall time` — expect commensurate drop.
- `usable` and `dropped` counts within ±1 per fixture vs P5.1a; same candidates flipping in/out is acceptable only if explainable.
- **L3**: סעיף 15 statute candidate still `direct`/`partial`; noisy exact_authority (Ottoman, AG convention, ministerial pensions) still `unrelated`.
- **L4**: no promissory-estoppel / השתק מחמת מצג candidates marked usable.
- **L5**: usable count not lower than P5.1a; reasonableness scholarship still admitted.
- `marker_validation.ok` still true after drafter on all fixtures.

Report at `reports/legal-research-v1-p6.2a-L{1..6}.json` plus a summary diff table.

**Stop condition.** If any fixture regresses on the L3/L4 quality checks above, abandon single-batch and fall back to hybrid threshold = 1 (i.e., one batch per claim = today's behavior) and report it instead of shipping a quality regression.

---

## P6.2b — Drafter style & answer depth

**Change scope.** Single file: `supabase/functions/legal-research-v1/stages/drafter.ts`. Only the `SYSTEM_PROMPT` and the closing instruction line in `buildUserMessage`. No changes to: tool schema, used_sources contract, marker parser, deterministic repair, escalation flow, footnote renderer, validation.

### SYSTEM_PROMPT — replace style block

Keep all grounding rules (use only provided sources, no invention, no internal id leaks, **bold** for emphasis, no `#` headings, footnote-marker contract). **Remove the "120–300 מילים" recommendation** and replace with:

> **סגנון כתיבה**
> - כתוב בעברית משפטית-אקדמית, ברמת חוקר משפטי / סטודנט מתקדם — לא בסגנון צ׳אט קליל.
> - העדף מינוח משפטי ישראלי מדויק (למשל "השתק פלוגתא", "צו מניעה זמני", "פיצוי מוסכם", "סבירות"). אל תשתמש במונחים באנגלית כאשר קיים מונח עברי טבעי.
> - פתח בהגדרת הדוקטרינה / הכלל, המשך בתנאים / יסודות, ואז ביישום ובסייגים. כשיש מחלוקת בפסיקה או בספרות — ציין זאת.
> - התשובה צריכה להיות **מפותחת ומהותית**, לא תקציר קצר. אין מגבלת מילים נוקשה, אך אל תהיה תמציתי מדי: אורך התשובה ייקבע לפי כמות ועומק המקורות המאומתים שסופקו, וצריך לאפשר מענה משפטי משמעותי לשאלה.
> - כל הצעה משפטית מהותית נושאת הערת שוליים. אם תמיכה היא partial בלבד — נסח בזהירות ("יש הסוברים", "ככלל", "במקרים מסוימים") או השמט.

Closing line in `buildUserMessage` updated to: "כתוב תשובה משפטית-אקדמית מפותחת בעברית, מבוססת אך ורק על המקורות שסופקו, עם הערות שוליים בכתב עילי. אל תקצר באופן מלאכותי — נצל את עומק המקורות."

### Guardrails kept

- `answer_markdown` min length still 20 (no upper bound).
- `used_sources` must still be non-empty and a subset of provided refs.
- Marker validation + deterministic repair unchanged.
- Internal-id leak detector unchanged.
- Escalation to gpt-5 unchanged.

### Validation

Re-run the same 6 fixtures (post-P6.2a) and report:
- `answer_markdown` word count (expect noticeably higher than P5.1a, esp. for L4/L5/L6).
- `marker_validation.ok` true on all six.
- `internal_id_leak` false on all six.
- No `[cite:...]` / C#/S#/LS# leaks.
- L3 still cites סעיף 15 footnote; L4 still issue-preclusion only, no promissory-estoppel drift; L6 still completes.
- Spot-check: answers read as legal-academic Hebrew, not chatbot prose.

Report at `reports/legal-research-v1-p6.2b-L{1..6}.json` plus a short qualitative note per fixture.

---

## Order of work

1. Implement P6.2a, deploy edge function, re-run 6 fixtures, write `p6.2a` reports, present diff vs P5.1a.
2. Only after P6.2a is accepted, implement P6.2b, re-run, write `p6.2b` reports.

## Explicitly out of scope

retrieval, candidate pool, Perplexity admission, URL hygiene, citation cleanup, "שם" / "לעיל ה״ש", bibliography, marker parser, footnote renderer, frontend (`LegalResearchV1Panel.tsx`), `legal-qa/index.ts`, DB schema, Fast/Deep, DoctrineClassifier, SourceRequirements.
