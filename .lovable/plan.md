# Diagnostic review: synthetic Word batch, 2026-11-25 23:37–23:41 UTC

Evidence: edge request log (time, duration), citation-chat and classify-source function logs, and the current code. No DB queries on user records, no new requests.

## Request timeline (edge log)

```text
note 1  book            23:37:50  Perplexity book found:false -> article fallback hit (journal)
note 2  article .95     23:38:05  [pplx-fallback:article] tier1_trusted=1 -> no fallback; [verified] raw=7 ranked=0
note 3  book            23:38:11  Shalev/Zemach; book JSON parse error (pos 370), fallback article hit
note 4  book            23:38:30  Weisman; "journal clue" forced article fallback
note 5  legislation     23:38:42  contracts law s.12
note 6  basic_law       23:38:52  protected explanation left out of the input
note 7  foreign_journal 23:39:02-03  citation-chat 860 ms, no lookup log lines
note 8  foreign_book    23:39:05 -> 23:40:15  citation-chat 70,183 ms, no step log lines
note 9  case (US)       23:40:16-17  citation-chat 903 ms, no lookup log lines
note 11 book            23:40:19  same as note 1: found:false -> article fallback (journal)
note 13/14 legislation  23:40:30 / 23:40:36
```

## Findings by priority

1. Notes 1 and 11 (same input, page 463 vs 618)
   - Seen: two separate full lookups (23:37:50 and 23:40:19), each with Perplexity book found:false followed by `fallbackBiblioSearch(..., "article")` (`citation-chat/index.ts:3881-3883`). The page and year come from that fallback's free-text hint. The logs do not show a verified source, so neither 463 nor 1978 is confirmed.
   - Root cause (confirmed): the batch loop runs each row on its own (`WordFootnoteWorkflow.tsx:221-`) and nothing in the document reuses or compares results with the same fingerprint. The search results are not deterministic, so the same input can come back with different numbers.
   - Charges: two separate requests went out. The client sends no same-document dedupe, so they were most likely counted as two. This can only be confirmed from the usage table, which I did not query.
   - Simplest fix: after the batch, group rows by `rawCitationFingerprint`. If one input has different outputs, mark all of them "results disagree, needs review" and do not approve automatically. Do not reuse an unverified result.
   - Test: two rows with the same input and outputs 463 and 618 must both be marked for review and must not be approvable as identical.

2. Note 8 (Crawford, about 70 s)
   - Seen: one request of 70,183 ms with no step logs. There is no per-step timing in the logs, and the log does not show the reason for the conflict. Whether a provider was slow is unknown (telemetry is not in the logs).
   - Design: a client-side time limit on each request (for example 45 s) that shows "still checking, you can move on". Keep the same request_id so the server's same-request rule prevents a second charge. Never automatically resend a request whose outcome is unknown (standing rule). Let the user retry manually using the existing recovery.
   - Test: a request that does not answer within the limit lets the batch continue, and a manual retry does not consume quota again (same request_id).

3. Note 2 (פלד): the author was swallowed into the title
   - Seen: classified as article (0.95). The lookup found no trusted candidate (raw=7, ranked=0). The author became part of the title.
   - Hypothesis (not traced to a line): the Hebrew article parser does not split "author, title" when there is no journal/volume, so this is shared and not Word-only (the same path as chat). The parsing failure and the missing data are two separate problems.
   - Test: the input "עומר יחזקאל פלד, חישוב הנזק..." keeps "עומר יחזקאל פלד" as the author even when nothing is found.

4. Note 9 (Brown, 1954 shown as missing)
   - Seen: 903 ms with no lookup logs, so it most likely went through the local/typed route. The year does not get into the structured field. The exact line is not confirmed.
   - Test: the input with 1954 gives "347 U.S. 483 (1954)" with no [חסר: שנה], and does not choose 349 U.S. 294 (1955).

5. Note 7 (Warren & Brandeis)
   - Seen: 860 ms with no lookup log lines. There is no evidence that a lookup ran, so it is likely the route ended locally without any attempt at completion. Indexing, query or extraction problems cannot be shown from what is available.
   - Test: confirm which route the planner chooses for a foreign article without volume or page.

6. Notes 13/14 (statutes)
   - Confirmed: `wordSourceIdentity` (`src/lib/wordSourceMap.ts:10,36`) has only case/doi/journal_article. Because of that, `wordRepeatContext.ts:30-33` creates an empty cell and resets adjacency.
   - Fix: add an identity of type `il_statute` with key = normalized law name plus year, and pinpoint = section, built only from a complete local parse. Adjacency, a single source in the note and no unknown text in between are already enforced by the current loop. A different law means a different key. Re-approval after editing the earlier note already exists through `invalidateWordDependents`.
   - Tests: 13 approved then 14 gives "שם, בס' 4". A different law, or a note with two sources in between, keeps the full citation.
   - Notes 10/12 (already short): this is an intentional safeguard. There is no identity for a citation that is already short, so the notes are not linked. They are preserved, but linking them is a missing capability.

7. Note 6 and the counters
   - Note 6: confirmed correct, keep it as a regression test.
   - Counters: "מתוכננות עד N בקשות מתוך M הערות" and "בדוק N מקורות" both use `readyCount` (`WordFootnoteWorkflow.tsx:419,481-482`), so in a single render they cannot show 11 next to 12. The progress counter uses `selected.length` (line 208), whose filter is slightly different (`end>start`). Most likely the screen was seen at two different moments, or one note has two sources (the second number is distinct notes). This is not confirmed.
   - Test: a single render shows the same N in both places and in progress.total.

## Implementation order

1. Same-document disagreement flag (1).
2. Hebrew statute identity for repeats (6).
3. Time limit with continue, same request_id, no automatic resend (2).
4. Author parsing for Hebrew articles (3), then the US case year (4).
5. Diagnose the route for 7 only after adding per-step telemetry.

## Do not change

- Settlement, quota and pricing.
- The rule against automatic resend.
- Protected explanations.
- The strict identity rule for cases and articles.
- V1/legacy.
