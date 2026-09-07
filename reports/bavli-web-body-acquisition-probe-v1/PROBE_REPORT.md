# bavli_web_body_acquisition_probe_v1 (read-only)

Target: בג"צ 1000/92 בבלי. URLs used: only those discovered in run `3d2e11a8-9e9a-47b3-8e30-7159b09cd6a7`.

## Direct probe (sandbox, browser-like headers)

| url | fetch attempted | HTTP | content type | bytes | extraction | chars | docket in body | identity | failure |
|---|---|---|---|---|---|---|---|---|---|
| https://www.daat.ac.il/daat/maamar.asp?id=151 | yes | 200 | text/html | 74,462 | HTML strip | 69,961 | yes (`1000/92`) | yes — "חוה בבלי נגד בית הדין הרבני הגדול", panel שמגר/ברק/ד' לוין, 7.2.94 | none |
| https://judgments.org.il/judgments/בגצ-1000-92-…/ | yes | 200 | text/html; utf-8 | 300,399 | HTML strip | 80,061 | yes | yes (parties + court) | none |

Both pages **are** the judgment body inline (daat is a clean full text; judgments.org.il is the full text inside site chrome). No follow-link is required. judgments.org.il also exposes a same-page `?pdf=14323329` print link — unnecessary.

## What the pipeline actually did

- Both URLs were **admitted** as `court_case` (new document-evidence classifier; daat `academic→court_case`, judgments.org.il `unknown→court_case`).
- Neither URL was ever fetched for a body. `secondary_body_acquisition.per_candidate` contains **only scholarship candidates** (all `origin: local_db`, HUJI/TAU/RUNI/Haifa) — the lane is secondary/scholarship-only, so judgment candidates are never handed to it. That is the skip condition: not a fetch failure, not a host rule.
- Body acquisition for Bavli was instead attempted only by `canonical_authority_acquisition`, which derived a single court-host URL `https://supreme.court.gov.il/` and failed with `Connection reset by peer (os error 104)` — the known court-egress block. It never considered the two discovered non-court URLs for fetching.
- Downstream: daat carries `downgrade_reason: uncertain_judgment_identity_prefer_commentary`, `classification_after: commentary`, `body_meaningful_chars: 162` (snippet only) — because no body was ever read.

## Answers

- **Skipped before fetch?** Yes — judgment-class web candidates are not routed to the secondary/web body fetcher; canonical acquisition only fetches derived court-host URLs.
- **Would the existing fetcher read them?** Yes. Plain HTML, 200, no auth, no WAF, no PDF, well under any size cap; the existing HTML path plus `processExtractedBody` handles both, and in-body docket + party + court identity validation would pass.
- **Relay?** Irrelevant. Both hosts answer directly; the relay is for `*.court.gov.il`.
- **Follow-link?** Not needed; page is the body.

## Verdict

**1. body_already_fetchable_but_not_wired**

A verified Bavli body is obtainable today from `daat.ac.il/daat/maamar.asp?id=151` (cleanest) and from `judgments.org.il`, using the existing web/HTML body fetcher — the only missing piece is routing admitted web *judgment* candidates into a body-acquisition lane instead of relying solely on court-host canonical acquisition.
