# Step 3 — Anchor-first citation priority (V3 deep)

## Goal
When a **verified** seminal anchor exists for a claim, it must be cited **before** any secondary source on that same claim. Secondary sources are still allowed — just demoted to second position.

This is **anchor-first, not anchor-only**, and **not must-cite**:
- Do NOT cite anchors that failed verification.
- Do NOT cite planned anchors that were never verified.
- Do NOT insert anchors into sentences they were not mapped to.
- Do NOT delete drafter-chosen sources.

Explicitly out of scope for this pass: placeholder footnote suppression, off-topic footnote suppression, citation cleanup, Rule 37 changes, citation-engine changes, retrieval changes, Perplexity changes, Fast mode, academic mode. Those are a separate citation-quality pass.

---

## Priority order (verified only)

Within each claim's `allowed sources`, sort by:

```text
tier 1  verified  statute_section / regulation / basic_law_section
tier 2  verified  leading_case (centrality=seminal)
tier 3  verified  leading_case (centrality=supporting) / committee_report
tier 4  verified  academic / other secondary
tier X  not verified → keep where it was; do NOT promote it
```

"Verified" = the V2 anchor lifecycle gave a verdict of `direct` or `partial` for that source (NOT `tangential`, NOT `unrelated`, NOT missing). Non-anchor sources keep their relative drafter ordering.

---

## Implementation

### 1. Pre-drafter sort (cheap, free signal)
In `buildDrafterPrompts` (`researchV2Pipeline.ts`), when building each ledger entry's `allowedIds` list, sort by the tier rule above using `anchor_lifecycle.per_claim[].candidates` to identify `verified` + `anchor_id` and card `source_type` for tier. LLMs strongly prefer the first listed source, so sorting alone already nudges the right behavior.

### 2. Drafter prompt addendum
Add one short paragraph to the system prompt in `buildDrafterPrompts`:

> כלל סדר ציטוט: כאשר רשימת המקורות המותרים לטענה כוללת מקור מעוגן ומאומת (סטטוט/תקנה/חוק־יסוד/פסיקה מנחה מאומתת), חובה להציבו ראשון ב-[cite:S#] של אותה טענה. ניתן להוסיף אחריו מקור משני אחד (אקדמיה/דו"ח/פסיקה תומכת) אם הוא מוסיף הסבר, ביקורת או הקשר. עיקרון: anchor-first, **not** anchor-only. אסור לעגן טענה במקור שלא נכלל ברשימת המקורות המותרים לאותה טענה.

### 3. Post-draft anchor-first enforcement
New module `supabase/functions/legal-qa/anchorFirstPass.ts`. Runs **after** `parseMarkers` and **before** `buildFootnotes` in `researchV2Pipeline.ts`. Pure TS, no LLM call.

For each claim, look at the `[cite:S#]` token group(s) the drafter actually wrote (i.e. cites that the parser mapped to that claim's allowed set):
- If a verified tier-1/tier-2 anchor exists in the claim's allowed set, ensure it is the **first** id in that cite group:
  - **promoted**: the verified anchor was present but not first → reorder it to first; keep at most one tier-3/4 secondary after it (the rest are dropped from that single group, but the source cards remain available for other claims).
  - **added**: the verified anchor was in the allowed set but the drafter never cited it on this claim → prepend it; keep the drafter's existing secondary as second.
- **kept**: no change needed (anchor already first, or only the anchor was cited).
- **no_anchor_available**: no verified tier-1/2 anchor exists for this claim → leave the cite group untouched.

Hard constraints in code:
- Only rewrite the cite token group(s) belonging to that claim, as identified by `parseMarkers` → claim mapping. Never touch a different claim's sentence.
- Only operate on source ids that exist in the claim's `allowedIds`. Never insert a card the verifier didn't approve for that claim.
- Cap each cite group at 2 ids after enforcement (anchor + one secondary). No 3-cite stacks.

No footnote suppression, no body text changes, no card list changes — only the bracketed `[cite:S#,S#]` token order inside already-anchored sentences.

### 4. Telemetry
Add to `qa_logs.metadata`:

```ts
v3_anchor_first_enforcement: {
  per_claim: [{
    claim_id: string,
    action: "promoted" | "added" | "kept" | "no_anchor_available",
    anchor_id?: string,
    before_order: string[],   // ["S3","S7"]
    after_order: string[],    // ["S1","S3"]
  }],
  totals: { promoted: number, added: number, kept: number, no_anchor_available: number }
}
```

Bump `v3_path` to `deep_v3_step3_anchor_first` in `researchV3Pipeline.ts`.

---

## Files touched

- **NEW** `supabase/functions/legal-qa/anchorFirstPass.ts` — sort helper + post-draft reorderer + telemetry shape.
- **EDIT** `supabase/functions/legal-qa/researchV2Pipeline.ts`
  - `buildDrafterPrompts`: import & apply the shared sorter on `allowedIds`; append the citation-priority paragraph to the system prompt.
  - After `parseMarkers` / before `buildFootnotes`: call `enforceAnchorFirst({ parsed, ledger, anchorLifecycle })`, attach result to `metadata.v3_anchor_first_enforcement`.
- **EDIT** `supabase/functions/legal-qa/researchV3Pipeline.ts`
  - `v3_path` → `"deep_v3_step3_anchor_first"`.

V1 path untouched. Fast mode untouched. Academic mode untouched. Citation engine untouched. Rule 37 untouched. Drafter, ledger, retrieval, Perplexity, footnote builder all otherwise untouched.

---

## Validation

Re-run on Q1, Q3, Q5, Q7 (deep mode). For each, report:
- `v3_path`
- `doctrinal_frame` (sanity — should match Step 2.3)
- `v3_anchor_first_enforcement.totals`
- per-claim `before_order` / `after_order` where action ≠ `kept` / `no_anchor_available`
- First cited source for the central legal claim in the body

## Acceptance gates

- **Q1**: a verified procedural anchor (תקנה 95 / סעיף 75 / שפע בר if verified) is the **first** cite on the procedural claim, before any academic commentary.
- **Q3**: a verified constitutional anchor (BL §8 / בנק המזרחי if verified) is the **first** cite on the constitutional-review claim, before ברק / proportionality literature.
- **Q5**: a verified contract anchor (אפרופים / סעיף 25 if verified) is the **first** cite on the interpretation claim, before academic commentary.
- **Q7**: a verified exhaustion / administrative-courts anchor (פסטרנק / חוק בתי משפט לעניינים מינהליים if verified) is the **first** cite on the exhaustion claim, before academic commentary.
- Footnote cleanup is **not** evaluated.
- No V1 fallback. No raw open-web citations. V2 ledger / drafter / citation engine otherwise unchanged.
- `v3_anchor_first_enforcement.totals.promoted + added ≥ 1` on at least one of the four questions where Step 2.2 review showed the drafter had skipped a verified seminal anchor.

## Out of scope (explicit)
Placeholder suppressor, off-topic footnote suppression, citation cleanup, Rule 37 edits, citation-engine edits, retrieval changes, Perplexity changes, Fast mode, academic mode, must-cite enforcement.
