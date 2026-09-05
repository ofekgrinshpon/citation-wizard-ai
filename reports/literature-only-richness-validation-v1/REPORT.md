# literature_only_richness_validation_v1 — live validation (no code, prompt, or deploy changes)

Two literature-only academic queries were run against the currently deployed
`legal-research-v1`. No code, prompts, retrieval, admission, CSM, alignment,
drafter, footnote rendering, relay or Hebrew style were modified.

Raw artifacts: `results.json`, `L1_answer.md`, `L2_answer.md`.

---

## 1. Final answers and footnotes

### L1 — literature-only reasonableness (`run_id e07ee4fa-deb0-4ed6-8aa8-f71b6debaab1`)

Full answer: `L1_answer.md`. Footnotes: **1**

1. נדב דגן, "מידתיות חוקתית, סבירות מנהלית: הסדרה משפטית של שיקול דעת שלטוני בראי המשפט המקובל", 461 (כרך ט"ו) — `law.haifa.ac.il` (journal_article)

The same footnote marker (¹) is attached to six consecutive paragraphs; there is
exactly one distinct cited source in the whole review.

### L2 — literature-only administrative promise / reliance (`run_id 3ff1d781-c118-497e-a968-3226be43ea76`)

Full answer: `L2_answer.md`. Footnotes: **2**

1. "הגנת ההסתמכות במשפט המנהלי" — `lawjournal.huji.ac.il` (journal_article) — directly on topic.
2. עידו סיון-סביליה, "מודלים רגולטוריים לניהול סיכוני סייבר בממשל הפדרלי בארה"ב – מחקר השוואתי" (כרך י"ד) — `law.haifa.ac.il` — **off-topic filler** (US cyber-risk regulation), used to support the paragraph criticising enforcement of governmental promises.

---

## 2. Basic metrics

| metric | L1 | L2 |
|---|---|---|
| run_id | e07ee4fa-deb0-4ed6-8aa8-f71b6debaab1 | 3ff1d781-c118-497e-a968-3226be43ea76 |
| total_ms (pipeline) | 225,769 | 391,696 |
| total_ms (client, incl. poll) | 227,797 | 394,432 |
| retrieval_ms | 73,906 | 107,013 |
| drafter_ms | 26,908 | 30,389 |
| raw sources found | 308 | 364 |
| admitted sources (post-dedupe pool) | 12 | 21 |
| body-acquired sources | 8 | 6 |
| sources in drafter pack | 2 | 2 |
| representative sources selected | 1 | 1 |
| model-emitted refs | 2 | 2 |
| post-CSM kept refs | 2 | 2 |
| alignment-kept refs | 2 | 2 |
| final footnotes | 1 | 2 |
| distinct cited sources | 1 | 2 |

Academic admission gate: L1 reviewed 18 candidates, admitted 6, rejected 12;
L2 reviewed 24, admitted 7 (2 scholarship + 5 government_report), rejected 22.
Both packs still collapsed to **2** sources at the drafter.

---

## 3. Literature-source funnel (strongest literature candidates)

