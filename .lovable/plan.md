# Fix: bare docket numbers (without a case-type prefix) get silently replaced

## What happened

You asked for `5555/18 חסון נ׳ כנסת ישראל פס' 4-6...` and got back
`בג"ץ 2144/20 חסון נ' כנסת ישראל (אר"ש 22.3.2020)` — a different Hasson case.

Cause (verified in the code):

1. The docket detector only recognizes a docket when it is preceded by a case-type
   prefix (`בג"ץ`, `ע"א`, `רע"א`, ...). Your input started with a bare `5555/18`,
   so the detector returned "no docket".
2. With no docket, the system fell through to the **party-name search branch**
   ("חסון נ' כנסת ישראל"), which asks Perplexity for *any* judgment between those
   parties and takes the returned docket as authoritative.
3. That branch has no cross-check against a docket the user actually typed, so
   the whole docket-anchor protection (which exists and works in the case-number
   branch) never ran. The wrong case number and wrong date were emitted with no
   warning.

The pinpoint reference (`פס' 4-6 לפסק דינו של השופט עמית`) was carried over
correctly — only the case identity was swapped.

## Fix

**1. Recognize bare dockets.**
Add a prefix-less docket pattern (`NNNN/YY`, plus the dashed lower-court form) that
runs when the prefixed pattern finds nothing. When a bare docket is found, route to
the case-number branch and let the search resolve the correct case-type prefix, with
the existing docket-anchor gate active (trusted source URL/title must contain
`5555/18`).

**2. Never let party search override a user-supplied docket.**
If the input contains any docket (prefixed or bare), the party-name branch must
either be skipped, or filter its results to those whose `caseNumber` matches the
user's docket. A result with a different docket is dropped, not returned.

**3. Fail loudly instead of substituting.**
If the requested docket cannot be anchored to a trusted source, return the citation
with `[חסר: ...]` markers / an explicit note that `5555/18` could not be verified —
never a different case number. This mirrors the `docket_limitation` discipline
already used in the research pipeline.

## Technical details

- `supabase/functions/_shared/caseTypePrefixes.ts` — add `BARE_DOCKET_RE`
  (`\b\d{1,6}[/-]\d{2,4}(?:[/-]\d{1,4})?\b`) with guards so it does not fire on
  dates, page ranges, or statute section numbers.
- `supabase/functions/citation-chat/index.ts`
  - line ~1622: after `CASE_DOCKET_RE` fails, try the bare pattern; keep
    `caseType` unknown and let Branch A's Perplexity query resolve it
    (`מצא את פסק הדין הישראלי 5555/18 ...`).
  - line ~1649: suppress `partyMatch` whenever any docket was detected.
  - Branch B (line ~2027): add a docket filter on `results[]` as a second layer.
  - Log `bare_docket_detected` and `docket_override_blocked` for telemetry.

## Validation

- `5555/18 חסון נ׳ כנסת ישראל פס' 4-6 לפסק דינו של השופט עמית`
  → `בג"ץ 5555/18 חסון נ' כנסת ישראל (אר"ש 8.7.2021), פס' 6–4 לפסק דינו של השופט עמית.`
- `2144/20 חסון נ' כנסת ישראל` → still resolves to the 2020 decision (no over-correction).
- `בג"ץ 5555/18 חסון נ' כנסת ישראל` (prefixed) → unchanged behaviour.
- A party-only query with no docket → party branch still works as today.
- A fake docket (e.g. `9999/99 פלוני נ' אלמוני`) → explicit "could not verify",
  not a substituted case.
