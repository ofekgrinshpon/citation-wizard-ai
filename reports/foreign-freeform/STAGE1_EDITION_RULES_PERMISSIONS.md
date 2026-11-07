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

## User decisions (2026-11-07)
1. DECIDED — Edition 21 is the target for this stage only. Implemented rules must be checked against ed. 21; never present ed. 21 as the current edition.
2. OPEN — Parser model. User chose gemini-2.5-flash conditional on it being the model actually wired to the new path. Check (free model listing, no paid call): `google/gemini-2.5-flash` is available but marked **deprecated** (no retirement date given; zero data retention on chat-completions). The existing `citation-chat` formatter call uses it via the gateway chat-completions endpoint. The new parsing path does not exist yet, so its wiring can only be verified once built. Current non-deprecated Flash alternative: `google/gemini-3.8-flash` (zero retention on chat-completions). Awaiting user choice.
3. DECIDED — Development caps per citation: ≤2 searches, ≤2 model calls, no automatic resend when the outcome is unknown. When caps are insufficient, report what is missing; never invent. These are technical limits, not approval for live-test spending.
4. BLOCKED — A person with authorized access to Bluebook ed. 21 must verify reporter order (Rule 10.3 / T2) and document the exact rule and exceptions. Until then: parallel reporters are offered as a choice, and the Stage 7 model-formatting experiment may use only rules already in code. No Bluebook-derived summary is fed to a model until its permitted use is established; viewing the pages is not proof of permission.
