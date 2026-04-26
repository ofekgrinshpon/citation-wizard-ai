## Goal

Add two dedicated chapter roles to the academic writing wizard — **introduction** and **conclusion** — that are generated *late* in the workflow with paper-level context, using their own prompts (not the generic `write_chapter` prompt). Display order in the final paper (intro → body → conclusion → abstract) stays decoupled from generation order (body → conclusion → introduction → abstract).

## How it will work for the user

After outline approval, the chapter strip will always show, in this fixed order:

```text
תקציר  |  מבוא  |  <body chapter 1>  |  …  |  <body chapter N>  |  סיכום ומסקנות
```

Locking rules (strictest, per your choice):

- **Body chapters** — unlocked from the start.
- **סיכום ומסקנות (conclusion)** — locked until *every* body chapter has content. Tooltip: "ניתן לכתוב את הסיכום רק לאחר השלמת פרקי הגוף, כך שהוא מבוסס על הניתוח בפועל ולא על המתווה בלבד."
- **מבוא (introduction)** — locked until the conclusion has content. Tooltip: "ניתן לכתוב את המבוא רק לאחר כתיבת פרקי הגוף והסיכום, כדי שהוא ימסגר את התזה כפי שהיא עולה מהעבודה בפועל."
- **תקציר (abstract)** — unchanged: locked until intro + body + conclusion all have content.

Display order in the assembled paper (export / future "view full paper") will remain intro → body → conclusion → abstract regardless of when each was generated.

## Backend changes (`supabase/functions/legal-qa/`)

### 1. New academic steps + profiles

`academicProfiles.ts`:

