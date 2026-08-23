# core_authority_recall_v1 — read-only diagnosis

Status of previous track: `router_profiles_v1` = **stable-initial / monitor** (closed; no changes made here).
Evidence base: `reports/internal-dogfooding-6/` (post-router run set, D1–D6, all terminal, 101–142s) + `qa_logs` metadata for the six run_ids.
No code changes, no validation reruns. The earlier MAYA-era diagnosis was moved to `DIAGNOSIS_maya_prior_track.md`.

---

## 0. Headline

The router made the pipeline fast and terminal-safe. It did **not** change *what the pipeline goes looking for*. Recall is limited by three independent bottlenecks, in decreasing order of impact:

1. **Nomination gap (planner)** — no stage ever names the canonical authority. Planner queries are doctrinal paraphrases ("פסקי דין על שלבי מבחן המידתיות"), never "בנק המזרחי", "דפי זהב", "בבלי", "פנידר". Landmark names appear in queries **only when the user typed them**.
2. **Local corpus shape** — for doctrinal questions the local hits are dominated by court-spokesperson **listing pages** (18/30 candidates in D1, D2, D3; 16/30 in D5). These are correctly marked `not_citable`, so a 30-candidate pool yields only 7–14 citable rows, mostly commentary.
3. **Last-mile citation gates** — of those citable rows, `claim_source_match` drops 6–13 refs per run as `claim_mismatch`, plus 1–5 as `commentary_in_substantive_block`. Every run ends with **2 used sources and 1–2 footnotes**, and hence the "מגבלת ביסוס" notice.

The verifier is **not** implicated: `verifier.results` is empty in all six runs (no rejections). Nothing was lost to dedup (`dup_url` count = 0 across the set; the docket-aware dedup fix from the prior track is holding).

---

## 1–2. Expected core authorities vs. observed pipeline behaviour

Legend for each authority row: **Plan** = named by analyzer/planner/facet expansion · **Query** = present in an emitted query string · **Local** = in local candidate pool · **Pplx** = in Perplexity candidates · **Pool** = dropped at candidate pool/dedup · **Ver** = verifier rejection · **Gate** = source-integrity / claim-source-match removal · **Draft** = drafter omitted despite availability.

### D1 — מבחני המידתיות (run `346b4f8b`), 14 queries, 30 candidates, 14 citable, 2 used, 1 footnote

| Expected authority | Plan | Query | Local | Pplx | Pool | Ver | Gate | Draft |
|---|---|---|---|---|---|---|---|---|
| חוק-יסוד: כבוד האדם וחירותו, ס' 8 (פסקת ההגבלה) | no (generic "חוק יסוד ... הוראות הגבלה") | generic | no | no | – | – | – | – |
| בג"ץ 6821/93 בנק המזרחי | **no** | no | no | no | – | – | – | – |
| בג"ץ 1715/97 לשכת מנהלי ההשקעות | **no** | no | no | no | – | – | – | – |
| בג"ץ 466/07 גלאון / 2605/05 המרכז האקדמי (מידתיות במובן הצר) | **no** | no | no | no | – | – | – | – |
| ספרות מידתיות (ברק; כהן-אליה ופורת) | yes (named in query) | yes | 1 (נדב דגן) | 3 | – | – | 5× `commentary_in_substantive_block` | – |

Actually cited: one compound scholarship footnote. The local pool contributed **18 listing pages** and zero constitutional judgments.

### D2 — עילת הסבירות (run `c03851e9`), 13 queries, 30 candidates, 12 citable, 2 used, 2 footnotes

| Expected authority | Plan | Query | Local | Pplx | Pool | Ver | Gate | Draft |
|---|---|---|---|---|---|---|---|---|
| בג"ץ 389/80 דפי זהב | **no** | no | no | no | – | – | – | – |
| בג"ץ 5658/23 (ביטול תיקון עילת הסבירות) | no (arrived by topical luck) | no | **yes, `judgment/full_text`** | yes | – | – | – | **cited (fn 1)** |
| בג"ץ 935/89 גנור / 3094/93 התנועה לאיכות השלטון | **no** | no | no | no | – | – | – | – |
| שיקולים זרים / חריגה מסמכות — פסיקה מובילה | facet exists, no docket | generic | no | no | – | – | – | – |
| ספרות מינהלית (זמיר, ברק-ארז) | partial | generic | 4 commentary rows, all `metadata_only` | yes | – | – | `metadata_only` → cannot carry holdings | – |

Note the topical drift in this run's pool: `תקנות שיקים ללא כיסוי`, `כללי סליקת שיקים`, `דיני מזונות אישה` were admitted as citable — the area lock did not bind statute-role queries.

### D3 — בג"ץ ובית דין רבני / רכוש (run `40865fbd`), 14 queries, 30 candidates, 12 citable, 2 used, 1 footnote

