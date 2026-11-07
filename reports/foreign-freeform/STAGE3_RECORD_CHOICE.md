# Stage 3 — Record-bound choice for foreign rulings, invalidation after edits

Scope: chat page only. No model, no billing/quota change, no deployment, no live provider call. Israeli routing and the Hebrew option lines are untouched.

## What changed
- **Choice buttons for English options.** When a foreign case lookup returns several rulings (e.g. Brown I / Brown II) or parallel reports of one ruling (e.g. Donoghue v Stevenson in AC and SC (HL)), the chat reply now shows one button per option plus a link to its source. The numbered text stays in the message for copy/reload.
- **Each option carries its record id.** Choosing an option builds the lookup result from that one validated record and passes it through the same acceptance and rendering used for search results (`selectForeignCaseChoice` in `citationPlanner.ts`, helpers in `src/lib/foreignCaseChoice.ts`). No new request, search or credit.
- **Two-step choice when needed.** If the chosen ruling itself has parallel reports, the next choice is offered from the same records.
- **Bound to the original input.** The choice stores a fingerprint of the bound input. A click is accepted only if this reply's input in the conversation still binds to it; otherwise the choice is removed and the user is asked to send the source again. Editing the user message already removes the old reply and its buttons.
- **In memory only.** Choices are not saved with the conversation; after a reload the text list remains without buttons.
- **Shared grounding.** The server lookup and the app's choice use the same pure function (`groundDecisionFields`) and record validator (`readDecisionRecord`) in `_shared/citationPure/caseLocations.ts`. A record whose id does not name exactly its own fields is rejected.
- **Conflicting reports are never offered.** A reporter whose own records disagree is dropped from the parallel-report list (text and buttons).
- **Rulings found without a stated country.** When the input has no jurisdiction and all records are from one country, tied records now go to decision grouping (several rulings → choice; parallel reports → report choice) instead of the earlier flat record list. If grouping finds no decision records, the earlier list is kept. Several countries still produce the earlier list.
- After a choice, the formatted citation is saved to citation history (no request id). It is not added to verified sources.

## Not in this stage
- Batch footnotes, Word footnotes and bibliography keep the text list (no buttons).
- A choice between countries (US vs UK records) has no decision records and stays a text list.
- Free-form parsing (Stage 4) and the reporter-priority rule (blocked on an authorised edition-21 check).

## Tests
- New `src/test/foreignCaseChoice.test.ts` (10) and `src/test/foreignCaseChoiceChat.test.tsx` (3): Brown I/II choice, two-step choice, Donoghue report choice without mixing, rejection after edit, unknown option, tampered record, chat-only, Israeli input, conflicting reports, rulings without a stated country, real chat page with no extra request or search, real message bubble.
- Two Word footnote tests were updated: cards now open automatically after a check, so the tests open a card only if it is closed. They also check that both cards are open after the batch.
- Full suite: 4,535 passed, 1 skipped (test environment needs the drawing library disabled, see below).
- Test environment note: the installed drawing library has no compiled binary, so screen tests crash at start. Tests were run with that library hidden from the test process only (`NODE_OPTIONS=--require` preload); no project file changed for this.
