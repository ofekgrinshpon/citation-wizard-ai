# local_primary_anchor_resolution_audit_v1 — read-only diagnostic

Run audited: AW4 (`מבחני מידתיות`), qa_log `8b949a69-bbf3-4b46-a8c1-b68668f844a0`,
run_id `3cec4fcc-cad3-4f70-8fbe-6dc9c137231d`. No code changed.

## 1. Nominated primary targets

| Nomination | Category | Identifier | Local lookup attempted | External attempted | Final state |
|---|---|---|---|---|---|
| N5 חוק-יסוד: כבוד האדם וחירותו, סעיף 8 | statute | statute_title + "סעיף 8" | **No** | Yes — 3 knesset PDFs/DOCX | `fetch_failed / acquisition_failed:statute_extraction_budget_spent`, body_chars 0 |
| N1 בג"ץ 848/95 רוזנברג | judgment | docket 848/95 | **No** (nomination lane) | Yes — search_first, 2 gov.il URLs, 4 derived URLs suppressed | `fetch_failed / http_403` |
| N3 R v Oakes | judgment (foreign) | none | No | Not routed | not attempted |

## 2. Local lookup trace

Local retrieval (`stages/localRetrieval.ts`) runs *before* discovery, but it is a
**generic query-driven retrieval**, not a nomination-driven resolver:

- The nomination stage (`sourceNomination.ts` → `officialSourceDiscovery.ts`) never
  calls the DB. Its statute lane (`officialSourceDiscovery.ts:1462-1700`) is
  URL-only: it collects official statute URLs already surfaced by Perplexity,
  filtered by `STATUTE_HOST_RE` (knesset/gov.il/nevo/justice), then fetches +
  PDF-extracts. If no such URL: `unsupported_statute_source:no_official_statute_url`.
  There is no `legal_documents` branch anywhere in that lane.
- Local retrieval does have an exact-authority lookup on `legal_documents`
  (title ilike + `source_type in (...)`), plus RPCs `search_legal_chunks_text`
  and `match_legal_chunks`. In this run the statute clue extraction failed:

| clue_source | raw_clue | normalized | tokens for ilike | source_type filter | status |
|---|---|---|---|---|---|
| planner_query | `חוק יס` | `חוק יס` | — | `israeli_law` | `skipped_low_signal / too_short` |
| planner_query | `חוק יס` | `חוק יס` | — | `knesset_research` | `skipped_low_signal / too_short` |
| planner_query | `חוק ומ` | `חוק ומ` | — | `knesset_research` | `skipped_low_signal / too_short` |

Cause: `LAW_BARE_RE = /(חוק\s+[^,?.\n]{2,80}?…)/g` in `localRetrieval.ts:146` uses a
**lazy** `{2,80}?`, so a bare law mention always captures exactly two characters
(`חוק יס`), which the exact-authority guard then rejects as `too_short`
(`applyExactAuthorityGuard`, `normalized_clue.length < 10`). Bare law names therefore
**never** produce a local title lookup. `STATUTE_SECTION_RE` (`סעיף N לחוק…`) is fine,
but the planner query here was phrased without that shape.

Net: **zero local DB rows were retrieved for the nominated Basic Law.**

## 3. External acquisition trace (N5)

| URL | Result |
|---|---|
| `fs.knesset.gov.il/12/law/12_ls1_830785.pdf` | extraction stopped — `statute_extraction_budget_spent` (inline cap 2.5 MB) |
| `fs.knesset.gov.il/12/law/12_lsr_211801.PDF` | same lane, no body |
| `fs.knesset.gov.il/25/law/25_lst_1437471.docx` | no body |

identity_tokens_matched 3, `section_found: false`, body_chars 0, cache miss, nothing injected.
The candidate pool still holds the statute as `origin: perplexity`,
`authority_tier: official_primary`, `text_usability: metadata_only` — a title +
177-char snippet, unusable as a section anchor.

## 4. Local corpus match

| Query | Result |
|---|---|
| `legal_documents` by source_type | caselaw 7,828 · knesset_research 6,164 · **israeli_law 5,013** · journal_article 2,235 · supreme_court_il 302 |
| `legal_document_chunks` | 512,338 total; 52,318 from `israeli_law`, **all embedded** |
| חוק-יסוד: כבוד האדם וחירותו | present — doc `ce785af1-…`, `israeli_law`, 1,633 chars, chunked |
| §8 text present? | **Yes** — the limitation-clause paragraph ("אין פוגעים בזכויות שלפי חוק־יסוד זה אלא בחוק ההולם…") is in the body verbatim |
| §8 *marker* present? | **No** — `select count(*) … where source_type='israeli_law' and content ~ '(^|\n)\s*8\.'` → **0**. The wikisource ingest stripped all section numbers and cross-references (bodies start with `"; ."`) |
| Would it pass source integrity? | Yes as a primary source: host `he.wikisource.org` → `authority_tier: statute_mirror`, which is inside `PRIMARY_TIERS` in `sourceSufficiency.ts:196` and accepted by `sourceHierarchy`/`discoveryPrecision` |

So the corpus *has* the authoritative text and it *would* be admissible — but the
section locator used everywhere (`statuteSectionDetection` / `sectionWindow` matching
`"סעיף 8"` / `"8."`) cannot anchor on it, because the numbers were lost at ingest.

## 5. Failure classification

Multiple, in this order of causal weight:

1. **No local lookup attempted for nominated anchors** — the nomination/discovery lane
   has no DB path at all, statute or judgment. External acquisition is used *instead of*,
   not after, local resolution.
2. **Local lookup attempted (generic lane) but query normalization failed** — the lazy
   `LAW_BARE_RE` truncates every bare law name to 2 chars → guard `too_short`.
3. **Local result not section-located** — statute bodies in `legal_documents` carry no
   section numbers, so even a correct title hit cannot yield "section 8 text".
4. Not the cause: source_type/authority filtering (`israeli_law` is whitelisted,
   `statute_mirror` is a primary tier) and corpus absence (the text exists).
5. Judgments: same as (1). `judgmentTextAcquisition.ts` does have a
   `local_db_docket_lookup` method, but it runs only for pool candidates in
   `case_law_synthesis`, never for nominated dockets before court-egress — 848/95 went
   straight to gov.il and died on 403 while the local caselaw corpus was never queried.

## 6. Minimal implementation recommendation (in sequence)

1. **Local statute resolver first** (`nomination → legal_documents` before any fetch):
   normalized statute-title match against `israeli_law`, returning the document body as
   an injected primary candidate. Cheap, deterministic, removes the PDF budget path for
   the most common anchors.
2. **Clue normalization fix** — make `LAW_BARE_RE` greedy/bounded and accept `חוק-יסוד`,
   so the existing local lane stops self-skipping. One-line class of bug, high yield.
3. **Section locator for section-less bodies** — locate by clause text/order (and/or
   re-ingest statutes with numbering); until then admit whole-statute text as
   `statute_full_text` primary support and let §-level claims stay unsupported rather
   than mis-anchored.
4. **Local judgment resolver** — docket lookup against the 7,828 caselaw rows before
   court-egress/relay.
5. **External acquisition stability last** — it becomes a fallback, not the main path.

No source_type/authority mapping fix is needed.
