# Fix: fabricated פ"ד publication and year for בג"ץ 5555/18

## What actually happened (confirmed from the run logs)

The retrieval was **correct** this time. The logs for the 15:53 run show:

- The docket was detected and anchored: `docket=בג"ץ 5555/18 ... docket_anchored=true`, with the real judgment PDF among the sources (`supremedecisions.court.gov.il/.../18055550.V36`), carrying the true decision date `2021-07-08`.
- The search model nevertheless returned a **fabricated publication**: `פ"ד נד(1) 1` plus date `27.08.2020`.
- The decision-date verifier did its job and rejected the date: `date verification: original={date:27.08.2020,year:2020} verified={"date":"","year":""} action=clear`.

The bug is what happens *after* that rejection:

1. Clearing the date does **not** clear the publication — `padi_volume/part/page` stay in the payload.
2. The volume-plausibility guard compares the volume against the year — but the year had just been cleared, so the guard is skipped entirely.
3. There is **no check between the docket year and the volume**. Volume נד corresponds to 1999–2001; a `.../18` docket cannot possibly appear there. Nothing in the pipeline notices.
4. The drafting prompt therefore received "פרסום: פ"ד נד(1) 1" with no date, and the writing model filled in the year that fits volume נד: **(2000)**.
5. Separately, the true date `8.7.2021` was sitting in the anchored search result and was never used, and the party name came out as "הכנסת" (from a snippet of a *different* judgment citing this one) instead of "כנסת ישראל".

Note the second-pass publication path already has the right guards (volume must be known, year must fit, docket must appear in a citation URL) — but it only runs when the first pass says *unpublished*. First-pass `isPublished=true` bypasses all of it.

## What to change

### 1. Docket-year vs פ"ד volume consistency gate
Derive the filing year from the docket (`5555/18` → 2018) and reject any `padi_volume` whose plausible-year window ends before the filing year. Unknown volumes are also rejected for modern dockets. On rejection: clear `isPublished` and all padi fields and fall back to the database form (אר"ש, from the `supremedecisions.court.gov.il` citation).

### 2. Apply the existing publication guards to the first pass
Reuse the second-pass sanity logic for first-pass `isPublished=true` results: the volume must be a known volume, must be consistent with both the decision year and the docket year, and the docket must appear in a trusted citation URL or in a snippet next to "פ"ד". Otherwise the publication is dropped, not kept.

### 3. Clearing the date must also clear the publication
In the date-reconciliation step, when verification comes back empty (`action=clear`), also clear `isPublished` / `padi_volume` / `padi_part` / `padi_page`. An unverifiable decision date means the פ"ד reference behind it is unverified too.

### 4. Use the anchored result's own date
When the anchored trusted search result carries a `date` (here `2021-07-08`) and the docket matches, use it as the decision date instead of leaving the field empty. This alone produces the correct `(אר"ש 8.7.2021)`.

### 5. Never let the writer invent a missing year
When the hint has no verified date, state explicitly that the year must be rendered as `[חסר: תאריך]` and that no year may be inferred from a פ"ד volume.

### 6. Party name from the case's own caption
Prefer the party names from the anchored *case page* title/caption (the judgment PDF or the psakdin case page) over snippets from other judgments that merely cite this case — that is where "הכנסת" came from instead of "כנסת ישראל".

## Files

- `supabase/functions/citation-chat/index.ts` — first-pass publication gate, docket-year check, anchored-date fallback, hint wording, party-source preference.
- Shared helper for the docket-year ↔ volume check (used by both the first- and second-pass paths).

## Validation

Re-run all four forms and compare against the expected output
`בג"ץ 5555/18 חסון נ' כנסת ישראל (אר"ש 8.7.2021), פס' 6–4 לפסק דינו של השופט עמית`:

1. `בג"ץ 5555/18 חסון נ' כנסת ישראל פס' 4-6 לפסק דינו של השופט עמית`
2. `5555/18 חסון נ׳ כנסת ישראל פס' 4-6 ...` (bare docket)
3. A genuine פ"ד case that must keep its volume — e.g. `ע"א 6821/93 בנק המזרחי` → `פ"ד מט(4) 221` must survive the new gate.
4. A fake docket (`בג"ץ 9999/99`) → must still render `[חסר: ...]` rather than invent a citation.