| source | type | host/journal | found | admitted | body | in_pack | representative | emitted | survived_CSM | cited | loss_reason |
|---|---|---|---|---|---|---|---|---|---|---|---|
| נדב דגן — מידתיות חוקתית, סבירות מנהלית (L1) | direct_doctrinal_scholarship | law.haifa.ac.il / משפט וממשל | ✔ | ✔ | ✔ 16k | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| בכמה קולות מדברת המדינה? (L1) | theoretical_normative_scholarship (adjacent) | TAU Law Review | ✔ | ✔ | ✔ 16k | ✔ | ✘ | ✔ | ✔ | ✘ | footnote_builder_or_reference_only |
| מ' שפירא — על סבירותה של עילת הסבירות (L1) | direct_doctrinal_scholarship | old.lawforum.org.il | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | — | ✘ | `discovery_only` — never body-acquired |
| פסק הדין הסבירות: עיונים ראשונים, מחקרי משפט כד (L1) | direct_doctrinal_scholarship | idi.org.il | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | — | ✘ | `class_unknown_has_no_secondary_academic_slot` |
| חוות דעת IDI: ביטול עילת הסבירות ושלטון החוק (L1) | policy_or_institutional_literature | idi.org.il | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | — | ✘ | no academic slot |
| סבירות על חוקתיות (L1) | critique_or_counterposition | hapraklit.co.il | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | — | ✘ | `no_credible_academic_provenance` |
| סולברג — מתווה הסבירות (השילוח) (L1) | critique_or_counterposition | dyoma.co.il | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | — | ✘ | `class_unknown_has_no_secondary_academic_slot` |
| INSS — הבג"ץ בעניין עילת הסבירות (L1) | policy_or_institutional_literature | inss.org.il | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | — | ✘ | slotted `primary_statute`, then rejected |
| אלעד שילד — אחריות סוכנויות נסיעות (L1) | off_topic | law.haifa.ac.il | ✔ | ✔ | ✔ 16k | ✘ | ✘ | ✘ | — | ✘ | off-topic local-DB body spend |
| חידושים ומגמות בדיני תאגידים (L1) | off_topic | law.haifa.ac.il | ✔ | ✔ | ✔ 16k | ✘ | ✘ | ✘ | — | ✘ | off-topic local-DB body spend |
| הגנת ההסתמכות במשפט המנהלי (L2) | direct_doctrinal_scholarship | lawjournal.huji.ac.il / משפטים | ✔ | ✔ | ✔ 16k | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| שרון ידין — הזוג המוזר: הבטחה מנהלית וחוזה רגולטורי (L2) | direct_doctrinal_scholarship | israeliconstitutionalism.wordpress.com | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | — | ✘ | `no_credible_academic_provenance` (blog mirror of an academic paper) |
| יואב דותן — ביקורת שיפוטית על שיקול דעת מינהלי (L2) | book/chapter | nli.org.il catalogue | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | — | ✘ | catalogue record, `off_topic_for_question_and_roles` |
| Craig — The Coherence of Legitimate Expectations (L2) | comparative_scholarship | cambridge.org | ✔ | gate-passed | ✘ | ✘ | ✘ | ✘ | — | ✘ | `class_unknown_not_admitted_for_scholarship`; would in any case be foreign law |
| סיון-סביליה — מודלים רגולטוריים לסיכוני סייבר (L2) | off_topic (comparative US regulation) | law.haifa.ac.il | ✔ | ✔ | ✔ 16k | ✔ | ✘ | ✔ | ✔ | ✔ | **cited despite being off-topic** |

---

## 4. Literature-only compliance

- Case law cited: **no** (neither answer carries a judgment footnote).
- Statutes cited: **no**.
- General web / news / blog / law-firm / Wikipedia / generic summary cited: **no** — those candidates were rejected at admission (`commercial_seo_page`, `bad_source`, `listing_or_search_page`).
- Violation: none of the prohibited categories were cited. The formal
  literature-only constraint is satisfied. The substantive failure is different:
  in L2 an unrelated academic article (US cyber-regulation) was used as
  literature filler, and both answers close with a boilerplate note telling the
  student to "complete precise references to case law and literature", which
  partly contradicts the literature-only instruction.

---

## 5. Source quality (cited sources only)

**L1 — נדב דגן, "מידתיות חוקתית, סבירות מנהלית: הסדרה משפטית של שיקול דעת שלטוני בראי המשפט המקובל"**, משפט וממשל / Haifa, vol. ט"ו, journal article, direct doctrinal scholarship on exactly the reasonableness–proportionality axis; body acquired (16,000 chars, local DB + PDF). It genuinely supports the paragraph on the reasonableness/proportionality relationship; it does **not** support the paragraphs on judicial activism, rule-of-law necessity, or the contemporary constitutional debate, where the same marker is reused.

**L2 — "הגנת ההסתמכות במשפט המנהלי"**, משפטים (HUJI law journal), author not captured in the record, year not captured; direct doctrinal scholarship on reliance protection; body acquired (16,000 chars). Directly supports the theoretical-foundation, distinction and justification paragraphs.

**L2 — עידו סיון-סביליה, "מודלים רגולטוריים לניהול סיכוני סייבר בממשל הפדרלי בארצות הברית"**, Haifa law review vol. י"ד; body acquired; **adjacent at best — in truth off-topic**. It does not support the sentence about the institutional costs of enforcing governmental promises; the drafter even bends the prose ("מודלים רגולטוריים") to fit the source rather than the reverse.

---

## 6. Unused good literature

- **בכמה קולות מדברת המדינה? על מתן מעמד לרשות חולקת** (TAU Law Review, L1) — role: theoretical/institutional scholarship; body acquired; emitted by the model and survived CSM and alignment, then lost at `dropped_before_footnotes` (`footnote_builder_or_reference_only`). Adjacent rather than direct; a footnote would have been defensible but it is not core reasonableness literature.
- **מ' שפירא, "על סבירותה של עילת הסבירות"** (Israel Law Forum PDF, L1) — the single most on-point critique found; dropped as `discovery_only`, i.e. discovered but never body-acquired, so it never reached admission.
- **"פסק הדין הסבירות: עיונים ראשונים", מחקרי משפט כד** (IDI-hosted PDF, L1) — a peer journal issue devoted to the topic; rejected because its class stayed `unknown` and there is no secondary academic slot for `unknown`.
- **שרון ידין, "הזוג המוזר: הבטחה מנהלית וחוזה רגולטורי"** (L2) — directly on the L2 topic; rejected only because the copy found sits on a WordPress mirror (`no_credible_academic_provenance`).
- **יואב דותן, ביקורת שיפוטית על שיקול דעת מינהלי** (L2) — the canonical Israeli treatise; found only as a library catalogue record, so no body and no citation.

