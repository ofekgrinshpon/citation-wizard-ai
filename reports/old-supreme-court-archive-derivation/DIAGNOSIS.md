# old_supreme_court_archive_derivation_v1 — read-only diagnosis

No code changed. Evidence: production `qa_logs` telemetry
(`retrieval.canonical_authority_acquisition`, `retrieval.specific_case_resolution`),
`stages/courtFileUrls.ts`, and out-of-band probes from this sandbox.

## 0. Headline

**The failure is not "old dockets derive to the wrong path".** The derivation is correct —
the exact same derived path family produced a successful 6,000-char body for
בג"ץ 6821/93 בנק המזרחי in production on 2026-08-22, through the **`type=4` corpus
endpoint**. What the canonical lane probes is a 3-URL, text-endpoint-only slice
(`HebrewVerdicts …type=2` ×2 + the `elyon1 .htm` mirror), and for these dockets **all three
of those endpoints serve a short non-judgment body**. The lane therefore never reaches the
one URL that is known to work.

Root cause = **wrong endpoint subset probed (text-first cap), plus an unrecognised
block/stub page on the text endpoints** — not path derivation, not fileName derivation,
not a missing archive record.

## 1. Per-authority ledger

All rows from `canonical_authority_acquisition.attempts` (D1–D5 runs, 2026-08-23) unless
marked. Derivation for every docket is well-formed; `endpoint_type` is `html` for all
attempts because only text endpoints are in the probe set.

| authority | docket | prefix | year | derived URLs probed | endpoint types | body chars | result | ms |
|---|---|---|---|---|---|---|---|---|
| בנק המזרחי | 6821/93 | בג"ץ | 1993 | `…fileName=93068210_Z01.txt&path=HebrewVerdicts/93/210/068/Z01&type=2`; `…93068210.z01&path=…/z01&type=2`; `elyon1/files/93/210/068/z01/93068210.z01.htm` | text ×3 | 0 | `plain_text_below_threshold` | 700–905 |
| לשכת מנהלי ההשקעות | 1715/97 | בג"ץ | 1997 | same shape, id `97017150`, seg `97/150/017` | text ×3 | 0 | `plain_text_below_threshold` | 1077 |
| דפי זהב | 389/80 | בג"ץ | 1980 | id `80003890`, seg `80/890/003` | text ×3 | 0 | `plain_text_below_threshold` | ~900 |
| גנור | 935/89 | בג"ץ | 1989 | id `89009350`, seg `89/350/009` | text ×3 | 0 | `plain_text_below_threshold` | ~900 |
| בבלי | 1000/92 | בג"ץ | 1992 | id `92010000`, seg `92/000/010` | text ×3 | 0 | `plain_text_below_threshold` | ~1000 |
| פנידר | ד"נ 7/81 | ד"נ | 1981 | id `81000070`, seg `81/070/000` (derivable) | not attempted — authority not registry-seeded in D-set | – | no attempt | – |
| קל בנין | ע"א 6370/00 | ע"א | 2000 | id `00063700`, seg `00/700/063` | not attempted (no seed) | – | no attempt | – |
| קיבוץ משמר העמק | ע"א 4263/04 | ע"א | 2004 | id `04042630`, seg `04/630/042` | not attempted (no seed) | – | no attempt | – |
| עטר | ע"א 2773/04 | ע"א | 2004 | id `04027730`, seg `04/730/027` | not attempted (no seed) | – | no attempt | – |
| **control R02 — בנק המזרחי** | 6821/93 | בג"ץ | 1993 | 4 URLs incl. **`…93068210_Z01.txt&path=EnglishVerdicts/93/210/068/Z01&type=4`** | text ×3 + **binary ×1** | **6000** | **success**, `court_url_derivation`, `derived_url_resolved` = the `type=4` URL | – |
| control — ע"א 2232/03 | 2232/03 | ע"א | 2003 | 4 URLs incl. `type=4` | text+binary | 6000 | success via `local_db_docket_lookup` (probes did not resolve) | – |

Telemetry does not currently record HTTP status, content-type or raw byte length per probe —
only `body_chars` after extraction and a rejection reason. **That is a diagnosis gap worth
closing in whatever fix lands** (see §5).

### Error-page signature
Out-of-band probes from this sandbox to both hosts return, for *every* docket including the
2003 control, an HTTP 200 `text/html; charset=utf-8` body of exactly **1,878 bytes** whose
title is `חסימת בקשה לא מורשת` ("blocked unauthorised request") — a WAF interstitial, not a
404. `supremedecisions.court.gov.il` additionally resets the connection for this sandbox's
egress, so sandbox results cannot be used to score production reachability; they only
establish the **signature**: a short HTML block page that survives as ~100 chars of text and
lands as `plain_text_below_threshold`. Production `body_chars: 0` on all five authorities is
consistent with either that block page or an empty/stub text response.

## 2. Old vs. new archive formats

- **Path/fileName conventions are identical across eras.** Working production URLs recorded
  in past runs span 1980 → 2010 dockets with one shape:
  `Home/Download?fileName=<yy><serial5><suffix>[_<DOC>.txt|.<doc>]&path=<Corpus>/<yy>/<b>/<a>/<DOC>&type=<n>`.
  No era-specific bucket, casing rule, or folder convention appears anywhere in the corpus of
  observed URLs.
- **The discriminating parameter is `type`, not the year.** `type=2` = Hebrew plain-text
  corpus; `type=4` = the corpus that actually served the body in every successful derived
  acquisition observed (`93068210 …EnglishVerdicts…type=4`, plus `…type=4` hits on 01/02/04/05/07
  dockets in retrieval logs). `type=2` derived URLs have **never** produced a usable body in
  any logged run, old or new.
