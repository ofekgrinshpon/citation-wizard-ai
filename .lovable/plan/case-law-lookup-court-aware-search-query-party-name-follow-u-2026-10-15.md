# Case-law lookup: court-aware search query + party-name follow-up

## Goal
Fill missing date and source (database / פ"ד) for case-number citations, e.g. `עש"א 1477-12-22` and `ע"א 11487/03`, without weakening the rule that details must be proven to belong to the exact case.

## Evidence from the live experiment (Oct 15)
- Current query tells the search to check פ"ד "first" for every case, including district/magistrate cases that can never appear in פ"ד. Both cases returned generic database landing pages only.
- Removing that instruction alone found `11487/03` (parties, 23.03.2008, Supreme Court).
- A follow-up query with the case number + party names found פ"ד סב(4) 1 for `11487/03`, and a date for `1477-12-22` (still unverified).
- Supporting evidence comes from sources outside the trusted list (Cardozo project, law-firm sites, a Haaretz PDF), where the case number appears only in the snippet. Today all of these are rejected.

## Changes

### 1. Court-aware query (citation-chat case-number branch)
- Classify the docket: Supreme (two-part number with a Supreme prefix: ע"א, בג"ץ, רע"א, ע"פ, דנ"א...) vs lower court (three-part number like `1477-12-22`, or a district/magistrate prefix: עש"א, ת"א, ת"פ, ע"מ, סע"ש...). Unknown -> current behaviour.
- Supreme: keep the פ"ד check, reworded as "check פ"ד; if not published, name the electronic database".
- Lower court: no פ"ד instruction at all; ask for the court, the decision date and the electronic database (נבו/תקדין/פסקדין). The system prompt's פ"ד paragraph is sent only for Supreme cases.

### 2. Party-name follow-up search (only when needed)
- Runs at most once, only if the first search confirmed the parties for the exact case number but the date or source is still missing.
- The query is the case number plus the confirmed party names, asking only for the decision date and where it was published.
- Results go through the same exact-case-number checks. Nothing confirmed earlier is overwritten.

### 3. Snippet evidence from non-trusted sources — owner decision needed
Option A (conservative, default): unchanged. Non-trusted sources still cannot prove anything; changes 1 and 2 only help when a trusted database page is returned.
Option B: accept a non-trusted result as proof of the date only when its snippet contains the exact full case number AND both party names close together. The database field is never taken from such a source (stays "[חסר: שם המאגר]" or, for Supreme, פ"ד if the snippet shows it).

## Unchanged
Trusted-host list, field clearing, party checks, the three-part docket identity fix, the formatter, models, other functions.

## Tests (offline, with the saved experiment responses as fixtures)
- Query for a lower-court docket contains no פ"ד instruction; Supreme query keeps it.
- Follow-up search fires only when parties are confirmed and date/source missing; never more than once; never for a different case number.
- `1477-12-22` vs `1477-12-23` / `1477/12` never cross-match in the follow-up.
- If Option B: a snippet that mentions the case only as a citation inside another judgment (no matching parties) is rejected.
- Full existing suite stays green.

## Cost / rollout
- One extra search (~$0.004) only in the follow-up case.
- Stages, each needing separate approval: (1) code + offline tests; (2) deploy citation-chat; (3) re-run the two cases live and compare.
