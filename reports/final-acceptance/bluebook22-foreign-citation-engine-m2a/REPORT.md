# ReLex — Bluebook 22 Foreign Citation Engine — Milestone 2A

## 1. Baseline from M1
M1 was SHIP: 1126 tests / 96 files. Israeli engine preserved, foreign auto-detection active, deterministic rendering active, Rule 37 owns repeats, small caps and rich copy active, registry parity enforced.

## 2. Exact M2A scope
Five changes, all inside existing families: (1) Bluebook edition 21 → 22 in the active prompts; (2) U.S. database-only cases (WL / U.S. Dist. LEXIS / U.S. App. LEXIS); (3) traditional UK Law Reports with no neutral citation; (4) free-text books and book chapters; (5) more journal entries plus journal jurisdiction inference. No new source families, tables, modes, UI, or architecture.

## 3. Files changed
- `src/data/bluebook/types.ts`: `ForeignCaseFields` gains `starPinpoint`, `decisionDate`, `reporterVolume`, and a documented `databaseIdentifier`.
- `src/data/bluebook/tables.ts`: journal metadata `[abbr, jurisdiction]`, `journalJurisdiction()`, a lookup by abbreviation, and the UK report series and court lists.
- `src/data/bluebook/extract.ts`: adds `extractUsDbCase`, `normalizeBluebookDate`, `extractUkTraditionalCase`, `extractBookChapter`, `extractBook`, and `parseSecondaryParen`. Updates detection order. Fixes the article-author suffix (", Jr.").
- `src/data/bluebook/render.ts`: adds the database-only branch in `renderUsCase` and the traditional-report branch in `renderUkCase`. Edition and year in book/chapter parentheticals no longer get a comma between them.
- `supabase/functions/citation-chat/index.ts`: two operative lines changed from edition 21 to 22 (deployed).
- `src/test/bluebookM2A.test.ts`: new, 22 tests.
- `src/test/bluebookRendering.test.ts`: one golden string corrected (see §10).

## 4. Active Bluebook edition
Both operative foreign instructions in citation-chat now say "מהדורה 22". No other references to edition 21 exist in `supabase/` or `src/`. A static test fails if a Bluebook/בלובוק instruction mentions edition 21, or if the edition-22 reference disappears. The Israeli prompts and the model are unchanged.

## 5. Database-only cases
Accepted shape: `Name, No. <docket>, <YYYY WL|U.S. Dist. LEXIS|U.S. App. LEXIS n>[, at *p] (<court> <Month D, YYYY>)`. Deterministic rendering requires all of the following: case name, docket number, database identifier, court, and an exact date. The date must parse to a real month and is normalised to Bluebook month forms. The database year must equal the decision year. The database identifier is stored only in `databaseIdentifier`, and the star page only in `starPinpoint`; `volume`, `reporter`, `firstPage` and `pinpoint` stay empty. If any required field is missing, the renderer reports it as missing and `runCitation` falls through to the existing engine. This applies to `Smith v. Jones, 2019 WL 1234567`, to a version with no docket, and to a version with only a year.

## 6. Traditional UK reports
Supported series: AC, QB, KB, Ch, Fam, WLR, All ER. WLR and All ER require a volume inside the year; the other series must not have one, and a mismatch is declined. Court parentheticals come from a closed list (HL, CA, PC, …). The case name must look like a case (`A v B`, `R (X) v Y`, `R v X`, `Re X`). Any neutral citation still goes to the M1 path, which is unchanged. "Annual Report [2019] AC 12" and "See generally [2019] Ch 3" are rejected.

## 7. Books and chapters
- Chapters are checked first. Required: author(s) that look like personal names, chapter title, `in`, book title, first page, and a parenthetical containing the year. Optional: pinpoint, editors, edition.
- Books are rejected up front if they contain `, in <Title>` (a chapter) or `, <vol> <Journal> <page>` (an article). Required: personal-name author(s), a title with no commas, and a year.
- Any part of the parenthetical that isn't recognised (e.g. "rev. ed.") causes a decline. A title ending in a bare number is declined because the number could be a title or a pinpoint. Articles, books and chapters use three separate extractors.