- **Document-code variance is real but secondary**: observed doc codes include `Z01/z01`,
  `A11`, `A22`, `A28`, `A59`, `T09`, `N06`, `O30`, `B05`, `Y01`, `V08`. Derivation only ever tries
  `Z01`/`z01` (suffix 0/1). For judgments whose file is not `Z01` this is a genuine second-order
  miss, but it is not what is failing here — R02 proves `Z01` is right for 6821/93.
- **Old judgments are present in the archive.** Nothing in the evidence supports "not stored"
  or "search-only discovery required" for these dockets.

## 3. Failure classification

| candidate cause | verdict |
|---|---|
| wrong path derivation | **ruled out** — same path succeeded for 6821/93 via `type=4` |
| wrong fileName derivation | **ruled out** for these dockets (same fileName in the successful run) |
| missing `type` parameter | **this is it** — the `type=4` variant is derived by `deriveSupremeCourtFileUrls` but is sorted after the text URLs and cut off by the canonical lane's 3-URL cap |
| archive lacks the old judgment | ruled out |
| endpoint requires search first | ruled out |
| production network/access issue | **contributing** — the `type=2` / `elyon1` endpoints return a short block/stub body rather than text; unrecognised as a block, it is reported as `plain_text_below_threshold` |
| unknown | – |

Restated: `canonical_judgment_text_acquisition_v1` inherited `maxUrls: 3` + text-first
ordering from the CPU-safety work. For Supreme Court dockets the text-first slice is exactly
the set of endpoints that do not serve bodies, so the lane is structurally guaranteed to
fail — for **all** dockets, not just old ones. The D-set happened to be old.

## 4. Candidate fixes

| option | recall gain | impl risk | maintenance | CPU/runtime risk | integrity risk |
|---|---|---|---|---|---|
| **A. fix derivation/ordering for the canonical lane** — allow the already-derived `type=4` URL as a last probe, behind the existing PDF preflight + byte cap + extraction ledger; add block-page detection | **high** — directly restores the only endpoint proven to work; R02 is the existence proof | **low** — no new code paths, one cap and one ordering rule | none | **bounded** — preflight already refuses oversized bodies; ≤1 binary probe per authority, ≤2 authorities/run | low — docket still validated inside the body |
| B. search archive by docket/name, then use returned URL | medium | medium-high (no stable search API; listing pages) | ongoing | medium | medium (listing pages masquerading as judgments) |
| C. tiny official-URL override table for registry authorities | medium (only the ~12 seeded) | very low | **real** — hand-maintained, silently rots | none | low |
| D. reputable-mirror fallback after official failure | medium-high | medium | medium | medium | **high** — paywalled/edited text presented as official |
| E. offline corpus enrichment | high, permanent | high | high | none at runtime | low |

## 5. Recommended minimal v1 — option A only

`canonical_acquisition_binary_endpoint_v1` (or folded into the open track):

1. **Raise the canonical lane's per-docket probe budget from 3 to 4** and let the last slot be
   the already-derived `type=4` corpus URL. Ordering stays text-first; the binary URL is only
   reached after every text endpoint has failed.
2. **Route that probe through the existing `pdfExtractionPreflight` + `retrievalBudget`
   ledger unchanged** — HEAD/range size check, hard byte cap, one speculative extraction per
   run, abort on budget. No change to PDF extraction limits.
3. **Add block-page/stub detection**: an HTML body under ~4 KB containing
   `חסימת בקשה לא מורשת` (or lacking any docket token) is classified
   `blocked_by_origin` / `stub_page`, not `plain_text_below_threshold`, and does not consume
   the extraction budget.
4. **Record per-probe HTTP status, content-type and raw byte length** in the attempt rows.
   Today the ledger cannot distinguish "blocked", "404", and "served an empty file".
5. Everything else unchanged: official court hosts only, no crawling, no mirrors, no search
   discovery, docket validated inside the downloaded body before injection, ≤2 seeded
   authorities per run, gates and caps untouched.

Deliberately out of scope: doc-code enumeration beyond `Z01/z01`, options B–E.

## 6. Acceptance criteria

Validation set D1–D6 + controls R02, P02, B8, NOISE, run sequentially.

1. **Recall** — ≥3 of {מזרחי, לשכת מנהלי ההשקעות, דפי זהב, גנור, בבלי} reach
   `body_acquired: true` with `body_identity_validated: true`.
2. **No false bodies** — zero injected candidates whose body fails docket validation; zero
   block/stub pages counted as bodies (`blocked_by_origin` visible in telemetry where it occurs).
3. **Stability** — every run terminal; zero CPU kills; zero dangling footnote markers; zero
   orphan source rows.
4. **Runtime** — median delta ≤ +20 s vs. the 2026-08-23 D-set baseline (101–141 s); no single
   authority attempt above 8 s.
5. **Controls unchanged** — R02 still resolves an exact body; P02 still refuses; B8 still
   returns the canonical quote; NOISE still seeds nothing.
6. **Footnote integrity** — no footnote rests on a source without an acquired body
   (`citations_without_body_acquired` = 0 on the D-set).

## 7. Track status

Keep `canonical_judgment_text_acquisition_v1` **open, not accepted**, and treat this as a
**subtrack inside it** rather than a new track: the lane, caps, guardrails and telemetry it
shipped are correct and validated; only the endpoint subset it probes is wrong. Closing the
parent track before the binary-endpoint fix would freeze a lane that can never succeed.
