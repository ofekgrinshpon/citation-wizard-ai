---
name: Academic Style Guide v1
description: Distilled, versioned Hebrew prescriptive style guide injected into Deep write_chapter drafts (Option B); admin-gated per-request override
type: feature
---

**Scope.** Real body chapters only — `taskMode === "academic_writing"` AND `academicStep === "write_chapter"` AND `!isAbstract`. Excludes intro, conclusion, abstract, outline, validate, topics, Fast research, citation-chat.

**Asset.** `supabase/functions/legal-qa/academicStyleGuide.ts` exports `ACADEMIC_STYLE_GUIDE_VERSION` and `buildStyleGuideBlock()`. The block is fenced with header `כללי סגנון אקדמי — לא מקור לציטוט (גרסה …)` so the drafter never treats it as a citable source. Hard cap: ≤12,000 chars (~3,000 Hebrew tokens); runtime warns if exceeded.

**Injection point.** `legal-qa/index.ts` ~line 4410 inside the `useStructuredDrafterPath && isAcademicChapter` branch. Style guide appended **after** the academic header and **after** the structured drafter prompt, **before** the source block at compose time. Position: persona → drafter scaffolding → style guide → sources.

**Gating.**
- Env: `STYLE_GUIDE_ENABLED` (default `"true"`; set `"false"` to disable globally).
- Per-request override: `body.styleGuideEnabled: boolean` honored **only when `isAdminCaller === true`** (admin role in `user_roles`). Mirrors the `evalForceLegacy` pattern. Non-admin requests always follow env.

**Telemetry.** `qa_logs.metadata.style_guide = { enabled, version, source }` where `source ∈ {"env","admin_override"}`. Real chapters only; null otherwise. Enables clean version A/B over time.

**Distillation pipeline (offline).** `eval/distill-style-guide.mjs` runs locally:
1. Stratified sample of ~150 `legal_documents` rows where `source_type='journal_article'`, capped 6 per journal.
2. Per-article gpt-5 call (reasoning=medium) → 8-dim structured observation via tool calling.
3. Synthesizer gpt-5 call (reasoning=high) → Hebrew prescriptive draft, ≤12,000 chars.
4. Outputs `eval/style-guide-output/observations-v1.json` + `draft-style-guide-v1.md`.
5. **Human review is mandatory** before promoting the draft into `academicStyleGuide.ts`.

**9 dimensions** (matches both observation schema and the runtime asset section structure): paragraph rhythm, opening moves, transitions, counter-argument handling, footnote density, closing moves, register, anti-patterns, comparative context.

**Eval.** `eval/style-guide-q1-q5.mjs` — 5 fixtures × 2 phases (`PHASE=before` with `styleGuideEnabled=false`, `PHASE=after` with `=true`). Submitted as the admin user so the override is honored. Qualitative read; watch existing `chapter_qa_guard` flags (`narrative_violation`, `under_word_floor`, `high_unresolved_share`) for regressions.

**Versioning.** Bump `ACADEMIC_STYLE_GUIDE_VERSION` on every replacement. v1.0-bootstrap is a hand-distilled placeholder pending the corpus-derived v1; replace it after the first distillation run + human review.

**Out of scope.** Per-run exemplar retrieval (Option A/D) — deferred until telemetry shows a specific rhetorical bucket plateauing. Model fine-tuning (Option C) — rejected; trades grounding capability for marginal style win.
