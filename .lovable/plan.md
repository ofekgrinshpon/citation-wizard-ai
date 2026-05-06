## Goal

Ship **Option B — Distilled Style Profile** for academic chapter generation. Treat "how Israeli legal scholarship is written" as a versioned, human-reviewed, prescriptive asset that lives next to `citationRules.ts` and is injected verbatim into every Deep `write_chapter` draft. No retrieval-time exemplars. No model training.

Strictly scoped to Deep `write_chapter` for **real body chapters** — not abstract, intro, conclusion, outline, validate, topics, Fast research, or citation-chat.

## Deliverables (in order)

### 1. Offline distillation harness — `eval/distill-style-guide.mjs`

One-shot Node script (mirrors existing `eval/*.mjs` pattern). Runs locally, never in an edge function.

- **Sampling.** Stratified sample of ~150 documents from `legal_documents` where `source_type = 'journal_article'`. Stratify by `metadata->>'journal'` (fallback `metadata->>'publication'`); cap 6 per journal. Reassemble `content` chunks per `document_id`.
- **Per-article structuring.** Slice **intro (first 2,500 chars)**, **body sample (middle 3,500 chars)**, **closing (last 1,500 chars)**. Drop articles shorter than 6,000 chars.
- **Distillation call.** One `gpt-5` call per article (Lovable AI Gateway, `reasoning.effort: "medium"`) returning structured JSON via tool-calling. Eight dimensions:
  1. Paragraph rhythm — sentences per paragraph, topic-sentence patterns
  2. Opening moves — exact phrases catalog
  3. Transitions — concession / sharpening / doctrinal pivot / comparative move
  4. Counter-argument handling — steel-man → distinguish → resolve
  5. Footnote density — bands by paragraph type (doctrinal / normative / comparative)
  6. Closing moves — synthesis / open question / policy
  7. Register — when "אטען", "ראוי", "מן הראוי", "דומני", "סבורני" appear; when not
  8. Anti-patterns — lists where prose belongs, scare quotes, English loanwords
- **Synthesis.** Second `gpt-5` reasoner call ("synthesizer") consumes all 150 observations and emits the Hebrew prescriptive style guide, **hard-capped at 3,000 tokens**, via a tool schema mirroring the runtime asset section structure.
- **Output.**
  - `eval/style-guide-output/observations-v1.json` — raw audit trail
  - `eval/style-guide-output/draft-style-guide-v1.md` — Hebrew prescriptive draft for human review

Run command (documented in script header):
```
LOVABLE_API_KEY=… node eval/distill-style-guide.mjs --sample 150 --out eval/style-guide-output
```

### 2. Human review pass

Out-of-band. The user (or research assistant) reads `draft-style-guide-v1.md`, cuts overfit / over-prescriptive rules, sharpens vague ones. Reviewed file becomes the source for step 3. **This step is the most important.**

### 3. Runtime asset — `supabase/functions/legal-qa/academicStyleGuide.ts`

Sits next to `citationRules.ts`. Single-file module:

```ts
export const ACADEMIC_STYLE_GUIDE_VERSION = "v1";
export const ACADEMIC_STYLE_GUIDE = `…reviewed Hebrew prescriptive text, ≤3000 tokens…`;
export function buildStyleGuideBlock(): string {
  return `כללי סגנון — לא מקור לציטוט (גרסה ${ACADEMIC_STYLE_GUIDE_VERSION})\n` +
         `אסור לצטט, להפנות, או להעתיק ניסוח מהבלוק הזה. הוא מתאר תבניות בלבד.\n\n` +
         ACADEMIC_STYLE_GUIDE;
}
```

Section structure (matches distillation schema):
1. קצב פסקה ומשפט פותח
2. מהלכי פתיחה
3. מהלכי קישור
4. טיפול בטיעוני נגד
5. צפיפות הערות שוליים
6. מהלכי סיום
7. רגיסטר ולשון
8. אנטי־דפוסים

Runtime guard: `console.warn` if `ACADEMIC_STYLE_GUIDE.length > 12000` chars (~3K Hebrew tokens).

### 4. Injection point — `supabase/functions/legal-qa/index.ts`

Single insertion in the `useStructuredDrafterPath && isAcademicChapter` branch around line **4397–4402**:

```ts
if (useStructuredDrafterPath && isAcademicChapter && typeof academicStep === "string") {
  const academicHeader = getAcademicSubModePrompt(academicStep, body);
  if (academicHeader) {
    drafterSystemPrompt = academicHeader + "\n\n" + drafterSystemPrompt;
  }
  // NEW — only for real body chapters
  const styleGuideEnv = (Deno.env.get("STYLE_GUIDE_ENABLED") ?? "true") !== "false";
  const isSuperAdmin = SUPER_ADMIN_USER_IDS.has(userId);
  const styleGuideOverride = isSuperAdmin && typeof body.styleGuideEnabled === "boolean"
    ? (body.styleGuideEnabled as boolean)
    : null;
  const styleGuideEnabled = styleGuideOverride ?? styleGuideEnv;
  const isRealChapter = academicStep === "write_chapter" && !body.isAbstract;
  if (styleGuideEnabled && isRealChapter) {
    drafterSystemPrompt = drafterSystemPrompt + "\n\n" + buildStyleGuideBlock();
  }
}
```

