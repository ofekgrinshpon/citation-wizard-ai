# local_semantic_retrieval_audit_v1 — read-only diagnostic

No code changed. Evidence: 12 most recent academic runs with
`metadata.retrieval.local`, primary run = AW4 `45c3f3b8-cda4-4c74-b5f2-ea2e8a094c37`
("כתוב פרק רקע תיאורטי … עקרון המידתיות בביקורת חוקתית"), plus direct corpus queries.

## 1. Does the local lane actually execute? — Yes

`stages/localRetrieval.ts` runs per target query, concurrency 4, three methods in
parallel: exact-authority lookup on `legal_documents`, lexical
`search_legal_chunks_text`, and `match_legal_chunks` (threshold 0.5) over
embedded chunks.

AW4 aggregate:

| metric | value |
|---|---|
| queries executed | 21 |
| wall / sum query ms | 8,142 / 31,822 (max 1,744) |
| candidates by method | text 120 · vector 97 · exact 1 |
| retained local candidates | 218 |
| errors / timeouts (text, vector, embedding) | 0 |

Same shape in all 12 runs (8–22 queries, 3.5–8.5 s, zero timeouts). Local
retrieval is healthy and is *not* the bottleneck.

## 2. Where the local material is lost

Pool drops, AW4 (all local_db):

| drop_reason | method | n |
|---|---|---|
| `vector_quota_per_claim` | vector | 70 |
| `discovery_listing_suppressed` | text | 69 |
| `dup_url` | text | 27 |
| `discovery_listing_suppressed` | vector | 19 |
| `dup_document_id` | text | 10 |

218 local candidates → **23 local candidates in the pool of 24**. Same
distribution in every run (listing 26–107, vector quota 26–92).

### 2a. Listing suppression is eating the local caselaw corpus (headline)

Every `discovery_listing_suppressed` drop in AW4 keys on
`index_or_listing:integrity_index_or_listing`, and **87 of 88 are
`source_type = caselaw`**. Cause: local caselaw rows were ingested with the
gov.il *collector* URL as `source_url`
(`…/dynamiccollectors/spokmanship_court?skip=30`). `sourceIntegrity` classifies
that URL as `index_or_listing`, and `discoveryPrecision` then suppresses the
candidate — even though the local chunk body is real judgment text.

Corpus-wide exposure:

| source_type | docs | with collector/`skip=` URL |
|---|---|---|
| caselaw | 7,828 | **4,481 (57%)** |
| knesset_research | 6,164 | 0 |
| israeli_law | 5,013 | 0 |
| journal_article | 2,235 | 0 |
| supreme_court_il | 302 | 0 |

So more than half the local case-law corpus is structurally unreachable by the
answer pipeline, regardless of query quality.

### 2b. `MAX_VECTOR_PER_CLAIM = 2` throttles the only precise lane

`candidatePool.ts:131` caps vector candidates at 2 per claim, and the tier order
is `exact > text > perplexity > vector`. In AW4 the vector lane produced the
topically *correct* material (e.g. "נדב דגן — מידתיות חוקתית, סבירות מנהלית",
sim 0.358; "עשרים שנה לבנק המזרחי", 0.399) while the text lane produced noise —
yet vector was ranked last and 70 vector hits were dropped on quota.

### 2c. Lexical FTS is morphology-blind and mis-selects its AND terms

`search_legal_chunks_text` builds a tsquery on the `simple` config (no Hebrew
stemming) and forces the **two longest words** as required `AND` terms, the rest
as `OR` boosters. Consequences seen in AW4 per-query telemetry: `מידתיות` does
not match `המידתיות`/`למידתיות`, and the longest-word heuristic anchors on
incidental tokens, so the text lane returned repeated generic court-listing
titles (family-law decisions, tax rulings) for a constitutional-proportionality
question. A direct probe of `search_legal_chunks_text('מבחן המידתיות פסקת ההגבלה', 40)`
returns 23 caselaw / 10 journal / 7 knesset chunks whose top titles are off-topic.

## 3. Is the proportionality material in the corpus? — Yes

| probe | result |
|---|---|
| `legal_documents.title ilike '%מידתיות%'` | 9 (all `journal_article`) |
| `content ilike '%מבחן המידתיות%'` | 36 journal · 11 caselaw · 5 supreme_court_il · 1 knesset |
| of those, also `פסקת ההגבלה` | 29 journal · 5 caselaw · 1 knesset |

## 4. What actually reached the answer

AW4 used 5 sources, 5 rendered footnotes:

| # | source | origin | type |
|---|---|---|---|
| 1 | חוק יסוד: כבוד האדם וחירותו | perplexity | israeli_law |
| 2 | נדב דגן — מידתיות חוקתית, סבירות מנהלית | **local_db** | journal_article |
| 3 | עשרים שנה לבנק המזרחי | **local_db** | journal_article |
| 4 | המהפכה החוקתית או מהפכת זכויות האדם? | **local_db** | journal_article |
| 5 | רבע מאה למהפכה החוקתית | **local_db** | journal_article |

So local journal material *does* reach the pack. What never reaches it is local
**case law** — zero local caselaw candidates survived, in any of the 12 runs.

## 5. Failure classification (causal weight)

1. **Listing suppression vs. local-corpus URLs** — 57% of local caselaw is
   pre-emptively suppressed on a metadata artefact of ingestion, not on content.
2. **Vector quota + tier ordering** — the highest-precision local lane is capped
   at 2/claim and ranked below a noisy lexical lane.
3. **Lexical FTS quality** — `simple` config (no Hebrew morphology) plus
   longest-two-words AND selection makes the text lane low-precision, and the
   text lane is what fills the pool.
4. Not the cause: local execution, embeddings, timeouts, source_type role
   filters, corpus absence, or the deterministic statute resolver.

## 6. Minimal recommendation (in sequence)

1. **Exempt `origin: local_db` candidates from listing suppression when the
   candidate carries chunk body text** (or, equivalently, stop treating the
   ingestion collector URL as the candidate's identity URL for local rows).
   Highest yield, smallest change; unlocks ~4.5k judgments.
2. **Raise/relax the vector quota for local candidates** (e.g. 2 → 4 per claim
   for `local_db`, or lift vector above `text` in `tierOf` when the text lane's
   score is below a floor). Bounded, no extra retrieval.
3. **Fix the lexical lane**: normalize Hebrew prefixes (ה/ו/ב/ל/כ/מ/ש) before
   building the tsquery and pick required terms by IDF/domain salience rather
   than string length.
4. Optional later: re-ingest caselaw `source_url` with per-judgment URLs.

No change to retrieval breadth, verifier, identity validation, or footnote
invariants is required for (1)–(3).
