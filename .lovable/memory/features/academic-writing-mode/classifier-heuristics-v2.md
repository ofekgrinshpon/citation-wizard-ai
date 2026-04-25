---
name: Academic Chapter — Classifier Heuristics v2
description: Classifier upgrade — added Hebrew prefix support for חוק/לחוק, bare-docket caselaw, journal_shape_fallback for non-whitelisted journals (e.g. רציו), expanded HEBREW_JOURNALS, fixed מ"מ false-positive on report, and split unknown skip reasons into 4 actionable buckets
type: feature
---

The chapter citation router (`_shared/chapterCitationRouter.ts`) was tuned in a single focused iteration after the type-aware architecture proved correct but the classifier itself was undercounting `journal_article` (0/19) and overcounting `unknown` (10/19).

### Heuristic changes

1. **Statute** — `STATUTE_RE` now allows a single Hebrew letter prefix (`ב/ל/ה/מ`) before `חוק`, so `סעיף 17 לחוק שירות המדינה` correctly classifies as `statute` (was: `unknown`). `הצעת חוק` also added.
2. **Caselaw bare-docket** — new `CASELAW_BARE_DOCKET_RE` catches `54321-03-25 (בית המשפט העליון)` shape (drafter dropped the בג"ץ prefix). New `classifyReason: "caselaw_bare_docket"`.
3. **Journal article**:
   - `HEBREW_JOURNALS` expanded with `רציו, הסניגור, תאוריה וביקורת, תיאוריה וביקורת, שערי משפט, קרית המשפט, עיוני חינוך, מגמות, מדינה וחברה, מחקרי רגולציה, ביטחון לאומי, המשפט בישראל, עיונים בביקורת המדינה, צפון אפריקה`.
   - New `ARTICLE_SHAPE_FALLBACK_RE` (in `articleCitationValidator.ts`) — quoted/bold title + Hebrew-letter or numeric volume + 4-digit year matches journals NOT on the whitelist. New `classifyReason: "journal_shape_fallback"`.
4. **Report false-positive fix** — removed `מ"מ` from `REPORT_PREFIX_RE` because it matched `מ"מבחן` inside quoted titles. The Knesset RM&I full name remains.

### Debug telemetry

Two new structures land in `qa_logs.metadata.chapter_engine`:

- `classify_reasons: { [ClassifyReason]: count }` — per-reason breakdown of WHY the classifier picked each type. Lets us audit decisions without re-running. Reasons:
  - `statute_lexical_anchor`, `caselaw_prefix_shape`, `caselaw_pd_series`, `caselaw_bare_docket`,
  - `book_chapter_betoch_link`,
  - `journal_whitelist_hit`, `journal_hint_token`, `journal_english_vol_page`, `journal_shape_fallback`,
  - `book_bold_title`, `report_prefix`, `web_url`, `web_marker`, `fallback_unknown`.
- `skipped.reasons` now distinguishes 4 cases instead of one undifferentiated `unclassified_citation_shape`:
  - `garbled_text` — short, no Hebrew letter cluster (OCR damage)
  - `recognized_no_journal_token` — has quoted/bold title + year, no journal name
  - `recognized_no_anchor` — has title but no year/journal/volume
  - `unclassified_citation_shape` — true unknown

### Files

- `supabase/functions/_shared/articleCitationValidator.ts` — expanded `HEBREW_JOURNALS`, exported `ARTICLE_SHAPE_FALLBACK_RE`.
- `supabase/functions/_shared/chapterCitationRouter.ts` — `ClassifyReason` enum, `classifyChapterFootnoteWithReason`, expanded skip reasons via `diagnoseUnknown()`, fixed regex.
- `supabase/functions/legal-qa/index.ts` — `chapterClassifyReasons` aggregator + `classify_reasons` telemetry field.
- `eval/academic-chapter-q1-q3.mjs` — captures the new `classify_reasons` field.

### Architecture unchanged

Routing topology (legal_resolver / bibliography / skipped) and `chapter_qa_guard` rescoping are untouched. Chapter-writing prompts and quality knobs untouched.
