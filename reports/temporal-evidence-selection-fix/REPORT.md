# Temporal Evidence Selection Fix — Implementation Report

## 1. The exact bug

`assessTemporalValidity()` built ONE global evidence blob:

```ts
const capable = opts.store.all().filter(isCurrentLawCapable).slice(0, 4);
const evidenceText = capable
  .map((s) => `מקור ${s.source_id} | ${s.title} | ${s.url}\n${s.extracted_text.slice(0, 2_500)}`)
  .join("\n\n---\n\n");
```

Every temporally sensitive claim was judged against the first 2,500 characters of up to four
documents. In Batch 3 / Q29 the full חוק רישוי עסקים was acquired, §7ג evidence passed identity,
span and support verification — and the temporal model then answered
`סעיף 7ג אינו מופיע בטקסט שסופק`, because §7ג sits far beyond character 2,500 in that statute.
`applyTemporalGate` correctly removed a claim it was told was unverifiable, and the run degraded to
a limitation-only answer with zero footnotes.

It was an evidence-selection bug in the temporal stage, not an acquisition or verification failure.

## 2. Exact code change

| File | Change |
|---|---|
| `supabase/functions/legal-research-v2/verification/temporalEvidence.ts` | new (~190 LOC) — claim-specific bounded temporal evidence selection |
| `supabase/functions/legal-research-v2/verification/temporalValidity.ts` | the global blob is replaced by per-claim packets; `checked_source_ids` is now per claim |
| `src/test/temporalEvidenceSelection.test.ts` | new — 13 deterministic tests |

Nothing else changed: no acquisition, identity, span, support, drafting, rendering, sufficiency or
prompt changes; `isTemporallySensitive`, `isCurrentLawCapable` and `applyTemporalGate` are untouched.

## 3. How claim-specific temporal evidence is built

For each temporally sensitive verified claim, `buildClaimTemporalEvidence(claim, store)` walks the
claim's OWN supporting source refs (max 3), keeps only `isCurrentLawCapable` sources, and collects:

1. **located statute section window** — when the claim (or the ref locator) names a section;
2. **verified span** — the exact span the verifier accepted, plus ±700 chars of surrounding body;
3. nothing else.

Bounds: ≤3 sources, ≤6 excerpts, ≤2,500 chars per excerpt, 1,800-char section window,
2,500-char prefix only as fallback. A full body is never injected.

Fallback: a claim whose supporting sources yield no capable text falls back to the previous bounded
prefixes of the capable documents (`fallback_prefix: true`), so nothing regresses when no
claim-specific text exists.

Contamination: the user message now renders one block per claim —
`claim_id → its own excerpts only` — with an explicit instruction to judge each claim solely against
the excerpts beneath it. A source that supported claim A is never offered as evidence for claim B.

## 4. Statute-section handling

Section tokens are extracted from the proposition with a narrow `סעיף N[א-ת](sub)` regex, normalized
through the existing `normalizeSectionToken`, and resolved with the existing `locateSection` against
the same source that supported the claim. If the locator does not find the section, **no section
excerpt is produced** and the claim can still end `unresolved` — "absent from the first 2,500
characters" is no longer conflated with "absent from the law", but statute identity alone never
implies the section exists.

## 5. Tests

13 new deterministic tests: section-token extraction; a statute whose §7ג sits past character 50,000
(asserted absent from the old prefix) reaching the checker as located section text; verified span
included; genuinely absent section producing no section excerpt; non-capable source contributing
nothing; contradicting repeal text reaching the checker verbatim; per-claim partitioning and no
cross-claim attachment; bounded excerpt sizes / no full-body dump; prefix fallback identical to the
old behaviour; historical claim still non-sensitive; empty-source claim producing an empty packet.

Full suite: **75 files, 820 tests, all passing.** Deno typecheck of the changed modules passes.

## 6. Q29 — before / after

| | Batch 3 (before) | After |
|---|---|---|
| run_id | 7844a3f6 | 97689654 |
| sensitive claims | 2 | 1 |
| current_verified | 0 | **1** |
| unresolved | 2 | **0** |
| contradicted | 0 | 0 |
| temporal repairs | 1 | 0 |
| footnotes | 0 | **3** |
| answer | limitation-only, 736 chars | substantive, 1,978 chars |
| prompt tokens | 283,168 | **209,036** |

The answer now states §7ג(א) of חוק רישוי עסקים as the source of the revocation power and §7ג(ב)(1)
as the consultation requirement, then analyses the hearing right, cure of the defect and remedy. The
already-verified §7ג evidence survived the temporal gate, and no temporal repair cycle was needed —
which is where most of the 74k token saving comes from.

## 7. Q24 (secondary temporal/statute regression)

| | Before (6ac895ec) | After |
|---|---|---|
| sensitive / unresolved | 2 / 2 | 0 / 0 |
| footnotes | 1 | 1 |
| answer length | 1,473 | 1,843 |
| temporal repairs | 1 | 0 |
| prompt tokens | 272,260 | **153,866** |

No temporally gated loss, no repair cycle, a longer answer at 44% fewer prompt tokens.

## 8. Strong non-temporal regression — Q28

| | Before (d8f88718) | After |
|---|---|---|
| sensitive claims | 0 | 0 |
| footnotes | 1 | 1 |
| answer length | 1,699 | 1,236 |
| prompt tokens | 92,858 | 165,676 |

Zero sensitive claims in both runs, so this path is untouched by the change. The answer remains a
correct mixed-test analysis with the same single verified footnote; the length and token differences
are ordinary run-to-run variance in the research loop, not a temporal effect.

## 9. Token impact

Q29 −74k, Q24 −118k, Q28 +73k (unrelated to the temporal path). The temporal call itself is now
smaller and better targeted; the real saving comes from avoiding unnecessary temporal repair cycles.

## 10. Strictness confirmation

Temporal checking remains independent of verification. The three outcomes are unchanged, the model
is still told that absence of current evidence is `unresolved` and never `current_verified`, a
non-capable source still contributes nothing, a genuinely missing section still yields no excerpt
and can remain unresolved, and `applyTemporalGate` still removes every non-`current_verified`
current-state claim. No detection, capability, support, identity, acquisition or admission rule was
relaxed — only the text the temporal model reads was corrected.

TEMPORAL EVIDENCE SELECTION FIX SHIPPED — TARGETED VALIDATION PASSED
