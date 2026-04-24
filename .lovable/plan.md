# Rule 37 short-form generator — autonomous repeat-citation rewriter

## Problem recap

Today, when the drafter cites the same source twice in the body, the post-processor at lines 4218-4350 of `supabase/functions/legal-qa/index.ts` **collapses both into one footnote** via `cardIdToNewNumber` / `oldIdToNewNumber`. The body ends up with `[1]` appearing twice — same number reused — which violates Rule 1.10 ("each [N] appears once"), Rule 37.7 (every repeat needs its own short-form note), and breaks the academic norm that the bibliography of footnotes is a sequential record of authority invocations.

The fix flips the model: **every body citation gets its own footnote number.** The first invocation of a source emits a full citation; every subsequent invocation emits a new footnote whose text is the auto-generated Rule 37.7 short-form (`שם` / `[name], לעיל ה"ש N`) or the Rule 37.5 legislation form (`ס' X ל[חוק]`).

## The new pipeline stage

A new function `applyRule37ShortForms()` runs **after** the footnote-build loop (immediately after line 4350) and **before** the appearance-order reordering at line 4406. It operates on three inputs already in scope: `answer` (body with `[N]` markers, pre-superscript), `footnotes` (the deduplicated list with full citations), and `oldIdToNewNumber` (the AI-id → emitted-id map).

```text
┌─────────────────────────────────────────────────────────────┐
│  Stage A — Build the source registry                        │
│    For each footnote f in footnotes:                        │
│      registry[f.number] = {                                  │
│        cardId,            // back-resolved via cardIdToNewNumber inverse
│        sourceType,        // f.source_type
│        shortName,         // computed once (see Stage B)
│        firstFnNumber: f.number,
│      }                                                       │
├─────────────────────────────────────────────────────────────┤
│  Stage B — Compute the short-form name per Rule 37.2        │
│    Legislation → strip year/ס"ח/[נוסח חדש] → "חוק העונשין" │
│    Case law    → "עניין/פרשת [identifying party]"           │
│    Books       → "[surname]" (or "[surname] [title-quoted]")│
│    Articles    → "[surname] \"[title]\""                     │
│    Foreign     → original-language name, "##X##" preserved  │
│    Internet    → site name in bold + brief title            │
├─────────────────────────────────────────────────────────────┤
│  Stage C — Walk the body, find every [N], expand repeats    │
│    bodyCitations = [{ pos, oldNum, pinpoint? }, ...]        │
│      // pinpoint = optional "בעמ' X" / "ס' X" inside or     │
│      // immediately following the [N] marker                │
│    seenInOrder = []                                          │
│    rewriteOps  = []                                          │
│    for each citation in body order:                         │
│      if first time seeing this firstFnNumber:               │
│        seenInOrder.push(citation)                           │
│        keep [N] as-is (full citation already in footnotes)  │
│      else:                                                   │
│        // It's a REPEAT — needs a brand-new footnote        │
│        newFnNum = nextAvailableNumber()                     │
│        shortText = buildShortForm(                          │
│          registry[firstFnNumber],                           │
│          previousCitation,                                  │
│          citation.pinpoint,                                 │
│        )                                                     │
│        push new footnote { number: newFnNum, citation: shortText, ... }
│        rewriteOps.push({ replace: oldMarker, with: [newFnNum] })
├─────────────────────────────────────────────────────────────┤
│  Stage D — Apply rewrites; reordering at line 4406 picks    │
│  up the new numbering naturally (it's by appearance order). │
└─────────────────────────────────────────────────────────────┘
```

## Rule 37.7 / 37.5 short-form generation logic

`buildShortForm(registry, previousCitation, pinpoint)` returns one of four shapes:

```text
1. Same source as the IMMEDIATELY previous footnote, no intervening source:
     → "שם."                                  (no pinpoint)
     → "שם, בעמ' 45."                          (with pinpoint)
     → "שם, בס' 17(א)."                        (legislation pinpoint, but
                                                see Rule 37.5 override below)

2. Same source as the immediately previous footnote, BUT an intervening source
   exists between this one and that one (defensive — rare in practice):
     → "[שם], שם."                             (with the source's short name)

3. Source previously cited, NOT the immediately preceding one:
     → "[שם], לעיל ה\"ש N."                    (no pinpoint)
     → "[שם], לעיל ה\"ש N, בעמ' 45."           (with pinpoint)

4. RULE 37.5 OVERRIDE — Legislation NEVER uses לעיל ה"ש:
     If sourceType ∈ {israeli_law, basic_law, regulation, ordinance}:
       → "ס' [pinpoint] ל[lawShortName]."     (with pinpoint)
       → Drop the repeat entirely, leave the body marker out
         (legislation without a pinpoint as a repeat is meaningless;
         the first full citation already established the law)
```