| Expected authority | Plan | Query | Local | Pplx | Pool | Ver | Gate | Draft |
|---|---|---|---|---|---|---|---|---|
| בג"ץ 1000/92 בבלי | **no** | no | no | no | – | – | – | – |
| בג"ץ 8638/03 סימה אמיר | no (topical hit) | no | **yes, `judgment/full_text`** | yes | – | – | – | **cited (fn 1)** |
| חוק יחסי ממון בין בני זוג, תשל"ג-1973 | **no** | no | incidental only | no | – | – | metadata-only when present | – |
| חוק שיפוט בתי דין רבניים (נישואין וגירושין) | title appears in one query | yes | – | – | – | – | – | not cited |
| בג"ץ 5416/09 פלוני / הלכת השיתוף | **no** | no | no | no | – | – | – | – |

13 refs dropped as `claim_mismatch` — the largest last-mile loss in the set.

### D4 — ס' 12 לחוק החוזים (run `92f8b601`), 8 queries, only 13 candidates, 7 citable, 2 used, 1 footnote

| Expected authority | Plan | Query | Local | Pplx | Pool | Ver | Gate | Draft |
|---|---|---|---|---|---|---|---|---|
| חוק החוזים (חלק כללי), ס' 12–13 | yes | yes | **yes, `statute/full_text`** ×2 | yes | – | – | – | **cited (fn 1)** |
| ד"נ 7/81 פנידר נ' קסטרו | **no** | no | no | no | – | – | – | – |
| ע"א 6370/00 קל בנין נ' ע.ר.מ. רעננה (פיצויי קיום) | **no** | no | no | no | – | – | – | – |
| ע"א 829/80 שיכון עובדים / 434/07 פרינץ | **no** | no | no | no | – | – | – | – |
| ספרות (שלו, פרידמן–כהן, ברק על תום לב) | no | no | no | no | – | – | – | – |

D4 is the cleanest illustration: the statute-first path answered from statute text alone. Its pool was only 13 candidates — the profile's query cap plus zero landmark nomination means the case-law layer was never even attempted.

### D5 — הרמת מסך, ס' 6 לחוק החברות (run `88673476`), 8 queries, 30 candidates, 14 citable, 2 used, 2 footnotes

| Expected authority | Plan | Query | Local | Pplx | Pool | Ver | Gate | Draft |
|---|---|---|---|---|---|---|---|---|
| חוק החברות, ס' 6 (ותיקון מס' 3) | yes | yes | yes — but 5 of 6 copies `metadata_only` | yes | – | – | metadata-only gate | one `statute/full_text` used |
| ע"א 4263/04 קיבוץ משמר העמק | no | no | **yes** | – | – | – | classified `commentary` → `commentary_in_substantive_block` | dropped |
| ע"א 2773/04 עטר נ' נצבא | no | no | **yes** | – | – | – | classified `commentary` | dropped |
| ע"א 10582/02 בן אבו / אחריות אישית של נושא משרה | **no** | no | no | no | – | – | – | – |
| ע"א 5072/19 שווארמה א.ש | no | no | yes `judgment` | – | – | – | – | **cited (fn 1)** — a tax-adjacent veil case, not the leading authority |

D5 shows failure mode (3): two genuine veil-piercing Supreme Court judgments were in the pool and were removed by classification/claim-match, while a weaker case became the footnote.

### D6 — טרור, ענישה ואכיפה (run `b0443e03`), 14 queries, 30 candidates, 12 citable, 4 used, 2 footnotes

