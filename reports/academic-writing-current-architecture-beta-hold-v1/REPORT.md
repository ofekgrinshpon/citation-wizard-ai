# Academic Writing — current architecture snapshot (beta hold)

Track: `academic_writing_beta_hold_feature_flag_v1`. Documents the state as of this
freeze. Nothing in Academic Writing was deleted, rewritten or improved.

## A. UI / entry point

- Surfaces as the 4th task-mode card `כתיבה אקדמית` inside `src/components/LegalQAChat.tsx`
  (`TASK_MODES`, id `academic_writing`), rendered on route `/app` (`src/pages/Index.tsx`,
  `mode = "legalqa"`). No dedicated route.
- Entry: user clicks the card (`handleModeChange`) or resumes a session from the
  history sidebar (`academicResumeSignal`, `QAHistorySidebar`).
- Wizard states (`WizardStep`): `init → topic_or_question → outline → writing →
  checkpoint → done`, with `maxReachedStep` allowing backwards navigation only.

## B. Project model

Persisted in `academic_sessions` (one row per user+project):
`wizard_step`, `max_reached_step`, `current_chapter`, `chapters` (jsonb: title,
content, status, footnotes, chapterMemory), `research_question`, `outline`,
`proposed_questions`, `last_academic_action`, `source_registry` (jsonb),
`current_run_id` / `current_run_step` / `current_run_chapter_idx` (in-flight run
markers), `project_id`, timestamps.
Mirror: `localStorage` key `relex_academic_session_<projectId>` (fast restore; DB wins).
Related: `legal_research_jobs` (V2 chapter jobs), `qa_logs` (server-side logging with
`metadata.academic_step`).
Not persisted as first-class fields: chapter purpose / argumentative role, project-level
memory beyond chapter memory, unresolved-authority list, uploads for the V2 path.
Footnote offset is derived client-side from previously written chapters.

## C. Current workflow

1. Topic or research question → `legal-qa` short steps `suggest_topics` /
   `validate_question` (free, non-streaming).
2. Outline → `legal-qa` `propose_outline`; user may edit body-chapter titles
   (`OutlineChapterEditor`); special chapters (תקציר / מבוא / סיכום) are force-injected.
3. Body chapter → `legal-research-v2` `mode: "academic_chapter"` (the live V2 slice,
   `src/lib/academic/chapterJob.ts`).
4. Introduction / conclusion / abstract → still routed at `legal-qa`
   (`write_introduction` / `write_conclusion`), which returns a hard-coded 503
   "engine offline" — dead path.
- V1 dependency: only the short `legal-qa` steps (they use the legal-qa AI path).
- Not connected: uploads into the V2 chapter context; bibliography export of the
  source registry.

## D. V2 body-chapter implementation

- Endpoint: `POST /functions/v1/legal-research-v2`, `mode: "academic_chapter"`.
- `project_context` (bounded, non-evidence): research question, outline titles+index,
  chapter {index, title, role: body, instructions, existing_text_excerpt ≤1500 chars},
  last 8 completed chapters (summary/key_points/cited_sources), up to 8 established
  conclusions, last 25 known sources.
- Chapter memory: deterministic summary/key_points/cited_sources/footnotes_count per chapter.
- Source registry: URL-or-citation keyed merge, `chapters_used_in`, capped at 200.
- Footnote numbering: continuous via `footnote_offset`.
- Jobs: `legal_research_jobs` row, four progress stages, polling + resume, heartbeat and
  inactivity reaping.
- Credits: 8 per chapter (`ACADEMIC_CHAPTER_CREDIT_COST`), idempotent on
  `client_request_id`, refunded on failure. Overwrite of an existing chapter requires
  a client-side confirmation.
- Models: Research Agent = Terra (beta default); Drafter = unchanged V2 drafter;
  verifier = unchanged four-check V2 verifier (identity / span / support / temporal).

## E. Experimental / evaluation surfaces

- Academic Research Contract experiment and the Terra-vs-Sol bakeoff were evaluation-only.
- `research_contract` field exists in `types.ts` / `agent/prompt.ts` / `index.ts` and is
  read on the **internal smoke path only**.
- Access is gated by `x-smoke-mode: 1` plus a smoke/eval token
  (`V2_EVAL_TOKEN_E`, `V2_EVAL_TOKEN_D`, `V2_EVAL_TOKEN_C`, `V2_EVAL_TOKEN`,
  `V2_SMOKE_TOKEN_B`, `V2_SMOKE_TOKEN`) or the service-role key.
- Not reachable by a normal beta user. **Deserves later cleanup**: the eval-only
  `research_contract` field and the accumulated eval tokens should be pruned in a
  dedicated cleanup track. Not touched here.

## F. What is not finished

Introduction, conclusion and abstract (dead 503 path); V2 upload integration;
persisted first-class chapter purpose / argumentative role; reliable deep academic
richness (evidence yield is the ceiling); latency/cost (~220–360s, ~5–8 credits per
chapter); academic scholarship acquisition; current consolidated legislation
acquisition (gov.il 403, Knesset shell pages); citation-title presentation
(`index`, `act.php`, `מקור ללא כותרת`); bibliography/source-registry surfacing.

## G. Current decision

Academic Writing is **not** part of the initial public beta. It is frozen as
work-in-progress and fully preserved. Initial beta core features: מחקר משפטי,
אזכור אחיד, הערות שוליים, ביבליוגרפיה.

## Feature flag

- Frontend: `ACADEMIC_WRITING_ENABLED` in `src/config/features.ts`
  (`VITE_ACADEMIC_WRITING_ENABLED === "true"`, default false).
- Backend: `academicWritingEnabled()` in
  `supabase/functions/legal-research-v2/beta/job.ts` (env `ACADEMIC_WRITING_ENABLED`,
  default false), enforced in `legal-research-v2/index.ts` before any credit charge,
  and in `legal-qa/index.ts` for `taskMode === "academic_writing"` before the credit gate.
- Availability only — not an authorization mechanism. No query-param or localStorage override.
