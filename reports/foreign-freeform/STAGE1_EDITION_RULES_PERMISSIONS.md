# Stage 1 — Edition, rules, permissions (no code changes)

Date: 2026-11-07. Scope: foreign sources only; Israeli path untouched.

## Edition gap found in code
- Edition 21: classification taxonomy (`src/data/bluebook/classification/taxonomy.ts`), unpublished/periodical renderers, AU/CA local slice, T2 identity sheet (44 entries).
- Edition 22: facade header (`src/data/bluebook/index.ts`), extractor header (`extract.ts`), renderer id `foreign_bluebook_v22`, and v22 T2 publisher index entries in `entitiesIndex.json` (membership only, not rules).
- Proposal: target edition 21 for all rule decisions; treat `foreign_bluebook_v22` as a technical id only; tag each output with the edition used; reconcile the two v22 header comments in Stage 2 (comment-only).

## Rule verification status
- Parallel-reporter preference (Rule 10.3 / T2 per country): NOT verified for ed. 21 from an authorized copy. Until verified, parallel reporters of one decision are offered as a choice, never auto-picked.
- Canada equal-year omission (T2.6): already implemented and approved earlier.

## Permissions
- Bluebook Online terms (eff. 2025-05-01) prohibit reproducing, transmitting, or creating derivative works from site content, and online pages cannot be downloaded or reproduced.
- Consequence: no Bluebook page text may be fed to a model or stored. The model-formatting experiment (Stage 7) may only use (a) rules already encoded in our code, or (b) a short summary written/approved by the user from a licensed copy. Legal confirmation of permitted use is the user's decision.

## Decisions pending from the user
1. Confirm target edition 21.
2. Confirm gemini-2.5-flash via the existing gateway path as first parser model.
3. Confirm per-citation caps: ≤2 searches, ≤2 model calls, no auto-retry on uncertain sends.
4. Who verifies Rule 10.3/T2 reporter order from a licensed copy, and the approved rule-summary source.
