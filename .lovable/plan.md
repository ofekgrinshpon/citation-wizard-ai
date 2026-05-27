**Goal**

In `mode: "sources_only"` (חיפוש מקורות), detect likely Perplexity-hallucinated or broken URLs and warn the user instead of silently presenting them as reliable links. Confirmed-dead links get a strong warning; ambiguous/slow links get a softer "not verified" note. Nothing is dropped.

**Strict scope (unchanged)**

sources_only only. No changes to: answer pipeline, drafter, verifier, retrieval, candidate pool, Perplexity prompts, citation engine, DB schema, source admission rules.

---

**Server: `supabase/functions/legal-research-v1/lib/sourcesOnly.ts`**

1. **Extend `SourceResult`** with three optional fields:
   - `url_validation_state?: "ok" | "unreachable" | "unverified"`
   - `url_unreachable?: boolean` (true only when state === "unreachable"; kept for back-compat / quick checks)
   - `url_status?: "404" | "410" | "dns" | "network" | "timeout" | "blocked" | "paywalled" | "ok" | string`

2. **New internal `validateUrls(allSources: SourceResult[]): Promise<void>`**
   - Collect unique URLs where `origin === "perplexity"` and a URL exists. Local DB sources are skipped entirely (never validated, never chipped).
   - Normalize URL for cache key (lowercase host, strip trailing `/`).
   - Per-run `Map<normalizedUrl, { state, status }>`.
   - **Concurrency 8** via a tiny worker-pool (no external deps).
   - **Per-URL timeout: 4s** via `AbortSignal.timeout(4000)`.
   - **Global soft deadline: 6s** for the whole stage, via a shared `AbortController` triggered by a `setTimeout(6000)`; any URL still in-flight when the deadline fires is marked `unverified / timeout`.
   - Wrapped in `Promise.allSettled` so a thrown error never breaks the response.

3. **Per-URL check**
   - Try `HEAD` with `redirect: "follow"`.
   - Status interpretation:
     - `2xx` → `ok`
     - `3xx` final → follows; treat by final status
     - `401` / `403` → `ok` (state) with `status: "paywalled"` — NO chip
     - `404` / `410` → `unreachable`
     - HEAD `405` or HEAD `403` or network/CORS-ish error → **fallback** `GET` with `Range: bytes=0-0` + same 4s timeout
       - If GET succeeds (2xx) → `ok`
       - If GET 404/410 → `unreachable`
       - If GET 401/403 → `ok` / `paywalled`
       - Else → `unverified` (status: `blocked` or `network`)
     - DNS / `ENOTFOUND` / `ECONNREFUSED` → `unreachable` (status: `dns` / `network`)
     - Abort due to per-URL timeout → `unverified` / `timeout`
     - Abort due to global deadline → `unverified` / `timeout`
     - Any unexpected non-2xx not covered above → `unverified` / `unknown`

4. **Apply results**
   - Mutate only Perplexity-origin entries in both `mainGrouped.sources` and `addGrouped.sources` (and the groups buckets, since they share object refs).
   - For each: set `url_validation_state`, `url_status`, and `url_unreachable = state === "unreachable"`.
   - Local DB entries: leave all three fields unset.

5. **Summary**
   - `summary.url_checks_failed` — count of confirmed `unreachable`
   - `summary.url_checks_unverified` — count of `unverified`
   - (Existing summary fields unchanged.)

6. **Async conversion**
   - Convert `buildSourcesOnlyPayload` to `async`. Call `await validateUrls(...)` once, after both main and additional are grouped/ranked, before returning the payload.
   - Update the single `sources_only` branch in `legal-research-v1/index.ts` to `await` the builder. No other call sites exist (answer mode never calls this builder).

---

**Frontend: `src/components/LegalSourceSearchPanel.tsx`**

1. **Extend types** on `SourceResult` to mirror the three new optional fields, and on `SourcesOnlyResponse["summary"]` to include `url_checks_failed?: number` and `url_checks_unverified?: number`.

2. **`SourceCard` chip rendering**
   - If `url_validation_state === "unreachable"`:
     - Destructive-variant chip text: `קישור לא זמין`
     - Tooltip: `ייתכן שזהו מקור שגוי שהוחזר ע"י מנוע החיפוש. מומלץ לאמת ידנית לפני שימוש.`
     - Apply `line-through` to the URL line only (not the title).
   - If `url_validation_state === "unverified"`:
     - Muted/warning-variant chip text: `הקישור לא אומת`
     - Tooltip: `לא הצלחנו לאמת את הקישור בזמן סביר. ייתכן שהאתר איטי או חוסם בדיקות אוטומטיות.`
     - No line-through.
   - For `ok`, paywalled (401/403), local DB sources, or any source without the field → no chip.
   - Chip placement: next to the existing support / "לבדיקה" chip, using `<Tooltip>` from `@/components/ui/tooltip` and `<Badge>` variants from the existing design system (no custom colors).

3. **Summary line**
   - Append ` · {n} קישורים לא זמינים` only when `summary.url_checks_failed > 0`.
   - Append ` · {n} קישורים שלא אומתו` only when `summary.url_checks_unverified > 0`.

---

**Backward compatibility**

All new fields are optional. Old `qa_logs` rehydrated from history (no `url_validation_state`, no new summary fields) render exactly as today: no chips, no extra summary text.

---

**Validation (re-run judicial-activism in חיפוש מקורות)**

- The two Cambridge Core entries (#21, #22) show `קישור לא זמין` with the strong tooltip.
- Live Knesset / nevo.co.il / court.gov.il / real IDI URLs show no chip.
- JSTOR/Cambridge entries that return 401/403 paywalls show no chip.
- Pure timeout cases show `הקישור לא אומת` (not the strong chip).
- Local DB sources never get any chip.
- No source disappears; grouping and rank order unchanged.
- Old history rows render cleanly.
- Typical added latency ≤ ~3s; hard cap ≈ 6s + small overhead even with many bad URLs.
- Answer-generation mode latency and output unchanged.

---

**Out of scope**

- No URL validation in answer mode.
- No Perplexity prompt or admit-list changes.
- No automatic resolution/replacement of broken URLs.
- No DB columns, no schema migration, no telemetry table changes.
- No source-admission policy changes.
