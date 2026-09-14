# ReLex V2 — Acquisition Failure Inspection (Batch 3, Q16–Q30)

**Type:** forensic inspection only. No code, prompt, budget, config, data, or deployment change was
made. No Batch 3 question was rerun or resumed. All findings below come from the current repository
state and the persisted `v2_eval_runs` rows (`agent_trace`, `telemetry.acquisition_ledger`,
`telemetry.source_funnel`, `telemetry.egress`, `verified_evidence`, `rejected_evidence`).

---

## 1. Executive summary

The working hypothesis — "acquisition is the bottleneck" — is **half right, and the half that is
wrong is the more expensive half**.

Across the 15 Batch 3 runs the acquisition ledger records **77 acquisition attempts on 48 distinct
authority keys**. Their terminal reasons:

| Terminal reason | Attempts | Questions |
|---|---|---|
| `body_identity_corroborated:docket_present_in_body` (acquired) | 20 | 11 |
| `body_identity_corroborated:statute_title_present_in_body` (acquired) | 9 | 8 |
| `http_403` | 13 | 10 |
| origin connection error (`error sending request …`) | 12 | 7 |
| `judgment_body_form_absent` | 7 | 4 |
| `too_short_for_a_document` | 7 | 4 |
| `docket_mention_not_self_identifying` | 2 | 2 |
| `docket_absent_from_body` | 2 | 2 |
| `statute_title_absent_from_body` | 2 | 2 |
| `statute_section_absent_from_body` | 1 | 1 |
| `unreadable_encoding` | 1 | 1 |
| `http_404` | 1 | 1 |

So **29/77 attempts acquired, 27/77 died at the network edge, 14/77 produced a readable body that
the identity layer refused, 7/77 hit a portal stub**.

Three separate mechanisms, in descending order of damage:

1. **Egress.** Every `www.gov.il` "legalInfo" search entry returns **403**; every
   `supremedecisions.court.gov.il/Home/Search?query=…` returns a TCP-level connection error from the
   edge runtime. These two URLs are exactly the two candidates `lookup_authority` synthesises for
   *every* case (`tools/lookupAuthority.ts:46-58`). The relay exists and is configured
   (`egress.relay_configured: true` in all runs) but was used **once in 15 runs** (Q16:
   `relay_calls: 1`, `relay_successes: 1`); in Q18/Q22/Q29 `relay_calls: 0` while court URLs were
   failing. `relayGate()` refuses a relay slot for guessed/derived URLs — and a `Home/Search?query=`
   URL is precisely such a URL. **The one working court egress path is gated off from the only court
   URL the system ever generates.**