| Expected authority | Plan | Query | Local | Pplx | Pool | Ver | Gate | Draft |
|---|---|---|---|---|---|---|---|---|
| חוק המאבק בטרור, התשע"ו-2016 | no (topical hit) | no | yes — 4 copies, 3 `metadata_only`, 1 `substantive_excerpt` | yes | – | – | metadata-only gate on 3 | partially used |
| ס' 20–24 (החמרה בענישה) / הכרזות ס' 2–6 | **no** | no | no | no | – | – | – | – |
| פקודת מניעת טרור / צווי מעצר מנהלי | **no** | no | no | no | – | – | – | – |
| פסיקה מובילה על אכיפה בררנית (בג"ץ 6396/96 זקין) | **no** | no | no | no | – | – | – | – |
| ע"פ 3793/18 פלוני | no | no | yes | – | – | – | – | **cited (fn 1)** |

Also present: 2 `class_government_report_not_admitted_for_scholarship` drops — Knesset research-centre papers, which are exactly the right background for an enforcement-equality question.

---

## 3. Failure classification

| Failure class | D1 | D2 | D3 | D4 | D5 | D6 | Share of missing core authorities |
|---|---|---|---|---|---|---|---|
| Planner did not name the authority | ●●● | ●●● | ●●● | ●●● | ●● | ●●● | **~70%** — dominant |
| Query too generic (doctrine paraphrase, no docket/party name) | ● | ● | ● | ● | ● | ● | overlaps the above |
| Corpus missing the source locally | ● (constitutional canon) | ● | ● (בבלי) | ● (contract canon) | – | ● | ~15% |
| URL/body acquisition failed | – | – | – | – | – | – | 0 this set |
| Verifier rejected | – | – | – | – | – | – | **0** (verifier ran empty) |
| claim_source_match dropped | 4 | 7 | **13** | 6 | 7 | 8 | **the last-mile loss** |
| Source label / citability issue (`commentary`, `metadata_only`, `listing_page`) | 5 | 3+4 md | 1+5 md | – | 3 | 1+3 md | large, structural |
| Drafter omitted despite availability | rare | rare | rare | rare | **yes (D5)** | rare | small |

Plain reading:
- **Nothing is being rejected for being wrong.** Recall dies before retrieval (nothing asked for the canon) and again after retrieval (right documents present, wrong label or wrong claim binding).
- The `not_citable` listing-page flood is not a bug in the gates — it is a signal that local vector search on doctrinal phrasing hits the court **spokesperson index**, not judgment bodies.
- `claim_mismatch` at 6–13 drops/run is now the single largest post-retrieval loss and deserves calibration (it currently requires the verifier's per-claim binding, which is empty in these runs — so *any* source lacking a binding looks mismatched).

---

## 4. Recommended minimal implementation path

**Recommendation: C — hybrid, staged, in this order.**

**Stage 1 (highest yield, lowest risk) — B: small curated doctrine registry (`core_authority_registry_v1`).**
A hand-written map: doctrine key → 3–6 canonical authorities (name + docket/section + area), covering ~30 doctrines that already exist as facets in `claimFacetExpansion.ts` (מידתיות, סבירות, שיקולים זרים, תום לב במו"מ, הרמת מסך, הלכת השיתוף/יחסי ממון, אכיפה בררנית, …). When a facet fires, emit **at most 2 extra name-anchored queries** for its seminal authorities (`"בג\"ץ 6821/93 בנק המזרחי"`, `"ע\"א 6370/00 קל בנין תום לב במשא ומתן"`). Deterministic, auditable, no model cost, no new stage in the hot path — it reuses the existing query list and the existing router query caps (raise the cap by +2 only on `doctrine_explainer` and `research_memo`).

**Stage 2 — D: two narrow query-expansion rules.**
(a) statute-title normalisation (the planner still emits informal titles); (b) when a facet's role is `binding_case_law` and every returned candidate is `listing_page`/`metadata_only`, re-issue **one** query restricted to judgment-body endpoints instead of accepting the listing flood.

**Stage 3 — calibrate the last mile (not a recall feature, but where the citations are actually lost).**
Allow a source to satisfy `claim_source_match` when verifier bindings are absent by falling back to facet+area agreement, and let a Supreme Court judgment classified `commentary` only because of its host domain be re-tested against `strongJudgmentIdentity`. This alone would have kept משמר העמק and עטר in D5.

**A (model-suggested expected authorities)** — defer. It re-adds a model call per query, is the main hallucination surface (invented dockets), and would need a verification pass, which is precisely the heavy path we just removed. Use it later only as a *fallback* when the registry has no entry, and only with a hard rule that a suggested docket must be retrieved before it can be named.

**E (local corpus enrichment)** — genuinely needed but slow; run it as an offline backlog track: ingest the ~200 canonical judgments referenced by the registry so Stage 1's queries hit local full text instead of the open web.

---

## 5. Cost / risk — recall without returning to the heavy path

| Lever | Added cost per run | Why it does not re-open the heavy path |
|---|---|---|
| Registry-driven name queries (+2 max) | +2 retrieval queries, ~4–8s | Fixed, deterministic ceiling; no new extraction, no PDF preflight change |
| Statute-title normalisation | ~0 | String-level, pre-retrieval |
| Judgment-body re-query on listing flood | +1 query, conditional | Fires only when the pool is already worthless; net *reduces* wasted candidates |
| claim_source_match fallback | 0 | Pure gate calibration |
| Corpus enrichment | 0 at runtime | Offline ingestion |

Ceiling: **+3 queries and ~+15s worst case**, well inside current profile budgets (101–142s against the router's wall-clock caps). No change to extraction, PDF preemption, footnote invariant, terminal fallback or routing — the three CPU-death mechanisms from the pre-router era are all extraction-side, and none of the proposals above touch extraction.

Main risk to watch: registry entries that are stale or wrong would push a *named* authority into the answer. Mitigation: the registry only seeds **queries**, never citations — an authority still has to be retrieved, classified and matched before it can be cited, so a bad entry costs one wasted query and nothing else.

---

## 6. Suggested next track (not opened)

`core_authority_registry_v1` — Stage 1 + Stage 2(a) only, default-on for `doctrine_explainer` / `research_memo` / `statute_first`, validated on D1–D6 with acceptance: ≥3 footnotes on at least 4/6, zero new CPU kills, runtime ≤ +20s, zero dangling markers.
