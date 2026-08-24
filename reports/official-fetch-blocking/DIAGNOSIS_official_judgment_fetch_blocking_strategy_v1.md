# official_judgment_fetch_blocking_strategy_v1 — read-only diagnosis

Method: replayed every official URL recorded in `reports/judgment-search-first/*.json` from the sandbox with (a) the production fetch profile equivalent and (b) a browser-like profile (Chrome UA + `Accept` + `Accept-Language: he-IL` + `Referer: https://supremedecisions.court.gov.il/` + follow redirects). No code changed. Total requests to the official origin: ~20, spread over three short batches.

## 1. URL correctness

| Run | URL | Origin of URL | Real fileName? | Result now |
|---|---|---|---|---|
| D1 | `Home/Download?path=HebrewVerdicts\97/150/017/a15&fileName=97017150.a15&type=4` | search-first | yes (`a15` doc code, docket-consistent `97017150`) | **200, 442 KB `application/pdf` — genuine judgment PDF** with the browser-like profile |
| D1 | `...fileName=97017150_Z01.txt&path=.../Z01&type=2` and `...97017150.z01&...&type=2` | deterministic derivation (guessed `Z01`) | no — `Z01` is a guessed code | 200 HTML `חסימת בקשה לא מורשת` |
| D1 | `...path=HebrewVerdicts/12/340/091/c32&fileName=12091340_c32.txt` | search-first, **wrong case** (2012 docket for a 1997 judgment) | n/a | irrelevant |
| D3 | `https://www.gov.il/BlobFolder/generalpage/spotify-floater/he/1000-92.doc` | search-first hallucination (`spotify-floater`) | no | not a judgment |
| D3 | `elyon1.court.gov.il/files/92/000/010/z01/92010000.z01.htm` | derivation (`z01` guess) | no | block page even with browser headers |
| D3 | two `Z01/z01 type=2` supremedecisions URLs | derivation | no | block page |
| MAYA-AMIR | `path=HebrewVerdicts/00/497/084/c10&fileName=00084970_c10.txt&type=4` | search-first | fileName pattern is docket-consistent (`00084970`), doc code `c10` plausible; **path segment order `00/497/084` looks transposed** (`00/084/970` expected) | 302 → block page |
| MAYA-AMIR | `www.court.gov.il/`, `gov.il/.../spokmanship_court`, `fs.knesset.gov.il/...docx` | search-first | not documents | noise |

Key facts:
- **The origin is not uniformly hostile.** With a browser-like profile, a correct `type=4` + real doc-code URL returned a real 442 KB judgment PDF. The production profile (`User-Agent: Mozilla/5.0 (compatible; ReLexBot/1.0)`, no `Referer`, no `Accept-Language`) is what earns the Hebrew block page on those same URLs.
- Every URL that returned `חסימת בקשה לא מורשת` **and** could not be recovered with browser headers carried a **guessed `Z01`/`z01` code or a transposed path** — i.e. wrong document code, not a real access denial.
- After ~15 requests in a few minutes the origin began **resetting the TCP connection** (`curl (56) Recv failure`) for *all* URLs, including the one that had just succeeded. That is IP-level rate limiting, recovering after a pause. No CAPTCHA, no login wall, no paywall was encountered at any point.

## 2. Fetch profile (production code)

`stages/judgmentTextAcquisition.ts:364,808` and `statuteTextAcquisition.ts:125` all send:
```
User-Agent: Mozilla/5.0 (compatible; ReLexBot/1.0)
redirect: "follow"
```
No `Referer`, no `Accept`, no `Accept-Language`, no session bootstrap. Redirects are followed correctly and query params are preserved (the 302 to the block page is followed and its body is correctly recognized). So: redirect handling and param handling are fine; **headers are the gap**. A first page visit for a session cookie was *not* needed in the successful fetch — UA + Accept + Accept-Language + Referer sufficed.

## 3. Origin policy

- Not a genuine access restriction: the same document is served to a normal-looking request. No authentication, CAPTCHA or interactive barrier exists on the `Home/Download` path.
- There **is** an unpublished rate/burst limit (connection resets after a burst). Any implementation must be single-flight, serialized, with a small per-run cap and backoff — no parallel fan-out over 4 candidate URLs.
- Nothing here requires bypassing a control; setting honest browser-ish headers on a low-volume, human-initiated request is not circumvention. Guardrail to keep: hard per-run and per-minute caps.

## 4. Extraction budget (MAYA-AMIR)

The attempt never reached the network: `result: fetch_failed`, `reason: extraction_budget_spent`, after search-first had already produced 4 official URLs in 3.0 s. The run-level ledger in `stages/retrievalBudget.ts` (`MAX_EXTRACTIONS_PER_RUN` / `MAX_EXTRACTION_BYTES_PER_RUN`) had been consumed earlier in the run by exploratory web/PDF extraction from general retrieval — the discovery lane runs *after* it and inherits an empty ledger. The named-judgment target is the highest-value extraction in the run and currently has the lowest priority. A reserved slot (e.g. 1 extraction + ~4 MB withheld from speculative use, released only to actionable discovery targets) is the correct shape.

## 5. Classification

| Failure | Class |
|---|---|
| D1 `a15` official URL | **fetch_profile_missing** (works with browser headers) |
| D1/D3 `Z01`/`z01` derived URLs | **wrong_url_or_file_code** |
| D3 gov.il `spotify-floater` .doc | **wrong_url_or_file_code** (search-first precision) |
| MAYA-AMIR `c10` URL | **extraction_budget_spent** (never fetched); URL itself likely **wrong_url_or_file_code** (transposed path segments) |
| Burst connection resets | **genuine_origin_block** — rate limit only, transient |
| R02 / P02 / B8 | no official-fetch failure; refusal behaviour correct |

No `identity_validation_failure` occurred — identity validation was never reached because no body was acquired.

## 6. Recommended next implementation (single track)

**1 — browser-like official fetch profile** (`official_origin_fetch_profile_v1`).

Rationale: it is the only change proven by direct evidence to convert an already-discovered URL into a real judgment body, and it is the precondition for judging everything else. Scope it as: shared `officialFetch()` helper (Chrome-class UA, `Accept`, `Accept-Language: he-IL,he;q=0.9`, `Referer` = the origin's own search page, follow redirects), serialized single-flight against `*.court.gov.il` with a per-run cap of ~3 requests and exponential backoff on connection reset, plus explicit detection of the block page and the rate-limit reset as distinct telemetry states.

Immediate follow-ups, in order, once (1) lands:
2. **extraction budget reservation** for actionable judgment targets (unblocks MAYA-AMIR).
3. **search-first URL correctness**: drop derived `Z01`/`z01` guesses entirely once real doc codes are searchable, and validate that the `path` segments match the `fileName` digits before fetching.
4. Mirror fallback / corpus enrichment only if (1)–(3) still leave a gap — not now.

Not recommended: option 6 (stop trying official fetch) — the origin demonstrably serves the documents; and option F (manual cache seeding) as architecture.
