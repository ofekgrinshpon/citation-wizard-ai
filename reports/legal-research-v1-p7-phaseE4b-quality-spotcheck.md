# P7 Phase E.4b — Retrieval Quality Spot-Check (L3, L4, L5, L6)

Diagnostics only. No code changed. Full per-candidate JSON in
`reports/legal-research-v1-p7-phaseE4b-quality-spotcheck.json`.

For each fixture: local candidates grouped by `retrieval_method`
(`exact_authority` / `text` / `vector`), the verifier `usable` set,
the drafter `used_sources`, and a relevance call.

---

## L3 — "מתי בית המשפט יפחית פיצוי מוסכם לפי סעיף 15 לחוק החוזים תרופות?"

**Pool**: local_db=12, perplexity=10, after_dedup=22.
**Local by method**: exact_authority=8, text=3, vector=1.

- **exact_authority (top)**: חוק החוזים (תרופות בשל הפרת חוזה) — bullseye.
- **text (top)**: same statute text + ערעור על החלטות פיצוי מוסכם — on-topic.
- **vector (top)**: "ריפוי החוזה לאחר הפרתו" (academic article on contract remedies) — adjacent, defensible.

**Verifier**: usable=12, dropped=10. Used⊆usable ✓.
**Drafter**: used_sources=9, footnotes=9, marker_validation.ok=true.

**Judgment**: clean. No off-topic text candidate entered the verifier. The single vector candidate that survived is an academic remedies piece — adjacent but reasonable. Source mix is dominated by exact statute + Perplexity scholarship, exactly as desired for a statute-interpretation question.

---

## L4 — "מהי דוקטרינת השתק פלוגתא?"

**Pool**: local_db=2, perplexity=2, after_dedup=4. (Small pool — query planner produced few hits.)
**Local by method**: text=1, vector=1.

- **text**: בימ"ש לענייני משפחה — פסק דין בעניין השתק פלוגתא — directly on-topic.
- **vector**: "על סופיות בפסקים זרים" — tangential (finality of foreign judgments). Defensible link via finality/res judicata, but not strong.

**Verifier**: usable=3, dropped=1. Used⊆usable ✓.
**Drafter**: used_sources=3, footnotes=3, marker_validation.ok=true.

**Judgment**: acceptable but thin. The vector candidate is borderline. The pool was unusually small (4) — this is a candidate-pool/query-planner concern, not an E.4b retrieval-SQL regression. No obviously bad text candidate.

---

## L5 — "מהי עילת הסבירות ומה היקף הביקורת השיפוטית עליה?"

**Pool**: local_db=4, perplexity=9, after_dedup=13.
**Local by method**: text=1, vector=3.

- **text**: עליון — עתירה בעניין ייצוג בוועדות תכנון — tangential to עילת הסבירות. Survives as `binding_case_law` for C1.
- **vector**: 3 candidates — mostly adjacent admin-law / proportionality material.

**Verifier**: usable=8, dropped=5. Used⊆usable ✓.
**Drafter**: used_sources=7, footnotes=7, marker_validation.ok=true.

**Judgment**: the single text candidate is borderline-tangential; it touches admin-court reasoning but is not a leading sebirut case. Perplexity carries the doctrinal weight (דפי זהב, ברק-ארז, etc.). Final answer leans on Perplexity scholarship and one good binding case — legally strong.

---

## L6 — "התחייבות רשות מקומית לתב"ע / הבטחה מנהלית"

**Pool**: local_db=7, perplexity=13, after_dedup=20.
**Local by method**: text=1, vector=6.

- **text**: בית הדין לעניינים מנהליים — מעמד מבקש מקלט — off-topic for admin-promise / תב"ע. Survives as `binding_case_law` for C2.
- **vector (6 candidates)**: all assigned role `binding_case_law` but they are in fact **scholarship/journal articles**:
  - "על כללים והצדקות" (legal theory) — tangential
  - "מידתיות חוקתית, סבירות מנהלית" — adjacent admin-law
  - "על התאוריה של חוזה המתנה" — **off-topic** (gift contracts)
  - "חריגה מסמכות עניינית בהליך האזרחי" — **off-topic** (civil jurisdiction)
  - "ההבחנה בין סיכון משפטי לסיכון מסחרי" — **off-topic** (commercial risk)
  - One nadav-dagan-style admin-law piece — adjacent

**Verifier**: usable=18, dropped=2. (Verifier was permissive here; off-topic vector hits passed.)
**Drafter**: used_sources=9, footnotes=9, marker_validation.ok=true. Used⊆usable ✓.

**Judgment**: the drafter filtered well — final 9 sources rely on Perplexity statute hits (חוק התכנון והבניה) and scholarship on הבטחה מנהלית, which are legally strong. **However** the verifier let several off-topic vector candidates into `usable` mislabelled as `binding_case_law`. This is **not introduced by E.4b** (the vector RPC now returns *more* candidates from the existing HNSW corpus; the role-misassignment and verifier permissiveness pre-date this phase). Worth flagging for a future phase, not a rollback signal.

---

## Aggregate verdict

| Fixture | text relevance | vector relevance | off-topic in verifier? | final sources legally strong? |
|---|---|---|---|---|
| L3 | strong | adjacent-ok | no | yes |
| L4 | strong | borderline | no | yes (thin pool) |
| L5 | borderline | adjacent-ok | no | yes |
| L6 | weak | mixed (3 off-topic) | yes (in usable, not in used) | yes (drafter filtered) |

**Comparison vs E.4a / Phase D**:
- E.4b adds many text candidates that previously timed out → drafter quality unchanged or improved on L3/L4/L5.
- L6's off-topic vector candidates were already present in E.4a (vector RPC was already fixed there); E.4b did not introduce them.
- No regression in `marker_validation.ok`, `footnote_count = used_sources`, or `used ⊆ usable` on any fixture.
- No exact-authority loss; no candidate-pool shrink attributable to the text rewrite.

**Recommendation**: mark E.4 complete. Two follow-ups worth queuing but **out of scope for E.4**:
1. Role-tag accuracy for vector candidates (journal articles labelled `binding_case_law`).
2. Candidate-pool size on L4 (only 4 dedup'd) — query-planner concern, not retrieval-SQL.

No retrieval-quality regression caused by E.4b.
