# V2 Literature Review Acceptance #2

Re-run of the Literature Review Acceptance matrix after the deployed
**Academic Evidence Yield + Bibliographic Identity** track.

**No product code was changed in this task.** Prompts, agent logic, extraction,
metadata parsing, drafter, verifier, renderer, budgets, scopes and synthesis are
exactly as deployed. The only file added is a harness reader
(`scripts/litrev2-extract.py`), which reads saved run JSON and touches nothing
in the pipeline.

## 1. Executive summary

The matrix could **not be completed**. Runs were launched strictly sequentially
with the same driver and the same ten prompts. Four broad runs (L1–L4) completed
normally. L5 aborted mid-run and L6, L7, L8, N1 and N2 aborted after one agent
step, all with the identical infrastructure error:

```
agent_model_error_402 {"status":402,"type":"payment_required","title":"Not enough credits"}
```

The AI workspace ran out of model credits at ~04:22 UTC, after L1–L4 had
consumed roughly 1.17M prompt tokens. This is an account/billing limit, **not a
product defect**, and it is not folded into any product finding below. L5–N2
must be re-run once credits are topped up before a SHIP verdict can be reached.

On the four runs that did complete, the deployed fixes are clearly visible:

- **Evidence conversion improved materially on exactly the runs that were weakest
  in the baseline.** L3 went from 9 read → 2 usable/2 cited to 9 read → 4
  verified and cited. L4 went from 8 fetched / 5 read → 2 cited to 10 fetched /
  8 read → 3 cited, with **7 of 7 academic sources acquired** where the baseline
  lost two outright at fetch (`runi.ac.il/getfile.ashx`).
- **Losses are now explicitly attributed.** Every non-contributing source carries
  a terminal stage: `NOT_ACQUIRED`, `UNUSABLE_EXTRACTION`,
  `READ_NO_QUOTE_REQUESTED`, `WINDOW_SERVED_NOT_MEMOED`. Nothing disappears
  unexplained. The vague "read but unusable" bucket is gone.
- **The span stage stopped being the bottleneck.** Across L1–L4 the span yield
  (memoed → span-verified) is **1.00 in every run**, and support yield is also
  1.00. The canonical-text change did what it was meant to do: no source was
  lost between "the model quoted it" and "the verifier checked it", and the loss
  did **not** migrate to support verification.
- **The remaining loss moved upstream, to agent selection.** The dominant
  terminal stage is now `WINDOW_SERVED_NOT_MEMOED` — quote windows were served
  and the research agent chose not to memo them. That is a judgment step, not a
  pipeline failure.
- **Bibliographic identity is now present but not yet trustworthy.** Metadata
  attaches to most academic sources (L4: 7/7, L2: 4/4) and footnotes now carry
  quoted titles and years. But author extraction produced two visibly wrong
  citations in L3 and one mistranslated title in L4, and raw URLs are still
  printed inside every footnote.

Verdict: **PARTIAL / REVIEW** (section 14).

## 2. Prompts and run IDs

Prompts are byte-identical to the baseline harness (`scripts/v2-litreview-acceptance.ts`,
unchanged). No prompt was rewritten and no new prompt was introduced.

| ID | Topic | run_id | Status | Latency | Chunks | Resumes |
|---|---|---|---|---|---|---|
| L1 | reasonableness lit review | 7f38e71a-dad6-49df-8f6e-8205986078eb | done | 382 s | 3 | 1 |
| L2 | administrative promise disagreement | 19fb9ba2-bca7-421a-ba38-8ed40df479b2 | done | 179 s | 3 | 0 |
| L3 | reasonableness vs proportionality | 7047ee5d-d1b5-4245-8eca-3e96fa0c5e5a | done | 399 s | 2 | 1 |
| L4 | good faith in contract | dfad9c04-c03c-481b-a81a-a57399e3ece8 | done | 196 s | 3 | 0 |
| L5 | controlling-shareholder conflicts | ff13989d-50d9-43de-b20b-762b3a1eb612 | **aborted — model credits 402** | 128 s | 3 | 0 |
| L6 | judicial review of Basic Laws | 9217259d-807e-465a-90e2-56bcf13670f4 | **aborted — 402 at step 1** | 0.1 s | 1 | 0 |
| L7 | tattoo copyright in video games | 39b7e84e-b23d-4d58-8364-273d769a49b1 | **aborted — 402 at step 1** | 0.07 s | 1 | 0 |
| L8 | IL/UK legitimate expectations | b6ad2081-8d75-4522-9635-b77e68dd905d | **aborted — 402 at step 1** | 0.13 s | 1 | 0 |
| N1 | s.12 Contracts Law | 4a098eb2-1f9c-4bf0-8a1c-a377fce1c8ab | **aborted — 402 at step 1** | 0.13 s | 1 | 0 |
| N2 | רע"א 3365/20 | 368d651b-00d4-4b9a-abe4-38ba1e2febf2 | **aborted — 402 at step 1** | 0.13 s | 1 | 0 |
| N1 (retry) | s.12 Contracts Law | 646c4c3a-8069-42b4-9061-dfbd681e703c | **aborted — 402, confirms persistence** | — | 1 | 0 |

