# Bluebook 22 Foreign-Source Integration — Milestone 1 Acceptance Report

Scope: foreign sources inside an Israeli legal paper, under the Israeli Uniform Citation
system. Not a separate Bluebook product, no global toggle, no Word Add-in work.

## 1. Architecture inspected

Pipeline traced end to end before any code was written:

```
validateCitationInput → normalizeQuotes/normalizeAbbreviations
  → resolveSourceType (detectSourceType regex → classify-source LLM)
  → verified-source store lookup
  → citation-chat (Perplexity, trusted-host gated) → extractFieldsFromResponse
  → validateAIResponse (CITATION_RULES required fields)
  → FormattedCitation (**bold** / ##italic##)
  → applyRepeatCitationRules (Israeli Rule 37)
  → bibliography partition (Hebrew / English)
```

Two manually synchronised rule registries: `src/data/citationEngine.ts` (canonical) and
`supabase/functions/_shared/citationEngine.ts` (Deno fork).

## 2. Classification bug and root cause

`detectSourceType` in `src/data/abbreviations.ts` terminated on
`latin text + "v." | "vs."` and returned generic `foreign`. Any US or UK case therefore
resolved to the fallback family, and the specific foreign rules (case, statute,
constitution, article, book, chapter, internet) could never be reached. Compounding it,
`classify-source`'s `ALLOWED_TYPES` contained no `foreign_*` value at all, so the LLM
classifier was structurally unable to return a specific foreign family.

## 3. Implementation delta

New module `src/data/bluebook/`:

- `types.ts` — `FOREIGN_RULESET_ID = "foreign_bluebook_v22"`, `ForeignSourceKind`
  (`case | constitution | statute | book | journal_article | book_chapter | internet | other`),
  `ForeignJurisdiction` (`US | UK | OTHER`), `FOREIGN_TYPE_IDENTITY` mapping the legacy
  public `foreign_*` SourceType values to kind+jurisdiction, and `toSourceType` back.
  The public `SourceType` enum was not exploded; no DB or UI migration.
- `tables.ts` — conservative abbreviation tables: US reporters, reporter→implied court,
  US courts, journal abbreviations, UK neutral courts, Bluebook month forms. Unknown
  journal titles are preserved verbatim; no abbreviation is ever guessed.
- `extract.ts` — deterministic fast paths ahead of the LLM: US reporter citations,
  `U.S.C.`, U.S. Constitution, UK neutral citations, UK statutes, law-review shape
  (known journal required). Hebrew-dominant text short-circuits to `null`.
- `render.ts` — deterministic renderers owning punctuation, ordering, court/year
  parentheticals, `§` vs `§§`, pincite placement, italics and small caps.
- `index.ts` — `renderForeignCitation(raw)`, which returns `null` unless detection
  confidence is `deterministic`.

`runCitation.ts` now renders a deterministically identified foreign source locally,
before the model call; anything else falls through to the existing engine untouched.
Pinpoint inputs and verified-store direct hits keep their existing paths.

Critical invariant enforced in extraction and rendering: `firstPage != pinpoint`.
`347 U.S. 483, 490` yields `firstPage = 483`, `pinpoint = 490`. Reporter, court, author,
year, journal abbreviation, statute code and page are never manufactured — a missing
field is reported as missing and the record falls through rather than being invented.

Rule basis: Israeli **Rule 35.1** is treated as the operative rule incorporating the
current Bluebook; Israeli Rule 36.x is examples/guidance only. Internally the ruleset is
named `foreign_bluebook_v22`; 36.x is never presented as a Bluebook rule number.

## 4. Small caps and rich copy

Audited `FormattedCitation.tsx`, `clipboard.ts` and every citation copy action. Added the
internal marker `^^text^^` alongside the existing `**bold**` / `##italic##` pipeline.
Preview renders it with CSS `font-variant: small-caps` — no Unicode pseudo-small-caps.
New `src/lib/citationRichText.ts` provides `citationToHtml` / `citationToPlain` /
`copyCitationRich` / `copyCitationsRich`; the uniform-citation panel, batch footnote
builder and verified-sources page now copy rich HTML with a clean plain fallback.
Unterminated markers are stripped in all three surfaces — no raw `^^` or `##` can reach a
user. Word Add-in insertion was deliberately not touched.

## 5. Registry drift protection

`src/test/citationEngineParity.test.ts` compares both registries on rule keys, rule ids,
templates, required fields and foreign coverage. It surfaced real pre-existing drift; the
six stale **foreign** templates in the Deno fork were synchronised to the canonical
registry. Four pre-existing **Israeli** divergences (looser required-field validation used
by the Perplexity resolver) are captured in a closed, documented allowlist so they cannot
change silently, and a dedicated assertion forbids any foreign rule from ever entering
that allowlist.

## 6. UI and bibliography

