# Stage 5 batch 4 coverage ledger — books and chapters (bounded)

Boundary correction baseline: `9cd99a68e3a4344ced067004c2ef725389bdd29e`. Exact supplied probes reproduced offline: 10 failures before the correction; focused 93/93 and full 3,351 passed / 1 skipped afterward. App `tsgo` passed; automatic build log reports `build OK`. No providers, deployment, database or settings changes.

Baseline: `8fbe3099f3d2b6155f33d33a2065b11aae5a741a`. Offline only; nothing deployed or published.
Edition baseline unchanged (general Bluebook 21 R15.1–15.4(a), R15.5.1(a); Israeli 36.6/36.8 corroboration, implemented from the rule details in the request — the book was not re-read). Not a claim of full or latest compliance. `foreign_bluebook_v22` identifier not renamed. Taxonomy unchanged (14/78/12/16); only `nonperiodical.book` and `collection_component.chapter` deepened. Periodical author-ambiguity gate unchanged.

## Grammar (`src/data/bluebook/bookWorks.ts`, shared adapter `src/lib/bookLocal.ts`)
```text
Labelled: Key: value; Key: value; …   (≥2 segments)
  keys: Author, Editor, Translator, Title|Book|In|Collection, Chapter, Volume, Edition, Year,
        Publisher, Publisher status (non-original|original), Original year, First page,
        Pinpoint, Section, Paragraph
Book:     [Vol ]Heading[ Page | , at Pin | § N | ¶ N] (Paren)[tail]
Chapter:  Heading, in [Vol ]Collection[, at Pin | § N | ¶ N] (Paren)[tail]
          Unlabelled comma-containing Heading → preserve (ambiguous author/title).
          Lone trailing collection numeral → preserve (ambiguous title/first page).
Paren:    [Ed ed[s]., ][Tr trans., ][Nd ed. ]YYYY
```
| Item | Bounded support |
| --- | --- |
| Editor-only book | Title-only heading + editors: starts with small-caps title, editors in the parenthetical; no author invented or reported missing |
| Contributors | Editors, then translators, then `[non-original publisher] [edition] year`; explicit `Original year` as a second parenthetical |
| Publisher | Rendered only with explicit `Publisher status: non-original` (R15.4 / 36.6). `original` → omitted with warning. Free-text or status-less publisher → whole input preserved with warning. Publisher with year before 1900 → declined (preserved) |
| Volume | Book: leading 1–2 digits; chapter: digits after `in`, before the small-caps collection |
| Pinpoints | `, at` page/roman/list; explicit `§`/`¶`; labelled `Pinpoint` / `First page`. Editor-only `Catch 22` and `Title 2020` retain their complete titles, no inferred pinpoint, and preserve the original with an ambiguity warning; `Catch 22, at 15` formats with the title numeral intact. Lone trailing chapter collection numerals do not become first pages. An explicit chapter `, at` never supplies a missing first page. Existing legacy signed-book parsing remains bounded as before, but cannot bypass a preservation reason or the new editor-only guard. |
| Chapter typography | Roman author, italic title, roman comma outside the italics, italic `in` (36.8), small-caps collection, first page, pinpoint. A missing first page stays missing (never taken from the pinpoint) |
| Author/title | The new chapter parser never infers an author from name shape, subtype selection, comma count or an assumed chapter author requirement. Every unlabelled comma-containing chapter heading (including exactly two parts, `Hidden Costs, Courts and Memory` and formerly accepted bare signed heads) is retained whole without `authors` and preserved with a specific author/title warning. Use explicit `Author: …; Chapter: …; Collection: …` (also `In:`). Free-text book comma headings remain whole unless the unchanged legacy M2A grammar applies. |
| Routing | Manual book on a chapter (or vice versa) → preserved mismatch; unsupported siblings (generic foreign) → preserved, never formatted; Hebrew → Israeli rules; recognized inputs skip classifier and providers in chat (initial/regeneration) and runCitation (single/batch) |
| Precedence | The existing M2A book grammar keeps precedence unless batch-4-only structure (labels, `, at`, §/¶, editor-only, ambiguous pinpoint) is present; runCitation keeps its existing deterministic path (status) when detection already matches |

## Excluded / limits
- Same-author collections, collected letters, reprints beyond an explicit original year, introductions/prefaces, pre-1900 place/publisher grammar, supplements, star editions, dictionaries, looseleafs, reports and other siblings: no new support.
- All unlabelled comma chapter heads are preserved, not formatted; no two-part-head exception. Titles containing parentheses are not parsed. Labelled values containing `;` are not supported.
- A chapter collection's lone trailing numeral is ambiguous and preserved. Separate explicit first-page labels are recommended; the existing bounded `Collection 12, 15` page-list grammar remains, only for headings without an ambiguous author/title boundary and collections without a numeric-ending title.
- The existing M2A free-text book grammar still assigns an author by name shape (unchanged prior behaviour).
- No identity verification, no dictionaries, no lookups. Book/chapter subtypes are not complete.
