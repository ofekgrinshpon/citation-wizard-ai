# core_authority_registry_v1 — validation report

Status: **NOT accepted.** Stage 1 + Stage 2(a) implemented and validated; acceptance
criteria partially met. One narrow trigger fix was applied and re-validated (D3).

Scope of code in this track: query seeding + statute-title normalization only.
No gate, verifier, drafter, footnote or classification behaviour was changed.

## 1. Result table

| ID | status | ms | doctrine triggered | seeded queries | statute rewrites | footnotes | dangling | orphan | metadata-only holdings |
|---|---|---|---|---|---|---|---|---|---|
| D1 | done | 142.3s | proportionality | 2 | 0 | 1 | 0 | 0 | none |
| D2 | done | 111.1s | reasonableness | 2 | 0 | 2 | 0 | 0 | none |
| D3 (pre-fix) | done | 131.3s | **none** (`no_doctrine_match`) | 0 | 1 | 3 | 0 | 0 | none |
| D3 (post-fix) | done | 122.3s | rabbinical_civil_property | 2 | 1 | 1 | 0 | 0 | none |
| D4 | done | 111.1s | precontractual_good_faith | 2 | 5 | 1 | 0 | 0 | none |
| D5 | done | 111.0s | piercing_corporate_veil | 2 | 5 | 1 | 0 | 0 | none |
| D6 | done | 191.4s | selective_enforcement | 1 | 3 | 3 | 0 | 0 | none |
| R02 (control) | done | 211.7s | constitutional | 1 | 0 | 0 | 0 | 0 | none |
| P02 (control) | done | 91.0s | none | 0 | 0 | 0 | 0 | 0 | none |
| B8 (control) | done | 80.9s | none | 0 | 0 | 1 | 0 | 0 | none |
| NOISE (control) | done | 151.3s | none | 0 | 0 | 1 | 0 | 0 | none |

All 11 runs reached terminal state. No CPU kills, no stale reaper closures,
zero dangling markers, zero orphan source rows, zero metadata-only holdings.

## 2. Where the registry-seeded authorities disappeared (D1 / D4 / D5)

Per-authority ledger (`retrieved → admitted → body_acquired → used`).

### D1 — proportionality
| authority | outcome | disappearance point |
|---|---|---|
| חוק-יסוד: כבוד האדם וחירותו ס׳ 8 | retrieved ✔ admitted ✔ body ✘ used ✘ | **body not acquired** — statute page admitted as a source but no section text; the drafter then had no quotable limitation-clause text, and `claim_source_match` dropped the ref against the proportionality-tests block. |
| בג"ץ 6821/93 בנק המזרחי | retrieved ✔ admitted ✔ body ✘ used ✘ | **claim_source_match dropped** — candidate present as metadata/reference only (no holding text), so the substantive blocks could not bind it. |
| בג"ץ 1715/97 לשכת מנהלי ההשקעות | retrieved ✘ | **query emitted but no candidate found** — the name-anchored query returned only listing/index pages, which `source_integrity` rejects as non-citable. |

Net effect: the single surviving footnote is commentary ("רבע מאה למהפכה החוקתית"),
i.e. the answer is topically right but authority-thin. `claim_source_match` dropped
8 refs (`claim_mismatch`, `commentary_in_substantive_block`) and left 4 unsupported blocks.

### D4 — precontractual good faith (s.12)
| authority | outcome | disappearance point |
|---|---|---|
| חוק החוזים ס׳ 12 | retrieved ✔ admitted ✔ body ✔ **used ✔** | success — carries the only footnote. |
| ד"נ 7/81 פנידר נ' קסטרו | retrieved ✘ | **query emitted, no candidate** — no free full-text endpoint surfaced; results were digest/listing pages filtered before admission. |
| ע"א 6370/00 קל בנין | retrieved ✘ | **query emitted, no candidate** — same pattern. |

### D5 — piercing the corporate veil (s.6)
| authority | outcome | disappearance point |
|---|---|---|
| חוק החברות ס׳ 6 | retrieved ✔ admitted ✔ body ✔ **used ✔** | success. |
| ע"א 4263/04 משמר העמק | retrieved ✘ | **query emitted, no candidate** (listing/index results only). |
| ע"א 2773/04 עטר נ' נצבא | retrieved ✘ | **query emitted, no candidate**. |

### Cross-run pattern
- **Statutes seed reliably** (D4, D5 body acquired and used; D1 statute retrieved but
  body-less).
- **Case-law authorities fail almost entirely at retrieval**: 7 of 9 seeded case
  authorities across D1/D4/D5/D6 never produced an admissible candidate. This is a
  *source-availability / listing-page* problem, not a registry problem — the correct
  name-anchored query was emitted every time.
- Where a case candidate *is* found (D2 דפי זהב, D3 סימה אמיר) it survives all the
  way to the footnotes. So the last mile is fine once a real document exists.
- Conclusion: **do not patch footnote counts.** The remaining gap is judgment-text
  acquisition for canonical cases, which belongs to a separate track
  (`canonical_judgment_text_acquisition_v1`, see §6).