A single retry was issued to confirm the 402 was persistent rather than
transient. It was. No further attempts were made.

## 3. Run telemetry (completed runs)

| ID | Steps | acad/web/off/corpus | raw-web | fetch | read | Verified claims | Unsup. | Src avail→cited | Footnotes | Answer chars | Prompt tok |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 | 21 | 3/1/2/0 | 0 | 8 | 6 | 6 | 0 | 4→4 | 3 | 1,247 | 273k |
| L2 | 21 | 6/1/0/0 | 0 | 4 | 4 | 5 | 0 | 4→4 | 5 | 1,629 | 308k |
| L3 | 22 | 3/1/1/0 | 2 | 9 | 9 | 6 | 0 | 4→4 | 5 | 1,321 | 320k |
| L4 | 20 | 6/1/0/1 | 2 | 10 | 8 | 6 | 0 | 3→3 | 6 | 1,561 | 271k |

Synthesis projection (memo sections/relationships/roles → verified
sections/relationships, refs dropped claim/source):
L1 3/2/4 → 3/2, 0/0 · L2 2/2/4 → 2/2, 0/0 · L3 2/2/4 → 2/2, 0/0 ·
L4 2/2/3 → 2/2, 0/0. **Zero projection loss in all four runs.**

## 4. Academic evidence funnel (new telemetry)

| | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| academic_discovered | 6 | 4 | 3 | 7 |
| academic_fetch_attempted | 6 | 4 | 3 | 7 |
| academic_acquired | 5 | 4 | 3 | 7 |
| academic_extracted_usable | 5 | 4 | 3 | 6 |
| academic_quotes_served | 4 | 4 | 3 | 5 |
| academic_sources_memoed | 3 | 4 | 2 | 3 |
| academic_sources_span_verified | 3 | 4 | 2 | 3 |
| academic_sources_support_verified | 3 | 4 | 2 | 3 |
| academic_sources_final_pack | 3 | 4 | 2 | 3 |

Ratios:

| | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| acquisition_yield | 0.83 | 1.00 | 1.00 | 1.00 |
| extraction_yield | 1.00 | 1.00 | 1.00 | 0.86 |
| quote_yield | 0.80 | 1.00 | 1.00 | 0.83 |
| **span_yield** | **1.00** | **1.00** | **1.00** | **1.00** |
| **support_yield** | **1.00** | **1.00** | **1.00** | **1.00** |
| read_to_verified_source_yield | 0.60 | 1.00 | 0.67 | 0.50 |

## 5. Terminal loss reasons, per source

Every source that did not reach the verified pack, with its explicit cause:

**L1** — S2 Van Leer *הפוליטיקה של הסבירות* `NOT_ACQUIRED` (http_failed);
S5 gov.il 5658/23 blob `NOT_ACQUIRED` (http_failed); S4 HUJI *תמורה גדולה*
(77k chars, usable) `READ_NO_QUOTE_REQUESTED`; S7 IDI *פסק דין הסבירות: עיונים
ראשונים* (34k chars, 4 quote windows served) `WINDOW_SERVED_NOT_MEMOED`.

**L2** — none. 4 discovered → 4 acquired → 4 verified → 4 cited.

**L3** — S2 Wikipedia דפי זהב `READ_NO_QUOTE_REQUESTED`; S3 toledano 5658/23,
S5 wikisource Basic Law, S6 TAU Law Review (144k chars, 3 windows served),
S8 Wikipedia לשכת מנהלי ההשקעות — all `WINDOW_SERVED_NOT_MEMOED`.