2. **Identity false negatives on genuine bodies.** `judgment_body_form_absent` fired on the
   **official Supreme Court PDF** of בג"ץ 1715/97
   (`supremedecisions.court.gov.il/Home/Download?…type=4`) and on the Adalah PDF of בג"ץ 7052/03 —
   both of which were nevertheless **fetched, readable, cited, span-verified and support-verified**
   in Q16's final answer (`source_funnel` S3/S4: `cited:true, identity_verified:true,
   span_verified:true`). The authorities are simultaneously *used in the answer* and *reported as
   unresolved*. PDF extraction flattens the caption block, so `assessCaptionStructure`'s
   600/1200-char window around the early docket hit loses the strong signals it requires.
3. **Downstream losses misattributed to acquisition.** Q19 and Q29 — the two worst-looking runs
   besides Q18 — are **not** acquisition failures. Q19 acquired ורדניקוב (ע"א 7735/14) from the
   official court site, 46 373 chars, `identity_verified:true`; it then lost four of five claims to
   `span_not_found` and one to `support_does_not_support`. Q29 acquired חוק רישוי עסקים including
   §7ג from nevo (`body_identity_corroborated`, S9 `span_verified:true, support_verified:true`) and
   still told the user it could not verify §7ג, because the temporal checker marked it
   `temporal_unresolved` ("סעיף 7ג אינו מופיע בטקסט שסופק").

**Q18 is the only pure acquisition failure of the three limitation-only/near-empty runs.**

Raw web search is **not** limited by search quality. It returned 208 results over 22 calls with zero
duplicate queries; **14 were fetched and 8 questions never fetched a single raw candidate** (Q22,
Q25, Q26, Q27, Q28 fetched 0 of 10–30 results each). The handoff, not the search, is the problem.

---

## 2. Current acquisition architecture (as built)

### 2.1 Discovery layer — never produces evidence

| Stage | In | Does | Out | Discards | Fallback after failure |
|---|---|---|---|---|---|
| `lookup_authority` (`tools/lookupAuthority.ts`) | kind + docket/statute/section/title hint | static `CANONICAL_AUTHORITIES` clue; local `legal_documents` match tiers (`case_number` exact → `citation ILIKE` → `title ILIKE`, first non-empty tier wins, `:98,109`); synthesises 2 fixed "official search entry" URLs per kind (`:46-58`) | candidates + `authority_key` + `expected_identity`, each given a `result_id` (`:197`) | DB errors swallowed silently in `try/catch` (`:96,106,117`) — no telemetry | none; opens an `acquisitionLedger` target only |
| `search` (`tools/search.ts`) | query + scope web/official/academic/corpus | Perplexity chat-completions (JSON-schema "sources") or `search_legal_chunks_text` RPC | `SearchResult[]` with `result_id` | `empty_query`, `missing_perplexity_credentials`, `perplexity_http_<n>`, `perplexity_credits_exhausted`, `corpus_rpc_error`; unparseable JSON silently → empty | none |
| `raw_web_search` (`tools/rawWebSearch.ts`) | query + limit + optional domain filter | Perplexity `/search` | ranked results with `query_key` dedupe | unsafe URLs dropped at discovery (`:120`) | identical-query dedupe served from the `discovered` map at no budget cost |

All three only mint `result_id`s into a per-run in-memory `discovered` map
(`tools/resultIds.ts`, re-seeded on resume so ids survive worker restarts).

### 2.2 Acquisition layer — the only path to evidence (`tools/fetch.ts`)

```text
result_id / url / source_id
  → source_id?  → re-read stored body (no HTTP, no budget; section locator)
  → local_document_id? → legal_documents row  → local_document_unavailable | local_body_empty
  → else HTTP:
      checkUrlSafety            → unsafe_url_blocked
      already-read URL          → served from store
      same authority acquired   → authority_reuse
      ledger dead path          → dead_acquisition_path:<prior reason>   (same URL never retried)
      officialFetch(url)        → host profile (browser-like UA for court/knesset/gov.il/nevo)
        court.gov.il            → relay FIRST, then direct, then tryAltEgress on 403/429/reset
                                   gated by relayGate(): no slot for guessed/derived URLs
      redirect final URL re-checked → unsafe_redirect_blocked
      status != ok              → http_<status>   (stored as a failed entry)
      > 24 MB                   → document_too_large
      extract by content type   → pdf (24 pages / 200k chars / 12s) | docx | charset-aware HTML
      decode                    → utf-8 with windows-1255 fallback probe
      checkIsActualDocument     → too_short_for_a_document (<400) | unreadable_encoding |
                                  block_page | listing_or_portal_shell:<sig> | portal_shell_no_prose
      corroborate identity      → case: docket presence + proceeding type + court level +
                                  judgmentSelfIdentity(classifyLocalCaselawBody + caption window)
                                  statute: core name presence (+ section variant if requested)
      ledger outcome            → acquired | failed | not_the_document | readable_unconfirmed_identity