The "previous footnote" check uses the running `seenInOrder` array — specifically the last item — so it correctly handles the case where two consecutive body markers cite the same source.

## Pinpoint extraction from the body

The body sometimes carries the pinpoint inline (`...כפי שקבע השופט ברק [3] בעמ' 245...`) and sometimes the AI tucked it into the footnote text. We detect pinpoints in two places:

```text
1. Inside the footnote that the [N] originally pointed to — only useful for the
   FIRST occurrence (which keeps its full citation, pinpoint already there).

2. In a ~40-char window AFTER the [N] marker in the body, matching:
     /\[N\]\s*(?:בעמ['׳]\s*\d+|בעמוד\s+\d+|בס['׳]\s*[\dא-ת()]+|בפס['׳]\s*\d+)/
   When found, the pinpoint is captured and stripped from the body (since it
   migrates into the new short-form footnote).
```

If no pinpoint is found for a repeat, the short-form is emitted without one — that's compliant with Rule 37.7 (pinpoint is optional in `שם` / `לעיל ה"ש N`).

## Source-name extraction (Rule 37.2) — `computeShortName(card, footnoteText)`

This is the trickiest part. The `SourceCard` has `source_type` and a full `citation`, but no pre-extracted "short name." We compute it once per source:

```text
LEGISLATION (israeli_law / basic_law / regulation / ordinance):
  Take the first chunk of the citation up to the first comma, then strip:
    - Hebrew year suffix (התש"ז-1977)
    - "[נוסח חדש]" / "[נוסח משולב]"
    - Bracketed annotations
  → "חוק העונשין", "פקודת הראיות", "חוק-יסוד: כבוד האדם וחירותו"

CASE LAW (caselaw / case_law_published / case_law_database):
  Strategy: extract the bolded party names (**...**) from the citation, prefer
  the non-government / non-anonymous side, and prefix with "עניין" or "הלכת":
    - Both parties bold → pick the one that is NOT in
      {מדינת ישראל, היועץ המשפטי לממשלה, פלוני, אלמוני, אנונימי, ...}
    - If both are generic → fall back to the case number (rare)
  → "עניין **גיספן**", "הלכת **קעדאן**"
  Hard fallback when no bold markers: take the segment between the case number
  and "נ'", strip whitespace.

BOOKS (book):
  Author surname only (last token of author name before the bolded title).
  Same-surname clash detection is deferred to v2 — for v1 we accept the
  collision and log it.
  → "ברק"

ARTICLES (article / article_in_book):
  Author surname + article title in quotes:
  → "פרוקצ'יה \"הסדרת החוזים המיוחדים\""
  Surname extracted as the first token before the opening quote of the title.

INTERNET (internet / web):
  Bold site name + abbreviated title (≤30 chars):
  → "**ynet** \"פתרון לסחבת...\""

FOREIGN (foreign / bluebook):
  Preserve original language; preserve "##X##" italic markers:
  → "Brown", "##Donoghue v. Stevenson##"
  Detected by Latin-character ratio in the citation > 50%.

FALLBACK when classification fails or extraction returns empty:
  Use the first 40 chars of the citation, trimmed at the last word boundary.
  Log it as `qa_logs.metadata.rule37_shortname_fallback` with the card id.
```

## Edge cases handled

