# web_judgment_source_classification_and_role_admission_v1 — acceptance

Rerun of the exact question from run `8be5d95a-defc-4c27-9531-ca87890176c0`.
New run: `3d2e11a8-9e9a-47b3-8e30-7159b09cd6a7`.

## Change
New `stages/documentEvidenceClassification.ts`, wired into `perplexityRetrieval.processRaw`:
- Judgment typing from the document: docket in title/URL (Hebrew final/non-final normalised, so `בג"צ` == `בג"ץ`) **plus** a second independent signal (party names `X נ' Y`, court identity, judgment structure/panel, substantial document body, host support). Docket alone, snippet-only mentions, commentary/marketing titles and blog/news paths fail closed.
- Scholarship typing from the document: two independent academic signals (journal, faculty/institute, bibliographic metadata, author+title, academic PDF).
- Host is a signal only — no closed whitelist; `bad` sources are never reclassifiable.
- Telemetry: `doc_class_from`, `doc_class_to`, `doc_class_signals`, `doc_class_docket` on every web result row.
- No change to identity validation, integrity, body-quality, verifier, CSM, alignment, retrieval, queries, drafter, topicality, counts or the canonical registry.

Tests: `src/test/documentEvidenceClassification.test.ts` (9). Full suite 38 files / 446 tests pass; typecheck clean; deployed.

## Admission result (was the goal)
64 web result rows; 15 re-typed from document evidence (13 → case law, 2 → scholarship); 13 of those admitted where the old run dropped them.

| source | found | admitted | class before → after | verifier | in pack | cited |
|---|---|---|---|---|---|---|
| בג"צ 1000/92 בבלי (daat.ac.il) | yes | **yes** | academic → court_case | **usable, `direct` (only direct verdict in run)** | no | no |
| בג"צ 1000/92 בבלי (judgments.org.il) | yes | **yes** | unknown → court_case | not usable | no | no |
| בג"ץ 3914-92 לב נ' ביה"ד הרבני ת"א (cwj.org.il) | yes | yes | unknown → court_case | usable, partial | no | no |
| בג"ץ 6641/11 פלונית נ' ביה"ד הרבני הגדול (law-mate) | yes | yes | discovery_only → court_case | usable, partial | no | no |
| בג"צ 6591/11 (law-mate) | yes | yes | discovery_only → court_case | not usable | no | no |
| דנג"ץ 8537/18 (afiklaw) | yes | yes | discovery_only → court_case | not usable | no | no |

Body acquisition: none of the web judgments obtained a body (`acquisition_success: false`).

## Previous run's bad sources
- בג"ץ 474/21 — did **not** survive (absent from this run's answer).
- דנ"פ 5387/20 רפי רותם — did **not** survive.
- Parental-responsibility TAU article — did **not** survive.

## Final answer this run: 2 footnotes
1. ע"פ 4988-08 איתן פרחי נ' מדינת ישראל (local DB, criminal — unrelated)
2. HUJI article on evidence for detention until end of proceedings (local DB — unrelated)

So the cited set is still wrong, though the prose now correctly names הלכת בבלי.

## Acceptance
**Pass on the stated scope.** Relevant discovered authorities — including both Bavli pages and three further rabbinical-court judgments — are no longer rejected because their web source was typed `unknown`/`academic`, and no identity/integrity/verifier gate was weakened.

## Next bottleneck (not fixed here)
**Pack selection ignores verifier-usable web judgments that have no acquired body.** Bavli/daat.ac.il carried the run's only `direct` verdict, yet the synthesis pack took one local-DB criminal judgment plus one local-DB article, because pack admission requires an acquired judgment body with in-body identity confirmation and the web judgments had none (`acquisition_success: false`, court-egress ran only for the local supremedecisions URL). The next track is body acquisition + pack selection for verifier-usable web judgments (recommended: `web_judgment_body_acquisition_and_pack_admission_v1`).

Minor observation, unactioned: two CDN hosts (`img.mako.co.il`, `img.haarets.co.il`) satisfied the two-signal test; both were harmless here (one dropped, one unused) but worth watching.