**L4** — S3 barelaw קלמר `NOT_ACQUIRED` (http_failed); S6 Reichman
*על אמון כתיאוריית־על* — HTTP **succeeded** via `getfile.ashx` but body extracted
empty → `UNUSABLE_EXTRACTION`; S4 Wikipedia קלמר and S9 HUJI LibGuide
`READ_NO_QUOTE_REQUESTED`; S2 Wikipedia אדרס, S5 HUJI *תום לב בחוזים ואשם*
(81k chars, 5 windows served), S10 Wikipedia רוקר `WINDOW_SERVED_NOT_MEMOED`.

No source in any run is unaccounted for.

## 6. Before / after per run

### L3 — the clearest baseline failure
Baseline: 9 read → 2 usable → 2 cited, 3 footnotes; the review rested on a single
scholar plus one judgment. Weill (Reichman) and Barak-Erez were **lost at span**.
After: 9 read → **4 verified and cited** (Haifa *מידתיות חוקתית, סבירות מנהלית*;
IDI *מדוע נדרשת עילת הסבירות*; בג"ץ 1715/97 from the official
`supremedecisions.court.gov.il` download; Knesset Basic Law PDF), 5 footnotes,
6 verified claims (baseline 4). **No span loss at all** — span_yield 1.00. The
remaining four non-contributors are agent memo choices, not span failures.

### L4 — the weakest baseline run
Baseline: 8 fetched, 5 read → 2 usable; **two `runi.ac.il/getfile.ashx` fetches
failed outright** and the Knesset statute URL was malformed
(`https://fs.knesset.gov.il/\7\law\...`). After: 10 fetched, 8 read,
**academic_acquired 7/7 — the Reichman `getfile.ashx` handler now acquires** —
3 verified and cited, 6 footnotes, 6 verified claims (baseline 5). One residual:
the Reichman file downloads but extracts to **zero characters**
(`UNUSABLE_EXTRACTION`), so acquisition was fixed and extraction was not. No
malformed Knesset URL appeared in this run.

### L1
Baseline 8 read → 3 usable → 3 cited. After 6 read → 3 academic verified plus
the 5658/23 judgment = **4 cited** (baseline 3), 6 verified claims (baseline 6).
Two hard acquisition failures (Van Leer WooCommerce-protected PDF, gov.il blob).

### L2
Baseline 5 read → 5 verified → 5 cited (already clean). After 4 read → 4 → 4,
every ratio 1.00. Behaviour preserved; the run found one fewer source.

### L5, L7, L8 — not measurable
L5 aborted before memo formation, so its zero verified claims are a **credit
abort, not an evidence-yield result** and must not be read as a regression. Its
partial funnel is still informative: Bebchuk & Kastiel (Iowa JCL) and Reichman
*levi.pdf* — both read-without-span in the baseline — were acquired, extracted
usable, and **served 10 and 3 quote windows respectively** before the run died.
That is the conversion path opening up, but it is not a completed measurement.
L7 (Marquette / Minnesota / W&L repository families) and L8 (English/Hebrew
comparative losses) produced no data at all. The repository-resolution audit,
the English-scholarship audit and the narrow-control audit are therefore
**deferred**.

## 7. Span failure audit

`span_not_found` did not occur in any completed run. Memoed → span-verified is
1.00 across L1–L4, and span-verified → support-verified is also 1.00. The
historical failure mode — model sees cleaned text, verifier checks a different
representation — **did not reproduce once**, and the loss did **not** migrate to
the support stage. This is the strongest single result of the re-run.

The loss that remains sits one stage earlier: 6 sources across L1/L3/L4 had quote
windows served and were never memoed. That is the research agent deciding the
window was not worth a claim, which is legitimate behaviour, but it is now the
top yield-limiting stage and the natural target of the next track.

## 8. Later-page continuation audit

`pdf_continuation_reads` was **not emitted in any completed run** (absent/null),
including on L3's 144k-char TAU Law Review PDF and L4's 81k-char HUJI article.
The feature therefore has **zero observed exercise** in this matrix and is
unproven — it consumed no budget, but it also demonstrated no value. Not a
regression; simply untested by these four questions.

## 9. Repository resolution audit

