# V2 Literature Review Acceptance #2

Re-run of the Literature Review Acceptance matrix after the deployed
**Academic Evidence Yield + Bibliographic Identity** track.

**No product code was changed in this task.** Prompts, agent logic, extraction,
metadata parsing, drafter, verifier, renderer, budgets, scopes and synthesis are
exactly as deployed. The only file added is a harness reader
(`scripts/litrev2-extract.py`), which reads saved run JSON and touches nothing
in the pipeline.

## 1. Executive summary

The full matrix (L1–L8 broad, N1–N2 narrow) has now been executed once each,
strictly sequentially, same prompts as the baseline. The first attempt was cut
off by an AI-gateway credit exhaustion (HTTP 402) after L1–L4; after the account
was topped up, L5–N2 were re-run cleanly. The credit aborts are recorded as
infrastructure events only and are not folded into any product finding.

What the full matrix shows:

- **The span-stage bottleneck is gone.** Across every completed run the
  memoed → span-verified → support-verified chain yields 1.00. The
  canonical-text change did exactly what it was designed to do, and the loss did
  not migrate downstream.
- **Every remaining loss is explicitly attributed.** Each non-contributing
  source carries a terminal stage (`NOT_ACQUIRED`, `UNUSABLE_EXTRACTION`,
  `READ_NO_QUOTE_REQUESTED`, `WINDOW_SERVED_NOT_MEMOED`). Nothing disappears
  unexplained.
- **Acquisition against external academic hosts is now the dominant blocker.**
  SSRN (×3 attempts across L5/L7), Yale Law Journal, UC Davis Law Review,
  Vanderbilt and Notre Dame repositories (`viewcontent.cgi`), OECD, ECGI,
  Justia, CourtListener, Google Scholar case pages and the UK Supreme Court PDF
  all failed at fetch. L7 acquired **0 of 4** academic sources; L5 **1 of 4**;
  L8's English primary sources (BAILII, UKSC, Parliament) were all lost at
  fetch/extraction.
- **Bibliographic identity is populated but still emits wrong citations.** Two
  footnotes carry invented/wrong author-title pairs sourced from embedded PDF
  info fields (a cp1255 mojibake title with a Knesset legal adviser as "author"
  of a Basic Law; `pubdat, "C:\Working Papers\11883.wpd"` for an NBER paper),
  and raw URLs still appear inside every footnote's visible text.
- **Narrow control N1 regressed on this sample** (0 verified claims, 0
  footnotes, central issue uncovered, 84 s / 24 steps) because the statute body
  was not acquired: `main.knesset.gov.il` extracted empty and Wikisource failed
  at fetch. N2 stayed narrow and correct (1 source, 3 footnotes, Rule 37 repeat).

Verdict: **PARTIAL / REVIEW** (section 16).

## 2. Prompts and run IDs

Prompts are byte-identical to the baseline harness
(`scripts/v2-litreview-acceptance.ts`, unchanged). No prompt was rewritten and
no new prompt was introduced.

| ID | Topic | run_id | Status | Latency | Chunks | Resumes |
|---|---|---|---|---|---|---|
| L1 | reasonableness lit review | 7f38e71a-dad6-49df-8f6e-8205986078eb | done | 382 s | 3 | 1 |
| L2 | administrative promise disagreement | 19fb9ba2-bca7-421a-ba38-8ed40df479b2 | done | 179 s | 3 | 0 |
| L3 | reasonableness vs proportionality | 7047ee5d-d1b5-4245-8eca-3e96fa0c5e5a | done | 399 s | 2 | 1 |
| L4 | good faith in contract | dfad9c04-c03c-481b-a81a-a57399e3ece8 | done | 196 s | 3 | 0 |
| L5 | controlling-shareholder conflicts | c46e1ef2-1237-4410-826d-00a04a56fdcf | done | 75 s | 2 | 0 |
| L6 | judicial review of Basic Laws | 9a2b5a9d-3d00-4545-ac09-7ab99ccd93fa | done | 97 s | 2 | 0 |
| L7 | tattoo copyright in video games | e0e50894-c3d5-47b6-9415-83c6219e93ab | done | 97 s | 1 | 0 |
| L8 | IL/UK legitimate expectations | c7999752-d561-4c2c-863a-f7e70060e47a | done | 76 s | 1 | 0 |
| N1 | s.12 Contracts Law | 890d8c92-02da-4dcd-bca2-d03ab3e5520c | done | 84 s | 3 | 0 |
| N2 | רע"א 3365/20 | ba3c3327-89ba-4f73-96ed-76612785a01e | done | 100 s | 3 | 0 |

