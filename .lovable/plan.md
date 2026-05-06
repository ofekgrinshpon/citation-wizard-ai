## Findings from the code (before any changes)

**1. Did the style guide run?**
Yes — the wiring is live. In `supabase/functions/legal-qa/index.ts` (~L4408–4420), for `taskMode==="academic_writing"` + `academicStep==="write_chapter"` + `!isAbstract`, `buildStyleGuideBlock()` is appended to the drafter prompt whenever `STYLE_GUIDE_ENABLED!=="false"`. Each run logs `qa_logs.metadata.style_guide = { enabled, version, source }`. We can confirm your specific runs by reading that field — see the verification step below. So the question of whether your output benefited from v1.0-final is answerable from telemetry, not guesswork.

**2. Why "שורה תחתונה" shows up in academic output**
Academic chapters reuse the **research drafter scaffolding**. `buildCompactStructuredPrompt()` (L4147+) hardcodes a research-style 5-section skeleton — **שורה תחתונה / מסגרת נורמטיבית / [תת-סוגיות or ניתוח מעמיק] / השלכות מעשיות / מסקנה** (L4232–4273) — and self-check rule #3 (L4327) re-asserts those exact section names. The academic persona header is *prepended* (L4413), but the structure block underneath still tells the model to title section 1 "שורה תחתונה" and section 4 "השלכות מעשיות". Both are practitioner-memo headings, not academic-chapter headings. The style guide forbids those rhetorical moves but cannot rename a section the prompt explicitly mandates.

**3. Is Deep actually running for chapters? (the "fast placeholders" symptom)**
Backend: yes. `enableDeepPipeline = (taskMode === RESEARCH_MODE) || isAcademicChapter` (L2079) forces chapters through the full Deep pipeline (decompose → plan → retrieve → rerank → source_pack → claim_map → drafter → anchor_pass → statute_completion → coverage_gap → footnote_validate). `modeProfile` is overridden to `MODE_PROFILES.deep`. The chapter is **not** running on Fast.

Frontend: `StageProgressList` hardcodes the header **"מבצע מחקר משפטי…"** (L33) for *every* SSE run — research Fast, research Deep, and academic chapter. That is what looks like "fast placeholders": same generic research-flavored stage list, regardless of mode. The stages themselves (`retrieve`, `claim_map`, `drafter`, `anchor_pass`…) are the real Deep pipeline events, so the engine is correct, but the labels read as research-mode skin.

---

## Plan

### Step 1 — Verify the style guide actually fired on your last run
Read the most recent academic `qa_logs` row for your user and report:
- `metadata.style_guide.enabled` (must be `true`)
- `metadata.style_guide.version` (must be `v1.0-final`)
- `metadata.style_guide.source` (`env` or `admin_override`)
- `metadata.profile_used_academic.step` (must be `chapter`)
- `metadata.chapter_qa_guard` flags (narrative_violation / under_word_floor / high_unresolved_share)

This tells us whether v1.0-final reached the drafter on the run that produced "שורה תחתונה" — and whether the QA guard already flagged style issues.

### Step 2 — Decouple the academic chapter structure from the research memo structure
In `buildCompactStructuredPrompt()`, branch `structureBlock` and the self-check on `isAcademicChapter`. For real chapters, replace the research scaffold with an academic chapter scaffold:

- Drop **שורה תחתונה** entirely. Academic chapters do not open with a practitioner bottom-line.
- Drop **השלכות מעשיות** as a mandatory titled section. If the chapter description calls for normative implications, the model can write a closing analytical paragraph — not a titled "implications" block.
- Replace with: an opening framing paragraph (no title), then **מסגרת נורמטיבית**, then either per-sub-issue analytical sections (when sub-issues ≥ 1) or a single **ניתוח** section, then **סיכום הפרק** (≤ 4–5 sentences, no bullets, no "לסיכום" opener — already enforced by §6 of the style guide).
- Update self-check rule #3 to match the new section list.
- Keep the word floor and footnote floor language unchanged — those are profile-driven and orthogonal.

Research mode (`!isAcademicChapter`) keeps its current 5-section memo structure verbatim. No behavior change for research Fast/Deep.

### Step 3 — Make the live-progress UI reflect mode
In `StageProgressList`:
- Accept an optional `mode: "research_fast" | "research_deep" | "academic_chapter"` prop.
- Header text: "מבצע מחקר משפטי מקיף…" for research_deep, "מחפש ומסכם…" for research_fast, **"כותב פרק אקדמי (מנוע Deep)…"** for academic_chapter. The explicit "מנוע Deep" wording answers the user's worry directly every time the panel renders.
- Pass the mode from `LegalQAChat` based on `taskMode` + `academicStep` + `researchDepth`.

Optional polish (same step): map raw stage names to academic-flavored Hebrew labels for chapters (e.g. `claim_map` → "מיפוי טענות הפרק", `source_pack` → "בחירת מקורות אקדמיים", `anchor_pass` → "עיגון הציטוטים"). Keeps backend stage IDs untouched; pure UI dictionary.

### Step 4 — Re-run and confirm
After Steps 2–3 ship, write one more chapter. Expected:
- No "שורה תחתונה" / no "השלכות מעשיות" titled section.
- Progress panel header reads "כותב פרק אקדמי (מנוע Deep)…".
- `qa_logs.metadata.style_guide.version === "v1.0-final"` and `chapter_qa_guard.any_flag` ideally `false` (or, at minimum, no `narrative_violation`).

### Out of scope (call out, don't do)
- Re-tuning the style guide content itself. v1.0-final stays as approved; the section-naming bug is in the *structure prompt*, not in the style guide.
- Touching research-mode prompts or research progress copy.
- Per-section word-floor changes for chapters (already governed by the Deep profile + `wordRangeMin/Max`).

### Technical anchors (for the implementer)
- `supabase/functions/legal-qa/index.ts` L4147 (`buildCompactStructuredPrompt`), L4232–4273 (`structureBlock`), L4313, L4327 (self-check #3), L4408–4420 (style-guide injection — already correct).
- `src/components/StageProgressList.tsx` L33 (hardcoded header).
- `src/components/LegalQAChat.tsx` ~L2245 (StageProgressList render site) — pass new `mode` prop.
- Telemetry verification: `select metadata->'style_guide', metadata->'profile_used_academic', metadata->'chapter_qa_guard' from qa_logs where user_id=… and task_mode='academic_writing' order by created_at desc limit 5;`
