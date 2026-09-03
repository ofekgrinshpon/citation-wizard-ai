# local_caselaw_suppression_sample_audit_v1 — read-only

No code changed. Evidence: `discovery_listing_suppressed` drops with `origin=local_db`,
`source_type=caselaw` from all runs of the last 3 days (AW4 / AW9 / AW7 and their
reruns): **3,448 drop events → 534 distinct candidates**, all of which joined 1:1 to
`legal_documents` rows. Corpus-wide control: all 4,481 caselaw rows whose
`source_url` is a gov.il collector URL. No external fetches; stored title/body/
metadata only.

## 1. Sample classification (n = 534 distinct suppressed local_db caselaw candidates)

| label | n | % |
|---|---|---|
| substantive_judgment_body | 524 | 98.1% |
| partial_judgment_body | 10 | 1.9% |
| listing_or_index_body | 0 | 0% |
| metadata_only | 0 | 0% |
| too_short | 0 | 0% |
| unclear | 0 | 0% |

Body length: p10 7,007 · median 26,216 · p90 82,162 · max 746,644 chars.
Only 1 of 534 is under 1,500 chars; 7 under 3,000.
529/534 carry a `case_number`; 479/534 open with a formal judgment opener.

Court distribution of the sample: family courts 211 · district 198 · magistrates 74 ·
Supreme Court 21 · juvenile 20 · traffic 4. Every candidate's URL is the same
collector path `…/dynamiccollectors/spokmanship_court?skip=N` — the suppression key
is `index_or_listing:integrity_index_or_listing` in every case.

The 10 `partial_judgment_body` rows are not listings either: they are official
press-office **תקציר פסק דין** summaries (1.4k–9k chars) with docket, panel and
holding — genuine but abridged text.

## 2. Body signals actually present

| signal | hits in sample |
|---|---|
| `לפני כבוד` / `בפני כבוד` / `ל פני כבוד` / `בבית המשפט העליון` opener | 479 |
| docket in `case_number` column | 529 |
| party block (`מאשימה … נגד … נאשם`, `תובע … נגד … נתבעת`) | dominant pattern |
| decision headers `פסק דין` / `גזר דין` / `החלטה` / `הכרעת דין` | ~all |
| body ≥ 2,000 chars | 527 |

Examples:
- `לפני כבוד השופט, הנשיא ניר מישורי לב טוב … מאשימה מדינת ישראל נגד נאשם … גזר דין רקע:` (22,067 chars)
- `לפני הרכב השופטים: כב' הנשיא, השופט אבי לוי [אב"ד] … גזר דין פתח דבר ביום 31.12.24, הורשע…` (55,122 chars)
- `בפני כבוד ה שופט הישאם שבאיטה תובע … נגד נתבעת … פסק דין עסקינן בתביעה לביטול דמי מזונות` (15,087 chars)

## 3. Listing signals

Zero rows classify as listing bodies. Listing vocabulary (`לצפייה`, `תוצאות חיפוש`,
`עמוד הבא`) appears in 14/534 sample rows and 28/4,481 corpus rows — always as
incidental strings inside very long judgments (e.g. the 746,644-char criminal
judgment, the 334,498-char fraud judgment), never as page furniture. There is no
row in the sample whose body is a list of case links.

## 4. Corpus-wide control (all 4,481 collector-URL caselaw rows)

| metric | value |
|---|---|
| avg body chars | 24,187 |
| body < 400 chars | 44 (1.0%) |
| body 400–1,999 chars | 69 (1.5%) |
| formal judgment opener | 2,468 (55%) |
| listing vocabulary present | 28 (0.6%) |
| has `case_number` | 4,470 (99.8%) |

The 44 short rows are **metadata_only**: the stored `content` is the press-office
headline sentence repeated (e.g. `ביהמ"ש לענייני משפחה בצפת, סג"נ אביבית נחמיאס: פס"ד
תביעה לפירוק שיתוף…`, 214 chars). They are not listings; they are simply un-bodied.
The 55% opener rate is a lower bound — Supreme Court press summaries and older
formats start with a date line or `תקציר` instead.

## 5. Answers

1. **Substantive text:** 524/534 (98.1%) sampled suppressed candidates carry full
   judgment text; 10 more carry official abridged judgment summaries. Corpus-wide,
   ~97.5% of collector-URL caselaw rows have ≥2,000 chars of body.
2. **Metadata-only / short / listing:** 0 in the sample. Corpus-wide 44 metadata-only
   (<400 chars) and 69 borderline (400–2,000). Real listing/index bodies: none found.
3. **Collector URLs are an ingestion identity artefact**, not a content signal. The
   `?skip=N` collector page is the crawl entry point recorded for every row of that
   batch; it carries no information about the row's body. Suppression is currently
   firing on provenance metadata, and it is wrong ~98% of the time for this class.
4. **Cheap deterministic body signals** that separate judgment text from listing text,
   in order of strength: (a) body length ≥ 2,000 chars; (b) `case_number` present /
   docket regex in title or first 500 chars; (c) formal opener regex
   `ל?פני (כבוד|הרכב)` / `בבית המשפט העליון`; (d) a party block `… נגד …` plus a
   decision header `פסק דין|גזר דין|החלטה|הכרעת דין`; (e) negative signal — listing
   vocabulary density ≥ 5 occurrences *and* fewer than 4 judgment markers (this
   negative rule fired on 0 rows, i.e. it is a safe, non-costly guard).
5. **Yes, a content-aware bypass is worth implementing** — it is the single largest
   remaining unlock (≈4.4k judgments, 57% of the local caselaw corpus).

## 6. False-positive risk estimate

A bypass gated on `origin=local_db` AND body ≥ 2,000 chars AND (docket present OR
judgment opener) AND NOT (listing-vocabulary ≥5 with <4 judgment markers) admits
≈4,360 of the 4,481 collector-URL rows and excludes the 44 metadata-only and most
borderline rows. Observed false-positive (a true listing body admitted) rate in the
sample: **0/534**; corpus-wide upper bound **<0.6%**, and the metadata-only holding
gate downstream would still catch any short/unbodied row before it can support a
holding. Risk is therefore low and double-covered.

## 7. Recommendation

**Implement the content-aware bypass; do not wait for URL re-ingestion.**

- Scope it narrowly: `origin = local_db` only, listing suppression untouched for web
  candidates and for local rows that fail the body test.
- Keep every downstream gate as-is: judgment identity validation, metadata-only
  holding gate, found-only support, source integrity, footnote invariants.
- Re-ingesting per-judgment `source_url`s is still worth doing later for citation
  quality (footnote links currently point at the collector page), but it is a
  presentation fix, not a prerequisite for recall.