Infrastructure aborts from the first session (402 "Not enough credits"):
ff13989d (L5, mid-run), 9217259d / 39b7e84e / b6ad2081 / 4a098eb2 / 368d651b
(L6–N2, step 1), 646c4c3a (N1 retry confirming persistence). All failed closed,
recorded cleanly, no fabricated answers.

## 3. Run telemetry

| ID | Steps | acad/web/off/corpus searches | raw-web | fetch | read | Verified claims | Unsup. | Src avail→cited | Footnotes | Answer chars | Prompt tok |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 | 21 | 3/1/2/0 | 0 | 8 | 6 | 6 | 0 | 4→4 | 3 | 1,247 | 273k |
| L2 | 21 | 6/1/0/0 | 0 | 4 | 4 | 5 | 0 | 4→4 | 5 | 1,629 | 308k |
| L3 | 22 | 3/1/1/0 | 2 | 9 | 9 | 6 | 0 | 4→4 | 5 | 1,321 | 320k |
| L4 | 20 | 6/1/0/1 | 2 | 10 | 8 | 6 | 0 | 3→3 | 6 | 1,561 | 271k |
| L5 | 10 | 0/8/0/0 | 3 | 8 | 2 | 2 | 0 | 1→1 | 2 | 725 | 88k |
| L6 | 12 | 0/8/0/0 | 3 | 2 | 2 | 4 | 0 | 2→2 | 3 | 1,612 | 128k |
| L7 | 13 | 2/1/1/4 | 3 | 12 | 4 | 3 | 0 | 2→2 | 3 | 928 | 107k |
| L8 | 8 | 3/1/0/0 | 3 | 8 | 3 | 2 | 0 | 1→1 | 3 | 919 | 58k |
| N1 | 24 | 0/2/1/5 | 2 | 9 | 3 | **0** | 0 | 0→0 | **0** | — | 195k |
| N2 | 20 | 0/1/0/0 | 1 | 1 | 1 | 4 | 0 | 1→1 | 3 | — | 208k |

**Drafter utilization: 100% in every run with a non-empty pack** (4→4, 4→4,
4→4, 3→3, 1→1, 2→2, 2→2, 1→1, 1→1). Zero unsupported claims in all ten runs.
Synthesis projection loss is zero in every run with synthesis content.

## 4. Academic evidence funnel

| | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 |
|---|---|---|---|---|---|---|---|---|
| academic_discovered | 6 | 4 | 3 | 7 | 4 | 0 | 4 | 1 |
| academic_acquired | 5 | 4 | 3 | 7 | 1 | — | 0 | 1 |
| academic_extracted_usable | 5 | 4 | 3 | 6 | 1 | — | 0 | 1 |
| academic_sources_memoed | 3 | 4 | 2 | 3 | 1 | — | 0 | 0 |
| academic_sources_span_verified | 3 | 4 | 2 | 3 | 1 | — | 0 | 0 |
| academic_sources_support_verified | 3 | 4 | 2 | 3 | 1 | — | 0 | 0 |
| academic_sources_final_pack | 3 | 4 | 2 | 3 | 1 | — | 0 | 0 |
| acquisition_yield | 0.83 | 1.00 | 1.00 | 1.00 | **0.25** | — | **0.00** | 1.00 |
| span_yield | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | — | — | — |
| support_yield | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | — | — | — |
| read_to_verified_source_yield | 0.60 | 1.00 | 0.67 | 0.50 | 1.00 | — | — | 0.00 |

The funnel splits cleanly in two: Hebrew-language runs (L1–L4) convert well;
runs depending on US/international academic hosts (L5, L7) collapse at
**acquisition**, before extraction or verification is even reached.

## 5. Terminal loss reasons, per source

**L1** — Van Leer *הפוליטיקה של הסבירות* `NOT_ACQUIRED` (http_failed); gov.il
5658/23 blob `NOT_ACQUIRED`; HUJI *תמורה גדולה* (77k chars)
`READ_NO_QUOTE_REQUESTED`; IDI *פסק דין הסבירות* (4 windows served)
`WINDOW_SERVED_NOT_MEMOED`.

**L2** — none. 4 discovered → 4 acquired → 4 verified → 4 cited.

**L3** — Wikipedia דפי זהב `READ_NO_QUOTE_REQUESTED`; toledano 5658/23,
wikisource Basic Law, TAU Law Review (144k chars, 3 windows), Wikipedia לשכת
מנהלי ההשקעות — all `WINDOW_SERVED_NOT_MEMOED`.

