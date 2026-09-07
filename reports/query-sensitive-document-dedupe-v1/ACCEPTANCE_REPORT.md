# query_sensitive_document_dedupe_v1 — acceptance report

## What was built
- `stages/urlCollisionGuard.ts` (new, pure): decides, for two candidates that normalize to the **same** canonical URL key, whether they are the same document.
  - Query params are split into *identity-like* (`id`, `docid`, `caseid`, `fileName`, `path`, `article`, …) and *noise* (`utm_*`, `fbclid`, `gclid`, `ref`, `_ga`, session/tracking) — noise never counts as a difference.
  - Identity evidence: normalized docket (quote/dash variants folded), authority id, case id, statute section id, normalized title.
  - Order of authority: **identity disagreement > URL-key equality**. Docket / authority-id / case-id / statute-id disagreement ⇒ `preserve_distinct`. Same docket ⇒ `collapse` even when query ids differ. Identity-like param difference **plus** materially different legal titles ⇒ `preserve_distinct`.
  - Fail-conservative: no meaningful query difference, or query difference with no identity evidence ⇒ `collapse` (previous behaviour).
- `stages/candidatePool.ts`: the `dup_url` branch now consults the guard against every already-admitted candidate on that key; a candidate is only dropped when a collapse decision is reached.
- Telemetry: `retrieval.pool.url_collision_resolution` — normalized key, original URLs, query differences, titles, normalized dockets, authority ids, identity signals, decision, reason, candidate ids.
- Canonical URL normalization is unchanged as the default path.

## Tests
`src/test/urlCollisionGuard.test.ts` — 8 tests: same endpoint different ids/dockets; different titles without docket; tracking-only variants; same docket via different ids; no-evidence conservative collapse; different authorities; identity extraction. Full suite **43 files / 488 tests pass**; typecheck and build clean. Deployed.

## Live validation
Question: the original divorce/property HCJ-review question. Run `3c050ec6-c573-4d03-9e32-1d38581d7d56`.

Collision telemetry fired once: two *different* Basic Laws (`חוק יסוד: כבוד האדם וחירותו`, `חוק יסוד: השפיטה`) published under the **identical** Knesset PDF URL with **zero** query difference — collapsed as `no_meaningful_query_difference`, i.e. the conservative rule, unchanged from before.

### Bavli funnel this run
| stage | outcome |
|---|---|
| discovery (Perplexity) | found — `daat.ac.il/daat/maamar.asp?id=151` and `daat.ac.il/lesson2/musagim/value2.asp?id1=541`, docket `1000/92` classified |
| role correction | applied (`binding_case_law` / `persuasive_case_law`) |
| **URL dedupe** | **survived** — no `dup_url` drop; the two daat representations differ by path, no collision raised |
| pool admission | **dropped: `backfill_origin_diversity_cap`** (`drop_key: perplexity:1`, ranks 106 and 109) |

The previous loss stage (`dup_url` on `www.daat.ac.il/daat/maamar.asp`) is gone. Bavli now dies **later**, at the backfill origin-diversity cap: both surviving daat representations count against a single `perplexity:1` origin slot and are cut at rank >100.

Per the stop rule (survives dedupe, dies elsewhere) work stopped here.

### Answer
Delivered a four-part answer on HCJ review of rabbinical property rulings (relevance of the extraneous consideration, its necessity to the outcome, ultra vires, deference gradient, remedies) with **1 footnote** — בג"ץ 8638/03 אמיר. Bavli is still uncited.

## Recommended next track
`origin_diversity_cap_authority_exemption_v1` — extend the existing direct-authority exemption in `candidatePool.ts` to the backfill origin-diversity cap, so a registry-listed core authority with confirmed docket identity is not cut by a per-origin slot.
