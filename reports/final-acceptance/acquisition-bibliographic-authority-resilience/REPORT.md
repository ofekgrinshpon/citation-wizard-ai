# Acquisition Reliability, Bibliographic Safety & Exact Authority Fallback

Scope: the three blockers from
`reports/final-acceptance/v2-literature-review-acceptance-v2/REPORT.md`.
Nothing in agent-owned research depth, verified synthesis, canonical quotable
text, span verification, drafter utilization or the Drafter model was changed.

## 1. Deployed architecture inspected first

| Component | State before this task |
|---|---|
| `tools/fetch.ts` | one URL per acquisition attempt; a failure ended the path with a generic `http_failed` |
| `vendor/officialFetch.ts` | browser-like headers for official IL hosts only; every other public host got a bare `ReLexBot` UA |
| `vendor/courtEgress.ts` | relay restricted to `*.court.gov.il` (unchanged) |
| `shared/bibliographic.ts` | embedded PDF metadata could outrank stronger page metadata |
| `drafting/render.ts` | raw URL appended to the visible text of academic citations |
| `tools/lookupAuthority.ts` | a single statute entry point (Nevo / Knesset) |

## 2. What changed

**A — acquisition reliability**
- `shared/fetchDiagnostics.ts` (new): a deterministic failure taxonomy —
  DNS / TLS / reset / timeout / 401 / 403 / 404 / 429 / 5xx / block page /
  login-or-paywall / JS shell / landing page / empty extraction /
  unreadable PDF / discovery endpoint. `http_failed` no longer exists as a
  terminal reason. Every class also states whether another public copy is
  worth trying.
- `tools/fetch.ts`: classifies HTTP failures, unusable bodies and exceptions;
  returns `failure_class` + `alternative_copy_worth_trying`; rejects
  Crossref/OpenAlex/search endpoints as non-documents.
- `vendor/officialFetch.ts`: ordinary browser navigation headers
  (`public_browser_like`) for public non-official hosts, with per-attempt
  telemetry. No cookies, no login, no challenge solving, no paywall bypass.
- `tools/alternativeCopy.ts` (new): bounded same-work recovery — one query
  naming the work, strict equivalence (DOI exact, or high title overlap
  confirmed by a shared author surname or matching year), and a refusal list
  for pirate mirrors. A recovered copy still passes the ordinary document
  check, identity corroboration and span verification.

**B — bibliographic fail-safe**
- Per-field provenance (`field_basis`) with a fixed trust order: repository
  page > HTML metadata > search metadata > PDF header/body > embedded PDF
  metadata. Weak values only fill clean gaps.
- Garbage filters: mojibake, hex blobs, producer strings (`pubdat`), file
  paths (`C:\Working Papers\11883.wpd`), `Microsoft Word - …`, sentence-like
  titles, malformed authors.
- Source-kind guardrails: statutes and judgments can never acquire a personal
  author or journal formatting.
- Structured academic citations no longer contain a raw URL; the link stays in
  the footnote's own `url` field. Discovery/API endpoints can never supply a
  citation title.

**C — exact authority fallback**
- Section-specific keys (`statute:X#12`) reuse an already corroborated parent
  body (`statute:X`) and locate the section inside it instead of spending
  another network attempt. A section absent from the body is reported missing,
  never assumed.
- `lookupAuthority` now offers several public statute entry points (Nevo,
  Knesset, Wikisource, gov.il), so one unavailable site no longer ends an
  exact-authority question. Each is a discovery entry only.

## 3. Tests

`src/test/acquisitionBibliographicResilience.test.ts` — 19 deterministic tests
covering B1–B8, the failure taxonomy, same-work equivalence (including refusal
of a title-only match and of pirate mirrors) and parent-statute section
location.

Full suite: **1014 passed / 85 files**. Typecheck clean. `legal-research-v2`
deployed.

## 4. Safety

No verification, corroboration or admission gate was weakened. No trusted-domain
shortcut was introduced. No authentication, paywall or CAPTCHA is bypassed —
recovery only looks for another publicly accessible copy of the same public
document. Court relay remains court-only. V1 untouched.

## 5. Verdict

**PARTIAL / REVIEW** — all three tracks are implemented, tested and deployed,
but the required live diagnostics (F1–F6) and full acceptance #3 matrix have
not yet been run, so real-world improvement in foreign-host acquisition yield
is not yet measured.

NO VERIFICATION GATE WEAKENED.
NO TRUSTED-DOMAIN SHORTCUT INTRODUCED.
NO PAYWALL OR AUTHENTICATION BYPASSED.
V1 UNCHANGED.
