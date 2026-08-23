# canonical_judgment_text_acquisition_v1 — read-only diagnosis

No code changed. Evidence: `reports/core-authority-registry/*.json` (D1–D6 + controls,
per-authority ledger emitted by `core_authority_registry_v1`), plus a code read of the
retrieval/acquisition stages.

## 1. Per-authority ledger (from the registry telemetry)

`retrieved` = a candidate matching the authority entered the pool;
`admitted` = survived `source_integrity`; `body_acquired` = substantive text attached;
`used` = reached a footnote.

| authority | query emitted | retrieved | admitted | body | used | disappearance point |
|---|---|---|---|---|---|---|
| בג"ץ 6821/93 בנק המזרחי (D1) | `בג"ץ 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי מבחני המידתיות` | ✔ | ✔ | ✘ | ✘ | body-less (metadata/reference row) → dropped at `claim_source_match` |
| בג"ץ 1715/97 לשכת מנהלי ההשקעות (D1) | `... נ' שר האוצר מבחני המידתיות` | ✘ | ✘ | ✘ | ✘ | **no citable candidate** (listing/index results filtered) |
| בג"ץ 389/80 דפי זהב (D2) | `... נ' רשות השידור עילת הסבירות` | ✔ | ✔ | **✘** | **✔** | cited **without** an acquired body — quality flag, see §1.1 |
| בג"ץ 935/89 גנור (D2, extra) | emitted | ✘ | ✘ | ✘ | ✘ | no candidate |
| בג"ץ 1000/92 בבלי (D3) | emitted | ✔ | ✔ | ✘ | ✘ | body-less → not bound to any block |
| בג"ץ 8638/03 סימה אמיר (D3, control) | emitted | ✔ | ✔ | ✘ | ✔ | cited without body (same flag as דפי זהב) |
| ד"נ 7/81 פנידר (D4) | emitted | ✘ | ✘ | ✘ | ✘ | no candidate |
| ע"א 6370/00 קל בנין (D4) | emitted | ✘ | ✘ | ✘ | ✘ | no candidate |
| ע"א 4263/04 משמר העמק (D5) | emitted | ✘ | ✘ | ✘ | ✘ | no candidate |
| ע"א 2773/04 עטר נ' נצבא (D5) | emitted | ✘ | ✘ | ✘ | ✘ | no candidate |
| בג"ץ 6396/96 זקין (D6) | emitted | ✘ | ✘ | ✘ | ✘ | no candidate |
| statutes: חוק החוזים ס׳12 (D4), חוק החברות ס׳6 (D5) | n/a | ✔ | ✔ | **✔** | ✔ | success — end-to-end |

Distribution of the 9 failing case authorities:
**7 = no candidate found**, **2 = candidate found but body-less**.
Zero failures at classification, zero at drafter omission.

### 1.1 New finding not in the registry report
`body_acquired: false` **but** `used: true` for דפי זהב (D2) and סימה אמיר (D3).
Those footnotes rest on a source with no acquired judgment text. That is not a fabrication
(the citation is real and on-point), but it is exactly the "cite without body" surface the
metadata-only holding gate is supposed to close, and it means today's footnote counts
overstate real grounding.

## 2. Court-source acquisition: what exists vs. what is reachable

`stages/courtFileUrls.ts` already derives Supreme Court archive URLs from the docket alone
(`yy|serial5|suffix` → `HebrewVerdicts/yy/b/a/Z01`, text `type=2` first, PDF/English `type=4`
last, plus an `elyon1` `.htm` mirror). It covers exactly the prefixes these authorities use
(בג"ץ, ע"א, ד"נ, רע"א…), so **all eight target dockets are derivable today** — no search
needed. Case name and court prefix are not required for derivation; the name is only used
for post-download docket/title validation.

Reachability probe from this sandbox: every derived URL returned `ECONNRESET` for all eight
dockets. The sandbox has no egress to `court.gov.il`, so this proves nothing about
production — the same derivation is what made R02 and G02 succeed in real runs. Reachability
must be re-measured inside the edge function, not here.

No official search API exists for the archive; Nevo/Takdin are paywalled and cannot be used
as an official body source (they may only ever be a metadata/reference row).

## 3. Reusable machinery — and why it is not firing

