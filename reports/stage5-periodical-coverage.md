# Stage 5 batch 3 coverage ledger — nonconsecutive journals/magazines and print newspapers

Baseline: `d2fbaf575a1397c0acaba24eaa0c1dcfb41c5def`. Offline only; nothing deployed or published.

## Source
- User-supplied general Bluebook **21 Rule 16.5** (nonconsecutively paginated journals/magazines) and **16.6(a),(b)** (newspapers, print), not Bluepages. Implemented from the rule details in the request; the book was not re-read in this batch.
- Israeli 35.1 precedence and 37.9/38 repeat handling unchanged (no Id./supra). `foreign_bluebook_v22` identifier not renamed. Workbook still 14/78/12/16; only the existing `periodical.article` (new mode) and `periodical.newspaper` (new route `foreign_newspaper`) changed.

## Supported grammar (`src/data/bluebook/periodical.ts`, shared adapter `src/lib/periodicalLocal.ts`)
```text
[Author, ][Designation, ][Title, ]Periodical[ (Place)], DateOrIssue[ (Section)], at Page[, pins][tail]
Designation := Editorial | Opinion | Op-Ed | Letter to the Editor
DateOrIssue := Mon. D, YYYY | Mon. YYYY | Mon.–Mon. YYYY | Season[–Season] YYYY[–YY]
             | [vol. N, ]no. N[, [Mon. ]YYYY]
Page        := alphanumeric (A1, 4F, SR3, 12);  pins := list/ranges, optional n.
Section     := (§ N) | (sec. X) | (X section)
```
| Item | Bounded support |
| --- | --- |
| R16.5 article | Author if supplied; italic title; small-caps periodical (verbatim, no new abbreviations); cover date as supplied (no invented day); `at` first page, pins. Unsigned starts with title, not missing. Issue designation only when no cover date, with warning |
| R16.6 newspaper | Author; roman designation before title; titleless designation substitutes for title; small-caps newspaper; supplied place roman in parentheses; full date; section parenthetical after date; `at` first page only. Supplied pinpoint is excluded from the citation but kept as an unrepresented-field warning |
| Kind decision | Article only from cover season/month/range or issue no.; newspaper only from place or section parenthetical. Day-date input with neither (or with a designation only) is **ambiguous** → generic foreign, preserved with a warning and subtype candidates; never guessed |
| Manual choice | `periodical.newspaper` → `foreign_newspaper`; `periodical.article` → existing route + this mode. Contradicting structure is preserved with a mismatch warning; manual newspaper on unparseable input preserved as unsupported. Generic/unsupported siblings never pass through the formatter |
| Safety | Unknown tails kept verbatim with warning; HTML/`##`/`^^` escaped; Hebrew-headed input left to Israeli rules; no identity verification claimed (reply always says so) |
| Callers | runCitation (single/batch/bibliography) and Index initial/regeneration; complete recognized input skips classifier and providers |

## Excluded
- Wire services, commercial databases, internet editions, consecutively paginated newspapers, student notes/reviews/symposia/newsletters and other `periodical.*` siblings: no new support (stay unsupported/generic).
- Unsigned titles containing a comma are read as `Author, Title` (limitation). Periodical names containing commas are not parsed. Year-only magazine dates are not parsed.
- Short forms beyond existing Israeli repeat rules; bibliography category beyond "foreign other"; no T6/T10/T13 additions.
- Not every case in either subtype is covered. Stage 5 remains incomplete.
