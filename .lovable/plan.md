## Goal

Replace the single catch-all `foreign` entry in the citation engine with **9 structured foreign source types** matching כללי האזכור האחיד 36.1–36.9 (Bluebook-aligned). Each gets its own template, required fields, formatting metadata, and rule notes — so AI output, validation, and tooltips work for foreign citations the same way they already do for Israeli sources.

No new tables, no edge function rewrites — only the citation registry, type list, validators, and the Deno-side fork.

## New source types

Added under a `foreign_*` namespace so the existing `foreign` key can stay as a fallback:

| Key | Rule | Description |
|---|---|---|
| `foreign_constitution` | 36.1 | חוקות (US federal/state) |
| `foreign_statute_us` | 36.2 | חוקים – ארה"ב (USC) |
| `foreign_statute_uk` | 36.3 | חוקים – אנגליה (chapter / regnal year) |
| `foreign_case_us` | 36.4 | פסיקה אמריקנית |
| `foreign_case_other` | 36.5 | פסיקה ממדינות אחרות (UK/Canada/Australia/…) |
| `foreign_book` | 36.6 | ספרים לועזיים (small caps) |
| `foreign_journal_article` | 36.7 | מאמרים בכתבי עת לועזיים |
| `foreign_book_chapter` | 36.8 | מאמרים שפורסמו בספרים לועזיים |
| `foreign_internet` | 36.9 | מקורות במרשתת לועזיים |

The legacy `foreign` entry stays in place as a free-text fallback for anything not covered.

## Templates (canonical)

```text
36.1  {jurisdiction} CONST. {division} {section}.
        e.g.  U.S. CONST. amend. XV, § 1.
36.2  [{statuteName}, ]{title} {code} § {section} ({year}).
        e.g.  Sherman Act, 15 U.S.C. §§ 1–7.
36.3  {statuteName} {year}, [{regnalYear} {monarch} ]c. {chapter}[, § {section}].
        e.g.  Habeas Corpus Act 1679, 31 Car. 2 c. 2.
36.4  {procPrefix?} ##{party1}## v. ##{party2}##, {volume} {reporter} {firstPage}[, {pinpoint}] ({court?} {year}).
36.5  ##{party1}## v. ##{party2}## {volumeOrYear} {reporter} {firstPage} ({courtAndJurisdiction}).
36.6  ##{authors}##, ##{bookTitle}##[: ##{subtitle}##] [{volume} ]{pinpoint?} ([{edition}, ][{editor?} eds., ][{translator?} trans., ][{publisher?} ]{year}).
36.7  {authors}, ##{articleTitle}##[: ##{subtitle}##], {volume} ##{journal}## {firstPage}[, {pinpoint}] ({year}).
36.8  {authors}, ##{articleTitle}##, in ##{bookTitle}## {firstPage}[, {pinpoint}] ({editor} eds., {year}).
36.9  {author?} ({handle?}), ##{title}##, ##{site}## ({date}), {url}.
```

Bold-small-caps names (authors, journals, sites, books) use the existing `##…##` italic marker in the renderer (same convention as the current `foreign` entry — display-only).

## Components / required fields (highlights)

- **36.1**: `jurisdiction` (req), `division` (`amend.`/`art.`) (req), `section` (req).
- **36.2**: `title` (req – e.g. `15`), `code` (req – `U.S.C.`), `section` (req), `statuteName` (opt), `year` (opt – omit if current).
- **36.3**: `statuteName` (req), `year` (req), `chapter` (req), `regnalYear`+`monarch` (req if pre-1962), `section` (opt).
- **36.4**: `party1`, `party2`, `volume`, `reporter`, `firstPage`, `year` (req); `procPrefix` (`Ex parte`/`In re`/`ex rel.`), `court`, `pinpoint` (opt). Note: court omitted for SCOTUS / state high court when reporter implies it.
- **36.5**: `party1`, `party2`, `volumeOrYear`, `reporter`, `firstPage`, `courtAndJurisdiction` (req).
- **36.6**: `authors`, `bookTitle`, `year` (req); `subtitle`, `volume`, `pinpoint`, `edition`, `editor`, `translator`, `publisher` (opt — `publisher` only pre-1900 or non-original).
- **36.7**: `authors`, `articleTitle`, `volume`, `journal`, `firstPage`, `year` (req); `pinpoint`, `subtitle` (opt).
- **36.8**: `authors`, `articleTitle`, `bookTitle`, `firstPage`, `year` (req); `editor`, `pinpoint` (opt).
- **36.9**: `title`, `site`, `url` (req); `author`, `handle`, `contentType`, `date`, `pinpoint` (opt).