`repository_pdf_followed` was **not emitted in any completed run**. All acquired
academic sources in L1–L4 were direct PDF or HTML URLs, not repository landing
pages. The families the feature targets (Marquette, Minnesota Law Review,
W&L Scholarly Commons) appear only in L7, which did not run. **Audit deferred.**

The one adjacent data point is positive: `runi.ac.il/yedion/.../getfile.ashx`,
which failed twice at fetch in the baseline, now returns a body (L4 S6) — the
gap there is extraction, not acquisition.

## 10. URL repair audit

`urls_repaired` was **not emitted in any completed run**. The malformed
`https://fs.knesset.gov.il/\7\law\...` URL from baseline L4 **did not reappear**;
L3 instead acquired the Knesset Basic Law cleanly from
`main.knesset.gov.il/Activity/Legislation/Documents/yesod3.pdf`. So the specific
defect is absent, but the repair path itself was never invoked and remains
unproven in production.

## 11. Bibliographic identity acceptance

| | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| bibliographic_sources_with_metadata | 5 | 4 | 2 | 7 |
| bibliographic_sources_with_authors | 1 | 0 | 2 | 2 |
| bibliographic_citations_rendered | 2 | 5 | 5 | 6 |

Metadata coverage is broad; **author coverage is thin (0–2 per run)** and, where
present, sometimes wrong. Bases observed: `pdf_metadata`, `search_metadata`,
`html_meta`.

### Actual footnotes — before / after

Baseline L1:
```
MISHPATIM 51 2022 https://...
```
Now L1 fn 1–2:
```
"עילת אי־הסבירות במשפט המינהלי" (2012) https://www.runi.ac.il/media/hfaja1so/zamir.pdf
"שני מושגים של ריסון – וסבירות" (2020) https://lawjournal.huji.ac.il/...
```
Quoted title + year is a real improvement over a shouting extraction artifact,
and the garbled `MISHPATIM 51 2022` / `[PDF] : נהליות מ טית...` titles from the
baseline did **not** recur in L1/L2/L4.

L2 fn 3–4:
```
"היקף הביקורת השיפוטית על שינוי מדיניות עקבית של רשויות המנהל" (2020) https://www.runi.ac.il/media/0ocekxxk/braverman.pdf
"The Doctrine of Legitimate Expectations and the Distinction ..." (2005) https://www.tau.ac.il/law/barakerez/articals/legitimate.pdf
```

**Three defective citations, all user-visible:**

1. L3 fn 1 — a mojibake title *and* an author who did not write the source:
   ```
   ארבל אסטרחן, "<E7E5F7E920E9F1E5E320ECE0FAF820E4EBF0F1FA2E706466>" (2020), סעיף 8
   ```
   The PDF's embedded `Author`/`Title` info fields (a Knesset legal adviser and a
   cp1255-encoded filename) were rendered verbatim as the citation of *Basic Law:
   Human Dignity and Liberty*. The old title-plus-URL form was less wrong.
2. L3 fn 3 — author `רונית` (a truncated first name) with a **sentence lifted
   from the body** used as the article title.
3. L4 fn 2 — `Nili Cohen, "Judge Ben-Porat's Contribution to the Principle of
   Good Faith in Negotiations" (2012)` for a Hebrew article whose real title is
   *תרומתה של השופטת בן-פורת לעיצובו של תום הלב במשא ומתן*. The author is right;
   the English title comes from the PDF's metadata and does not match the
   document as published.

## 12. Raw-URL and garbled-title audits

**Raw URL:** every academic footnote in every completed run still ends with a
full percent-encoded URL inside the visible citation text — e.g. L2 fn 1 is a
title followed by a 140-character `lawjournal.huji.ac.il/...%D7%94...pdf` string.
Zero exceptions. The baseline defect is **unchanged**.

**Garbled titles:** the specific baseline artifacts (`MISHPATIM 51 2022`,
`BODILY AUTONOMY AND TATTOO COPYRIGHT IN`) did not appear in L1/L2/L4, and L2's
four titles are clean. But L3 replaced them with a **worse** class: a raw
cp1255 hex blob and a body sentence, both sourced from PDF info fields that
outranked the perfectly good search/HTML title. The merge priority is over-
trusting `pdf_metadata` for Hebrew documents.

## 13. Scholarly attribution, synthesis and drafter utilization

