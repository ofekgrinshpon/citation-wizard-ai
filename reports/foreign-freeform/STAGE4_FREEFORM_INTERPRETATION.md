# Stage 4 — Free-form interpretation and handoff

Scope: interpret a narrow set of foreign sources before the existing citation engine, then hand only grounded facts to that engine. No deployment, no merge, no paid model or search call, no live accuracy run. The new parser is not enabled. Israeli dockets, statutes, and Hebrew case captions stay on the Israeli path. A Hebrew word next to a Latin foreign source does not by itself reject that source.

This stage does not produce a finished Bluebook citation for every complex source. Edition 21 is the rule target and is not described as the current edition. Reporter precedence and British abbreviation punctuation stay unresolved; parallel reports remain a user choice.

## What changed
- New pure module `supabase/functions/_shared/citationPure/freeformInterpret.ts`.
  - **Hebrew cue words do not reject a foreign source and do not become facts.** "הספר National identity מאת Smith, Anthony D" is a foreign book. The fields are the Latin title and the Latin author. "הספר" and "מאת" stay in the original input only. "הספר National Identity של סמית'" has no Latin author, so it is not searched and "סמית'" is not transliterated. An Israeli docket, statute, or "נגד" caption stays on the Israeli path.
  - **Already-structured citations stay on the existing detector.** A citation `detectForeignSource` already accepts, including `Brown v. Board of Education, 347 U.S. 483 (1954)`, is not reinterpreted.
  - **Case names stay on the existing case lookup.** `Donoghue v Stevenson` and `Brown v. Board of Education` are not sent to the new parser. Record-choice clicks still format the selected record with no new search and no model call.
  - **Books.** `National identity by Smith, Anthony D` is read as title `National identity` and author `Smith, Anthony D`, each an exact slice of the input. Year, edition and publisher stay empty until a search result states them for that author and title. The supplied author string is not rewritten. `Smith, Anthony D` matches `Anthony D. Smith`. A missing middle initial does not confirm the other side: `Anthony Smith` does not match `Anthony J. Smith` or `Anthony D. Smith`. Disagreeing initials conflict. `Hart, H.L.A.` and `Smith, Anthony D` are readable inverted bylines. `Smith, Anthony` without an initial is ambiguous and is not searched. `John Smith`, `Joan Other`, and a title with no personal name do not match. Two records with different years do not contribute a year or an edition. A year-only record and a same-year edition record do not become one edition: the shared year can remain, and the edition is not grounded.
  - **Books the existing check can bind.** `National Identity by Anthony Smith (1991)` is handed to the existing book lookup with those three spans only. A mocked result that names Joan Other and 2001 does not supply the year; a result that names Anthony Smith and `(1991)` can supply 1991. Publisher is still not invented.
  - **Articles.** `The Path of the Law by Holmes, Oliver Wendell, Harvard Law Review` is handed to the existing article lookup with title, author and journal spans. No year is added.
  - **Chapters.** `Quiet Rules by Jane Doe, in Synthetic Collection` is not split into chapter, collection and page. Clarification only. The existing labelled and parenthetical book/chapter grammars are unchanged.
- The chat page and `runCitation` skip the source-type classifier for these patterns, so that classifier is not an extra model call. The citation-chat formatter remains `google/gemini-2.5-flash` and is not used for a free-form handoff.
- **Budget counting, when a `CitationBudget` is attached.** The cap of 2 retrievals is shared by Perplexity searches and result-page fetches. `searches` counts only Perplexity search calls. `retrievals` counts each of those searches and each page fetch. A third network retrieval does not run. If the first search matches the author and title but has no year or edition, the second slot is the page fetch and the open-web search is not sent. If nothing matched, the second slot is the open-web search and a page is not fetched after that. An unknown outcome (throw, timeout, HTTP 408/502/504) sets `unknown` and blocks every later retrieval. There is no retry when it is unknown whether the call was sent. Model calls share one cap of 2 for the parser and the formatter on the same request budget. Production makes **0** parser calls because the live gate is false. Record choice does not increment either counter. The citation-chat handler attaches a budget to every foreign `runForeignLookup`, including an ordinary foreign case. Israeli docket, statute, and `נגד` processing does not use this budget.
- **A missing budget is the same cap.** `runForeignLookup` creates one budget for that call when the caller does not pass one, including article and statute lookups. A throw, timeout, or HTTP 408/502/504 does not send another retrieval. A page fetch uses one of the two slots, so it does not run after two searches and it does not leave room for a third call. The handler still passes the request budget through, so a later lookup in the same citation does not start the count again. Choosing an already returned record does not call lookup. The formatter charges the same request budget before its existing call and is not sent when that budget is unknown or already at 2. Its model id is unchanged.
- **Parser wiring, still off.** `citation-chat/index.ts` calls `resolveFreeformBeforeLookup` before search. A deterministic book, article, or case route does not call the model. An Israeli source does not call the model. If that route finds nothing to search, one parser attempt may run, but only when `freeformLiveEnabled()` is true. That function is false while `GATEWAY_RETENTION_PROVED` is false, so production sends no parser request. Tests install an in-process transport; a client request cannot. The parser id remains `google/gemini-3.8-flash` at `https://ai.gateway.lovable.dev/v1/chat/completions`. The formatter id remains `google/gemini-2.5-flash`. A quote that is not in the input is dropped. A timeout marks the budget unknown and does not call the formatter or send another model request. A resolved lookup does not call the formatter. A free-form request that does not resolve still does not fall through to the formatter.

