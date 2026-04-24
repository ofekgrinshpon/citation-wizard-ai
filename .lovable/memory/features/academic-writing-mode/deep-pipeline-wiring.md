---
name: Academic Chapter — Deep Pipeline Wiring
description: Academic chapter writes now opt into the full Deep research pipeline (modeProfile, Stage E.5, citation engine resolver) via enableDeepPipeline gate
type: feature
---

Academic chapter writes (`taskMode === "academic_writing"` + `academicStep === "write_chapter"` + not `isAbstract`) flow through the **same Deep pipeline** as research mode.

### Mechanism

A single `enableDeepPipeline = (taskMode === RESEARCH_MODE) || isAcademicChapter` gate (defined right after `isAcademicChapter` is computed in `legal-qa/index.ts`) replaces every bare `taskMode === RESEARCH_MODE` check that gates Deep behavior. For chapters, `modeProfile` is force-overridden to `MODE_PROFILES.deep` after `resolveModeProfile` — any `depth` from the body is ignored.

### What chapters now inherit

- **Decomposition + planner + claim map** (Frame → Decompose → Plan → Retrieve → Rank → SourcePack → ClaimMap → Draft).
- **Stage E.5 Perplexity completion** when `core < perplexityCompletionMinAnchored` (6 in Deep).
- **Round-2 retrieval** (Deep profile has `retrievalRounds: 2`).
- **Anchor pass** (Deep profile has `anchorPassEnabled: true`).
- **Structured drafter** (`gpt-5` legacy variant per Deep profile) with the **5-section Deep scaffold** (שורה תחתונה / מסגרת נורמטיבית ≥3 פסקאות / סעיף לכל תת-סוגיה ≥3 פסקאות ≥250 מילים / השלכות מעשיות ≥2 פסקאות / מסקנה) and the hard 1200-word floor language.
- **Citation engine resolver** runs on `finalFootnotes` post-parse; canonical re-emission overwrites `fn.citation` when resolved. Telemetry in `qa_logs.metadata.chapter_engine = {resolved_count, unresolved_count, drop_reasons}`.

### Academic persona preserved

The academic system prompt (`getAcademicSubModePrompt("write_chapter", body)` — "חוקר אקדמי בכיר", high-register Hebrew, narrative citations, 12,000-char document context) is **prepended** to the structured drafter prompt when `useStructuredDrafterPath && isAcademicChapter`. The Deep scaffold and the academic voice coexist.

### Cost / billing

Chapter cost stays at 8 credits — `creditCost` is computed before the profile override; no credit math change.

### Files

- `supabase/functions/legal-qa/index.ts` — `enableDeepPipeline`, profile override, structured-drafter prompt prepend, post-parse engine resolver loop, `metadata.chapter_engine` block.
- `supabase/functions/legal-qa/modeProfiles.ts` — unchanged; chapters consume the existing `deep` profile.
- `supabase/functions/_shared/citationResolver.ts` — unchanged; reused on chapter output.

### Not widened

- Shadow A/B logger (`runShadowAbComparison`) stays research-only to avoid extra background cost on chapters.
