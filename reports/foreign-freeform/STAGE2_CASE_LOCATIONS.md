# Stage 2 — Case location records, grouping by decision, UK reporters, search completion

Scope: foreign case lookups only (`citation-chat` foreign lookup + the shared client planner). No model, no billing/quota change, no deployment, no live provider call. Israeli routing untouched.

## What changed
- New pure module `supabase/functions/_shared/citationPure/caseLocations.ts`.
  - **One record per reported location**: reporter, volume, first page, report-volume year and year form travel together. Fields are never assembled from two records.
  - **Grouping by decision first**: records merge into one decision only when court, decision year and neutral citation do not conflict, and they share a neutral citation, an identical location, or the same year. Different court or conflicting year → separate decisions.
  - **Location chosen only inside one decision**: one location → used; two or more parallel reporters → `locationChoiceRequired` (the edition-21 priority rule is still unverified, so nothing is picked automatically); same reporter with disagreeing records → that reporter is dropped and a `location:` conflict is recorded.
  - **Decision year vs report year kept apart**: `decisionYear` (neutral citation / US decision parenthetical) and `volumeYear` (e.g. `[2017] AC`) are stored separately. Example: R v Jogee [2016] UKSC 8, [2017] AC 387.
  - **Caption binding**: a citation counts only when the nearest preceding "v" caption in the same text names both parties, so a citation of another case quoted in the same snippet is ignored.
  - **UK reporters expanded (server evidence only)**: AC, QB, KB, Ch, Fam, P, WLR, All ER, All ER Rep, Lloyd's Rep, ICR, IRLR, BCLC (square year); App Cas, QBD, ChD, Ch D, PD, Ex D, CPD, HL Cas, Cr App R (round year); SC, SC (HL), SC (PC), SC (J), SLT (no brackets). Neutral citations now include `EWCA Civ/Crim` and EWHC divisions.
- `foreignLookup.ts`: case lookups use the records above; returns `caseDecisions` and, when needed, `locationChoiceRequired`. Several decisions → existing `disambiguation` list. Database-only forms (WL/LEXIS/docket) keep the earlier path but can no longer contribute reporter/volume/page.
- **Search completion**: the open (Tier-2) search now runs when the first search returns nothing usable, only unrelated records, or a related record without usable details. Still at most 2 searches and 1 page fetch per citation; never a third search.
- Crown captions ("R v Jogee") now match identity (previously a one-letter party never matched).
- UK renderer: optional `reportYearStyle` reproduces round/no-bracket report years as found in the source; default unchanged.
- Client planner: a parallel-report choice is shown as a numbered list with sources; no citation is formatted until the user chooses. `citation-chat` returns this result instead of falling through.

## Intended behavior changes (tests updated)
- `bluebookM2B` B14: two disagreeing F.3d records no longer yield a mixed "F.3d 649" with missing volume; the whole location stays missing and a conflict is reported.
- `citationC2Corrections`: a first search that matches the wrong chapter now allows one open search (2 searches total). This can add one search per unmatched book/chapter lookup, within the approved cap.

## Not in this stage
- English choice buttons that carry the record id and format from it, and invalidating a choice after input edits — Stage 3. Today the choice is shown as text.
- Pasted-input (local) parsing of the new UK reporters — unchanged; only search evidence uses the expanded list.
- Reporter priority (Rule 10.3/T2) — still blocked on an authorized edition-21 check.
- Open edition-21 question to verify: current UK output uses report abbreviations without periods (e.g. `AC`, `WLR`); Bluebook T2 forms may use periods. Not changed here.

## Tests
- New `src/test/foreignCaseLocations.test.ts` (16 tests, mocked search only).
- Full suite: see roadmap entry for counts. Two failures in `wordFootnoteWorkflow.test.tsx` were reproduced on a copy without Stage 2 changes; they predate this stage and are not addressed here.