- **Three or more invocations of the same source** — every repeat after the first generates its own short-form footnote. The "immediately previous" check correctly toggles between `שם` and `לעיל ה"ש N` based on what's actually adjacent in the final ordering.
- **Drafter already wrote `שם` / `לעיל ה"ש N` manually** — these are detected via the existing `SUPRA_FULL` / `\bשם\b` test (already used at lines 4662, 4696). Manually-authored short-forms are passed through untouched; the back-ref validator (lines 4525-4630) continues to fix wrong N values. The new generator only fires when the body re-uses the same `[N]` marker, which is the bug pattern we're fixing.
- **Legislation repeat with no pinpoint** — per the override above, we drop the body marker (the first full citation suffices). Logged as `rule37_legislation_repeat_dropped`.
- **Foreign sources** — `לעיל ה"ש N` stays in Hebrew per Rule 37.9; only the source name is in the original language. The `##X##` italic markers are preserved.
- **Same source as previous, different pinpoint** — emits `שם, בעמ' [new pinpoint].` (Rule 37.7 explicitly allows this).
- **Card resolution failure** — if a footnote in the registry has no resolvable card (e.g. fuzzy-URL-only match with `source: "unverified"`), we use the citation text itself as the short-name source via the fallback path. The repeat still gets a proper `לעיל ה"ש N` form.

## Interaction with existing post-processors

The current Rule 37 cleanup at lines 4632-4668 (`lawSupraRe`, `שם, שם` collapse, בי"ת prefix enforcement) **stays** and runs *after* the new generator. The generator produces canonical short-forms; the cleanup is now a defensive net for edge cases and any AI-authored short-forms that slip through. The back-ref validator at lines 4525-4630 also stays and is now mostly a no-op for generator-produced short-forms (since the generator emits the correct `N`), but remains useful for AI-authored ones.

The appearance-order reordering at line 4406 runs **after** the new generator, so the new repeat footnotes get renumbered to their actual position in the final body order. The `reorderMap` step at lines 4460-4470 already rewrites `לעיל ה"ש X` references inside footnote citations — that means if the generator emitted `לעיל ה"ש 3` and reordering renumbers footnote 3 to 5, the back-reference auto-updates to `לעיל ה"ש 5`. No changes needed there.

## Telemetry

New `qa_logs.metadata.rule37_short_forms`:

```text
{
  total_repeats_expanded: number,
  shem_count: number,
  supra_count: number,
  legislation_section_count: number,
  legislation_repeat_dropped_count: number,
  shortname_fallback_count: number,
  samples: [{ original_marker, source_type, short_name, form }]  // first 5
}
```

This makes it easy to see, per query, how the generator fired and catch regressions.

## What we are explicitly NOT doing in this pass

- **Not implementing same-surname clash detection for books** (Rule 37.2 second paragraph). v1 accepts collisions, logs them via `shortname_fallback_count`. We can layer this on later if logs show it matters.
- **Not retroactively fixing prior `qa_logs` rows** — the rewriter only runs on new queries.
- **Not changing the drafter prompt** — the prompt already asks for `שם` / `לעיל ה"ש N` (lines 832, 845, 3305-3318). The generator is a safety net for when the drafter ignores the prompt and re-uses the same `[N]`.
- **Not touching the academic-mode shortcut block** — that path doesn't go through the footnote build loop, so there's nothing to expand.

## Files touched

- `supabase/functions/legal-qa/index.ts` — new `computeShortName()`, `buildShortForm()`, and `applyRule37ShortForms()` functions; insert the call between line 4350 and line 4406; add the `rule37_short_forms` block to the `qa_logs.metadata` write.
- `.lovable/memory/logic/repeated-citations.md` — append a "Rule 37 Short-Form Generator (server-side)" section documenting the new behavior, the source-name extraction rules, and the legislation override.

## Acceptance criteria

For a query whose drafter cites the same Barak journal article three times in the body:

- The body shows `[1]`, `[2]`, `[3]` (or whatever the final appearance-order numbers are) — never the same number twice.
- Footnote 1 is the full Barak citation.
- Footnote 2 is `שם, בעמ' [pinpoint].` (or just `שם.` if no pinpoint), because it's adjacent to footnote 1.
- Footnote 3 is `שם.` if it's also adjacent to footnote 2, otherwise `פרוקצ'יה, לעיל ה"ש 1, בעמ' [pinpoint].`.
- For a query that cites חוק העונשין twice with different sections: first footnote is the full citation; second `[N]` marker is replaced by `ס' 35 לחוק העונשין.` inline (no separate footnote needed for legislation repeats with pinpoints), or — if we keep it as a footnote per current architecture — the footnote text is `ס' 35 לחוק העונשין.`.
- `qa_logs.metadata.rule37_short_forms.total_repeats_expanded >= 1`, with samples showing the original card and the generated form.
- No regression: queries with no repeats produce identical output to today.