## 8. Journals and jurisdiction
Added 15 high-confidence entries: 13 U.S. (UCLA, Vand., Minn., Iowa, Fordham, Notre Dame, B.U., Wm. & Mary, Emory, Sup. Ct. Rev., Harv. Int'l L.J., Yale J. Int'l L., Harv. J.L. & Pub. Pol'y) and 2 UK (Int'l & Compar. L.Q., Legal Stud.). Every entry, including the M1 ones, now carries its jurisdiction (US/UK). Jurisdiction is looked up by full title or canonical abbreviation. It is never taken from the author or a URL, and it is display metadata only: the source type stays `foreign_journal_article`. Unknown journals are still declined and never given an abbreviation.

## 9. No-fabrication safeguards
All M1 gates still hold: `renderForeignCitation` needs deterministic confidence, and `runCitation` needs `missing.length === 0`. The new extractors decline on any part they can't identify.

## 10. Regressions
- **Rule 37:** a repeated new chapter (M2A) produces "שם" and never Id./Ibid./supra/infra. The M1 test still passes.
- **Rich formatting:** a new article's `^^L.Q. Rev.^^` survives from the renderer through HTML (CSS small caps) to plain text. The M1 small-caps tests pass.
- **Israeli engine:** the Israeli suites pass unchanged, and Hebrew-heavy text still skips foreign detection.
- **Registry parity:** no foreign templates changed, the parity test passes, and the allowlist is unchanged.
- **One M1 golden string corrected:** `(2d ed., 1994)` → `(2d ed. 1994)`. Bluebook puts no comma between the edition and the year, so this fixes a foreign-output bug. It is not a weakened test.

## 11. Test / build
- Full suite: **1148 tests / 97 files, all passing** (baseline 1126 / 96).
- The typecheck is clean and the build is OK.
- citation-chat is deployed.

## 12. Live acceptance (28 records — see ACCEPTANCE_RECORDS.txt)
| Group | n | Deterministic | Notes |
|---|---|---|---|
| U.S. database cases | 5 | 5 | Star pages, dockets and dates all correct |
| UK traditional + 1 neutral control | 6 | 6 | Neutral output identical to M1 |
| Books | 4 | 3 | "rev. ed." declined safely |
| Chapters | 4 | 4 | Editors and editions correct |
| Journal articles | 6 | 5 | Unknown Canadian journal declined; Jr. suffix fixed |
| Negative controls | 3 | 0 | All fell through |

Every deterministic render was checked by hand. No reporter, court, date, docket, page or abbreviation was invented.

## 13. Unsupported cases remaining
- "rev. ed." and other non-ordinal editions.
- Institutional authors, and editors listed as the authors of a whole book.
- Multi-volume star-paged treatises.
- Titles containing commas.
- UK "v" is kept as typed (no forced "v.").
- UK reports older than 1865 or from specialist series (Lloyd's Rep, Cr App R).
- Database cases with only a year, or with no docket (these deliberately fall through).
- Journals outside the whitelist.

## 14. Recommendation
The existing families now cover the realistic Israeli academic use cases. Further Bluebook expansion (C.F.R., legislative materials, international) should wait for evidence of real user demand. It is not needed for launch.

BLUEBOOK 22 MILESTONE 2A — SHIP

ISRAELI CITATION ENGINE: PRESERVED
BLUEBOOK ACTIVE EDITION: 22
DATABASE-ONLY US CASES: ACTIVE
TRADITIONAL UK REPORTS: ACTIVE
BOOK FREE-TEXT DETECTION: ACTIVE
CHAPTER FREE-TEXT DETECTION: ACTIVE
JOURNAL JURISDICTION INFERENCE: ACTIVE
RULE 37 FOREIGN REPEATS: PRESERVED
SMALL CAPS + RICH COPY: PRESERVED
REGISTRY DRIFT PROTECTION: PRESERVED
NEW SOURCE FAMILIES ADDED: NO
ARCHITECTURAL REWRITE: NO
NEXT BLUEBOOK EXPANSION REQUIRED BEFORE LAUNCH: NO
PRIMARY REMAINING FOREIGN-CITATION GAP: Journals outside the conservative whitelist and non-ordinal book editions still fall back to the existing engine.