```

**No automatic alternative route exists anywhere in this chain.** On failure `fetch` returns
diagnostics plus `ledger.advice()` — a *text hint* to the model ("look for a mirror copy") after
≥2 failed attempts (`tools/acquisitionLedger.ts:282-294`). `prompt.ts:33` explicitly tells the model
these signals are recommendations, "ההחלטה בידך". Nothing re-issues a fetch, switches domain, tries
the relay for a different URL, or falls back to the local corpus.

### 2.3 Admission, verification, delivery

`EvidenceStore` appends every fetched entry (including failed ones) de-duped by normalised URL;
`readable()` = `fetch_status==="ok" && is_actual_document` is the citable pool. **Authority binding
is *not* required for citation** — this is why Q16 cites two authorities that its ledger calls
unresolved. Verification then requires (a) the literal span to be found in the stored body and
(b) a support judgement, and the temporal checker can independently mark a claim
`temporal_unresolved`.

---

## 3. Material authority failure table

Route abbreviations: LA = `lookup_authority`, S = `search`, RW = `raw_web_search`.
"First failure point" is the first stage in the chain where the authority was lost.

| Q | Authority | Why needed | Route | Candidate? | Candidate host | Fetch? | Fetch outcome | Body? | Identity | Verification | First failure point | Alt. candidate already known? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 16 | בג"ץ 1715/97 | proportionality tests | LA+RW | yes | supremedecisions (Download type=4) | yes | 200, PDF | **yes** | **rejected `judgment_body_form_absent`** | span+support verified, **cited** | identity (false negative) | n/a — same body used |
| 16 | בג"ץ 7052/03 | proportionality | RW | yes | adalah.org PDF | yes | 200 | yes | **rejected `judgment_body_form_absent`** | span+support verified, **cited** | identity (false negative) | n/a |
| 16 | בג"ץ 6821/93 | limitation-clause origin | LA | search page only | www.gov.il legalInfo | yes | **403** | no | – | – | discovery (no document candidate) | no |
| 16 | חוק-יסוד כבוה"א §8 | the clause itself | S official | yes | m.knesset.gov.il PDF | yes | 200 | yes | **`statute_title_absent_from_body`** | – | statute identity | no |
| 17 | ע"א 915/91 גנז | duty of care of authority | S | yes | ralc.co.il | yes | 200 | yes | `docket_mention_not_self_identifying` | – | identity | court URL (reset) |
| 17 | ע"א 243/83 | negligence/policy | LA | search page only | gov.il | yes | 403 | no | – | – | discovery/egress | no |
| **18** | **חוק החוזים §13** | **the central rule** | LA+S+RW | yes ×3 | nevo `#/search`, main.knesset `LawPrimary.aspx`, fs.knesset PDF | yes ×3 | stub, stub, 200 | 1 of 3 | **`statute_title_absent_from_body`** (the PDF was a bill/explanatory memo) | claim marked `temporal_unresolved` | discovery → wrong document | no current consolidated text discovered |
| **18** | רע"א 4705/22 | modern sham-contract | S | yes | toledano.co.il | yes | 200 | yes | **`judgment_body_form_absent`** | – | identity | no |
| **18** | ע"א 630/78 ביטון | leading sham-contract | LA | search pages only | court Home/Search, gov.il | yes ×2 | **reset**, **403** | no | – | – | egress | no |
| 19 | ע"א 7735/14 ורדניקוב | the BJR itself | S official + LA | yes | supremedecisions | yes | 200 | **yes, 46 373 ch** | **acquired** | **4× `span_not_found` + 1× `support_does_not_support`** | **verification (span)** | n/a |
| 19 | חוק החברות §252 | duty of care | S official | search page only | gov.il | not fetched (403 earlier) | – | no | – | – | discovery/egress | no |
| 20 | ע"פ 7052/18 | defence-from-justice dev. | S | yes | toledano.co.il | yes | 200 | yes | **`judgment_body_form_absent`** | – | identity | no |
| 20 | ע"פ 2910/94 יפת | doctrine origin | LA | search page only | gov.il | yes | 403 | no | – | – | egress | no |
| 20 | חסד"פ §149 | statutory anchor | LA+S | yes ×3 | gov.il, main.knesset, fs.knesset | yes ×3 | 403, stub, **200** | yes | acquired | used | (recovered) | yes — fs.knesset worked |
| 21 | בש"פ 5002/09, 4988/08 | Issacharov line | LA | court URLs | supremedecisions | yes ×2 | **reset** | no | – | – | egress | yes (haaretz PDF worked for 1062/21) |
| 22 | בג"ץ 135/75 סאי-טקס | the promise test | LA | gov.il + court | both | yes ×2 | 403, reset | no | – | – | egress | **raw_web returned 30 results, 0 fetched** |
| 22 | בג"ץ 8634/08 | modern restatement | S | court + gov.il | both | yes ×2 | reset, 403 | no | – | – | egress | same |
| 23 | חוק הירושה §20, §25 | the formal requirements | LA+S | yes ×3 | main.knesset, nevo ×2 | yes | stub ×2, 404 | no | – | – | discovery (portal stubs) | **yes — the whole law was acquired from he.wikisource, but the §-level targets stayed unresolved** |
| 24 | ע"א 2699/92 בכר | oppression precedent | LA | gov.il search page | gov.il | yes | 403 | no | – | – | egress | no |
| 24 | חוק החברות §191 | the section | LA+S+RW | yes ×2 | nevo, (2nd) | yes | `statute_section_absent_from_body` then acquired | yes | acquired on 2nd | 2 claims `temporal_unresolved` | (recovered) | yes |
| 25 | ע"פ 4855/02 בורוביץ | restraint-of-trade proof | LA | yes | (body) | yes | 200 | yes | `docket_absent_from_body` | – | identity/wrong document | no |
| 26 | ע"א 2643/97 גנז | competing transactions | S | yes ×3 | barelaw (403), afiklaw, law-mate | yes ×3 | 403, identity reject, **acquired** | yes | acquired 3rd | used | (recovered) | yes |
| **29** | חוק רישוי עסקים §7ג | the hearing duty | S | yes | nevo `law_html` | yes | 200, 136 354 ch | **yes** | **acquired, corroborated** | **`temporal_unresolved`: "סעיף 7ג אינו מופיע בטקסט שסופק"** | **temporal/verification** | n/a |
| **29** | בג"ץ 3/58 ברמן | the hearing rule | LA | court search page | supremedecisions | yes | **reset** | no | – | – | egress | no |
| **29** | 654/78, 2911/94 באקי | scope/cure of hearing | LA | court search pages | supremedecisions | yes ×2 | **reset** | no | – | – | egress | no |
| **29** | בג"ץ 3379/03 מוסטקי | cure/relative voidness | S | yes | glima.info | yes | **403** | no | – | – | egress | no |
| 30 | בג"ץ 8077/08 | student discipline | LA+S | yes ×3 | gov.il, court, colman.ac.il | yes ×3 | 403, reset, **`unreadable_encoding`** | no | – | – | egress + decoding | no |