## Model id
Checked without a paid request, on 2026-11-07:
- Google AI Studio model page lists model code `gemini-3.8-flash` (https://aistudio.google.com/docs/models/gemini-3.8-flash).
- Lovable's AI feature docs name Gemini 3.8 Flash as a chat model (https://docs.lovable.dev/features/ai).
- A public model-list mirror records Lovable raw id `google/gemini-3.8-flash` (https://modelschemas.com/models/lovable/lovable-google-gemini-3-8-flash). That mirror is not this project's gateway.

This environment did not call `https://ai.gateway.lovable.dev/v1/models` with the project key. The id is the one the owner approved and the public pages name. It is not proof that this deployment's key can call it today. The handler is wired and the live gate is false. Wired is not the same as active.

## Gateway privacy
Not proved for this deployment. Live calls stay off.

What was checked:
- Lovable's AI docs say Enterprise workspaces use zero-data-retention models unless an admin enables Extended-retention models (https://docs.lovable.dev/features/ai). That is a workspace setting, not a measurement of this project's gateway logs, the `LOVABLE_API_KEY` route, or stored prompts.
- Google's Gemini 3.8 page documents an Interactions API (`interactions.create`) as well as generateContent. This stage does not call either one. Stage 1's note that the Interactions endpoint retains data is not re-verified here and is not treated as proof about chat-completions.
- The repository has no retention flag, log-retention config, or gateway storage setting for citation calls.
- Stage 1's statement that chat-completions have zero data retention is a prior note, not new evidence.

Unknown: whether Lovable or the gateway stores citation prompts, for how long, who can read them, and whether this workspace is Enterprise with Extended-retention off. No claim of zero retention is made.

## Boundaries
- A comma between two full words is ambiguous. `by Warren, Louis` and `by Smith, Anthony` ask for clarification and do not search, and neither is certified as the reversed name. `Smith, Anthony D`, `Hart, H.L.A.`, and `Holmes, Oliver Wendell` stay one person. In the article matcher, `Warren, Louis` stays two people, and `Samuel D. Warren, Louis D. Brandeis` still matches the same two authors.
- A bare `Review` is not a journal. `National identity by Smith, Anthony, A Review of Politics` asks for clarification and does not search. `Harvard Law Review` still routes as an article.
- A Hebrew comment plus a slash number, such as `הערה 12/34`, is not an Israeli source. The Latin book in that paste stays a foreign book. `ע"א`, `נגד`, `חוק`, `פקוד`, and `תקנות` still stay off this parser.
- A recognizable Latin case inside a Hebrew comment, `הספר Donoghue v Stevenson`, is handed to the existing case lookup. The party names are the Latin span only. Parallel reports stay a choice.
- Chapter free-form (`Title by Author, in Collection`) is not completed.
- Prose that does not match the `Title by Author` pattern, including an instruction glued onto that pattern, is not intercepted and stays on the existing engine.
- Search can add a year only when the existing book or article lookup ties it to the same work. This stage does not add a new enrichment algorithm.
- A page fetch is one retrieval when a budget is attached. It is not a free extra call. An article page inspection uses the same cap.
- Buttons, history of a finished case citation, and batch/Word/bibliography choice lists are unchanged from Stage 3. A book clarification can be saved by the existing history writer as the assistant reply; it is not a verified source.

## Author-match cause
The book lookup took the last whitespace token of the author string as the surname. For `Smith, Anthony D` that token is `D`. A one-letter token was treated as "no author check", so any page with the same title would have matched. The first repair treated `Smith, Anthony D` as one person, but it also treated a middle initial on only one side as optional. `Anthony Smith` then matched `Anthony J. Smith`, and a page that named Anthony J. Smith could supply 1970. Initials now have to be the same set, including both empty. One side having an initial and the other not is unverified. Both sides having different initials is a conflict. `H.L.A.` is split into the initials H, L, and A before comparison. A single full word after the comma is not treated as one identified person, on the book path or the article path. The stored field remains the original span.

## Reviewed findings
1. One-sided middle initial. Resolved on the book identity check. `Anthony Smith` does not verify `Anthony J. Smith` and does not ground 1980. Disagreeing initials conflict.
2. Page fetch after two searches, and a page year without an author recheck. Resolved for every `runForeignLookup` call, including a caller that omits the budget. Searches and page fetches share the retrieval cap of 2. A page year or edition is kept only when that page names the supplied author and title. Unknown outcome: no retry.
3. Year-only record merged with a same-year edition. Resolved. The edition is not grounded unless every year-bearing donor states that edition. Disagreeing years drop the year and the edition.
4. Inverted names. Resolved. `Smith, Anthony D` and `Hart, H.L.A.` still match. `by Warren, Louis` and `by Smith, Anthony` stay unverified and do not search. Article coauthors are unchanged.
5. Bare `Review` routed as an article. Resolved for that keyword. The input is a book clarification, not an article search. No extra phrase list and no live model.
6. Hebrew plus any slash number treated as Israeli. Resolved. The slash number is not an Israeli marker. A Hebrew note beside a Latin book stays a foreign book. Real Israeli markers are unchanged.
7. `הספר Donoghue v Stevenson` labeled as an Israeli book. Resolved. The Latin case span goes to the existing case lookup. Party names do not include the Hebrew word. Parallel reports remain a choice.
8. Tests called the lookup directly and mocked `invokeFunction`, so they never ran `citation-chat/index.ts`. Resolved by `src/test/foreignFreeformHandler.test.ts`.

## Tests
- Real handler entrypoint: `src/test/foreignFreeformHandler.test.ts`. It compiles `supabase/functions/citation-chat/index.ts` and calls that function. `runForeignLookup`, `resolveFreeformBeforeLookup`, and the planner/renderer are the production modules. Mocked: HTTP (`trackedFetch` and the global `fetch`), auth claims, the credit RPCs, `Deno.env`, and, only in the parser describe, an in-process model transport. Not mocked: the handler, the binding, the lookup, or the case-choice function. With the gate off, a deterministic book still cites `Smith, Anthony D` and `1991`, and the parser transport is not called. With the test transport installed, `Anthony D. Smith wrote the book National Identity.` produces one parser call, one search, no formatter call, and a citation for 1991 rather than Joan Other's 2001. A thrown parser call is not repeated and does not reach the formatter. `by Warren, Louis` and `ע"א 240/95` do not call the parser. A prose case still ends in a record choice with no further call.
- `src/test/foreignFreeformFlow.test.ts` still runs `runCitation` with `invokeFunction` mocked. It is client wiring, not the server handler test.
- Full suite in this environment: **4576 passed, 4 skipped, 0 failed** (218 files passed, 1 file skipped). Exit status 0. The skipped test is the optional Hebrew-article baseline, which runs only when `RELEX_CITATION_BASELINE` is set. The other three skips are `rpcPrivileges.test.ts`, which queries a live database and is skipped when `PGHOST` / `SUPABASE_DB_URL` are unset.
- App TypeScript (`tsc -p tsconfig.app.json --noEmit`) and Node TypeScript (`tsc -p tsconfig.node.json --noEmit`) passed. Exit status 0.
- `node_modules/canvas` has no native binary, so jsdom crashes when that directory is present. It was moved aside for this run and moved back afterward. No dependency file was changed. These tests do not prove canvas or PDF behavior.

## Readiness
The handler now contains the parser call, and the production gate is still false. This branch can be reviewed as disabled wiring plus mocked proof. It is not live parser functionality. Green tests are not a live-accuracy verdict.

Not live-ready. `GATEWAY_RETENTION_PROVED` is false. Gateway plan, retention settings, and per-project model access were not verified. No live test was run.

## Proposed staging experiment, not run
One synthetic sentence with no client text, for example `Anthony D. Smith wrote the book National Identity.` Preconditions, still unmet: the workspace plan and the Extended-retention, EU-inference, and AI-app-context settings are recorded; Gemini 3.8 Flash is on that workspace's Available models list; the owner approves a separate live-test budget. Calls if those are met: 1 parser request to `google/gemini-3.8-flash`, then at most 1 Perplexity search, and a page only if that search has no year and a retrieval slot remains. No formatter call if the lookup resolves. No second parser call if the first outcome is unknown. Google's published introductory list price, fetched 7 November 2026 from https://aistudio.google.com/docs/whats-new-gemini-3.8, is "$0.75/1M input tokens and $3.75/1M output tokens" through the end of the year. Lovable's credit conversion for this project was not measured, so the credit cost is unknown. This experiment was not executed.

## Not verified
- Live model quality, cost, or latency. No request was sent to Gemini or to Perplexity.
- Gateway retention and logging for this deployment.
- That `google/gemini-3.8-flash` answers on this project's key.
- A professionally checked source set. The mocked book year is a fixture, not proof of live accuracy.
- Bluebook reporter order and British abbreviation punctuation.

## Feature gate and rollback
`GATEWAY_RETENTION_PROVED` is `false`. `freeformLiveEnabled()` stays false even if `FREEFORM_PARSER_LIVE=1` and `FREEFORM_PARSER_MODEL=google/gemini-3.8-flash` are set. Turning the live parser on requires that constant, those environment values, and a separate owner approval for a paid live test. The handler will then send at most one parser request on the shared budget. Rollback is reverting this stage's module, the handler parser call, the planner/host branches, the recovery allowlist entry for `freeformHandoff`, and the lookup budget argument. Existing case, book, article, and Hebrew requests that do not match the new patterns do not set `freeformHandoff`.
