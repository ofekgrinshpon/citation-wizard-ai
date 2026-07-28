# C2 — Case-law synthesis capability (diagnostic only)

Run date: 2026-07-28. No code, prompt, retrieval, verifier or sufficiency changes were made.
Raw dumps: `reports/c2-synthesis-diagnostic/{C2,C1,A,B,E,B8,B2}.json`.

## 1. C2 — "מה הפסיקה אומרת על הלכת השיתוף?"

### 1. Analyzer
| field | value |
|---|---|
| legal_area | דיני קניין / אזרחי (**wrong** — this is דיני משפחה / יחסי ממון) |
| answer_type | doctrinal_explanation |
| output_shape | analysis |
| confidence | 0.8 |
| claims | C1 definition · C2 founding/developing caselaw · C3 scope of application · C4 limits/exceptions · C5 practical/procedural |

Claim decomposition is actually good — it maps onto the requested synthesis skeleton (core doctrine → applying cases → limits). Required roles were `binding_case_law` + `scholarship` on almost every claim.

### 2. Shape override
None. `analysis` stood; `lead_ref` = `shape_not_eligible` (as designed — lead_ref is only enabled for case_holding/definition/quote).

### 3. Planner — 13 queries
No query asked for **primary_statute**. Zero mentions of חוק יחסי ממון בין בני זוג, תשל"ג-1973, and zero named landmark cases.

| claim | role | targets | query_he |
|---|---|---|---|
| C1 | binding_case_law | local_db | "הלכת השיתוף" "בית המשפט העליון" הגדרה דוקטרינרית עקרון השיתוף פסק דין מייסד |
| C1 | scholarship | perplexity | מאמר "הלכת השיתוף" הגדרה דוקטרינרית … כתב־עת משפטי |
| C2 | binding_case_law | local_db | פסיקה מייסדת "הלכת השיתוף" … |
| C2 | persuasive_case_law | local_db | "הלכת השיתוף" "בית משפט מחוזי" … |
| C2 | scholarship | perplexity | מאמרים "הקמת הלכת השיתוף" … |
| C3 | binding_case_law | local_db | "הלכת השיתוף" היקף החלה סוגי נכסים … |
| C3 | scholarship | perplexity | היקף החלת "הלכת השיתוף" … |
| C4 | binding_case_law | local_db | "הלכת השיתוף" חריגים מגבלות … |
| C4 | persuasive_case_law | local_db | מקרים מחוזיים "נדחתה בקשה לשיתוף" … |
| C4 | scholarship | perplexity | מאמר ביקורתי "מגבלות הלכת השיתוף" … |
| C5 | binding_case_law | local_db | "הלכת השיתוף" סעדי בית המשפט … |
| C5 | scholarship | perplexity | מדריך פרקטי "הלכת השיתוף" … |
| C5 | factual_report | perplexity | דו"ח משרד המשפטים … |

**All caselaw queries were sent to `local_db` only.** Perplexity was used exclusively for scholarship/reports. The corpus has no Supreme Court family-law judgments, so the caselaw lane was structurally dead.

### 4. Local retrieval
- exact_authority: **0** · text: **41** · vector: **26**
- preserved phrase: `"הלכת השיתוף"` (phrase preservation worked)
- text hits are almost entirely **gov.il court-spokesperson press-release blurbs** (family courts, first instance), not judgments.
- text_authority_signal fired → vector budget shrank; no landmark case surfaced via vector either.

### 5. Perplexity
6 queries, 200 OK on all; 17 results dropped by hygiene, 10 admitted.
Admitted set includes **fabricated / placeholder URLs that passed hygiene at score 0.75**:
- `https://ssrn.com/abstract=...` (literal ellipsis) — "Family Law in Israel"
- `https://www.jstor.org/stable/sample` — "הלכת השיתוף והשלכותיה על דיני הקניין בין בני זוג"
- `https://www.jstor.org/stable/sample2` — "הלכת השיתוף: בין יצירה שיפוטית…"
- `https://www.jstor.org/action/doBasicSearch?Query=הלכת+השיתוף` (a search page)
- `ע"א 52/80 שחר נ' פרידמן` mapped to `gov.il/BlobFolder/generalpage/spotify-floater-2/he/sf-21.pdf`

Only one Perplexity item is a genuine, verifiable doctrinal source (`nevo.co.il/.../specific_shituf.pdf`, plus `law.biu.ac.il/.../hacalathshitufhspezifi.pdf`).

### 6. Candidate pool
found **79** → after_dedup **19**. Drops: `dup_url` 47, `vector_quota_per_claim` 12, `dup_document_id` 1.

**The dominant drop reason is an artifact, not a quality filter.** `normUrl()` strips the query string, so every gov.il spokesperson page (`…/spokmanship_court?skip=40`, `?skip=90`, `?skip=250`, `?skip=1110` …) collapses to one key and 40+ distinct rulings are discarded as "duplicates" — including several on-topic ones:
- "פס"ד הצהרתי וסילוק יד … מכוח הלכת השיתוף הספציפי (תלה"מ 43598-07-21)" — dropped `dup_url`
- "בחינת כוונת שיתוף ספציפי" (מחוזי מרכז, 0.355) — dropped `dup_url`
- "תובענה לשיתוף רכושי (תמ"ש 62952-05-20)" — dropped `dup_url`

