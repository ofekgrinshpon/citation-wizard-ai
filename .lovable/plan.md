## Rule 37 status in BatchFootnoteBuilder — code review

The repeat-citation logic lives in `applyRepeatCitationRules` (line 889) with helpers `extractShortSourceLabel` (952), `extractReferenceSuffix` (935), `replaceCitationOnly` (970), `extractCitationOnly` (977). It runs from `finalizeApproved` at line 342.

### What works
- Basic detection of "same source twice" via `normalizeSourceKey` (strips pinpoints, casing, "סעיף X ל…" prefix, English equivalents).
- Generates a שם form for the immediately-consecutive case and a לעיל ה"ש form otherwise.
- Preserves rule/warning lines via `replaceCitationOnly`.

### Bugs still live

**Bug A — Short-form label is garbage for case law (highest impact).**
`extractCitationOnly` strips every `**`, so by the time `prior.fullCitation` reaches `extractShortSourceLabel`, there are no asterisks left. The case-law regex `/\*\*?([^*\n]+?)\*\*?\s+נ['׳]/` requires at least one `*` and therefore never matches. Control falls through to the English/lead branch and returns the first ~80 chars (e.g. `ע"א 2401/08 מדינת ישראל נ' גיספן`) instead of the Rule 37.2 short label `עניין גיספן`.

**Bug B — Rule 37.5 (legislation exception) is not implemented.**
Repeated laws produce `חוק העונשין, לעיל ה"ש 3, בעמ' 5.` The rule requires `ס' 5 לחוק העונשין.` (or `שם, בס' 5.` for adjacent repeats). There is no legislation branch in `applyRepeatCitationRules`; `isLegislationInput` from `src/lib/citationUtils.ts` exists but isn't used here.

**Bug C — Rule 37.7 "intervening source" branch missing.**
`seen` only remembers the first occurrence's index. There is no `prevCellKey` tracker, so the rule "same source as previous note but with an intervening source ⇒ `[name], שם.`" can't be expressed. Today every non-immediate repeat collapses to `לעיל ה"ש N`.

**Bug D — Rule 37.8 בי"ת prefix not enforced on short forms.**
`extractReferenceSuffix` returns the suffix verbatim (`עמ' 12`, `סעיף 5`, `פסקה 3`). It is then concatenated into the שם/לעיל output unchanged, producing `שם, עמ' 12.` instead of `שם, בעמ' 12.` (and `סעיף → בס'`, `פסקה → בפס'`). The server-side post-processor in `legal-qa/index.ts` does fix this, but the batch builder writes its output independently and never benefits from it.

**Bug E — שם detection off-by-one risk.**
`prior.index === index` (where `prior.index = firstSeenIndex + 1` and `index` is the current 0-based loop index) means "immediate" really means "current cell is exactly 1 after the FIRST occurrence". A source seen at positions 0, 1, 2 gets `שם` at position 1 and `לעיל ה"ש 1` at position 2 — should be `שם` again at position 2.

**Bug F (minor) — `applyRepeatCitationRules` runs inside a `setCells` updater.**
At line 342 the function is called from within a state-updater callback. Under React 18 StrictMode the updater can run twice; the function is pure, but it makes debugging harder than computing once before `setCells`.

### Proposed fix scope (frontend only, ~50 lines in BatchFootnoteBuilder.tsx)

1. **Fix short label (Bug A + E).**
   - Track `prevCellKey` alongside `seen`.
   - In `extractShortSourceLabel`, drop the `\*` requirement and match `([^,\n]+?)\s+נ['׳]\s+([^,\n]+?)(?:,|$)`. Prefer the second party unless it's `מדינת ישראל`/`פלוני`/`היועץ המשפטי לממשלה`/`היועמ"ש`, in which case fall back to the first. Prepend `עניין ` for case law.
   - Adjacent-repeat test becomes `prevCellKey === sourceKey` (not index arithmetic).

2. **Legislation branch (Bug B).**
   - Detect via `isLegislationInput(cell.input)` from `src/lib/citationUtils.ts` (already imported pattern available) or regex on the citation.
   - Extract law name with `extractLawNameFromInput`; extract section number from `cell.input` (`סעיף\s+([\dא-ת()./–-]+)`).
   - Adjacent same-law: `שם.` (or `שם, בס' X.` if section differs).
   - Non-adjacent: `ס' X ל<lawName>.` (no `לעיל ה"ש`).

3. **בי"ת prefix helper (Bug D).**
   - Add `withBetPrefix(suffix)` that rewrites `עמ' → בעמ'`, `סעיף → בס'`, `פסקה → בפס'`, `at 12 → at 12` (Latin unchanged), and leaves already-prefixed forms alone.
   - Apply only on שם / לעיל branches, never on the first (full) occurrence.

4. **Move out of the setCells updater (Bug F).**
   - Compute `const normalized = applyRepeatCitationRules(cells);` before `setCells(normalized)` so it runs exactly once per click.

### Out of scope
- No edge-function changes (`legal-qa`, `citation-chat`, `case-law-search` untouched).
- No DB / bibliography / integrity-card / final-list-rendering changes.
- No prompt changes — purely deterministic post-processing in the builder.

### Files touched
- `src/components/BatchFootnoteBuilder.tsx` only.

If you want, after I implement I can also update `mem://logic/repeated-citations` to note that the builder now mirrors the server's Rule 37 behavior.