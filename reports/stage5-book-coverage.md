# Stage 5 batch 4 coverage ledger — books and chapters (bounded)

Baseline: `8fbe3099f3d2b6155f33d33a2065b11aae5a741a`. Offline only; nothing deployed or published.
Edition baseline unchanged (general Bluebook 21 R15.1–15.4(a), R15.5.1(a); Israeli 36.6/36.8 corroboration, implemented from the rule details in the request — the book was not re-read). Not a claim of full or latest compliance. `foreign_bluebook_v22` identifier not renamed. Taxonomy unchanged (14/78/12/16); only `nonperiodical.book` and `collection_component.chapter` deepened. Periodical author-ambiguity gate unchanged.

## Grammar (`src/data/bluebook/bookWorks.ts`, shared adapter `src/lib/bookLocal.ts`)
```text
Labelled: Key: value; Key: value; …   (≥2 segments)
  keys: Author, Editor, Translator, Title|Book|In|Collection, Chapter, Volume, Edition, Year,
        Publisher, Publisher status (non-original|original), Original year, First page,
        Pinpoint, Section, Paragraph
Book:     [Vol ]Heading[ Page | , at Pin | § N | ¶ N] (Paren)[tail]
Chapter:  Author, Title, in [Vol ]Collection[ First][, Pin | , at Pin] (Paren)[tail]
Paren:    [Ed ed[s]., ][Tr trans., ][Nd ed. ]YYYY
```
| Item | Bounded support |
| --- | --- |
| Editor-only book | Title-only heading + editors: starts with small-caps title, editors in the parenthetical; no author invented or reported missing |
| Contributors | Editors, then translators, then `[non-original publisher] [edition] year`; explicit `Original year` as a second parenthetical |
| Publisher | Rendered only with explicit `Publisher status: non-original` (R15.4 / 36.6). `original` → omitted with warning. Free-text or status-less publisher → whole input preserved with warning. Publisher with year before 1900 → declined (preserved) |
| Volume | Book: leading 1–2 digits; chapter: digits after `in`, before the small-caps collection |
| Pinpoints | `, at` page/roman/list; explicit `§`/`¶`; a bare trailing page only when the remaining title does not end in a numeral. Title ending in a numeral renders `, at`. Bare roman numerals or a number after a numeric-ending title → preserved as ambiguous |
| Chapter typography | Roman author, italic title, roman comma outside the italics, italic `in` (36.8), small-caps collection, first page, pinpoint. A missing first page stays missing (never taken from the pinpoint) |
| Author/title | Never inferred from name shape. Free-text book headings with a comma are kept whole as one small-caps heading (identical output, no author identity asserted) unless the existing M2A grammar already applies. A chapter needs exactly one comma before `, in`; more → preserved with a specific warning. Labelled `Author:` is the explicit form |
| Routing | Manual book on a chapter (or vice versa) → preserved mismatch; unsupported siblings (generic foreign) → preserved, never formatted; Hebrew → Israeli rules; recognized inputs skip classifier and providers in chat (initial/regeneration) and runCitation (single/batch) |
| Precedence | The existing M2A book grammar keeps precedence unless batch-4-only structure (labels, `, at`, §/¶, editor-only, ambiguous pinpoint) is present; runCitation keeps its existing deterministic path (status) when detection already matches |

## Excluded / limits
- Same-author collections, collected letters, reprints beyond an explicit original year, introductions/prefaces, pre-1900 place/publisher grammar, supplements, star editions, dictionaries, looseleafs, reports and other siblings: no new support.
- Unsigned chapters with a comma in the title are preserved (ambiguous), not formatted. Titles containing parentheses are not parsed. Labelled values containing `;` are not supported.
- Two-part chapter heads (`A, T, in …`) are read as author/title because R15.5.1(a) components carry an author — a structural, not name-shape, decision; flagged for review.
- The existing M2A free-text book grammar still assigns an author by name shape (unchanged prior behaviour).
- No identity verification, no dictionaries, no lookups. Book/chapter subtypes are not complete.