- Extend `AcademicStep` union with `"introduction"` and `"conclusion"`.
- Add two new entries in `ACADEMIC_PROFILES` (intro/conclusion). Both inherit Deep envelope characteristics from chapter (deep pipeline ON, 8 credits, same QA-guard thresholds) but with adjusted `documentContextChars` (introduction and conclusion don't need the per-chapter document slice — they consume body-summary context instead). Word ranges stay Deep (1200–2000).
- Update `resolveAcademicProfile` to recognize the new `academicStep` values:
  - `academicStep === "write_introduction"` → `introduction`
  - `academicStep === "write_conclusion"` → `conclusion`

### 2. New dedicated prompts

`index.ts` `getAcademicSubModePrompt`:

- Add `case "write_introduction"`: receives `researchQuestion`, `outline`, `previousChapters` (titles + body-only content), and a parsed `thesisLine` from outline. Prompt instructs the model to do exactly the 7 steps you specified (frame phenomenon → present current law → identify gap → formulate RQ → state thesis → methodology → roadmap), with continuous prose, high register, restrained footnotes (target: 3–6, not 8–14), and an explicit "do not dive into doctrinal analysis" guard.
- Add `case "write_conclusion"`: receives the same paper-level context plus the (already-written) introduction draft if available. Prompt instructs the 6 conclusion steps (restate RQ → present final thesis → synthesize key findings across chapters → show how analysis supports thesis → limits/unresolved → broader implication), with explicit "no new arguments" and "no chapter-by-chapter rehash" guards.
- Both prompts share a `paperLevelContextBlock(body)` helper that emits:
  - Research question
  - Final outline (verbatim)
  - Titles of all chapters
  - Truncated body of each completed chapter (cap ~2,500 chars per chapter for intro, ~3,500 for conclusion since it needs richer recall)
  - Parsed thesis from outline
  - For conclusion: the just-finalized chapter list as the canonical structure

### 3. Pipeline routing

In `index.ts` request handler:

- Treat `write_introduction` and `write_conclusion` like `write_chapter` for credit cost (8), Deep pipeline override (`enableDeepPipeline = true`), and SSE streaming eligibility.
- Update `isAcademicChapter` (currently `academicStep === "write_chapter"`) to be a broader `isAcademicLongForm` that covers all three (`write_chapter` | `write_introduction` | `write_conclusion`). Every existing reference to `isAcademicChapter` in the Deep-pipeline plumbing (drafter prompt prepend at line ~4242, retrieval gates, chapter QA guard, `chapter_engine` telemetry, `profile_used_academic` metadata) keeps working.
- For intro/conclusion: skip the per-chapter `outline` thesis-block parser (lines ~1313–1360) and instead inject the paper-level context block. The structured drafter still gets the Deep scaffold; only the *academic header* prepended in the drafter swap is the new intro/conclusion prompt.
- Word floor / footnote floor: keep Deep envelope, but lower `footnoteFloor` for introduction (synthesis chapter — fewer, framing citations). Easiest path: add an optional `footnoteFloorOverride` field on `AcademicProfile`, used in the drafter prompt builder when present.

### 4. Telemetry

`qa_logs.metadata.profile_used_academic` will now include `step: "introduction" | "conclusion"` automatically (no extra code — `resolveAcademicProfile` already feeds it). Add `chapter_engine.role = "introduction" | "conclusion" | "body"` so we can see resolver behavior per role in retrospect.

## Frontend changes (`src/components/LegalQAChat.tsx`)

### 1. Chapter classification helpers

Add alongside `isAbstractChapter`:

- `isIntroductionChapter(title)` — matches `מבוא` / `introduction` (with prefix tolerance, like the existing abstract helper).
- `isConclusionChapter(title)` — matches `סיכום ומסקנות` / `סיכום` / `מסקנות` / `conclusion`.
- `chapterRole(title): "abstract" | "introduction" | "conclusion" | "body"` — single source of truth; UI and lock logic both use it.

### 2. `approveOutline` — force-inject intro and conclusion

After parsing chapter titles from the outline:

- Strip any model-emitted intro/conclusion (so we don't get duplicates with slight title variations).
- Build the canonical chapter list: `["תקציר", "מבוא", ...bodyTitles, "סיכום ומסקנות"]`.
- The `propose_outline` prompt already says "אל תכלול תקציר במתווה — התקציר יסונתז בנפרד בסוף." We'll extend that line to also exclude intro/conclusion, and instruct the model to plan only body chapters.

### 3. Lock rules

Replace the current `abstractUnlocked` block with a unified gating computation:

```text
bodyChapters       = chapters.filter(role === "body")
allBodyDone        = every body chapter has content
conclusionUnlocked = allBodyDone
introUnlocked      = allBodyDone && conclusion chapter has content
abstractUnlocked   = allBodyDone && conclusion has content && intro has content
```

Each chip in the chapter strip uses its role to pick lock state, icon (Lock when locked, Wand2 for synthesis when unlocked-and-empty, Check when written), and tooltip text.

### 4. Submit routing

`writeCurrentChapter` will inspect role and dispatch:

- `body` → `handleAcademicSubmit("write_chapter")` (unchanged).
- `introduction` → `handleAcademicSubmit("write_introduction")`.
- `conclusion` → `handleAcademicSubmit("write_conclusion")`.
- `abstract` → `handleAcademicSubmit("write_chapter", { isAbstract: true })` (unchanged).

`handleAcademicSubmit` request body for the new steps will include `previousChapters` (only `body` role with full content, cap 3,000 chars each), `outline`, `researchQuestion`, plus — for `write_conclusion` — the body chapters; for `write_introduction` — the body chapters and (if present) the conclusion content as `conclusionContent` so the introduction can preview the actual thesis.

### 5. SSE streaming

`useSseStream` is currently `academicStep === "write_chapter"`. Change to include the two new steps so they get the same streaming progress UI.

### 6. Toasts

After writing the last body chapter: "פרקי הגוף הושלמו — ניתן לכתוב את הסיכום."  
After writing the conclusion: "ניתן עכשיו לכתוב את המבוא, מבוסס על העבודה כפי שהיא בפועל."  
After intro is written: existing "ניתן לייצר תקציר" toast continues to fire.

## Memory

Add `mem://features/academic-writing-mode/intro-conclusion-roles.md` documenting the new steps, locking rules, generation-vs-display order decoupling, and prompt design intent. Update the existing `deep-pipeline-wiring.md` cross-reference so future work knows `isAcademicChapter` was generalized.

## What we are NOT doing

- No display-order rendering work in this change. The chapter strip already shows chips in array order, which after `approveOutline` will be exactly intro → body → conclusion → abstract. A future "export full paper" step will read the same array.
- No changes to citation-chat, research mode, or Phase C work.
- No abstract-prompt changes — the synthesis abstract prompt continues to consume all chapters including the just-written intro and conclusion.
- No new database migrations — `academic_sessions` already persists the chapter array shape.

## Validation

Manual smoke test: start a fresh academic session → propose outline (confirm chapter list is `תקציר | מבוא | bodies | סיכום ומסקנות`) → write each body chapter → confirm conclusion chip unlocks, intro stays locked → write conclusion → confirm intro unlocks → write intro → confirm abstract unlocks. Verify `qa_logs.metadata.profile_used_academic.step` shows `introduction` / `conclusion` for those runs.