---

## 4. Raw web search: discovery → acquisition handoff

| Q | Calls | Results | Fetched | Identity rejects | Unique domains | Outcome |
|---|---|---|---|---|---|---|
| 16 | 2 | 16 | 3 | 2 | 12 | **useful** — produced the Adalah 7052/03 PDF and the YIT 3390/16 PDF, both cited |
| 18 | 1 | 8 | 1 | 1 | 3 | produced the fs.knesset bill PDF (S11) — wrong document type |
| 20 | 3 | 30 | 3 | 0 | 15 | **useful** — antitru.st copy of בורוביץ 4855/02 bound after the official path failed |
| 21 | 2 | 16 | 1 | 0 | 9 | useful — haaretz PDF of 1062/21 after court reset |
| 22 | 3 | 30 | **0** | 0 | 18 | **inert** — 30 candidates, none fetched, while 135/75 and 8634/08 stayed unresolved |
| 23 | 1 | 10 | 2 | 0 | 10 | partly useful |
| 24 | 3 | 30 | 4 | 0 | 11 | **useful** — 8712/13, 3432/17, 2786/18 acquired |
| 25 | 1 | 10 | **0** | 0 | 2 | inert |
| 26 | 2 | 20 | **0** | 0 | 9 | inert |
| 27 | 3 | 30 | **0** | 0 | 14 | inert |
| 28 | 1 | 8 | **0** | 0 | 8 | inert |
| **Total** | **22** | **208** | **14** | **3** | – | 5 questions genuinely improved; 5 questions fetched nothing |

Answers to the specific sub-questions, from the traces:

- **Registered?** Yes. Every raw result is registered into the `discovered` map with a durable
  `result_id` (`researchAgent.ts` raw branch → `nextResultId()`), so the model *can* address them.
- **Visible in the next step?** Only as a compacted result list in the rolling research-state
  message; there is no persistent "unfetched candidates" panel. Once the list scrolls out of the
  compacted window, a candidate is effectively invisible — nothing re-surfaces it.
- **Suppressed/deduped?** No. `raw_web_search_deduped_queries: 0` in every run; nothing was
  suppressed.
- **Budget?** Not the cause in the inert cases. Q22 ended at step 14 of its step budget with
  `fetch_calls: 10`; Q27 ended at step 22 with `fetch_calls: 3`; Q28 at step 11 with
  `fetch_calls: 5`. **Budget headroom remained in every inert case.**
- **StopPolicy?** Did not block — no `budget_exhausted:fetch` appears in any Batch 3 trace.
- **Searched instead of fetching?** Yes, systematically. Q22 issued 3 raw searches and 7 scoped
  searches while fetching zero raw candidates; Q27 spent 7 web searches and 3 raw searches and made
  3 fetches total, then filled 50 turns with `already_read` re-reads.
- **Terminated with useful candidates unfetched?** Yes — in Q22, Q25, Q26, Q27, Q28 (and Q18, where
  8 raw results for the statute text produced a single fetch of the wrong document).

**Funnel:** 208 raw candidates discovered → 14 fetched (6.7 %) → 11 yielded bodies → 8 bound →
**5 questions had a raw-web source reach the final verified evidence**.

**Verdict: there is a systemic discovery → fetch handoff problem.** Raw web search finds material;
the agent routinely does not act on it, and nothing in the code forces or even re-surfaces it.

---

## 5. Statute acquisition

How V2 gets Israeli statutes today: only via generic discovery. `lookup_authority` synthesises two
fixed statute URLs — `nevo.co.il/laws/#/search/<term>` and
`main.knesset.gov.il/…/LawPrimary.aspx?t=lawlaws&st=lawlaws&lawitemid=<term>`
(`tools/lookupAuthority.ts:53-57`). **Both are SPA/portal shells.** They return HTTP 200 with a
near-empty DOM, so `checkIsActualDocument` rejects them as `too_short_for_a_document` — 7 of the 7
such rejections in the batch came from exactly these two URL templates. There is no statute-specific
acquisition path, no consolidated-text resolver, no section resolver.

Statute failures by cause:

| Cause | Cases |
|---|---|
| Portal stub (`too_short_for_a_document`) from the two synthesised URLs | חוק החוזים §13 (Q18 ×2), חוק הירושה §20/§25 (Q23 ×2), חסד"פ §149 (Q20), חוק זכויות הסטודנט (Q30) |
| gov.il **403** | חוק החברות §252 (Q19), חסד"פ §149 first attempt (Q20) |
| Readable but wrong document (`statute_title_absent_from_body`) | חוק-יסוד כבוה"א §8 (Q16, knesset PDF), חוק החוזים §13 (Q18, fs.knesset PDF = **a bill and explanatory notes, not the enacted law**) |
| Section missing from an otherwise correct law (`statute_section_absent_from_body`) | חוק החברות §191 (Q24, nevo — recovered on a second attempt) |
| **Acquired but the section could not be located in the body** | **חוק רישוי עסקים §7ג (Q29)** — corroborated, span-verified, then `temporal_unresolved` |
| 404 | חוק הירושה §25 (Q23, nevo) |

**Alternative copy already in hand but unused — the sharpest finding here:** in Q23 the full text of
חוק הירושה was successfully acquired from `he.wikisource.org`
(`body_identity_corroborated:statute_title_present_in_body`), yet the two section-level targets
`…#20` and `…#25` remained in `unresolved_authorities`, because a section target is only satisfied by
a body fetched *for that target*. The same pattern appears in Q29: the whole licensing law is in the
store (136 354 chars, twice), and the run still reports the §7ג claim as unverifiable.
`section_reads_missing` is non-zero in 8 of 15 runs (Q19: 12, Q27: 9, Q21: 3).

So statute failures split roughly **50 % discovery (portal stubs / wrong URL template), 25 % egress
(gov.il 403), 25 % section-resolution inside an already-acquired body** — and essentially 0 %
extraction/encoding.

---

## 6. Judgment self-identity: false-negative analysis

Seven `judgment_body_form_absent` rejections across four questions, plus two
`docket_mention_not_self_identifying`:

| Q | Docket | URL host | Genuine judgment text? | Notes |
|---|---|---|---|---|
| 16 | **1715/97** | **supremedecisions.court.gov.il /Home/Download …type=4** | **Yes — the official Supreme Court file** | fetched, readable, **cited, span-verified, support-verified** in the final answer; still refused binding |
| 16 | **7052/03** | adalah.org PDF | **Yes — full judgment reproduction** | same: cited and verified, binding refused |
| 16 | 3390/16 | toledano.co.il | header-card page | correctly rejected; the YIT PDF of the same docket bound |
| 18 | 4705/22 | toledano.co.il | header-card page | plausibly correct rejection |
| 20 | 7052/18 | toledano.co.il | header-card page | plausibly correct rejection |
| 24 | 3432/17, 2786/18 | toledano.co.il | header-card pages | correctly rejected; both dockets later bound from the official site |
| 17 | 915/91 | ralc.co.il | digest page | correct |
| 26 | 2643/97 | he.afiklaw.com | commentary | correct; later bound from law-mate.com |

