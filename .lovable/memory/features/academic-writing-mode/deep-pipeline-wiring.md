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

### Academic persona preserved + outline context

The academic system prompt (`getAcademicSubModePrompt("write_chapter", body)` — "חוקר אקדמי בכיר", high-register Hebrew, narrative citations, 12,000-char document context) is **prepended** to the structured drafter prompt when `useStructuredDrafterPath && isAcademicChapter`. The Deep scaffold and the academic voice coexist.

The chapter prompt is now **outline-aware**: it parses `body.outline` (the full markdown outline produced by `propose_outline`) on the server and extracts the **thesis** (`התזה המרכזית`), **line of argument** (`קו הטיעון`), the **current chapter's description** (`הרחבה`) and **counter-arguments** (`טיעוני נגד`), plus the **titles of all other chapters**. These are injected into the prompt under explicit headers so the drafter knows what the chapter must argue and how it relates to siblings — not just the title.

### Word envelope alignment

The legacy fallback drafter path (used only when claim-map fails) previously hardcoded `500-1200` words for academic chapters, silently halving Deep's 1200-2000 floor on degraded runs. It now reads `${modeProfile.wordRangeMin}-${modeProfile.wordRangeMax}` when `isAcademicChapter`, so a claim-map miss no longer collapses the chapter length.

### Research question lock

`propose_outline` now opens with an explicit lock: "שאלת המחקר שלהלן היא קבועה ואין לשנותה…". The user's RQ is also interpolated **verbatim** into the מבוא section's "שאלת המחקר:" line (no `<...>` placeholder), preventing the model from rewriting/paraphrasing it.

### Cost / billing

Chapter cost stays at 8 credits — `creditCost` is computed before the profile override; no credit math change.

### Files

- `supabase/functions/legal-qa/index.ts` — `enableDeepPipeline`, profile override, structured-drafter prompt prepend, post-parse engine resolver loop, `metadata.chapter_engine` block.
- `supabase/functions/legal-qa/modeProfiles.ts` — unchanged; chapters consume the existing `deep` profile.
- `supabase/functions/_shared/citationResolver.ts` — unchanged; reused on chapter output.

### Not widened

- Shadow A/B logger (`runShadowAbComparison`) stays research-only to avoid extra background cost on chapters.
