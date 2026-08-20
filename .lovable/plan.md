# Bibliography: switch to the real citation engine

## Answer to your question

No — the bibliography section does **not** use the citation engine (אזכור אחיד). It calls a separate, much weaker backend (`bibliography-lookup`), which is why sources come out broken.

## What the two paths actually do

Citation Wizard / Footnotes (the good path, `runCitation` → `citation-chat`):
- Input validation, automatic source-type classification (with the statute-strength fix)
- Verified-source store lookup
- Grounded search with the docket detector, bare-docket handling, party-name lock
- Post-checks: פ"ד volume/year conflict, decision-date authority, Knesset-term table, editor grounding gate (Rule 23.7), Rule 24.11 editor placement
- Rule-based completeness validation with explicit missing-field warnings

Bibliography (`bibliography-lookup`):
- Verified-source keyword match, otherwise one single Perplexity `sonar` call with a long prompt
- Only post-processing is the article validator, and it is skipped entirely for legislation and case law
- No docket detection, no party lock, no date/פ"ד reconciliation, no Knesset terms, no editor grounding, no rule completeness check
- Client fires 4 lookups in parallel with no retry, so rate-limited rows fail outright

Result: legislation and case-law entries in bibliography get whatever the model says, with none of the guards that were added to the citation engine over the last months. That is the breakage.

## Plan

1. Route bibliography through the shared pipeline
   - Replace `lookupOne`'s `bibliography-lookup` call with `runCitation`, passing the row's category as the source-type override when the user set one.
   - Map the bibliography categories to the engine's source types (primary/secondary legislation, supreme/district/magistrate/specialized case law, literature).
   - Keep the verified-store shortcut (`useVerifiedStore: true`), so known sources stay free.

2. Bounded, retrying execution
   - Replace the local `processInPool` (concurrency 4, no retry) with the shared `runPool` at concurrency 2, 1 retry with backoff on transient errors — same as the footnotes builder.

3. Per-row status and errors
   - Keep the three-state review rows, but populate them from `RunCitationResult`: `status: verified` → verified badge, `warning` → show the missing-field text, `error` → the real Hebrew message from `CitationRunError` (credits, login, rate limit) plus a "נסה שוב" button for that single row.
   - Disambiguation: `citation-chat` returns one answer rather than option lists, so the "needs_choice" state becomes a warning row the user can edit, and rows the engine can't complete surface the `[חסר: …]` markers instead of silently wrong text.

4. Credits
   - Each engine-backed row costs 1 credit, same as today; verified-store hits stay free. Charging stays server-side in `citation-chat`.

5. Backend cleanup
   - Leave `bibliography-lookup` deployed but unused by the UI for now, so nothing else breaks; remove it in a follow-up once bibliography is confirmed stable.

## Validation

Re-run the sources that came out broken: a primary statute, a חוק-יסוד, a Supreme Court judgment with a docket, a district judgment, a book with an editor, and a journal article — checking that each matches what the Citation Wizard returns for the same input.
