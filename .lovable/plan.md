
# P6 — Minimal frontend hookup to `legal-research-v1`

Goal: let the user run end-to-end Research v1 from the UI and visually review answer, footnotes, latency, and debug trace. No backend changes. No citation/URL polish.

## Approach

`LegalQAChat.tsx` is ~3260 lines and currently short-circuits Research mode to `MaintenanceCard`. Instead of weaving v1 into the existing standard submit flow, build a **self-contained panel** and mount it where the Research maintenance card renders. This keeps blast radius tiny and avoids touching academic/legal-qa/pleading paths.

## New file

`src/components/LegalResearchV1Panel.tsx` — single component owning input, submit, loading, progress, result, debug.

- One `<Textarea>` (Hebrew, RTL) + one submit `<Button>`.
- On submit: `supabase.functions.invoke("legal-research-v1", { body: { question, project_id } })`, with `project_id` pulled from `useProjects()` (current selected project, optional).
- Request timeout: client-side `Promise.race` with `AbortController` at 300s. On timeout show: `"הבקשה ארכה זמן רב מדי. נסה שוב או קצר את השאלה."`
- Loading UI:
  - `<Progress>` bar
  - current stage label from a fixed array of 6 Hebrew stages (as specified in request).
  - Elapsed time `mm:ss`.
  - Note: `"זה עשוי לקחת 2–3 דקות"`.
  - Progress driver: `setInterval` 1s. Start at 5%. Walk stage-by-stage on a soft schedule (e.g. ~25s per stage budget → ≈15% per stage), capped at 90%. On success → 100%. On error → freeze + error message. No backend polling, no streaming.
- Result UI:
  - Answer rendered as plain markdown-ish text. Use existing pattern (whitespace-pre-wrap on `<div>`), no new markdown lib — answer is short Hebrew prose with `¹²³` superscripts already in text.
  - Footnotes list below: `{n}. {title} — <a href={url} target="_blank" rel="noreferrer">{url}</a>`. If `url` missing/empty, render title only. No filtering on URL quality.
  - `used_sources` chips (optional small render — title + source_type), still shown even if URL weak.
- Debug `<Collapsible>` (default open in dev, closed in prod via `import.meta.env.DEV`):
  - `run_id`, `total_ms`, per-stage timings from `debug.stage_runs` / `debug.planning` / `debug.retrieval` / `debug.verifier` / `debug.drafter`.
  - claims, queries (compact JSON).
  - verifier summary (`counts`, `candidates_usable`, `candidates_dropped`).
  - used_sources & footnotes raw.
  - Local vs Perplexity split from `debug.retrieval.local.candidates` / `debug.retrieval.perplexity.candidates`.
  - Rendered as `<pre>` blocks for nested objects.

## Edit

`src/components/LegalQAChat.tsx` — only two surgical changes:

1. Replace the Research `MaintenanceCard` render (line ~2934–2938) with `<LegalResearchV1Panel />` (or wrap the whole research empty-state branch). The panel handles its own loading/result so we render it whenever `taskMode === "research"` and bypass the existing `result`/`loading`/`error` chrome for that mode.
2. Remove the `if ((taskMode as string) === "research") { toast.info(...); return; }` short-circuit in `handleSubmit` (line ~1929–1932) — Research no longer uses the global submit; the panel owns its submit. (Actually simpler: leave the short-circuit in place — the panel renders before submit can be reached because research mode hides the standard input bar… verify with quick read.) If the global input is still visible for research mode, also hide it for `taskMode === "research"`.

No changes to: `legal-qa`, drafter, verifier, retrieval, schemas, DB, Fast/Deep code, citation engine, MaintenanceCard component itself.

## Out of scope (explicitly)

URL hygiene, citation cleanup, Uniform Citation Rules, "שם" / "לעיל ה״ש", bibliography, streaming, polling, Fast/Deep, DoctrineClassifier, SourceRequirements, marker parser, retrieval/verifier/drafter prompt changes, DB schema changes.

## Verification

- Build passes.
- Submit a test question in `/app` Research tab → progress runs → answer + footnotes appear → debug section shows run_id and timings.
- Error path: kill network → timeout message renders, progress freezes.
