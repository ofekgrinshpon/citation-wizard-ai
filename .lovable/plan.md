

## Goal
Fix three bugs in the Bibliography Generator:
1. Manual category change in step 2 is ignored — source still ends up under the auto-detected category (e.g., user picks ספרות משפטית, but it lands under פסיקה – מחוזי).
2. Sources are rendered with trailing periods that should be stripped on display/copy.
3. The article `אלון הראל "מרובה המחזיק את המרובה: על היקף התפרשותן של הזכויות החוקתיות" משפטים נז` is mis-classified as **פסיקה – מחוזי**.

## Root causes

### Bug 1 — manual category reset
In `src/hooks/useBibliography.tsx`, `addEntries` correctly applies `sourceTypeOverride`, but immediately wraps the new list in `rebuildBibliographyEntries(...)` which spreads `...classifyCitation(item.fullCitation)` over every entry — overwriting the user's choice with the heuristic result. Same thing happens on every mount via the `useEffect` that re-runs `rebuildBibliographyEntries`.

### Bug 2 — trailing periods
`copyAll` and the rendered list emit citations exactly as stored. Verified citations and AI lookups frequently end with `.`, leading to `... ס"ח 226.` on every line.

### Bug 3 — district-court false positive
In `classifyCitation`, the district-court detector is:
```
/ת"א|ת"פ|ע"מ|ה"פ|המר|פר"ק/
```
`המר` has no boundary anchor, so it matches inside the ordinary Hebrew word **המרובה** ("המרחזיק את **המר**ובה") and the article gets tagged as district case-law. Same risk exists for other un-anchored multi-letter tokens once gershayim are absent.

## Fix

### `src/hooks/useBibliography.tsx`

1. **Persist manual category override.**
   - Add `manualCategory?: boolean` to `BibliographyEntry`.
   - In `addEntries`, when `sourceTypeOverride` is provided: set `sourceType` from it AND set `manualCategory: true`.
   - In `rebuildBibliographyEntries`, if `item.manualCategory` is true, **keep** the existing `sourceType`/`subCategory`/`authorSurname` — only run `classifyCitation` for `language` and `year` (or just preserve everything except recompute `language`/`year` from text).

2. **Anchor district / magistrate / specialized regexes** so abbreviations like `המר`, `ת"א`, `ע"מ`, `ה"פ`, `ת"ד`, `ד"מ` only match when they actually look like procedure tokens (followed by space + digits, or with required gershayim on Hebrew words). Concretely, replace:
   ```
   /ת"א|ת"פ|ע"מ|ה"פ|המר|פר"ק/
   ```
   with anchored versions that require either a leading whitespace/start-of-string AND a following space + digit (procedure number) or quote mark, e.g.:
   ```
   /(?:^|\s)(?:ת"א|ת"פ|ע"מ|ה"פ|פר"ק|המ['׳]|המר['׳])\s+\d/
   ```
   Apply the same boundary tightening to magistrate (`ת"ט|תא"מ|ת"ד`) and specialized (`עב"ל|ס"ק|ד"מ`) regexes — each must be followed by `\s+\d` (a docket number) to count as case-law.
   - Also add a precedence rule: if the citation contains a quoted article title (`"..."`) AND a Hebrew journal/volume hint (`משפטים|עיוני משפט|הפרקליט|מחקרי משפט|כתב[\s-]עת` followed by a Hebrew volume marker like `נז`/`כב`/digits), classify as `literature` BEFORE running case-law heuristics.

3. **Strip trailing punctuation on storage.** In `addEntries` (and `addEntry`, `syncFootnoteEntries`), normalize `fullCitation` once with `text.trim().replace(/[.,;:\s]+$/u, "")` before constructing the entry. This guarantees every stored citation ends cleanly; the on-screen list and copy-to-Word output then never show a stray period.

### `src/components/BibliographyGenerator.tsx`

- No regex changes. Two display-side touch-ups:
  1. When rendering rows in step 2 and step 3, also strip trailing `.,;:` defensively (harmless second pass).
  2. The category popover (`onChangeCategory`) already sets `sourceTypeOverride` on the review item — the hook fix above is what makes it actually stick after commit.

### Edge function
No change.

## Out of scope
- Disambiguation flow, Perplexity fallback, verified-source priority, 3-step wizard structure.
- Existing entries in `localStorage` will re-run through the (now safer) classifier on next mount; manually-overridden ones added after this change will be locked.

## Outcome
- Picking "ספרות משפטית" (or any other category) on a row → the source lands and **stays** in that category, even after page reload.
- `אלון הראל "מרובה המחזיק את המרובה..." משפטים נז` → classified as **ספרות משפטית** (literature pre-check wins; even without it, `המר` no longer false-matches inside `המרובה`).
- All bibliography lines end without a trailing `.` — both on screen and in the "העתק ל-Word" output.
- Real district cases (e.g. `ת"א 1234/20 פלוני נ' אלמוני`) still classify correctly because the anchored regex requires `ת"א` followed by a docket number.

