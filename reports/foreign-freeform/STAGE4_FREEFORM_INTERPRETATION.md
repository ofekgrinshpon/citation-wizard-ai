# Stage 4 — Free-form interpretation and handoff

Scope: interpret a narrow set of foreign sources before the existing citation engine, then hand only grounded facts to that engine. No deployment, no merge, no paid model or search call, no live accuracy run. The new parser is not enabled. Israeli dockets, statutes, and Hebrew case captions stay on the Israeli path. A Hebrew word next to a Latin foreign source does not by itself reject that source.

This stage does not produce a finished Bluebook citation for every complex source. Edition 21 is the rule target and is not described as the current edition. Reporter precedence and British abbreviation punctuation stay unresolved; parallel reports remain a user choice.

## What changed
- New pure module `supabase/functions/_shared/citationPure/freeformInterpret.ts`.
  - **Hebrew cue words do not reject a foreign source and do not become facts.** "הספר National identity מאת Smith, Anthony D" is a foreign book. The fields are the Latin title and the Latin author. "הספר" and "מאת" stay in the original input only. "הספר National Identity של סמית'" has no Latin author, so it is not searched and "סמית'" is not transliterated. An Israeli docket, statute, or "נגד" caption stays on the Israeli path.
  - **Already-structured citations stay on the existing detector.** A citation `detectForeignSource` already accepts, including `Brown v. Board of Education, 347 U.S. 483 (1954)`, is not reinterpreted.
  - **Case names stay on the existing case lookup.** `Donoghue v Stevenson` and `Brown v. Board of Education` are not sent to the new parser. Record-choice clicks still format the selected record with no new search and no model call.
  - **Books.** `National identity by Smith, Anthony D` is read as title `National identity` and author `Smith, Anthony D`, each an exact slice of the input. Year, edition and publisher stay empty until a search result states them for that author and title. The supplied author string is not rewritten. `Smith, Anthony D` matches `Anthony D. Smith`. A missing middle initial does not confirm the other side: `Anthony Smith` does not match `Anthony J. Smith` or `Anthony D. Smith`. Disagreeing initials conflict. `Smith, Anthony` and `Hart, H.L.A.` are readable inverted bylines. `John Smith`, `Joan Other`, and a title with no personal name do not match. Two records with different years do not contribute a year or an edition. A year-only record and a same-year edition record do not become one edition: the shared year can remain, and the edition is not grounded.
  - **Books the existing check can bind.** `National Identity by Anthony Smith (1991)` is handed to the existing book lookup with those three spans only. A mocked result that names Joan Other and 2001 does not supply the year; a result that names Anthony Smith and `(1991)` can supply 1991. Publisher is still not invented.
  - **Articles.** `The Path of the Law by Holmes, Oliver Wendell, Harvard Law Review` is handed to the existing article lookup with title, author and journal spans. No year is added.
  - **Chapters.** `Quiet Rules by Jane Doe, in Synthetic Collection` is not split into chapter, collection and page. Clarification only. The existing labelled and parenthetical book/chapter grammars are unchanged.