Each component carries `rule` (e.g. `"36.4"`) and `format` (`bold`/`italic`/`plain`) so the existing tooltip + validation pipeline picks them up with no UI changes.

## Notes (per-rule)

Each new entry gets a `notes:` array carrying the Hebrew rule prose verbatim from the user's spec (so tooltip and validator messages match the manual). Includes:
- 36.2 advice: omit year when citing current code; `§§` for ranges.
- 36.3 pre-1962 regnal-year requirement; year-in-name vs. trailing `(year)`.
- 36.4 prefer official > regional > state reporter; SCOTUS / state high court → omit court; non-state reporter → add jurisdiction in parens.
- 36.6 publisher only when pre-1900 or non-original publisher; volume before authors.
- 36.7 short list of common abbreviations (Am., Br., Bull., Bus., Compar., Const., Crim., Econ., Eur., Hist., Hum., Interdisc., Int'l, J., Juris., Just., L., Mag., Med., Phil., Pol'y, Pol., Psych., Pub., Q., Rsch., Rev., Rts., Sch., Sci., Soc., Soc'y, Socio., Stud., Tax'n, Tech., Univ., Y.B.) — added as a `notes` line so the validator/tooltip can quote them.
- 36.9 social-media handle convention `(@handle)`; URL required; date format `Mar. 22, 2019`.

## Files to change

1. **`src/data/abbreviations.ts`**
   - Extend `SourceType` with the 9 new keys.
   - Add `REQUIRED_FIELDS` entries for each.
   - Add Hebrew `FIELD_LABELS` for new field names (`jurisdiction`, `division`, `code`, `chapter`, `regnalYear`, `monarch`, `reporter`, `procPrefix`, `volumeOrYear`, `courtAndJurisdiction`, `subtitle`, `publisher`, `handle`, `site`, `contentType`, `pinpoint`, `statuteName`).
   - Add `RULE_REFERENCES` entries (`"כלל 36.X – …"`).

2. **`src/data/citationEngine.ts`**
   - Add the 9 `CITATION_RULES` entries described above.
   - Keep the existing `foreign` entry as a fallback.

3. **`src/lib/citationValidation.ts`**
   - Extend `ENGINE_KEY_MAP` with the 9 new keys (1:1 mapping).
   - No regex extractors yet — validation falls back to required-field presence (same path the legacy `foreign` entry already used). Future PR can add Bluebook-specific regexes.

4. **`supabase/functions/_shared/citationEngine.ts`** (Deno fork)
   - Mirror the 9 new entries in the Deno copy so Stage E.5 Perplexity-resolver (`citation-engine-perplexity-resolver` memory) can validate Bluebook candidates the same way. Required-fields helper auto-picks them up.
   - Add a one-line memory note that the Bluebook entries must stay in sync between the two files.

5. **`.lovable/memory/logic/citation-rules/foreign-bluebook-rule-36.md`** (new memory)
   - Short index of the 9 entries + the 1:1 sync rule between `src/data/citationEngine.ts` and `supabase/functions/_shared/citationEngine.ts`.

## Out of scope (intentionally deferred)

- Auto-classifier heuristics that route foreign text to the right `foreign_*` subtype — current classifier still picks `foreign`; subtypes are reachable via the manual SourceTypeConfirmation override and via AI prompt. Can be a follow-up once we have real samples to tune on.
- Regex-based field extractors in `citationValidation.ts` for foreign citations (Bluebook strings vary too much; skipping until we have telemetry).
- AI prompt updates inside `citation-chat` / `legal-qa` — they already read from the engine registry, so the new entries surface automatically. We'll watch logs and tighten prompts later if needed.

## Verification

- TypeScript build passes (the harness will run it).
- Manual sanity check: open `SourceTypeConfirmation` UI and confirm the 9 new options appear with correct Hebrew labels; pick `foreign_case_us` and verify the template + required fields render in the validator.