All five should have been citable in a real literature review; four were lost before the pack.

---

## 7. Synthesis assessment

**L1** — Does not synthesize among sources: with one cited source there is nothing to synthesize. It does present competing positions (vagueness critique vs. rule-of-law necessity; overlap vs. distinction with proportionality), but attributes them to anonymous "הספרות" / "כותבים מסוימים" rather than to named scholars. It distinguishes descriptive doctrine, normative critique and institutional argument at the level of prose structure only. It does not let the literature structure the answer — the structure is the user's own question outline. It avoids case-law and statute filler. It would give a student a paragraph skeleton and exactly one real reference: not enough to start a seminar paper.

**L2** — Slightly better: two sources, one of them squarely on point, and a genuinely clean conceptual separation between promise, reliance and legitimate expectation, plus institutional-cost critique (regulatory chill, budget, intergenerational commitment) and remedial middle grounds (transition periods, sunset clauses). Still no named scholarly positions, no disagreement mapped between identified authors, and one of its two footnotes is off-topic. Also unhelpful for a seminar bibliography.

Both answers correctly declare the source base is thin, which is honest but confirms the finding.

---

## 8. Quality scores (1–10)

| dimension | L1 | L2 |
|---|---|---|
| source relevance | 6 | 5 |
| source quality | 7 | 6 |
| source diversity | 2 | 2 |
| literature-only compliance | 9 | 8 |
| synthesis | 3 | 4 |
| academic richness | 3 | 3 |
| citation precision | 3 | 3 |
| Hebrew naturalness | 6 | 6 |
| product usefulness | 3 | 3 |

Hebrew is readable but contains artefacts: "מטולוגיה", "ארטראריות", "תודולוגיות", "הקטגוריונית", "הציפייה הגיטימית", and stray Latin ("sunset clauses").

**Acceptance standard: FAILED.** Neither query produced several distinct
legal-scholarship sources with meaningful synthesis.

---

## 9. Diagnosis

- **Are literature-only answers richer than mixed doctrine/case-law answers?**
  No. They are equally thin — 1 and 2 footnotes, versus 2–4 in the recent mixed
  runs. Removing the need for canonical judgments did not increase richness.
- **Is canonical judgment acquisition still the main blocker?** No. These runs
  needed no judgment at all, and still collapsed to a 2-source pack. There is an
  **independent academic source-use thinness**.
- **Where is the loss?** Not (a): discovery found 308/364 raw candidates,
  including the right Israeli literature. The loss is concentrated in:
  - **(b) academic admission** — dominant. `class_unknown_has_no_secondary_academic_slot`
    (12 in L1, 16 in L2), `no_credible_academic_provenance` (4 / 15),
    `insufficient_academic_signals` (6 / 20). Real scholarship on IDI, hapraklit,
    השילוח, a WordPress mirror of an academic paper, and NLI catalogue records is
    all rejected, while the pack is topped up from generic local-DB journal PDFs.
  - **(c) body acquisition for literature** — secondary. The best direct critique
    in L1 was dropped as `discovery_only` (no fetch attempted); web body
    acquisition ran 0 web attempts in L1 (`web_attempts: 0`) and only local hits.
  - **(d) pack selection** — the local-DB body budget was spent on off-topic
    articles (travel agencies, corporate law, institutional investors, consumer
    credit algorithms, cyber-risk), so 6–8 bodies yielded only 2 usable ones.
  - **(f) drafter under-use** — mild: the model emitted both pack sources; it
    simply had 2 to work with, and reused a single marker across six paragraphs.
  - (e), (g), (h) are **not** blockers here: representative use was 5/5 and 3/3,
    CSM and alignment dropped nothing (0 removals), and the footnote builder lost
    only one adjacent ref in L1.
  - (i) Hebrew style is a real but secondary defect.

---

## 10. Final recommendation

**literature_source_use_is_still_thin**

Concretely: the next track should be academic admission and literature body
acquisition — allow `class: unknown` Israeli scholarship with strong title and
journal/institute signals (IDI מחקרי משפט, הפרקליט, השילוח, faculty and
constitutionalism blogs mirroring named academic papers) into a secondary
academic slot, attempt body acquisition for `discovery_only` scholarship PDFs
before dropping them, and gate the local-DB body budget on topical fit so it is
not consumed by unrelated journal articles. Court-canonical URL resolution is
**not** the blocker for this class of task.
