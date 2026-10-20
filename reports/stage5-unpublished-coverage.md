# Stage 5 batch 2 coverage ledger — unpublished manuscripts and dissertations/theses

Baseline: `7ffb0eb2babe1bd6990f48d36268d8dec7bb7369`. Offline only; nothing deployed.

## Source
- User-provided general Bluebook **21 Rule 17.2.1 (manuscripts not scheduled for publication) and 17.2.2 (dissertations and theses)**, not Bluepages: https://drive.google.com/file/d/19dQaCAVawq9KR9dic6a71Cpy-3QCoAZ2/view . Implemented from the rule details supplied in the request; the PDF was not fetched or independently re-read in this batch.
- Israeli 35.1 precedence and 37.9/38 repeat handling unchanged (no Id./supra). `foreign_bluebook_v22` identifier not renamed. Workbook still 14/78/12/16; only the existing `unpublished_communication.manuscript` and `.thesis` subtypes gained a route.

## Supported
| Item | Bounded support |
| --- | --- |
| Manuscript | `Author, Title [pins] (date) (unpublished manuscript|unpublished comment) [(on file with …/available at …)]`; roman throughout; title/author verbatim |
| Thesis | Same, with `(<degree> dissertation|thesis, <institution>)`; year-only dates kept as supplied |
| Missing | Author, title, date, work type, institution reported as missing markers + warning; never invented |
| Ambiguity | Trailing year-like number kept in title with warning; unparsed parentheticals/URLs preserved verbatim with an "unverified" warning; Hebrew-headed input not handled here |
| Detection | Only from an explicit work-type parenthetical; never from title words or repository hosts. Complete input skips the classifier and all paid calls |
| Manual choice | Effective subtype routes to `foreign_unpublished_manuscript` / `foreign_thesis`; manual manuscript may supply "unpublished manuscript" with a warning; manual thesis never invents a degree; a contradicting label is preserved with a mismatch warning; existing stale/plan freshness rules unchanged |
| Callers | Shared `unpublishedWorkLocal.ts` in runCitation (single/batch/bibliography pipeline) and Index initial/edit/regeneration; reply always states identity/institution/repository not verified |

## Excluded / not audited
- Other R17 types (letters, memoranda, e-mail, interviews, speeches, working papers), forthcoming/published works, jurisdiction-specific exceptions, short forms beyond existing Israeli repeat rules, bibliography category beyond "foreign other".
- Unsupported siblings (`unpublished_communication.letter`, `.memo`, …) stay unsupported and route to generic handling.

## Remaining Stage 5
D1a and this batch do not complete Stage 5; all other family batches remain open and need separate authorization.