The Citation Wizard was not redesigned. `FootnoteReviewCard` keeps its structure and now
groups the type override into **מקורות ישראליים** and **מקורות לועזיים** (פסיקה, חקיקה,
חוקה, ספר, מאמר בכתב עת, פרק בספר, מקור אינטרנטי, אחר לועזי), with a read-only detection
line showing family · jurisdiction. Jurisdiction stays auto-detected; the user is never
asked to choose "Bluebook". The bibliography keeps the Hebrew/English split and adds
foreign groups inside the English section (פסיקה, חקיקה, ספרים, מאמרים, מקורות אינטרנט,
שונות) instead of collapsing everything into literature/misc.

## 7. Verified-source compatibility

Verified identity and citation formatting are separated. A verified source is still
returned as verified; its stored text is deterministically re-rendered only when the
stored citation parses into complete structured fields, and preserved as-is otherwise.

## 8. Tests

- `bluebookClassification.test.ts` (9) — Brown → US case not generic foreign; `15 U.S.C. § 1`
  → US statute; `U.S. CONST. amend. XIV, § 1` → constitution; `[2024]/[2019] UKSC` → UK case;
  law review → article; firstPage/pinpoint separation; online PDF of a journal article is
  still an article; Hebrew inputs unaffected.
- `bluebookRendering.test.ts` (15) — golden renders: SCOTUS, SCOTUS with pinpoint, Court of
  Appeals, District Court, constitution, `§` and `§§`, article with/without pinpoint, book,
  book chapter, UK neutral, UK statute, internet, italics, and a no-fabrication case.
- `citationSmallCaps.test.tsx` (4) — preview, rich HTML, plain fallback, unterminated marker.
- `citationEngineParity.test.ts` (6) — registry drift.
- `foreignRepeatRule37.test.ts` (1) — repeated foreign citations use the Israeli repeat form;
  no `Id.`, `supra` or `infra`.

Full suite: **1126 tests / 96 files passing**; typecheck clean. Existing Israeli citation,
statute, Basic Law, Hebrew article/book and Rule 37 tests are unchanged and pass.

## 9. Live acceptance

33 real foreign records were run through detection + rendering; per-record input, family,
jurisdiction, structured fields, final citation and warnings are in
`ACCEPTANCE_RECORDS.txt` beside this report. Coverage: SCOTUS, Courts of Appeals, District
Courts, `In re` / `Ex parte`, pinpoints, a database-only case, three constitution forms,
four U.S.C. forms including a `§§` range, six law-review articles (one with an unknown
journal, one reached via URL), four UK cases, a UK statute, and two deliberately incomplete
inputs.

Manual inspection: every deterministic render matched the expected Bluebook form exactly.
No fabricated reporters, courts, years or pages appeared. Incomplete inputs
(`Smith v. Jones`, `Brown, 347 U.S.`) correctly declined to render and fell through to the
existing engine.

## 10. Known unsupported cases

- Westlaw/Lexis database-only cases (`2019 WL 1234567`) are detected as a foreign case by
  shape but not rendered deterministically; they fall through to the engine.
- Traditional UK Law Reports without a neutral citation (`Donoghue v Stevenson [1932] AC 562 (HL)`)
  detect by shape only and fall through.
- Journal articles in unlisted journals are detected only when the journal is known; otherwise
  they fall through rather than risk a guessed abbreviation.
- Journal articles currently carry jurisdiction `OTHER` even for US journals (display label only,
  no effect on rendering).
- Books and book chapters render deterministically from structured fields but have no
  free-text extractor yet — they arrive through the engine or a manual override.

## 11. Milestone 2 recommendations

Westlaw/Lexis database cases; UK Law Reports without a neutral citation; book and
book-chapter extraction from free text; journal jurisdiction inference; a wider journal
table; C.F.R. / Federal Register; legislative materials; Restatements / UCC / court rules;
SSRN / working papers; EU and international materials; updating the citation-chat prompt
from "Bluebook (מהדורה 21)" to 22; Word Add-in small-caps support. None of these requires
an architectural rewrite — each is a new table entry, extractor or renderer inside
`src/data/bluebook/`.

---

BLUEBOOK 22 MILESTONE 1 — SHIP

ISRAELI CITATION ENGINE: PRESERVED
RULE 37 FOREIGN REPEATS: PRESERVED
FOREIGN AUTO-DETECTION: ACTIVE
GENERIC FOREIGN FALLBACK: FALLBACK ONLY
BLUEBOOK CORE DETERMINISTIC RENDERING: ACTIVE
SMALL CAPS WEB PREVIEW: ACTIVE
RICH CLIPBOARD FORMATTING: ACTIVE
WORD ADD-IN SUPPORT: OUT OF SCOPE
REGISTRY DRIFT PROTECTION: ACTIVE
MILESTONE 2 REQUIRED BEFORE INITIAL LAUNCH: NO
