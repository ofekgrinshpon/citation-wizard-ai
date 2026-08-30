# academic_citation_authority_alignment_v1

Align academic claim categories, available source authority, and the claim-source-match gate so academic drafts can cite the doctrinal sources they actually rest on — without ever letting secondary literature stand in for a court holding, statutory text, a docket-specific outcome, or a binding-law statement.

## What changes, in plain terms

Today an academic draft asks for "binding case law" style support, gets literature instead, writes claims tagged as court holdings, and then the safety gate strips nearly every footnote. Four moves fix that mismatch:

1. Academic blocks get their own claim categories (background, framing, theory, literature synthesis, critique, methodology) that literature can legitimately support.
2. When no acquired primary source backs a block, the draft is required to use cautious academic phrasing instead of "בית המשפט קבע כי" / "החוק קובע".
3. The gate learns the academic categories, and stops stripping literature from substantive academic blocks.
4. Retrieval stops throwing away academic material just because the query slot asked for a judgment or a statute, and adds soft roles for critique/counter-position and implementation/example.

Primary-law safety is untouched: exact holdings, statutory text, docket questions, canonical quotes and binding-law claims still require acquired primary authority.

## Technical plan

### 1. Academic claim categories — `stages/claimSupportCategory.ts`
- Extend `ClaimSupportCategory` with `doctrinal_background`, `academic_framing`, `theoretical_explanation`, `literature_synthesis`, `critique_or_counterposition`, `methodological_framing`.
- `categoryAccepts` for all six: accept `doctrinal_authority` (eligible acquired secondary) as well as judgment/statute authority; `background_only` stays rejected.
- `deriveClaimCategory` gains an `academicMode` input. In academic mode the default for untagged blocks becomes `doctrinal_background` instead of `doctrinal_synthesis`, and `black_letter_rule` / `application` proposition types map to `theoretical_explanation` unless the drafter explicitly declared a primary category.
- The docket-identity escalation to `court_holding` stays active in academic mode — a block naming a concrete docket still needs a judgment body.

### 2. Primary-law language guard — new `stages/primaryLanguageGuard.ts`
- Deterministic Hebrew detector for unsupported primary-law formulations ("בית המשפט קבע", "ההלכה היא", "החוק קובע", "הפסיקה הכריעה", "נפסק כי", "סעיף … קובע").
- Applied post-draft, per block, only when `user_task_intent = academic_writing` **and** the block kept no acquired primary source: rewrite to the cautious register ("בספרות ניתן למסגר", "הדיון הדוקטרינרי מציג", "המקורות המשניים מתארים", "ניתן לטעון כי", "הטיוטה מניחה כנקודת מוצא").
- Blocks that do keep an acquired primary ref are left alone.
- Also add the same instruction to the academic prompt slice in `stages/academicPromptCleanup.ts` so the model mostly avoids the phrasing up front; the guard is the deterministic backstop.

### 3. Academic-aware claim-source-match — `stages/claimSourceMatch.ts`
- `applyClaimSourceMatch` accepts `academicMode: boolean`.
- Rule B (`commentary_in_substantive_block`): skipped in academic mode for the six academic categories when the source is an eligible acquired doctrinal secondary with verifier verdict `direct` or `partial`.
- Rule E keeps rejecting doctrinal secondary for `court_holding` / `statutory` in every mode.
- `commentary_only_claims` still recorded, but in academic mode it no longer drives the commentary-only limitation caveat (the academic "הערת עבודה" already carries the scope note).
- Run the primary-language guard after ref selection, so the decision uses the final kept refs.

### 4. Source role expansion — `stages/sourceDepthPolicy.ts` / academic planning
- For academic runs add soft roles to the source mix: primary legal anchor (if available), doctrinal background, theoretical/normative, critique/counter-position, implementation/example.
- Add two query intents to the academic nomination/facet set targeting critique ("ביקורת על", "עמדה מנוגדת", "הסתייגות") and applied/example material.
- Roles are advisory: unfilled roles are reported in telemetry, never fabricated and never a refusal trigger.

### 5. Discovery admission fix — `stages/perplexityRetrieval.ts`
- Thread an `academicMode` flag from `index.ts` (already computed as `sourceUseIntent.plan.user_task_intent`) into `runPerplexityRetrieval` → `processRaw`.
- In `correctRoleForClass`, when academicMode and the class is `academic` / `publisher` under a `binding_case_law` / `primary_statute` / `regulation` query role, remap the role to `scholarship` instead of dropping as role-mismatched; record `role_corrected_from/to`.
- Listing/index and `discovery_only` suppression is unchanged, as is source integrity.

### 6. Primary acquisition
No change to acquisition itself. If primary text is acquired it is used and primary-law language stays allowed; if not, the run proceeds on doctrinal sources under the language guard.

### 7. Telemetry — added to the drafter report and `qa_logs.metadata`
```text
academic_authority_alignment: {
  academic_claim_categories_used, primary_language_blocks,
  unsupported_primary_language_suppressed, doctrinal_secondary_refs_allowed,
  doctrinal_secondary_refs_rejected_for_primary_claims,
  commentary_only_claims_kept, source_roles_expected,
  source_roles_filled, source_roles_missing
}
```
Plus pre/post counters: structured source_refs emitted, refs kept by claim-source-match, refs dropped by authority category, rendered footnotes.

### 8. Validation
- Unit tests: new `src/test/academicAuthorityAlignment.test.ts` covering category acceptance, the language guard (rewrite vs. leave-alone), and the "doctrinal secondary never supports court_holding/statutory" invariant. Existing suites must stay green.
- Live run of AW1, AW4, AW7, AW8 via the existing academic validation runner, checked against the stated acceptance criteria (AW1 no longer 10→0; AW4 keeps materially more legitimate doctrinal refs; AW7 not forced to over-cite; AW8 keeps legitimate refs; no secondary source under a holding/statutory claim; rendering invariants clean).
- Report written to `reports/academic-citation-authority-alignment/ACCEPTANCE_REPORT.md`, including the pre/post funnel table and any off-topic doctrinal sources still surviving in AW8.

## Explicitly out of scope
Judgment identity validation, docket limitation, source integrity, footnote rendering, found-only support rules, and any fixed citation-count target.