| component | reusable? | blocker |
|---|---|---|
| `specificCaseResolution.ts` (R02 exact-body path: derive → probe text-first → validate docket in body → stamp) | **yes, wholesale** | gated in `index.ts:770` on `researchMode === "specific_case"` **and** on dockets found in the *user's question* (`detectDockets(question)`). Registry-seeded dockets live in the seeded query, never in the question, so on D1–D6 (`doctrine_explainer`) this lane is never entered. **This is the single biggest gap.** |
| `courtFileUrls.ts` derivation + `isTextEndpointUrl` text-first ordering | yes | pure, no network, no CPU cost |
| `pdfExtractionPreflight.ts` + `retrievalBudget` extraction ledger | yes | already bounds bytes/time; the text-first ordering keeps most hits off the PDF path |
| `docketAwareUrlKey.ts` dedupe, `primaryShapeRescue`, `specificCaseIdentity` title recovery | yes | all docket-keyed, work unchanged on a seeded docket |
| `judgmentTextAcquisition.ts` | partly | it only re-acquires text for candidates **already in the pool**; it cannot create a candidate for an authority that retrieval never returned — which is 7 of 9 failures |
| router caps | fine | `doctrine_explainer` allows 2 speculative acquisitions and a 140 s budget; there is headroom for 1–2 bounded derived-URL probes |

So the CPU/PDF risk of reuse is low: the proven path is text-endpoint-first, byte-capped and
budget-charged, and it is the *same* code that survived R02/F06/F07 validation.

## 4. Option comparison

| option | recall gain | impl risk | CPU/runtime | integrity risk | fits router budget |
|---|---|---|---|---|---|
| **A. official-court targeted search query** | low — this is essentially what fails now; the archive has no good search surface, results are listing pages | low | low | low | yes |
| **B. docket-based URL derivation for seeded authorities** | **high — addresses 7/9 "no candidate" and both body-less cases**; all 8 dockets are derivable | low (code exists) | bounded: text endpoints first, existing preflight/ledger | low — body validated against docket before use | yes (1–2 probes) |
| C. reputable-mirror fallback | medium | medium | medium | **high** — paywalled/edited text presented as official | marginal |
| D. offline corpus enrichment | high, permanent | high (ingest pipeline, licensing) | none at runtime | low | n/a — separate track |
| E. PDF extraction / acquisition retry | low — the failures are pre-extraction | low | **raises CPU risk** (the F02/F05/R02 kill class) | low | poorly |

## 5. Recommended minimal v1

**Extend the existing exact-body fast lane to registry-seeded dockets — option B only.**

Trigger, all of which must hold:
1. `core_authority_registry_v1` seeded an authority with a parsed Israeli docket (or the
   question itself names one), **and**
2. after the normal retrieval pass that authority is absent, or present only as
   `listing_page` / `metadata_only` / body-less, **and**
3. the docket is Supreme-Court derivable (`isSupremeCourtDocket`).

Behaviour: call the existing `specificCaseResolution` derivation for **at most 1–2 seeded
authorities per run** (highest registry role first), text endpoints before binary, validate
the exact docket inside the downloaded body, then stamp the body onto a candidate and let
the normal verifier / `source_integrity` / `claim_source_match` chain decide.

Guardrails (all already implemented, kept as-is): no holding from a metadata-only source;
no citation unless substantive text was acquired — which also fixes the §1.1
`used-without-body` cases; no verifier or integrity bypass; no crawling, only derived URLs;
per-probe timeout + byte cap + extraction ledger; one telemetry row per attempt
(`authority_id, docket, urls_probed, http_status, content_type, bytes, text_len,
docket_validated, outcome, ms`).

Explicitly out of scope for v1: mirrors, search-based discovery, corpus ingestion,
extraction retries.

## 6. Validation plan (for the implementation track, not run here)

D1–D6 plus R02, P02, B8, NOISE, MAYA / MAYA-AMIR. Report per run:
body-acquired canonical judgments before/after, footnote count, whether each footnote has a
body, runtime delta, CPU-kill / stale / stub count, metadata-only holdings, irrelevant
seeded sources reaching footnotes.

Acceptance targets: ≥4 of the 9 failing authorities body-acquired; zero footnotes without an
acquired body; runtime delta ≤ +20 s on D1–D6; zero CPU kills; controls unchanged
(P02 refusal, B8 canonical quote, NOISE no seeding).