**The guard is doing its job on commentary and header-card pages (5 of 9 rejections are correct, and
no commentary false-bind recurred in this batch). Its failure mode is PDF.** Both false negatives are
PDF-extracted judgments. `extractPdfPagesBounded` emits a linearised text stream in which the caption
block (court name / parties with נ' / litigant roles / לפני-panel) is split across page furniture and
column order, so `assessCaptionStructure`'s requirement — an early docket hit (≤4000 chars) with ≥2
distinct structural signals, at least one *strong*, inside a 600-before/1200-after window — is not
satisfied even though the document is unmistakably a judgment. `classifyLocalCaselawBody` was tuned
and audited on **local DB bodies**, which are stored pre-cleaned; PDF-extracted bodies are a
different textual population.

Consequence, and it is worth stating precisely: **the guard does not currently block genuine
judgments from being used** — the body still enters the EvidenceStore and can be cited, as Q16
proves. What it blocks is **binding**, which is what feeds `unresolved_authorities`, the acquisition
ledger's dead-path logic, and the memo's "we could not obtain X" language. That is how Q16 ends up
citing בג"ץ 1715/97 while listing it as unresolved. The tradeoff today is therefore: correct on
commentary, over-strict on PDFs, and the cost is bookkeeping and agent behaviour rather than
outright evidence loss — except where the model reads the "unresolved" signal and keeps searching
(Q16 spent 7 further turns re-reading S3/S4/S5).

---

## 7. Alternative-source utilisation (root-cause classes A–F)

Classification of the 25 material authority losses (terminal class only, one per authority):

| Class | Meaning | Count | Examples |
|---|---|---|---|
| **A** | No usable source discovered | **6** | 6821/93 (Q16), 243/83 (Q17), 630/78 (Q18), 2910/94 (Q20), 2699/92 (Q24), 8077/08 (Q30) — in each, the only candidates were the two synthesised search-entry URLs |
| **B** | Usable source discovered but never fetched | **5** | 135/75 and 8634/08 (Q22, 30 raw candidates unfetched); Q25, Q26, Q27 raw candidate pools left untouched |
| **C** | Usable body fetched but rejected | **8** | 1715/97, 7052/03, Basic Law §8 (Q16); 4705/22, חוק החוזים §13 fs.knesset PDF (Q18); 915/91 (Q17); 7052/18 (Q20); 4855/02 (Q25) |
| **D** | Body admitted but not verified | **3** | ורדניקוב 7735/14 (Q19, 4× `span_not_found`); רישוי עסקים §7ג (Q29, `temporal_unresolved`); חוק החברות §191 (Q24, 2 claims `temporal_unresolved`) |
| **E** | Verified evidence existed but was omitted | **1** | Q29 — S9 shows `span_verified:true, support_verified:true` on the licensing law, yet `verified_claim_count: 0` and the user got a limitation-only answer |
| **F** | Infrastructure/budget prevented continuation | **10** | every `supremedecisions … Home/Search` connection reset: 5002/09, 4988/08 (Q21), 135/75, 8634/08 (Q22), 654/78, 3/58, 2911/94 (Q29), 3379/03 (Q29, 403), 630/78 (Q18), 8077/08 (Q30) |

(A and F overlap by construction — where the *only* discovered candidate was a search-entry URL that
died at the network, the loss is counted once, under F when the failure was transport-level and
under A when discovery never produced anything else. Both are ultimately the same root defect:
`lookup_authority` synthesises two URLs that cannot be fetched from this runtime.)

---

## 8. Agent behaviour after acquisition failure

Fetch-call outcome distribution across all 15 traces (633 fetch entries):

| Outcome | Count |
|---|---|
| `already_read` (re-read of a stored body) | **452** |
| `already_read_noop` (suppressed repeat of a repeat) | **82** |
| body obtained | 54 |
| `http_403` | 34 |
| network error | 12 |
| empty / not a document | 8 |
| `http_404` | 1 |

**84 % of all fetch actions are re-reads of material the agent already has.** Worst offenders:
Q19 (109 already-read actions, `already_read_noop S1 x10`, 308 943 prompt tokens, 24 steps, and the
final answer still scored 25), Q29 (48, with `already_read_noop S7 x4`), Q21 (91), Q26 (52), Q27 (50).

The predicted loop is confirmed and has a specific shape:

1. identify authority → 2. fetch the synthesised official URL → 3. 403 or reset → 4. broad search →
5. more candidates registered → 6. **re-read an already-stored body looking for the missing span**
rather than fetch a new candidate → 7. repeat with a slightly different `find` string.

The re-read loop is a *span-hunting* loop, not a search loop: the agent is trying to make the bodies
it already has answer the question, because `section_reads_missing` keeps telling it the span is not
there. Q29's trace is the clearest case — 18 consecutive turns of `already_read`/`already_read_noop`
against S1/S2/S3/S7 for "זכות הטיעון", "ריפוי הפגם", "7ג" — while four named authorities sat
unresolved and the raw-search budget was never touched (`raw_web_search_calls: 0`).

No run hit `budget_exhausted`. Premature memo submission is visible in Q18 (memo at step 7 of a
budget that allowed more) and Q24 (three memo submissions, steps 11/13/18).

---

## 9. Q18 forensic timeline

| Step | Action | Result |
|---|---|---|
| 1 | `lookup_authority` statute חוק החוזים §13 | 2 candidates — both synthesised portal URLs (nevo SPA, knesset `LawPrimary.aspx`) |
| 1 | `search` corpus ×2 | 16 corpus hits (family-court and district judgments mentioning מראית עין) |
| 2 | `fetch R1` (nevo SPA) | `chars=0 document=false` → `too_short_for_a_document` |
| 2 | `fetch R17` | 1 114 chars, document → a minor judgment, not §13 |
| 2 | `fetch R9`, `R10` | **403** ×2 |
| 3 | `fetch R2` (knesset `LawPrimary.aspx`) | `chars=0` → stub |
| 3 | `search` official + corpus, `lookup_authority` 630/78 and 1780/93 | 630/78 → the two search-entry URLs again; 1780/93 → mis-matched registry hint (בג"ץ 6821/93 מזרחי) |
| 4 | `fetch R20`, `R24` | 403 ×2 |
| 4 | `raw_web_search` "חוק החוזים … סעיף 13 pdf אתר הכנסת" | 8 results |
| 5 | `fetch R35`, `R33` | 403 ×2 |
| 5 | `fetch R30` (court `Home/Search?query=630/78…`) | **connection reset** |
| 6 | `fetch R37` (`fs.knesset.gov.il/…7_ls1_289922.PDF`) | **51 528 chars, readable** — but it is a **bill with explanatory notes**, so `statute_title_absent_from_body` |
| 6 | `fetch R29` | 403 |
| 7–8 | `submit_research_memo` ×2 | claims=2 then claims=1 |
| — | verification | the single surviving claim marked `temporal_unresolved`: "S11 … הוא חלק מדברי המבוא להצעת החוק" |
| — | drafter | limitation-only answer, 0 footnotes |

`issue_summary` is explicit about the terminal state: *"התקציב הנוכחי אינו מאפשר פעולת fetch נוספת
להשגת נוסח חקיקה רשמי עדכני"* — the agent believed it was out of fetch budget. Telemetry says
`fetch_calls: 12` and no `budget_exhausted` block ever fired; **the agent stopped on a belief, not on
a limit.**

Could a bounded further attempt have succeeded with information already in the run? Yes. The run had
16 corpus results and 8 raw-web results it never fetched, and the `he.wikisource.org` route that
worked for חוק הירושה in Q23 was never tried for חוק החוזים. **Class: A/C mixed — discovery produced
only portal shells and one wrong document; terminal class C (wrong document accepted into the store,
correctly refused identity).**

`central_issue_covered` — Q18 reports **true**. That is incorrect: zero verified claims, zero
footnotes, no substantive answer.

## 10. Q29 forensic timeline

| Step | Action | Result |
|---|---|---|
| 1 | 3 × `search` web | 17 results |
| 2 | `fetch R2` | **136 354 chars — חוק רישוי עסקים from nevo, corroborated, S1** |
| 2 | `fetch R7`, `R12` | 47 608 and 54 425 chars (Haifa Law article on late hearing; עע"ם 1038/08 from hamoked) |
| 2 | `lookup_authority` 654/78, 3/58, 2911/94 | six candidates — all court/gov.il search-entry URLs |
| 3 | 6 × `fetch` by find-string | all `already_read` |
| 4 | `fetch R20`, `R22`, `R24` (the three court URLs) | **connection reset ×3** |
| 5 | 3 × `search` web | 17 more results |
| 6 | `fetch R25` | 46 294 chars (S7) |
| 6 | `fetch R27` | 403 |
| 7–18 | **~40 consecutive `already_read` / `already_read_noop` re-reads** of S1/S2/S3/S7 | no new evidence |
| 19 | `submit_research_memo` | claims=1 |
| 20 | `search` "site:nevo.co.il חוק רישוי עסקים סעיף 7ג" | 2 results |
| 21 | `fetch R48` | **136 354 chars again — the same law, re-acquired as S9, `span_verified:true, support_verified:true`** |
| 22 | `submit_research_memo` | claims=2 |
| — | verification/temporal | both claims `temporal_unresolved`: "סעיף 7ג אינו מופיע בטקסט שסופק" |
| — | drafter | limitation-only answer, 0 footnotes |

**Q29 is not an acquisition failure.** Four authorities bound (`authority_bindings_created: 4`),
five readable bodies, the licensing law acquired twice and span-verified — and the delivered answer
says nothing was verifiable. The loss is between span verification and the temporal checker: the
section locator could not find §7ג inside a 136 k-character HTML dump of the whole law
(`section_reads_missing: 2`), and the temporal stage converted "section not located" into
"current law unverifiable".

`central_issue_covered` — Q29 reports **true**. Also incorrect.

**Q18 and Q29 are different failures.** Q18 = discovery + wrong-document (nothing usable was ever in
the store). Q29 = the right statute was in the store, twice, and the section-location/temporal layer
discarded it. They look identical to the user and share only the drafter's limitation template.

---

## 11. Acquisition vs downstream: causal classification

| Root layer | Instances | Where |
|---|---|---|
| Authority planning | 0 material | the agent named the right authorities in every inspected run |
| **Discovery (URL templates that cannot yield a document)** | **13** | every `lookup_authority` case/statute call |
| Candidate registration | 0 | ids are minted and durable |
| **Discovery → fetch handoff** | **5 questions, 194 unfetched raw candidates** | Q22, Q25, Q26, Q27, Q28 |
| **Fetch/egress** | **27 attempts** | gov.il 403 ×13, court reset ×12, 404, encoding |
| Extraction/decoding | 1 | `unreadable_encoding` (colman.ac.il, Q30) |
| **Judgment identity** | 9 (2 false negatives) | §6 |
| **Statute identity / section resolution** | 5 | §5 |
| EvidenceStore admission | 0 | append-only, no material loss observed |
| **Verification (span)** | 4 + `section_reads_missing` in 8 runs | Q19 ×4 |
| **Temporal** | 5 claims across Q18/Q24/Q29 | §5, §10 |
| Sufficiency/repair | 2 severe | Q18 and Q29 both reported `central_issue_covered: true` with 0 verified claims |
| Drafting | 0 | the drafter faithfully rendered an empty verified set |
| Infrastructure/budget | 10 | court egress; **no budget ceiling was ever reached** |

---

## 12. Systemic vs isolated

**Systemic:**
- `lookup_authority` generates the same two unfetchable URLs for every authority (403 / reset).
- The relay is configured but effectively unused: 1 relay call in 15 runs, while 12 court
  connection-resets occurred, because `relayGate()` declines guessed/derived URLs — the only kind
  this pipeline produces for courts.
- No automatic second route after any failure; the entire recovery strategy is a text hint.
- Section-level targets are not satisfied by an already-acquired full statute body.
- Re-read dominance (84 % of fetch actions) and the associated token blow-up.
- `central_issue_covered: true` on runs with zero verified claims.

**Isolated:**
- `unreadable_encoding` on one academic host.
- The known law-firm-newsletter header-card false bind (not observed again in Batch 3).
- One mis-matched registry hint (Q18 mapping 1780/93 to מזרחי 6821/93).

---

## 13. Ranked bottlenecks

**A. Largest: the acquisition *route* layer — synthesised URLs that cannot be fetched, with no
alternative route and an unused relay.** 27 of 77 attempts die here, it is the direct cause of 16 of
25 material losses (classes A + F), and it is fully deterministic: the same two URL templates fail
the same way in every run.

**B. Second: the discovery → fetch handoff.** 208 raw candidates, 14 fetched; 5 questions fetched
none while their target authorities stayed unresolved, with step, fetch and time budget all
remaining. Nothing in the code re-surfaces or forces the drain of a discovered candidate.

**C. Q18 and Q29 are different failures** — see §10. Only Q18 is an acquisition failure.

**D. `raw_web_search` is limited by what happens after it finds results**, not by search quality.
Zero duplicate queries, 18 unique domains in a single question, and the useful hits it did produce
(Adalah 7052/03, antitru.st בורוביץ, the 8712/13 official copy) were decisive where they were
fetched.

**E. The self-identity guard is materially distorting the ledger, not blocking evidence.** Two
genuine PDFs were refused binding while being cited and verified in the same answer. Its
commentary-rejection behaviour is correct and should not be weakened; the PDF caption window is the
defect.

**F. Statute failures are primarily a discovery/fallback problem, not an egress problem.** Only 2 of
13 statute attempts died at 403; 7 died on portal-shell URL templates and 4 on
identity/section-resolution inside bodies that were already readable.

**G. Single highest-yield change: class A/F — the acquisition route.** Make authority acquisition
attempt a *route*, not a URL: when the synthesised official URL fails (403/reset), the same authority
should be pursued through the routes that demonstrably work in this very batch (relay for court
hosts including derived URLs, `fs.knesset.gov.il` for statutes, `he.wikisource.org` consolidated
text, and already-discovered mirrors) before the agent is allowed to move on. Sixteen of the
twenty-five material losses sit in this class, including all four of Q29's unresolved judgments and
Q18's ע"א 630/78.

---

## 14. Recommended design direction (direction only — not implemented)

1. **Route-based acquisition per authority key.** Keep the ledger's dead-path memory, but make a
   failed attempt trigger the *next route for the same authority* in code, bounded (e.g. ≤3 routes
   per authority per run), instead of returning a hint to the model.
2. **Let the relay serve the URLs the pipeline actually produces** for court hosts, rather than
   declining derived URLs — this is the difference between 1 and ~12 relay calls in this batch.
3. **Replace the two synthesised statute portal URLs** with acquisition targets that return text.
   No hardcoded statutes, no bulk ingest — the point is that `#/search` and `LawPrimary.aspx` are
   structurally incapable of yielding a body.
4. **Satisfy section targets from an already-acquired parent statute body** instead of treating
   `law#§` as an independent acquisition target.
5. **Caption assessment on PDF-extracted text** needs a layout-tolerant variant (or to run against
   the pre-linearisation page text). Do not relax the commentary signals.
6. **Force the candidate drain before memo submission**: if unresolved authorities exist and
   unfetched discovered candidates for them remain within budget, the memo step should not be the
   next available action.
7. **`central_issue_covered` must be derivable from verified claims**, not asserted alongside zero
   of them.

---

## 15. Final verdict

The dominant failure is a single, specific, deterministic mechanism — authority acquisition is
attempted through URL templates that cannot be fetched from this runtime, with no second route and
an unused relay — compounded by a discovery→fetch handoff that leaves 93 % of raw candidates
untouched. The verification, temporal and sufficiency defects found in Q19, Q24 and Q29 are real and
separately actionable, but they are second-order and were not the cause of the batch-wide pattern.

**ACQUISITION BOTTLENECK IDENTIFIED — READY FOR DESIGN REVIEW**
