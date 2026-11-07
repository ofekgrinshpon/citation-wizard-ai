# Stage 4 — Free-form interpretation and handoff

Scope: interpret a narrow set of foreign-language foreign sources before the existing citation engine, then hand only grounded facts to that engine. No deployment, no merge, no paid model or search call, no live accuracy run. The new parser is not enabled. Israeli routing and Hebrew input are unchanged.

This stage does not produce a finished Bluebook citation for every complex source. Edition 21 is the rule target and is not described as the current edition. Reporter precedence and British abbreviation punctuation stay unresolved; parallel reports remain a user choice.

## What changed
- New pure module `supabase/functions/_shared/citationPure/freeformInterpret.ts`.
  - **Hebrew never enters it.** Any Hebrew letter, including a Latin title wrapped in Hebrew such as "הספר National Identity של סמית'", stays on the existing path. The owner amendment overrides the earlier plan example that would have sent that mixed sentence to the new parser.
  - **Already-structured citations stay on the existing detector.** A citation `detectForeignSource` already accepts, including `Brown v. Board of Education, 347 U.S. 483 (1954)`, is not reinterpreted.
  - **Case names stay on the existing case lookup.** `Donoghue v Stevenson` and `Brown v. Board of Education` are not sent to the new parser. Record-choice clicks still format the selected record with no new search and no model call.
  - **Books.** `National identity by Smith, Anthony D` is read as title `National identity` and author `Smith, Anthony D`, each an exact slice of the input. Year, edition and publisher stay empty. A presentation reorder `Anthony D Smith` is stored only as a reorder of the same tokens and is not sent to search or shown as a fact. The existing book lookup checks the last word of the author. Here that word is `D`, so a search could attach another book with the same title. **No search is sent.** The user gets a clarification, not a Bluebook citation.
  - **Books the existing check can bind.** `National Identity by Anthony Smith (1991)` is handed to the existing book lookup with those three spans only. A mocked result that names Joan Other and 2001 does not supply the year; a result that names Anthony Smith and `(1991)` can supply 1991. Publisher is still not invented.
  - **Articles.** `The Path of the Law by Holmes, Oliver Wendell, Harvard Law Review` is handed to the existing article lookup with title, author and journal spans. No year is added.
  - **Chapters.** `Quiet Rules by Jane Doe, in Synthetic Collection` is not split into chapter, collection and page. Clarification only. The existing labelled and parenthetical book/chapter grammars are unchanged.
- The chat page and `runCitation` skip the source-type classifier for these patterns, so that classifier is not an extra model call. The citation-chat formatter remains `google/gemini-2.5-flash` and is not used for a free-form handoff.
- **Budget.** A free-form lookup carries a citation-wide budget: at most 2 searches and 2 model calls. A timeout or a thrown search marks the outcome unknown and does not send the open-web search. A later search after the cap is not sent. Record choice calls `noteRecordChoice` and does not increment either counter. The production path currently makes **0** model calls because the live parser is off.
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
- Surname-first authors such as `Smith, Anthony D` are not searched, because the existing author check would not bind the surname.
- Chapter free-form (`Title by Author, in Collection`) is not completed.
- Prose that does not match the `Title by Author` pattern, including an instruction glued onto that pattern, is not intercepted and stays on the existing engine.
- Search can add a year only when the existing book or article lookup ties it to the same work. This stage does not add a new enrichment algorithm.
- A page fetch inside the existing article lookup is the lookup's existing inspection, not a third search. Free-form article requests still stop at two searches, and an unknown first search blocks the second.
- Buttons, history of a finished case citation, and batch/Word/bibliography choice lists are unchanged from Stage 3. A book clarification can be saved by the existing history writer as the assistant reply; it is not a verified source.

## Tests
- New `src/test/foreignFreeformInterpret.test.ts` (14): Smith book spans and the missing year/publisher/edition; searchable book handoff; article handoff; chapter refusal; absent and contradictory fields; paired versus mixed reporters; injection as data; invalid JSON, schema error, and no retry after timeout; Hebrew and structured citations; two-search cap and unknown-outcome stop; Donoghue choice with no added search or model call; server rejection of invented client fields; `runCitation` does not call the classifier or the formatter for the Smith example; mocked book search keeps 1991 from Anthony Smith and drops Joan Other's 2001.
- Full suite in this environment: **4546 passed, 4 skipped, 0 failed** (216 files passed, 1 file skipped). The skipped file case is the optional Hebrew-article baseline comparison, which runs only when `RELEX_CITATION_BASELINE` is set. The other three skips are `rpcPrivileges.test.ts`, which queries a live database and is skipped when `PGHOST` / `SUPABASE_DB_URL` are unset. Stage 3's reported 4535 passed / 1 skipped matches this run once those three database checks are counted as skipped here and the 14 new tests are added.
- App TypeScript (`tsc -p tsconfig.app.json --noEmit`) and Node TypeScript (`tsc -p tsconfig.node.json --noEmit`) passed.
- Test environment: the installed `canvas` package has no compiled native binary, so jsdom crashes at startup. For this run the package directory was moved out of `node_modules` for the test process only. No project dependency file was changed. These tests do not prove canvas or PDF behavior.

## Not verified
- Live model quality, cost, or latency. No request was sent to Gemini or to Perplexity.
- Gateway retention and logging for this deployment.
- That `google/gemini-3.8-flash` answers on this project's key.
- A professionally checked source set. The mocked book year is a fixture, not proof of live accuracy.
- Bluebook reporter order and British abbreviation punctuation.

## Feature gate and rollback
`GATEWAY_RETENTION_PROVED` is `false`. `freeformLiveEnabled()` stays false even if `FREEFORM_PARSER_LIVE=1` and `FREEFORM_PARSER_MODEL=google/gemini-3.8-flash` are set. Turning the live parser on requires that constant, those environment values, and a separate owner approval for a paid live test. Rollback is reverting this stage's module, the planner/host branches, and the lookup budget argument. Existing case, book, article, and Hebrew requests that do not match the new patterns do not set `freeformHandoff`.
