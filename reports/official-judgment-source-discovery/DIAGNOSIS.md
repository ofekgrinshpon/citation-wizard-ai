# official_judgment_source_discovery_v1 — read-only diagnosis

No code changed. Evidence: live probes of `supremedecisions.court.gov.il` / `elyon1.court.gov.il`
from this sandbox (2026-08-24), indexed official archive URLs, production telemetry from the
`type4_last_resort_probe_v1` runs, and a direct inspection of the local corpus
(`legal_documents`, 21,542 rows).

## 0. Headline — the derivation is wrong in a way we had not identified

`canonical_judgment_text_acquisition_v1` derives one document code only: **`Z01` / `z01`**.
The archive does not use a single document code. Indexed, live official URLs show a wide,
non-derivable code space:

| docket | official archive fileName / path (indexed, live) |
|---|---|
| בג"ץ 1715/97 לשכת מנהלי ההשקעות | `fileName=97017150.a15&path=HebrewVerdicts\97/150/017/**a15**&type=4` |
| בג"ץ 9333/03 | `…03093330.**a06**&path=HebrewVerdicts\03/330/093/a06&type=4` |
| בג"ץ 4593/05 | `…05045930_**A08**.txt&path=HebrewVerdicts\05\930\045\A08&type=4` |
| בג"ץ 6539/03 | `…03065390.**g07**&path=…/g07&type=4` |
| ע"א 1/01 | `…01000010.**j09**&path=…/j09&type=4` |
| בג"ץ 102/99 | `…99001020_**I01**.txt&path=…/I01&type=4` |
| בג"ץ 3921/20 | `…20039210.**O04**&path=…/o04&type=4` |
| בג"ץ 4178/04 (פ"ד) | `fileName=**SB1_6_4178-04.pdf**&path=**PediVerdicts**\62\1&type=4` |

The path segments (`yy/b/a`) our derivation computes are **correct** — `97/150/017` for 1715/97
matches exactly. Only the trailing document code is guessed, and `Z01` is a minority case. The
"WAF/block" page is what the download handler returns for a **non-existent object**, so
`blocked_by_origin` in our telemetry is, for 4 of 5 authorities, really `object_not_found_wrong_doc_code`.