**L4** — barelaw קלמר `NOT_ACQUIRED`; Reichman *על אמון כתיאוריית־על* acquires
via `getfile.ashx` but extracts to zero chars → `UNUSABLE_EXTRACTION`; Wikipedia
קלמר, HUJI LibGuide `READ_NO_QUOTE_REQUESTED`; Wikipedia אדרס, HUJI *תום לב
בחוזים ואשם* (5 windows), Wikipedia רוקר `WINDOW_SERVED_NOT_MEMOED`.

**L5** — SSRN `papers.ssrn.com` `NOT_ACQUIRED`; Yale Law Journal
*The Agency Costs of Agency Capitalism* `NOT_ACQUIRED`; gov.il Companies Law
`NOT_ACQUIRED`; ECGI SSRN-mirror PDF `NOT_ACQUIRED`; OECD report `NOT_ACQUIRED`;
Nevo Companies Law page `UNUSABLE_EXTRACTION` (empty); Nevo Income Tax Ordinance
(200k chars, 13 windows) `WINDOW_SERVED_NOT_MEMOED`; NBER w11883 → VERIFIED,
cited.

**L6** — no academic sources discovered at all (0 academic searches); the two
acquired sources (toledano.co.il case summaries for בג"ץ 5555/18 and
בג"ץ 5658/23) both verified and cited.

**L7** — Justia (×2), CourtListener docket, CourtListener API search, Google
Scholar case page, Vanderbilt `viewcontent.cgi`, Notre Dame `viewcontent.cgi`,
UC Davis *47-5 Collins* PDF, SSRN — **all `NOT_ACQUIRED` (http_failed)**;
CourtListener Solid Oak docket (31k chars) and OpenAlex API (200k chars)
`WINDOW_SERVED_NOT_MEMOED`; Crossref API search page and copyright.gov Circular
1 → VERIFIED, cited.

**L8** — BAILII Coughlan and Bancoult both acquired but extracted only 1,439
chars → `UNUSABLE_EXTRACTION`; europeanlawblog, Parliament `banc-1`, UKSC
`uksc-2008-0023-judgment.pdf` `NOT_ACQUIRED`; gov.il court decision
`WINDOW_SERVED_NOT_MEMOED`; Cardozo `sai tex` `READ_NO_QUOTE_REQUESTED`;
Wikipedia *Legitimate expectation* → VERIFIED, cited.

**N1** — `main.knesset.gov.il` statute page `UNUSABLE_EXTRACTION` (empty);
Wikisource חוק החוזים `NOT_ACQUIRED`; HUJI journal article and one more academic
source served quotes but were `WINDOW_SERVED_NOT_MEMOED` (correctly — they are
not on point for a narrow statutory question). Net: 0 verified claims, 0
footnotes.

**N2** — רע"א 3365/20 (toledano) → VERIFIED, cited, 3 footnotes with Rule 37
repeat. Clean.

## 6. Before / after per run

### L3 — the clearest baseline failure
Baseline 9 read → 2 usable → 2 cited. After: 9 read → **4 verified and cited**,
6 verified claims (baseline 4), span_yield 1.00 (baseline lost Weill and
Barak-Erez at span).

### L4 — the weakest baseline run
Baseline 8 fetched / 5 read → 2 cited, two `runi.ac.il` fetch failures and a
malformed Knesset URL. After: 10 fetched / 8 read, **academic_acquired 7/7**,
3 cited, 6 footnotes. Residual: the Reichman file extracts to zero characters.

### L5 — English corporate scholarship
Baseline partial: Bebchuk & Kastiel and Reichman were acquired. This run:
**0 of the English-language journal/working-paper sources acquired** (SSRN ×2,
Yale LJ, OECD, ECGI all http_failed). The one verified source is NBER w11883
(Bebchuk–Kastiel-family empirical working paper) — but its footnote is
`pubdat, "C:\Working Papers\11883.wpd"` (PDF info fields), and the Companies Law
was never obtained. Answer: 725 chars with explicit limitations. **Worse than
the baseline partial on acquisition, though the one acquired source converted
perfectly (11 windows → memo → span → support → cited).**

### L6 — judicial review of Basic Laws
The agent ran **zero academic searches** for an explicitly academic-mapping
prompt and built the answer on two toledano.co.il case summaries (both verified,
correctly cited as judgments). Answer (1,612 chars) is accurate but is a
case-law summary, not a literature review — an agent selection outcome, not an
ingestion failure.

### L7 — repository acquisition, re-tested
The exact baseline failure reproduced: **0 of 4 academic sources acquired**
(Vanderbilt, Notre Dame `viewcontent.cgi`, UC Davis PDF, SSRN). `repository_pdf_followed`
was never emitted — these failed at the landing/PDF fetch itself. The cited
"scholarship" footnote is a **Crossref API search URL titled `works`** — a real
citation-quality defect. Answer honestly discloses the mapping-only limitation
(928 chars, central issue uncovered).

### L8 — comparative IL/UK
BAILII pages extract to 1,439 chars (cookie/frameset shell) → unusable; UKSC
PDF `unsupported_response`; Parliament page http_failed. Only Wikipedia survived
verification. The answer is explicit that the Israeli/comparative side could not
be sourced. Thin but honest; the losses are all acquisition/extraction, each
with an explicit terminal stage.

### L1, L2
L1: 6 read → 4 cited (baseline 3), two hard acquisition failures. L2: 4→4→4,
every ratio 1.00, behaviour preserved.

## 7. Span failure audit

`span_not_found` did not occur in **any** of the ten runs. Memoed → span →
support is 1.00 everywhere a source was memoed. The historical failure mode —
model sees cleaned text, verifier checks a different representation — did not
reproduce once, and the loss did not migrate to support verification. This is
the strongest result of the re-run.

The residual pre-verification loss is `WINDOW_SERVED_NOT_MEMOED` (agent judgment
on served windows) and, on this sample, outright acquisition failure.

## 8. Later-page continuation audit

`pdf_continuation_reads` was never emitted in any of the ten runs — including on
L3's 144k-char TAU Law Review PDF, L4's 81k-char HUJI article and L5's 200k-char
Nevo statute. The feature has zero observed exercise: it consumed no budget and
demonstrated no value. Untested, not regressed.

## 9. Repository resolution audit

`repository_pdf_followed` was never emitted in any run. The repository families
the feature targets appeared in L7 (Vanderbilt, Notre Dame, UC Davis, SSRN) and
**all failed at the underlying HTTP fetch**, before any landing-page → PDF
resolution could engage. Repository resolution therefore remains unproven in
production; the binding constraint is fetch-level blocking on these hosts
(403-class), not landing-page structure.

## 10. URL repair audit

`urls_repaired` was never emitted. The malformed `fs.knesset.gov.il/\7\law\...`
URL from baseline L4 did not reappear (L3 acquired the Knesset Basic Law cleanly
from `main.knesset.gov.il/.../yesod3.pdf`). The repair path is unproven in
production but the specific defect is absent.

## 11. Bibliographic identity acceptance

| | L1 | L2 | L3 | L4 | L5 | L7 |
|---|---|---|---|---|---|---|
| bibliographic_sources_with_metadata | 5 | 4 | 2 | 7 | 1 | 0 |
| bibliographic_sources_with_authors | 1 | 0 | 2 | 2 | 1 | 1 |
| bibliographic_citations_rendered | 2 | 5 | 5 | 6 | 2 | 2 |

Author coverage remains thin (0–2 per run). Where metadata exists, footnotes now
carry quoted titles and years — a real improvement over baseline artifacts like
`MISHPATIM 51 2022`, which did not recur.

**But three user-visible defective citations appeared, all tracing to embedded
PDF info fields outranking better metadata:**

1. L3 fn 1 — `ארבל אסטרחן, "<E7E5F7E920E9F1E5E320ECE0FAF820E4EBF0F1FA2E706466>"
   (2020)` — a cp1255 mojibake title and a **false author attribution** on
   Basic Law: Human Dignity and Liberty.
2. L3 fn 3 — author `רונית` (truncated first name) with a body sentence as the
   article title.
3. L5 fn 1 — `pubdat, "C:\Working Papers\11883.wpd"` for an NBER working paper —
   the PDF's `Author`/`Title` fields rendered verbatim.
4. L4 fn 2 — correct author (Nili Cohen) but an English metadata title that does
   not match the published Hebrew article.

## 12. Raw-URL and garbled-title audits

**Raw URL:** unchanged from baseline — every footnote still prints a full
percent-encoded URL inside the visible citation text (e.g. L2 fn 1, a title
followed by ~140 characters of `lawjournal.huji.ac.il/...pdf`). Zero exceptions.

**Garbled titles:** the baseline shouting-extraction artifacts are gone, but L7
fn 2 introduces a new low: a Crossref **API search endpoint** cited as
`works https://api.crossref.org/works?query.title=copyright%20tattoos...` —
neither a document nor a title.

## 13. Scholarly attribution, synthesis, drafter utilization

**Attribution** tracks metadata availability: L1 names זמיר and דותן in
opposition; L2 names שטיין, נגבי, ברוורמן; L3/L4 name זמיר, שלו, ברק. L5
correctly refrains from attributing positions it could not verify. Anonymous
phrasing persists where author metadata is missing — which is often.

**Synthesis** is intact: disagreement mapping, doctrinal frames and comparative
structure all survive the projection with zero dropped refs in every run.

**Drafter utilization is 100% in every run with a non-empty pack.** No run
delivered rich verified material that the drafter mishandled.
**A drafter model change remains NOT JUSTIFIED.**

## 14. Narrow controls

| | baseline | this round |
|---|---|---|
| N1 | 32 s, 1 source, direct answer | **84 s, 24 steps, 0 verified claims, 0 footnotes, central issue uncovered** |
| N2 | 47 s, 1 source, direct answer | 100 s, 1 source, 4 verified claims, 3 footnotes (Rule 37 repeat present) |

**N1 is a genuine regression on this sample.** The cause is acquisition, not
depth drift: `main.knesset.gov.il` returned a page whose statute body extracted
empty, Wikisource failed at fetch, and the agent (correctly) declined to build
claims on the two off-point academic sources it had also fetched. No gratuitous
academic expansion occurred in N2; N1's 2 academic fetches were wasted budget
but did not distort the answer. Still, the user-visible result for the simplest
possible question — "what does s.12 say" — was an empty answer, where the
baseline answered directly. This must be re-validated before any SHIP.

## 15. Reliability (reported separately from evidence yield)

- Product stalls: 2 of 10 runs (L1 at 193 s, L3 at 182 s) froze mid-chunk and
  needed one harness resume each. A real user cannot do this.
- Infrastructure aborts: 7 attempts (first session), all AI-gateway 402 "Not
  enough credits" — account-level, resolved by top-up; the pipeline failed
  closed every time.
- No abandoned runs, no timeouts, no invariant errors, no credit/refund
  anomalies in the ten completed runs.

## 16. Remaining failures

1. **Fetch-level blocking on external academic/official hosts** — SSRN,
   Yale LJ, UC Davis, Vanderbilt/Notre Dame repositories, OECD, ECGI, Justia,
   CourtListener, Google Scholar, UKSC, BAILII extraction shell. This single
   class accounts for the majority of academic loss in L5, L7 and L8, and for
   the N1 statute failure.
2. **Bibliographic merge over-trusts embedded PDF info fields**, producing two
   invented/wrong author-title citations (one a false author on a Basic Law) and
   one non-matching translated title. A confidently wrong citation is worse than
   a plain one.
3. **Raw URLs printed inside every visible footnote**, plus one Crossref API
   search URL cited as a source (`works`).
4. **N1 narrow-control regression** (empty answer to a simple statutory
   question) — acquisition-caused, but user-visible and must be re-validated.
5. `WINDOW_SERVED_NOT_MEMOED` remains the top *post-acquisition* loss stage
   (agent judgment), including large on-topic PDFs.
6. Two of ten runs stalled and needed a resume.
7. Continuation reads, repository following and URL repair were never invoked;
   all three remain unproven in production.

## 17. Product-readiness conclusion

On Hebrew-language material the fixes delivered: span-stage loss is eliminated
(not displaced), the two worst baseline runs roughly doubled their
verified-and-cited counts, every loss now has an explicit terminal cause, and
verification safety, provenance, temporal handling and Rule 37 are unchanged
and unweakened. Drafter utilization is 100%.

SHIP is blocked by three things: acquisition against the English-language
academic hosts that L5/L7/L8 depend on still fails wholesale; the bibliographic
layer, while broadly populated, emits demonstrably invented author/title
citations in a minority of footnotes; and the N1 narrow control produced an
empty answer on this sample. Recommended next steps, in order: egress/fetch
handling for the blocked academic hosts; demote `pdf_metadata` below
`html_meta`/`search_metadata` (especially for Hebrew documents) and suppress
obviously-invalid author values; re-validate N1.

---

V2 LITERATURE REVIEW — PARTIAL / REVIEW

AGENT-OWNED RESEARCH DEPTH: ACTIVE

VERIFIED RESEARCH SYNTHESIS HANDOFF: ACTIVE

ACADEMIC EVIDENCE YIELD FIX: ACTIVE

BIBLIOGRAPHIC IDENTITY: ACTIVE

DRAFTER MODEL CHANGE: NOT JUSTIFIED

PRIMARY REMAINING BOTTLENECK: fetch-level blocking on external academic and statute hosts, with bibliographic metadata that still trusts embedded PDF info fields over better sources