No Supreme Court leading authority was dropped, because none was ever retrieved. What *was* lost to the dedup artifact were the applying/limiting lower-court cases (layer 3–4 of the requested pack).

### 7. Verifier
19 verified · direct 3 · partial 9 · tangential 2 · unrelated 5 → **12 usable**. Verifier behaved sensibly (killed the procedural press-release noise, kept the שיתוף material). Not the bottleneck.

### 8. source_sufficiency
`applied: true`, `category: case_law_synthesis`, `sufficient: **true**`, reason `case_law_synthesis_supported`, `thin_source: false`.
topic_phrases = `["הלכת השיתוף"]`; topical_refs = s1, s5, s6, s7, s11; topical_authority_refs = **s1 (ע"א 52/80 via the odd gov.il PDF), s11 (jstor "sample2" — fabricated)**.
→ The gate passed on a pack whose two "authorities" are one peripheral 1980 judgment and one non-existent article. **Too loose in this configuration**: it counts topicality but not authority level or URL reality.

### 9. Final used_sources (11 of 12 passed)
| type | items |
|---|---|
| caselaw | ע"א 52/80 שחר נ' פרידמן (1) |
| scholarship / journal_article | 6 (2 of them fabricated jstor/ssrn) |
| other / factual_report | 3 (incl. gov.il "בקשה לרישום הסכם שיתוף" service page) |
| statute | **0** |

No חוק יחסי ממון, no בבלי, no יעקובי/קנוביץ, no ע"א 4623/04, no הדרי/שיתוף-ספציפי line from the Supreme Court.

### 10. Final answer
- Did it synthesize a line of case law? **No.** It produced a doctrinal essay anchored on a single 1980 case plus commentary; there is no chronological/authority line, no "leading case → applying cases → limiting developments".
- Did it identify the doctrine correctly? **Broadly yes** (חזקת שיתוף based on אורח חיים תקין ומאמץ משותף) — but that content comes from a snippet, not from controlling authority.
- Pre/post חוק יחסי ממון, spouses vs. common-law partners? **Not addressed at all** — correctly, since nothing in the pack supported it, but it means the answer is materially incomplete for the question asked.
- Overstatement? **Yes.** "פסק-דין ע"א 52/80 הוא נקודת הציון המרכזית שמנסחת את חזקת השיתוף" and "מהווה אבן-וסד" elevate a peripheral judgment to leading-authority status — an assertion the sources do not support. Two footnotes cite fabricated URLs.

## 2. Controls

| id | shape | branch | passed/used | verdict |
|---|---|---|---|---|
| C1 false doctrine | analysis | none | 7/7 | **Partial pass.** Did not invent "הלכת יורש אחר יורש" as a named הלכה, correctly grounded it in **סעיף 42 לחוק הירושה** and distinguished it from השתק פלוגתא. But the sufficiency gate now reports `sufficient: true` (topical refs s3/s5/s7 from real inheritance sources) so it answered substantively instead of the limited answer seen last run. Retrieval got better; the "false doctrine ⇒ say no recognized doctrine by that name" wording is **not** explicit in the answer. |
| A case holding | case_holding | none | 15/4 | Answered, `lead_ref=s9 required_anchor_case`. Hedgy ("אינו מהווה גמירה־דין סופית") but stable. |
| B statute section | definition | none | 7/3 | Stable. `lead_ref=s3 required_anchor_statute`, verbatim §12(a)+(b). |
| E practical weak pack | list | `insufficient_sources_limitation` | 10/0 | Stable refusal — generic procedure only. |
| B8 canonical quote | quote | `canonical_quote_registry` | 13/1 | Unchanged, verbatim. |
| B2 missing docket | case_holding | `docket_limitation` | 12/0 | Unchanged refusal + upload invitation. |

## 3. Failure classification for C2

Ranked by contribution:

1. **C — retrieval missed leading authorities (primary).** The Supreme Court family-law corpus is absent locally, and all caselaw queries were routed to `local_db` only. Zero exact_authority hits, zero statute hits.
2. **B — planner did not build synthesis-shaped queries.** No `primary_statute` role for חוק יחסי ממון, no named-landmark-case queries, no Perplexity target for any caselaw role.
3. **D/E — admission + pool artifacts.** Perplexity admitted fabricated URLs at 0.75; the pool's `dup_url` key ignores query strings and destroyed 47 candidates including on-topic lower-court rulings.
4. **G — sufficiency too loose here.** It passed on 2 "topical authorities", one of which does not exist. Topicality is checked; authority tier and URL reality are not.
5. **H — drafter overstated** on a weak pack (promoted ע"א 52/80 to leading authority). Secondary to 1–4.

Not implicated: **A** (analyzer read it as doctrinal synthesis correctly, though legal_area was mislabeled) and **F** (verifier was accurate).

**Bottom line:** this is *not* primarily a drafting problem. C2 is a **retrieval-strategy problem first** (no primary family-law authority reachable, caselaw lane locked to a corpus that lacks it), a **source-integrity problem second** (fabricated Perplexity URLs entering the footnotes), and only then a sufficiency-strictness and drafting problem.