- The chat page and `runCitation` skip the source-type classifier for these patterns, so that classifier is not an extra model call. The citation-chat formatter remains `google/gemini-2.5-flash` and is not used for a free-form handoff.
- **Budget counting, when a `CitationBudget` is attached.** The cap of 2 retrievals is shared by Perplexity searches and result-page fetches. `searches` counts only Perplexity search calls. `retrievals` counts each of those searches and each page fetch. A third network retrieval does not run. If the first search matches the author and title but has no year or edition, the second slot is the page fetch and the open-web search is not sent. If nothing matched, the second slot is the open-web search and a page is not fetched after that. An unknown outcome (throw, timeout, HTTP 408/502/504) sets `unknown` and blocks every later retrieval. There is no retry when it is unknown whether the call was sent. Model calls are a separate cap of 2. This path makes **0** model calls because the live parser is off. Record choice does not increment either counter. The citation-chat handler attaches a budget to every foreign `runForeignLookup`, including an ordinary foreign case. Israeli docket, statute, and `נגד` processing does not use this budget.
- **Callers that do not pass a budget.** They keep the earlier behavior: up to two searches, a second search after a timeout, and a page fetch after those searches. That page fetch is no longer an uncounted way to ground a year: the page text must name the supplied author and title before a year or edition is accepted. This older retry remains only for direct callers that omit the budget. It is not the handler path.
- **Model scaffold.** Requested gateway id `google/gemini-3.8-flash` (Google's model code `gemini-3.8-flash`; chat-completions URL `https://ai.gateway.lovable.dev/v1/chat/completions`). The source text is placed in a JSON field and is data, not instructions. Invalid JSON, a schema error, a missing quote, a contradictory year, and an unpaired reporter/volume/page are dropped or rejected. A timeout is not retried. `executeFreeformModelAttempt` does not call a transport unless a test passes `permitMock: true`. `freeformLiveEnabled()` is false.

## Model id
Checked without a paid request, on 2026-11-07:
- Google AI Studio model page lists model code `gemini-3.8-flash` (https://aistudio.google.com/docs/models/gemini-3.8-flash).
- Lovable's AI feature docs name Gemini 3.8 Flash as a chat model (https://docs.lovable.dev/features/ai).
- A public model-list mirror records Lovable raw id `google/gemini-3.8-flash` (https://modelschemas.com/models/lovable/lovable-google-gemini-3-8-flash). That mirror is not this project's gateway.

This environment did not call `https://ai.gateway.lovable.dev/v1/models` with the project key. The id is the one the owner approved and the public pages name. It is not proof that this deployment's key can call it today. The live call is not wired.

## Gateway privacy
Not proved for this deployment. Live calls stay off.

What was checked:
- Lovable's AI docs say Enterprise workspaces use zero-data-retention models unless an admin enables Extended-retention models (https://docs.lovable.dev/features/ai). That is a workspace setting, not a measurement of this project's gateway logs, the `LOVABLE_API_KEY` route, or stored prompts.
- Google's Gemini 3.8 page documents an Interactions API (`interactions.create`) as well as generateContent. This stage does not call either one. Stage 1's note that the Interactions endpoint retains data is not re-verified here and is not treated as proof about chat-completions.
- The repository has no retention flag, log-retention config, or gateway storage setting for citation calls.
- Stage 1's statement that chat-completions have zero data retention is a prior note, not new evidence.

Unknown: whether Lovable or the gateway stores citation prompts, for how long, who can read them, and whether this workspace is Enterprise with Extended-retention off. No claim of zero retention is made.

## Boundaries
- In the article matcher, `Warren, Louis` stays two people and is not treated as `Louis Warren`. A book byline of that same shape, `by Warren, Louis`, is still read as one inverted name so that `by Smith, Anthony` can be searched. That book reading can match `Louis Warren`. It is a remaining ambiguous case, not a claim that every comma identifies one person.
- A bare `Review` is not a journal. `National identity by Smith, Anthony, A Review of Politics` asks for clarification and does not search. `Harvard Law Review` still routes as an article.
- A Hebrew comment plus a slash number, such as `הערה 12/34`, is not an Israeli source. The Latin book in that paste stays a foreign book. `ע"א`, `נגד`, `חוק`, `פקוד`, and `תקנות` still stay off this parser.
- A recognizable Latin case inside a Hebrew comment, `הספר Donoghue v Stevenson`, is handed to the existing case lookup. The party names are the Latin span only. Parallel reports stay a choice.
- Chapter free-form (`Title by Author, in Collection`) is not completed.
- Prose that does not match the `Title by Author` pattern, including an instruction glued onto that pattern, is not intercepted and stays on the existing engine.
- Search can add a year only when the existing book or article lookup ties it to the same work. This stage does not add a new enrichment algorithm.
- A page fetch is one retrieval when a budget is attached. It is not a free extra call. An article page inspection uses the same cap.
- Buttons, history of a finished case citation, and batch/Word/bibliography choice lists are unchanged from Stage 3. A book clarification can be saved by the existing history writer as the assistant reply; it is not a verified source.

## Author-match cause
The book lookup took the last whitespace token of the author string as the surname. For `Smith, Anthony D` that token is `D`. A one-letter token was treated as "no author check", so any page with the same title would have matched. The first repair treated `Smith, Anthony D` as one person, but it also treated a middle initial on only one side as optional. `Anthony Smith` then matched `Anthony J. Smith`, and a page that named Anthony J. Smith could supply 1970. Initials now have to be the same set, including both empty. One side having an initial and the other not is unverified. Both sides having different initials is a conflict. `H.L.A.` is split into the initials H, L, and A before comparison. A single given name after a comma (`Smith, Anthony`) is a book byline, not an article coauthor list. The stored field remains the original span.

## Reviewed findings
1. One-sided middle initial. Resolved on the book identity check. `Anthony Smith` does not verify `Anthony J. Smith` and does not ground 1980. Disagreeing initials conflict.
2. Page fetch after two searches, and a page year without an author recheck. Resolved on the handler path. Searches and page fetches share the retrieval cap of 2. A page year or edition is kept only when that page names the supplied author and title. Unknown outcome: no retry.
3. Year-only record merged with a same-year edition. Resolved. The edition is not grounded unless every year-bearing donor states that edition. Disagreeing years drop the year and the edition.
4. Inverted names. `Smith, Anthony` and `Hart, H.L.A.` resolve on the book path. `Warren, Louis` stays two people in the article matcher. Remaining: a book byline `by Warren, Louis` can still match `Louis Warren`.
5. Bare `Review` routed as an article. Resolved for that keyword. The input is a book clarification, not an article search. No extra phrase list and no live model.
6. Hebrew plus any slash number treated as Israeli. Resolved. The slash number is not an Israeli marker. A Hebrew note beside a Latin book stays a foreign book. Real Israeli markers are unchanged.
7. `הספר Donoghue v Stevenson` labeled as an Israeli book. Resolved. The Latin case span goes to the existing case lookup. Party names do not include the Hebrew word. Parallel reports remain a choice.
8. Tests called the lookup directly and mocked `invokeFunction`, so they never ran `citation-chat/index.ts`. Resolved by `src/test/foreignFreeformHandler.test.ts`.

## Tests
- Real handler entrypoint: `src/test/foreignFreeformHandler.test.ts`. It compiles `supabase/functions/citation-chat/index.ts` and calls that function. `runForeignLookup`, `bindFreeformLookup`, and the planner/renderer are the production modules. Mocked: HTTP (`trackedFetch` and the global `fetch`), auth claims, the credit RPCs, and `Deno.env`. Not mocked: the handler, the free-form binding, the lookup, or the case-choice function. The positive book fixture returns a citation containing `Smith, Anthony D`, `National identity`, and `1991`, and not Joan Other's 2001. The same file covers a missing initial, a wrong page author, inverted names, a same-year edition, two searches with no page fetch, a thrown search with no retry, a case choice with no further call, an article, a Hebrew-wrapped case, and an Israeli docket that does not start a book search.
- `src/test/foreignFreeformFlow.test.ts` still runs `runCitation` with `invokeFunction` mocked. It is client wiring, not the server handler test.
- Full suite in this environment: **4566 passed, 4 skipped, 0 failed** (218 files passed, 1 file skipped). Exit status 0. The skipped test is the optional Hebrew-article baseline, which runs only when `RELEX_CITATION_BASELINE` is set. The other three skips are `rpcPrivileges.test.ts`, which queries a live database and is skipped when `PGHOST` / `SUPABASE_DB_URL` are unset.
- App TypeScript (`tsc -p tsconfig.app.json --noEmit`) and Node TypeScript (`tsc -p tsconfig.node.json --noEmit`) passed. Exit status 0.
- `node_modules/canvas` was already absent at the start of the full run (set aside earlier because the package has no native binary and jsdom crashes when that directory is present). The suite passed in that state. The directory was moved back afterward. No dependency file was changed. These tests do not prove canvas or PDF behavior.

## Readiness
Not ready to merge. The wrong-person year grounding found in review is fixed and covered by the real handler, but a book byline of two full words around a comma can still confirm the reversed name. Callers that omit the budget still retry after an unknown search and can fetch a page after two searches. Green tests are not a verdict.

Not live-ready. The parser is off. Gateway retention for this deployment is not proved. This environment did not call the model id with the project key. No live accuracy, cost, or latency claim is made.

## Not verified
- Live model quality, cost, or latency. No request was sent to Gemini or to Perplexity.
- Gateway retention and logging for this deployment.
- That `google/gemini-3.8-flash` answers on this project's key.
- A professionally checked source set. The mocked book year is a fixture, not proof of live accuracy.
- Bluebook reporter order and British abbreviation punctuation.

## Feature gate and rollback
`GATEWAY_RETENTION_PROVED` is `false`. `freeformLiveEnabled()` stays false even if `FREEFORM_PARSER_LIVE=1` and `FREEFORM_PARSER_MODEL=google/gemini-3.8-flash` are set. Turning the live parser on requires that constant, those environment values, and a separate owner approval for a paid live test. Rollback is reverting this stage's module, the planner/host branches, the recovery allowlist entry for `freeformHandoff`, and the lookup budget argument. Existing case, book, article, and Hebrew requests that do not match the new patterns do not set `freeformHandoff`.