**Attribution.** L1 names יצחק זמיר and יואב דותן and sets their positions
against each other. L2 names אלכס שטיין, משה נגבי and יונתן ברוורמן. L3 names
יצחק זמיר as the opposing view. L4 names גבריאלה שלו, אלון and ברק. Anonymous
phrasing ("בספרות המחקרית מוסבר", "מאמר אקדמי מציג עמדה") appears in L3, where
`bibliographic_sources_with_authors` is 2 of 3 and one of those two is the bogus
`רונית`. So attribution still tracks metadata availability, and the metadata
layer is not yet reliable enough to lift it further.

**Synthesis.** All four answers map disagreement rather than listing sources:
L1 policy-vs-theory (זמיר) against two-modes-of-restraint (דותן); L2 three
doctrinal frames plus the procedural-vs-substantive protection axis; L3 the
constitutional/administrative split and the import objection; L4 freedom of
contract against expansive good faith, with the בית יולס illustration.
Projection loss is zero in all four.

**Drafter utilization: 4→4, 4→4, 4→4, 3→3 — 100% in every completed run.**
Every surviving synthesis relationship is visible in the prose. There is no run
in which rich verified material reached the drafter and came out worse.
**A drafter model change remains NOT JUSTIFIED.**

## 14. Reliability (reported separately from evidence yield)

- Product stalls: **2 of 4 completed runs** (L1 at 193 s, L3 at 182 s) froze
  mid-chunk and required one harness resume each — a real user cannot do this.
  Baseline was 1 stalling run out of 8 broad runs; this re-run is worse, on a
  smaller sample.
- Abandoned runs: 0.
- Infrastructure aborts: **6 runs (L5–N2) plus 1 retry**, all HTTP 402 "Not
  enough credits" from the model gateway. Not a pipeline defect; the pipeline
  failed closed, wrote no fabricated answer, and recorded the error cleanly.
- No timeouts, no invariant errors, no credit/refund anomalies in L1–L4.

## 15. Remaining failures

1. Model credits exhausted → **60% of the acceptance matrix unmeasured**
   (L5–L8, N1, N2). Narrow-control behaviour, repository resolution, English
   scholarship and the L5/L7/L8 comparisons are all unverified this round.
2. Bibliographic merge over-trusts embedded PDF info for Hebrew documents,
   producing one mojibake title, one body-sentence title and one non-matching
   English title — and, worse, one **false author attribution** on a statute.
3. Raw URLs still printed inside every visible academic citation.
4. `WINDOW_SERVED_NOT_MEMOED` is the new dominant loss stage (6 sources across
   L1/L3/L4), including two very large, clearly on-topic academic PDFs.
5. Two of four long runs stalled and needed a resume.
6. Continuation reads, repository following and URL repair were never invoked;
   all three remain unproven in production.

## 16. Product-readiness conclusion

The engineering track did what it claimed on the half of the matrix that ran.
Span-stage loss — the primary bottleneck named in the baseline report — is gone,
not displaced: span and support yields are both 1.00, and the two worst baseline
runs (L3, L4) both roughly doubled their verified-and-cited source counts. Loss
diagnosability is now complete. Verification safety, provenance, temporal
handling and Rule 37 are unchanged and unweakened.

What blocks SHIP is not evidence conversion. It is that (a) six of ten prompts,
including both narrow controls and every English-scholarship run, could not be
executed, and (b) the new bibliographic layer, while broadly populated, emits
demonstrably wrong author/title citations in a minority of footnotes — and a
confidently wrong citation is worse for a law student than a plain one.
Recommended next step: top up model credits and re-run L5–N2 unchanged, and
demote `pdf_metadata` below `html_meta`/`search_metadata` for Hebrew documents.

---

V2 LITERATURE REVIEW — PARTIAL / REVIEW

AGENT-OWNED RESEARCH DEPTH: ACTIVE

VERIFIED RESEARCH SYNTHESIS HANDOFF: ACTIVE

ACADEMIC EVIDENCE YIELD FIX: ACTIVE

BIBLIOGRAPHIC IDENTITY: ACTIVE

DRAFTER MODEL CHANGE: NOT JUSTIFIED

PRIMARY REMAINING BOTTLENECK: served quote windows the agent never memoes, plus a bibliographic merge that trusts Hebrew PDF info fields over better metadata
