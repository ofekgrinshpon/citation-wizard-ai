# official_court_egress_path_v1 — status report

Verdict: **NOT ACCEPTED YET — blocked on an egress credential** (code landed, inert, zero behaviour change).

## What was implemented (scope-clean)

New module `supabase/functions/legal-research-v1/lib/courtEgress.ts`:

- **Allowlist only.** Regex `(^|\.)court\.gov\.il$`. Any other host is rejected before a
  request is made. It structurally cannot become a general-purpose proxy.
- **Fallback only.** Reached solely from `officialFetch`'s court lane, and only after the
  direct edge fetch already failed with a transport reset or a 403/429 origin rejection.
  URLs come exclusively from the existing official-discovery ladder; nothing is crawled.
- **Same browser-like profile** as `official_fetch_profile_v1` (UA / Accept /
  `Accept-Language: he-IL,he,en` / same-origin Referer / redirects / query params),
  forwarded to the relay under a namespaced header prefix.
- **Strict limits:** serialised behind the existing single-flight court chain, max 3
  alternative-egress fetches per run, ≥1 s spacing, backoff 1.2 s→5 s, hard stop after
  2 consecutive failures, 25 s relay timeout.
- **No bypass of anything:** no cookies, no login, no CAPTCHA solving, no paywalled source.
- **Telemetry** (`metadata.court_egress` + per-attempt `alt_egress_*` fields on
  `metadata.official_fetch.attempts`): configured, calls, cap, stopped_reason, host,
  fallback reason, status, content-type, content-length, connection reset, ms, skip reason.
  Body bytes / extraction chars / identity validation / cache write / injected candidate id
  continue to be recorded by the existing `noteOfficialFetchOutcome` path.
- **Cache-first, unchanged:** `verified_legal_sources` lookup still precedes any fetch, and
  a successful acquisition still writes the verified row + chunks.
- **Citability unchanged:** the egress only yields bytes. Extraction, identity validation,
  source-integrity, verifier, claim-source-match, sufficiency and the footnote builder are
  untouched.

Configuration (all optional; with none set the module is inert and the pipeline behaves
exactly as validated in `official_fetch_profile_v1`):

```
COURT_EGRESS_URL_TEMPLATE   https://<relay>/fetch?url={url_encoded}   (https + {url}/{url_encoded} required)
COURT_EGRESS_TOKEN          sent as Authorization: Bearer <token> unless {token} is in the template
COURT_EGRESS_HEADER_PREFIX  default "X-Fwd-"
```

## Why validation was not run yet

The 8-run sequence cannot satisfy the primary acceptance criterion — *"at least one official
court URL that fails from Supabase Edge succeeds through the alternative egress path"* —
because no alternative egress exists to point at. Probe results
(`reports/court-egress/EGRESS_PROVIDER_PROBE.md`):

- **Option C (existing approved provider) is unavailable:** both stored credentials are dead.
  `CONVERTAPI_SECRET` → HTTP 401 `Invalid or missing API credentials`;
  `APIFY_API_TOKEN` → HTTP 401 `user-or-token-not-found`.
- **Option B (Cloudflare Worker) is doubtful:** three independent Cloudflare-fronted relays
  reached the origin with 522 / reader timeout, i.e. the origin does not answer Cloudflare
  egress either.
- **Option A / D (own small egress) is the likely winner:** a plain VM/host with a clean —
  preferably Israeli — IP works today (the sandbox IP returns the real 364 KB PDF).

Running the 8 queries now would only reproduce the `official_fetch_profile_v1` results
(court resets, gov/knesset bodies acquired, P02 safe, B8 byte-identical) at the cost of a
full validation cycle. Validation is queued for the moment a relay URL exists.

## Acceptance checklist (current state)

| Criterion | Result |
|---|---|
| Court URL failing from Edge succeeds via alternative egress | **BLOCKED** — no egress configured |
| Nominated judgment body acquired, identity-validated, injected | BLOCKED (same cause) |
| Cache writes succeed for acquired judgment bodies | Unchanged path, previously MET for statutes |
| No block page cached or cited | MET (detection unchanged) |
| No citation without acquired + identity-validated text | MET (no gate touched) |
| P02 safe / B8 byte-identical | MET (no code path reachable without config) |
| No verifier / integrity / footnote loosening | MET |
| Egress allowlisted, rate-limited, cannot become a general proxy | MET |

## Next step

Provide one of:
1. a relay URL + token for a small fetch service on a clean/IL IP (Option A/D), or
2. a working key for a commercial fetch API with residential/IL geo (ScraperAPI-class),
   which the same template mechanism accepts, or
3. a renewed ConvertAPI / Apify credential (then re-probe those egresses).

Then run the 8-query sequence (D1, D3, MAYA-AMIR, R02, MAYA, Nation-State, P02, B8) and
finalise this report. After that, in order:
`actionable_extraction_budget_reservation_v1`, then URL correctness (remove the `Z01`/`z01`
derivation guesses).