Second, `PediVerdicts` (the scanned/typeset פ"ד volumes) is a whole official corpus we never
probe, with **non-derivable** fileNames (`SB1_6_4178-04.pdf`). Pre-1997 canonical judgments
live there far more reliably than in `HebrewVerdicts`.

Third: the one body we do fetch — 6821/93, 2.34 MB — comes from **`EnglishVerdicts`**. That is
the *English translation*, not the Hebrew original. Citing Hebrew holdings from it is an
integrity smell independent of the extraction-slot issue.

## 1. Source-path inventory

Probe run 2026-08-24 (one burst, same egress IP, interleaved). `Home/Download` with derived
`Z01`; `type=2` = Hebrew text corpus, `type=4` = binary/corpus.

| authority | local corpus | supremedecisions `type=2` (Z01) | supremedecisions `type=4` (Z01) | elyon1 `.htm` (Z01) | correct official path known? |
|---|---|---|---|---|---|
| בג"ץ 6821/93 בנק המזרחי | ✘ | 200, text/html, 1,787 B, **block** | **200, application/pdf, ~2.34 MB (EnglishVerdicts — translation)** | 200, html, 1,878 B, block | partly (EN only) |
| בג"ץ 1715/97 לשכת מנהלי ההשקעות | ✘ | 200, html, 1,787 B, block | 200, html, 1,787 B, block | block | **yes — doc code `a15`, indexed and live** |
| בג"ץ 389/80 דפי זהב | ✘ | block | block | block | no (pre-1997; expect PediVerdicts) |
| בג"ץ 935/89 גנור | ✘ | block | block | block | no (pre-1997; expect PediVerdicts) |
| בג"ץ 1000/92 בבלי | ✘ | block | block | block | no (pre-1997; expect PediVerdicts) |
| ד"נ 7/81 פנידר | ✘ | block | block | block | no |
| ע"א 6370/00 קל בנין | ✘ | block | block | block | not yet located |
| ע"א 4263/04 קיבוץ משמר העמק | ✘ (only a 71 KB **journal article about it**, HUJI law review) | block | block | block | not yet located |
| ע"א 2773/04 עטר | ✘ | block | block | block | not yet located |

Per-path characterisation:

| path | trust | body | identity validation | extraction risk |
|---|---|---|---|---|
| local corpus (`legal_documents`) | official-equivalent, already ingested | **only 2020–2024 caselaw** (7,828 rows, `min decision_date 01.01.2020`) + 302 `supreme_court_il`; **zero** of the 9 canonical dockets | trivial (`case_number`) | none |
| `Home/Download` + correct doc code, `HebrewVerdicts type=2/4` | official | yes, when the code is right | yes (docket appears in body) | low for `.txt`/`type=2`, high for PDFs |
| `Home/Download` `PediVerdicts type=4` | official | yes for old פ"ד judgments | yes | **PDF, multi-MB — high** |
| `EnglishVerdicts type=4` | official but a **translation** | yes (6821/93) | yes | 2.34 MB PDF — high |
| `Home/Index` viewer page | official | no body, HTML shell (Angular, ~6 KB, no server-rendered content) | n/a | none |
| elyon1 `.htm` mirror | official | same doc-code dependency as above | yes | low |
| `supreme.court.gov.il` SharePoint verdicts list | official | listing only | n/a | none |
| judgments.org.il / cwj.org.il / daat / Wikipedia | secondary mirrors | yes (full text on judgments.org.il) | yes (docket + parties in body) | low (HTML) |
| Nevo / Takdin | paywalled | no | n/a | n/a |

## 2. Why the "WAF" page appears

Not a WAF in the rate-limiting sense, for the canonical failures:

- In a single burst from one IP, 6821/93 `type=4` returned a real `application/pdf` while the
  neighbouring dockets returned the 1,787-byte `חסימת בקשה לא מורשת` page. An IP/rate block
  cannot be object-selective. ⇒ **the block page is the handler's response to an invalid or
  non-existent `path`/`fileName`**.
- A genuine IP-level block also exists and is separate: after ~40 requests the host switched to
  `ECONNRESET` for everything, including the previously-working URL. So the origin has *both*
  a not-found page dressed as a security page *and* an aggressive rate limiter.
- `Home/Index` is a pure Angular shell — no server-side body, so "fetch the viewer page first"
  yields nothing without the site's JSON API.

Classification against the requested list: **wrong query parameter (document code) → object does
not exist**, primary; **direct-download rate limiting**, secondary and burst-dependent; NOT
wrong path derivation, NOT wrong `type`, NOT missing archive record (1715/97 is demonstrably
online), NOT header/UA (same UA succeeded and failed in the same burst).

## 3. Search-first option

Correct in principle — the doc code is only obtainable by discovery — but the official surfaces
are weak: `supremedecisions` is an Angular SPA whose JSON API we could not enumerate before the
rate limiter cut the session, and the SharePoint list at `supreme.court.gov.il` is a listing UI.
What *does* work today is **web-index discovery**: a targeted query restricted to
`supremedecisions.court.gov.il` returned the exact official `a15` URL for 1715/97 on the first
try, and equivalent official URLs for five other dockets incidentally. That is search-first, but
against a general index rather than the court's own search box — one extra hop, no crawling,
and the final fetch is still from the official host.

Cost: 1 search + 1 fetch per authority, both bounded; the search hop is ~1–2 s and no CPU.

## 4. Override option

A tiny override table (`authority_id, docket, official_url, source_kind, source_verified_at,
expected_identity_terms`) is the most *reliable* option for exactly the ~12 registry authorities:
zero discovery cost, zero CPU, official host, identity terms checked in the body. Its weakness is
the known one — it rots silently, and it does not generalise beyond the registry. But the registry
is by definition a small, hand-curated, slow-moving list, so the maintenance burden is honest and
proportional: the override table has the *same* cardinality and the *same* review cadence as the
doctrine registry it serves. Combined with a `source_verified_at` staleness check it is
defensible; it is not a substitute for discovery in the general case.

## 5. Mirror fallback option

Technically viable (judgments.org.il carries full Hebrew text for בבלי, and identity is
verifiable in-body), but for pre-beta it is the highest integrity risk: an edited or truncated
mirror text presented behind a judgment citation. If ever allowed, it must be registry-only,
identity-validated in-body, labelled `secondary_mirror` (never official), ranked below any
official source, blocked from carrying a holding on its own, and fully telemetered. Recommend
**not now**.

## 6. Comparison of next fixes

| option | share of the 5/5 failure solved | impl risk | maintenance | CPU/runtime | integrity risk | before beta? |
|---|---|---|---|---|---|---|
| **A. canonical_pdf_extraction_priority_v1** | 1/5 (6821/93 only) — and that body is the **English translation** | low | none | raises PDF extraction pressure | medium (translation-as-original) | as a *support* fix only |
| **B. official search-first discovery (doc-code recovery)** | **potentially 4–5/5** — proven for 1715/97; recovers `a15`-class codes and PediVerdicts PDFs | medium (new discovery hop, result parsing, host allow-list) | low | +1 search + 1 fetch per authority, capped | low (official host, in-body identity) | **yes** |
| **C. official URL override table for registry authorities** | 5/5 for the curated set, 0 beyond it | **very low** | real but proportional to the registry | none | low | **yes** |
| D. reputable mirror fallback | 5/5 nominally | medium | medium | low | **high** | no |
| E. offline corpus enrichment | 5/5 permanently; corpus today is 2020–2024 only | high (ingest + licensing) | high | none at runtime | low | no — separate track |

## 7. Recommendation

**Next fix = C + B, in that order, as one narrow track
`canonical_official_source_resolution_v1`.**

1. **C first (ship-blocking, one day):** an official-URL override table for the ~12 registry
   canonical authorities, each row carrying `official_url`, `source_kind`
   (`hebrew_text` | `hebrew_pdf` | `pedi_pdf` | `english_translation`), `source_verified_at`,
   and `expected_identity_terms`. The canonical lane probes the override URL **first**, before
   any derivation. Prefer Hebrew text sources; an `english_translation` row may be acquired but
   must be labelled as a translation and must not carry a Hebrew-quoted holding.
2. **B second:** when no override row exists, run one bounded official-host discovery query per
   authority (max 1–2 authorities/run), accept only `supremedecisions.court.gov.il` /
   `elyon1.court.gov.il` URLs, prefer `type=2`/`.txt`/`.htm` over PDF, then fetch and validate
   the docket in-body. Feed a successful discovery back as a proposed override row (telemetry
   only, not auto-written).
3. **Extraction priority (A) stays — but as a support fix, implemented after B/C**, since with
   correct Hebrew text endpoints most canonical acquisitions stop needing an extraction slot at
   all. Keep it scoped to: a canonical, identity-validated, registry-seeded body may claim the
   run's speculative extraction slot ahead of opportunistic candidates.
4. Correct the telemetry vocabulary: the 1,787/1,878-byte page is
   `object_not_found` (short HTML + `חסימת בקשה לא מורשת` + docket absent), distinct from
   `rate_limited` (`ECONNRESET` / repeated blocks across *all* URLs in a run). Today both are
   `blocked_by_origin`, which is what hid this root cause.
5. Also fix the doc-code assumption in `courtFileUrls.ts` documentation: `Z01` is one code among
   many (`a06 a15 A08 g07 j09 I01 O04 …`); do **not** enumerate them by brute force — that is a
   rate-limit trap. Discovery, not enumeration.

Out of scope: mirrors (D), corpus enrichment (E), doc-code brute force, court-site JSON API
reverse engineering.

## 8. Acceptance criteria

Validation set D1–D6 + controls R02, P02, B8, NOISE, sequential.

1. **Recall** — ≥4 of {מזרחי, לשכת מנהלי ההשקעות, דפי זהב, גנור, בבלי} reach
   `body_acquired: true` **and** `body_identity_validated: true`, from an official host.
2. **Language integrity** — zero Hebrew-quoted holdings sourced from an
   `english_translation` body; any translation-sourced footnote is labelled as such.
3. **No false bodies** — zero injected bodies failing in-body docket validation; zero
   `object_not_found` pages counted as bodies; `object_not_found` vs `rate_limited` visible and
   distinct in telemetry.
4. **Footnote integrity** — `citations_without_body_acquired` = 0 on the D-set.
5. **Stability** — every run terminal, zero CPU kills, zero dangling markers; ≤2 authorities
   resolved per run; ≤1 discovery query + ≤2 fetches per authority.
6. **Runtime** — median delta ≤ +20 s vs. the current D-set baseline; no single authority
   resolution above 10 s.
7. **Controls unchanged** — R02 exact body, P02 refusal, B8 canonical quote, NOISE seeds nothing.