## 3. D3 — trigger diagnosis and fix

- **Exact query text:**
  `מתי בג״ץ יתערב בהחלטה של בית דין רבני בענייני רכוש בין בני זוג, במיוחד כאשר נטען שבית הדין החיל דין דתי במקום דין אזרחי?`
- **Normalized terms (statute-title normalization, 1 rewrite applied):**
  `חוק בתי הדין הרבניים (נישואין וגירושין), התש"י-1953` →
  `חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי"ג-1953`.
  Normalization worked; only the doctrine trigger failed.
- **Why the doctrine did not fire:** the trigger required the court phrase with the
  definite article — `בית\s+הדין\s+הרבני` / `בתי\s+הדין\s+הרבניים`. The user wrote
  the indefinite natural form **`בית דין רבני`**. Everything else matched (the
  property signal `רכוש` appears 6 characters later, well inside the 80-char window).
- **Missing required trigger term:** the `ה` definite article in `הדין`/`הרבני`.
- **Adjustment applied:** court phrase is now
  `(?:בית|בתי)[\s\u05be-]+ה?דין[\s\u05be-]+ה?רבני(?:ים)?` — definite article optional,
  singular/plural, tolerant of maqaf/hyphen separators.
- **Over-trigger controls (unchanged, deliberately):** a civil-property signal
  (`רכוש|ממון|שיתוף|איזון`) must still appear within 80 characters of the court
  phrase. Verified behaviour:
  | probe | fires |
  |---|---|
  | D3 query (`בית דין רבני ... רכוש`) | yes |
  | `מתי בית הדין הרבני מוסמך לכפות גט סרבן?` | no |
  | `סמכות בתי הדין הרבניים באיזון משאבים` | yes |
  | `מהם השלבים בהגשת תביעת גירושין?` | no |
- **Post-fix D3 run:** triggered `rabbinical_civil_property`, 2 seeded queries,
  בבלי + סימה אמיר both retrieved and admitted, **סימה אמיר used in the final answer**.
  Footnotes went 3 → 1, but quality rose: the pre-fix run's third footnote was
  `רע"א 1487/23 זוהר כץ נ' ראז חקלאות` — an unrelated commercial matter. The post-fix
  answer cites the on-point HCJ authority instead.

## 4. Controls

| control | expectation | result |
|---|---|---|
| R02 (real docket, exact body) | terminal, no fabrication | done in 211.7s; substantive answer; **0 footnotes** — flagged below |
| P02 (fake docket) | deterministic refusal, no seeded authority leakage | pass — clean `docket_limitation` refusal, upload invitation, no registry seeding |
| B8 (canonical quote) | verbatim s.1 from official text | pass — 1 footnote, official PDF, verbatim |
| NOISE (generic civil procedure) | no registry trigger, no canonical authority injected | pass — `no_doctrine_match`, 0 seeded queries |

Two residual observations (neither caused by this track):
- **R02 returned 0 footnotes with a substantive body.** The registry seeded the
  Mizrahi/limitation-clause authorities but no citable body was acquired, and every
  ref was dropped at claim-source-match — leaving prose with no citations. This is a
  drafter-side gap (should degrade to a limitation notice, not uncited prose).
- **NOISE footnote 1** is a compound label pairing `ע"א 7791/19 שלה אמין` with
  `תקנות סדר הדין האזרחי` — a compound-label hygiene issue already tracked in
  `source_label_quality_v2_unread_sources`.

## 5. Acceptance status

| criterion | status |
|---|---|
| D3 trigger works when appropriate | **met** (post-fix; over-trigger probes clean) |
| Controls R02/P02/B8/NOISE pass | **partially met** — P02/B8/NOISE pass; R02 terminal and non-fabricating but returns an uncited body |
| No irrelevant registry-seeded authority in final footnotes | **met** — every seeded authority that reached a footnote (דפי זהב, סימה אמיר, ס׳ 12, ס׳ 6) is on-point; no seeded authority appeared in P02/NOISE |
| No metadata-only holdings | **met** — 0 across all 11 runs |
| Source quality improves, not just query count | **partially met** — improved in D2, D3 (post-fix), D4, D5 (canonical primary sources now carry the answer); unchanged in D1, D6, R02 where canonical judgments were never retrievable |

**Overall: not accepted.** Two blockers remain, both outside this track's code:
canonical judgment-text availability, and R02's uncited body.

## 6. Recommended next tracks (no code written)

1. `canonical_judgment_text_acquisition_v1` — for registry authorities with a known
   docket, resolve directly to court-archive / text-endpoint URLs instead of relying
   on general search, so 6821/93, 7/81, 6370/00, 4263/04, 2773/04, 6396/96 stop
   dying at "no candidate".
2. `uncited_body_degradation_v1` — when claim-source-match strips every ref from a
   substantive answer (R02), emit the existing Hebrew limitation notice rather than
   uncited prose.
