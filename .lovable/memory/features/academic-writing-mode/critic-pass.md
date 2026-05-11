---
name: Academic Chapter Critic Pass
description: Post-drafter audit + single targeted revision for academic chapters; gated by claim-coverage and severity thresholds
type: feature
---

**Location:** `supabase/functions/legal-qa/critic.ts`, `criticRevision.ts`, wired in `index.ts` between drafter (~line 4614) and anchor pass.

**Trigger preconditions (all required):**
- `isAcademicChapter && useStructuredDrafterPath && useNewDrafter`
- `claimMapV2 && sourcePackV2` present
- `answerText.length >= 200`
- `academicProfile.criticEnabled === true` (chapter / introduction / conclusion only — abstract is excluded)
- Env: `ACADEMIC_CRITIC_ENABLED !== "false"` (default on)

**Critic stage:** `runChapterCritic` calls `callPlannerJSON` with stage `"critic"`, `reasoningEffort: "low"`, 25s timeout. Provider follows the default planner routing (OpenAI when key set, else Gemini). Tool: `report_critique` returning `{ verdict, issues[], coverage }`.

**Issue kinds:** `missing_claim`, `ungrounded_paragraph`, `weak_narrative_citation`, `footnote_density_low`, `off_topic_paragraph`, `anchor_misuse`. Severities: low/medium/high.

**Revision trigger (`shouldRevise`):** `verdict === "revise"` AND any of:
- ≥1 high-severity issue
- ≥2 medium-severity issues
- `claims_supported / claims_total < profile.criticMinCoverage` (chapter: 0.7; intro/conclusion: 0.6)

**Revision pass:** `runChapterRevision` calls the same `callDrafter` variant (`structured`/`legacy`) and timeout as the original drafter. Prompt embeds issues verbatim and instructs surgical fixes only — no new sources beyond the existing source pack, no tone/structure change. Single call, no loop. On empty/error/timeout → keep original draft.

**Telemetry:**
- `qa_logs.metadata.stage_runs` adds `critic` (always when run) and `revision` (only when fired).
- `qa_logs.metadata.chapter_critic` = `{ verdict, coverage, issues_count, issues_summary[], revised, revision_status? }`.
- SSE: `stage` events `critic`/`revision` with running → complete badges.

**Failure semantics:** any exception in critic/revision is caught and logged; the original draft ships unmodified. Critic never blocks the response.