**Position rationale.** After the academic persona (so persona framing dominates), before the source block (so the model never confuses style with citable sources). The `כללי סגנון — לא מקור לציטוט` header makes the fence explicit.

**Override gating.** `body.styleGuideEnabled` is honored **only when the request comes from a super-admin user** (UUID present in the existing `SUPER_ADMIN_USER_IDS` set used elsewhere in the file — same pattern as `evalForceLegacy`). Non-admin requests always follow the env flag. This lets the user toggle the guide per-request while testing without exposing the lever to end users.

**Excluded from injection** (out of scope per Option B framing):
- `write_introduction`, `write_conclusion` (paper-level prompts; revisit in stage 4 if needed)
- `write_chapter` with `isAbstract === true`
- Fast research, citation-chat, all non-academic flows

### 5. Telemetry

In the `qa_logs.metadata` block (around line ~7258, where `chapter_engine` is set):

```ts
style_guide: isRealChapter ? {
  enabled: styleGuideEnabled,
  version: styleGuideEnabled ? ACADEMIC_STYLE_GUIDE_VERSION : null,
  source: styleGuideOverride !== null ? "admin_override" : "env",
} : { enabled: false, version: null, source: null },
```

Enables clean A/B over time and per-version regression tracking. No new tables, no schema migration.

### 6. Eval — `eval/style-guide-q1-q5.mjs`

Mirrors `eval/academic-chapter-q1-q3.mjs`. Five chapter fixtures × 1 rep × 2 phases (`PHASE=before` with `styleGuideEnabled=false`, `PHASE=after` with `styleGuideEnabled=true`, both submitted as a super-admin user so the override is honored). Captures full `answer_full`, `chapter_engine`, `chapter_qa_guard`, `style_guide`. **Qualitative read by the user, not a metric.** Watch existing `chapter_qa_guard` flags (`narrative_violation`, `under_word_floor`, `high_unresolved_share`) for regressions.

## Files touched

| File | Change |
|---|---|
| `eval/distill-style-guide.mjs` | **NEW** — offline distillation harness |
| `eval/style-guide-output/` | **NEW** dir (gitignored except final guide) |
| `supabase/functions/legal-qa/academicStyleGuide.ts` | **NEW** — versioned runtime asset |
| `supabase/functions/legal-qa/index.ts` | ~15 lines: import, super-admin–gated override + injection at line ~4397, telemetry at line ~7258 |
| `eval/style-guide-q1-q5.mjs` | **NEW** — before/after eval harness |
| `.lovable/memory/features/academic-writing-mode/style-guide-v1.md` | **NEW** memory entry |
| `.lovable/memory/index.md` | append memory link |

No DB migrations. No new tables. No new edge functions. No new packages.

## Staged rollout

| Stage | Action | Gate |
|---|---|---|
| 1 | Run distillation harness, human-review draft, commit `academicStyleGuide.ts v1` | `STYLE_GUIDE_ENABLED=false` (env default for stage 1 only) |
| 2 | Super-admin override via `body.styleGuideEnabled=true`. Generate ~10 chapters from your account, read them | flag off for everyone else |
| 3 | Flip `STYLE_GUIDE_ENABLED=true` env default for all Deep chapters. Watch `chapter_qa_guard` daily for a week | revert via env if regressions |
| 4 | Quarterly refresh: re-run harness, diff `v1`→`v2` draft, human-review the diff, ship `v2` | `style_guide.version` telemetry powers A/B |

Stages 5+ (targeted exemplar lane → Option D, fine-tuning → Option C) are explicitly **deferred**. Only revisit if stage-4 telemetry shows a specific rhetorical bucket plateauing.

## Out of scope (intentional)

- Per-run exemplar retrieval — rejected; variance is the enemy.
- Any model training (C1/C2/C3) — rejected; regression risk on grounding.
- Auto-regenerating the style guide on a schedule without human review.
- Touching Fast research, citation-chat, abstract, outline, validate, topics, intro, conclusion.
- Letting the guide grow past 3,000 tokens — hard cap in synthesizer prompt + runtime warn.

## Verification

- TypeScript build passes.
- One eval run (`eval/style-guide-q1-q5.mjs`) before flipping the env default.
- `qa_logs.metadata->'style_guide'` populated on the next 5 real Deep chapters after deploy — confirm via `supabase--read_query`.
- Manual read of 3 chapters before/after — final sign-off is taste, not metric.