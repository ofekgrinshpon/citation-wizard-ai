# judgment_self_identity_v1

## Files changed

| File | Change |
|---|---|
| `supabase/functions/legal-research-v2/vendor/judgmentBodyForm.ts` | New. V1 `classifyLocalCaselawBody` ported verbatim (same regexes, same 2,000 / 900 / 400 floors, same four-way result) + `assessCaptionStructure` caption probe. |
| `supabase/functions/legal-research-v2/tools/authorityCorroboration.ts` | `isSelfIdentifying` replaced by `judgmentSelfIdentity`; new basis `judgment_body_form_absent`; wired into both binding branches. Docket / proceeding-type / court-level / expected-identity checks unchanged. |
| `src/test/authorityCorroborationSelfIdentity.test.ts` | New, 17 deterministic cases. |
| `src/test/rawWebSearch.test.ts`, `authorityBindingCorroboration.test.ts`, `hebrewDecoding.test.ts`, `localCorpusAcquisition.test.ts` | Toy judgment fixtures enlarged to genuine-judgment shape (caption, parties, panel, reasoning, closing). No assertion changed. |
| `scripts/judgment-self-identity-validation-v1.ts` | New read-only live probe. |

Untouched: raw_web_search, Perplexity usage, source tiers, blacklists, EvidenceStore, verifier, sufficiency, drafter, renderer, temporal logic, budgets.

## Acceptance / rejection rule

A body binds to a cited judgment only when ALL hold:

1. the shipped identity checks pass (docket present, proceeding type matches, court level matches, expected identity matches);
2. `classifyLocalCaselawBody(...) === "substantive_judgment_body"` — `partial_judgment_summary`, `metadata_only`, `listing_or_index_body` never bind → `judgment_body_form_absent`;
3. an early docket occurrence (≤ 4,000 chars) has ≥ 2 distinct caption-shaped structural signals within −600 / +1,200 chars, on short (≤ 80 char) lines, **excluding the docket's own line**, at least one of them strong (party `נ׳`/`נגד` block, litigant-role block, panel/opener `לפני`/`בפני`/`הרכב`); court identity and decision header alone are also article vocabulary → otherwise `docket_mention_not_self_identifying`.

Terminal disposition (`ניתן היום`, `אשר על כן`, `לפיכך`, appeal accepted/rejected, numbered paragraphs, judicial first person) is recorded as supporting only, never a gate. No domain is used, added or blacklisted.

The docket-line exclusion was added after live evidence: portal pages title themselves `עא 3807/12 X נ' Y — <site>`, which reproduces caption vocabulary on one line without reproducing the judgment.

## Tests

17 new cases (three false binds, wrong-court `2553/01` and `8704/09`, unrelated article, portal title-line page; court.gov.il full judgment, judgments.org.il 423/75 and 417/81, old-format reproduction, unknown party names, short-but-genuine; statute corroboration, `no_expected_identity`, `body_not_a_document` regressions).

Suite: **759 passed, 5 failed** — the 5 are the pre-existing `researchJobMode` localStorage failures under the node-env config, unrelated. `deno check index.ts` clean. Deployed.

## Live validation (read-only, real fetches)

| Authority | URL | body class | result | basis |
|---|---|---|---|---|
| ע"א 2553/01 | globes.co.il/news/article.aspx?did=884357 | substantive | **REJECT** | docket_mention_not_self_identifying |
| ע"א 3807/12 | psakdin.co.il/Court/ע-א-3807-12… | substantive | **REJECT** | docket_mention_not_self_identifying |
| ע"א 3807/12 | supremedecisions.court.gov.il Home/Download type=2 | substantive | ACCEPT | docket_present_in_body (court_identity, litigant_roles, panel_opener, decision_header) |
| ע"א 5185/93 | immunewill.co.il/… | substantive | ACCEPT | docket_present_in_body — **correct**: the page carries `פסק הדין המלא` followed by the full caption (`בבית המשפט העליון…`, panel, `נ ג ד`) and the judgment text; it is a reproduction, not commentary |
| ע"א 423/75 | judgments.org.il/…423-75… | substantive | ACCEPT | docket_present_in_body (litigant_roles, panel_opener) |
| ע"א 417/81 | — | — | not bound | no reproduction surfaced by discovery (workrights/PDF hits fail proceeding-type or docket presence) |
| ע"פ 8704/09 | supremedecisions.court.gov.il type=2 | substantive | ACCEPT | docket_present_in_body (all five signals) |
| ע"פ 8704/09 | ozar-law.co.il listing | substantive | REJECT | docket_mention_not_self_identifying |
| wrong-court 2553/01, 8704/09 variants | judgments.org.il district pages | substantive | REJECT | docket_proceeding_type_mismatch |

Two of the three original false binds are now rejected. The third (Immunewill) turns out on inspection to be a **genuine full reproduction of 5185/93**, so its bind is correct, not a false positive.

Residual false bind observed: `od-nadlan.co.il/?p=3629`, a law-firm newsletter that prints a structured case-header card (`שם ומספר הליך…`, `ערכאה … בפני כב' הש' …`) above its own commentary. The card satisfies caption structure on separate lines. Catching it needs a commentary/byline counter-signal, which the approved design restricts to confirming rejections — not shipped.

False negative observed: none among the required accepts. ע"א 417/81 was already unbound before this change (discovery, not the gate).

## Q6 / Q11 rerun (background eval path, charge-free)

| | Q6 | Q11 |
|---|---|---|
| status | done, ok | done, ok |
| latency | 207 s | 102 s |
| agent steps / model calls | 23 / 28 | 9 / 14 |
| bindings created / withheld | 3 / 1 | 1 / 2 |
| central issue covered | true | true |
| verified claims / evidence pairs | 1 / 5 | 3 / 7 |
| invariant errors | none | none |
| footnotes | 1 | 1 |

Both ran to completion on the background entrypoint; the 150-second synchronous gateway limit that truncated the earlier Q11 smoke did not apply. No pipeline regression.

## Verdict

**JUDGMENT SELF-IDENTITY PARTIAL — REVIEW** — the gate ships, the required rejects and accepts hold, and Q6/Q11 are clean; one residual class (case-header-card newsletters) still binds and needs a decision on commentary counter-signals.
