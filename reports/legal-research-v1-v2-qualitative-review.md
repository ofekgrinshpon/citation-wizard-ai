# V2.1 Structured Drafter — Qualitative Review Pack

Read-only review of 10 fixtures from the full V2 harness. No code, prompt, schema, or builder changes. Goal: a human verdict on prose quality, source coverage, citation cleanliness, heading usefulness, compound-footnote appropriateness, and missing legal nuance.

Source data: `reports/legal-research-v1-v2-harness-*.json` + full `qa_logs` rows pulled by `run_id`.

Selection summary

| Fixture | Category | Coverage Δ | Prose Δ | Adj runs base→v2 | Headings v2 | avg src/seg | Notes |
|---|---|---:|---:|---:|---:|---:|---|
| L3 | V2 better | +0.31 | +201 | 0 → 1 | 5 | 2.6 | constitutional-style enumeration |
| R03 | V2 better | +0.36 | −257 | 4 → 0 | 3 | 2.25 | classic 4-prong constitutional test |
| R10 | V2 better | +0.18 | −683 | 2 → 0 | 6 | 2.75 | doctrinal coverage gain |
| R16 | V2 better | 0 | −268 | 13 → 4 | 7 | 2.45 | procedural; many sections |
| PROT | V2 better | +0.19 | −1586 | 11 → 0 | 5 | 2.71 | high cluster fixture |
| R04 | V2 worse | −0.07 | −2073 | 1 → 0 | 5 | 2.5 | most material under-development |
| R09 | V2 worse | −0.13 | −908 | 10 → 0 | 5 | **3.0** | highest avg src/seg |
| R18 | V2 worse | 0 | −1035 | 0 → 0 | 1 | 2.2 | concision vs nuance |
| L6 | V2 worse | 0 | −1164 | 2 → 0 | 5 | 2.67 | mechanical-feeling sectioning |
| R19 | mixed | −0.14 | −1155 | 12 → 0 | 5 | 2.4 | V2 more direct, baseline hedged |

---

## 1. L3 — תנאי תקנת השוק לפי חוק המכר  *(V2 better)*

**Coverage:** baseline 0.54 (7/13) → V2 0.85 (11/13). avg src/seg 2.6.

**Baseline excerpt (one body paragraph):**
> "המכירה נעשתה בתנאים המזכירים **שוק פתוח/מוכר** … כפי שהתפתחו בניתוחים הפרשניים סביב סעיף 34 והנוסחים התיקוניים.² … כאשר מדובר במכירת רשות ציבורית, גם אם נפל פגם בהליכי המכר … לא בהכרח מונע את החלת ההגנה לאחר שהתקיימו המניעים הכרונולוגיים של תקנת השוק (מסירה/רישום וכו').⁵"
> Ends mid-sentence at "סעד לביטול הליך מנהלי או הוצל" — baseline was truncated by the model.

**V2 excerpt:**
> "**תנאים עובדתי‑נורמטיביים להחלת התקנה** — תנאי יסוד: ההגנה חלה כאשר המכירה נעשתה בשוק פתוח … והנזקק/הרוכש פעל בתום‑לב ובתשלום שווי סביר.³
> **חריגים והגבלות נפוצים** — מצג כוזב או הונאה … סחורות שסווגו כנכסים מיוחדים … הוראות פשיטת רגל או תקנות רישום …⁷
> **ממשק עם דוקטרינות וקונפליקטים משפטיים** — תקנת השוק משולבת במערכת הדוקטריניות — היא מתחרה עם חזקת הבעלות …⁹"

**Citation cleanliness:** baseline has 8 superscripts, 0 adjacent; V2 has 11 markers but 1 adjacent run (rare V2 leak). All 10 V2 segments are compound.

**Underdeveloped or just concise?** V2 is *more* developed than baseline (+201 chars, +4 sections) and **does not lose** the statute/practice/exceptions story; it adds an explicit "interface with other doctrines" section that the baseline never reaches.

**Headings:** helpful — 5 sections track the natural taxonomy of the question (definition / conditions / consequences / exceptions / doctrinal interface).

**Compound footnotes:** appropriate. avg 2.6 sources/segment reflects statute + commentary + case law on a textbook topic — exactly the multi-source backing legal writing expects.

**Missing nuance:** none material vs. baseline. Baseline itself was visibly truncated.

**Verdict: V2 better.**

---

## 2. R03 — פסקת ההגבלה וארבעת תנאיה  *(V2 better)*

**Coverage:** 0.55 → 0.91. Cluster pathology in baseline (4 adjacent runs) → 0 in V2.

**Baseline excerpt:**
> "**3. מידתיות … (א) *התאמה* — האם האמצעי יכול לקדם את המטרה; (ב) *הכרח/חסכנות* … (ג) *מאזן/מידתיות במובן הרחב* … ³ … מצומצמים יותר של התאמה והכרח בעילות מסוימות.⁵"

**V2 excerpt:**
> "**ארבעת תנאי פסקת ההגבלה** — בחוק … תכלית ראויה … מידתיות … הגנה על מהות הזכות.²³⁴⁵
> בתי המשפט מיישמים את מבחן המידתיות במגוון עצימות ביקורתיות: לעתים ייעשה בדיקה פיקוחית רחבה כאשר הזכויות שנפגעות מהותיות …⁷"

**Cleanliness:** baseline 16 superscripts with 4 adjacent runs (²³, ⁴⁵ etc.); V2 has 11 markers with **zero** adjacency.

**Underdeveloped?** No. The four-prong test, the three sub-tests of proportionality, and the doctrine of "essence of the right" are all present in V2, with the **added** dimension of "varying intensity of judicial review" (paragraph 7). Coverage is materially up.

**Headings:** helpful. The question literally asks for four enumerated conditions; sectioning matches the structure of the answer.

**Compound footnotes:** appropriate (2.25 avg). On a multi-test constitutional doctrine, multi-source segments are expected.

**Verdict: V2 better.**

---

## 3. R10 — דוקטרינת תום הלב לפי סעיף 39  *(V2 better)*

**Coverage:** 0.82 → 1.00. avg src/seg 2.75. Headings: 6.

**Baseline excerpt:**
> "סעיף 39 לחוק החוזים קובע חובת **קיום החוזה בתום לב** … פסיקה עליונה מבחינה במפורש בין חובת תום הלב במשא ומתן … לבין חובת תום הלב בעת קיום החוזה.² … בספרות עולה מסקנה סבירה שהיחס בין חופש החוזים לתום הלב אינו אבסולוטי … ⁸⁹"

**V2 excerpt:**
> "**יחס החובה לחופש החוזים ולתנאים מפורשים** — הספרות והפסיקה בדקו האם ניתן להוציא את חובת תום הלב מהיקף ההסכמה המפורשת; יש מגמה להסתייג מסייגים גורפים …⁶
> לכן הסכמות שמנסות לנטרל לחלוטין את חובת תום הלב אינן תמיד מכשירות …⁷"

**Cleanliness:** baseline 13 supers, 2 adjacent; V2 9 supers, 0 adjacent.

**Underdeveloped?** Slightly more concise (−683 chars) but no doctrinal element is dropped: scope, subjective/objective test, remedies, freedom-of-contract interface, practical conclusions. Full source coverage compensates.

**Headings:** mostly helpful, but 6 headings on a ~2,000-char answer starts to feel dense. The "מסקנה מקדימה" heading is borderline mechanical (it's just one sentence).

**Compound footnotes:** appropriate. 2.75 avg matches a doctrine grounded simultaneously in statute, two distinct case-law lines (§12 vs §39), and academic writing.

**Verdict: V2 better.**

---

## 4. R16 — גילוי מסמכים בתקנות סדר הדין האזרחי  *(V2 better)*

**Coverage:** tied at 1.00 (6/6). Cluster pathology: baseline **13 adjacent runs**, V2 **4**.

**Baseline excerpt:**
> "התקנות קובעות חובת המצאת מסמכים רלוונטיים … ¹²³⁴ … קיימות הגנות משמעותיות … חיסיון עורך‑לקוח … פרטיות וסודיות מסחרית.⁵¹"
> Persistent 3–4-marker runs throughout.

**V2 excerpt:**
> "**חריגים וחסויות** — תקנות הגילוי מכירות בחריגים … חיסיון עורך־לקוח, סודיות מסחרית ושיקולי פרטיות או חיסיון חקירה … ⁷
> **המלצות מעשיות קצרות** — להחליף תצהירי גילוי …¹ … להעלות טענות חיסיון מוקדם …⁸ … לאמץ פרוטוקול e‑discovery …¹⁰"

**Cleanliness:** V2 is the only fixture where the builder leaked **4 adjacent runs** — investigate later; baseline still much worse (13).

**Underdeveloped?** No — V2 actually has *more* cited segments (16 vs 7) and adds explicit recommendation list. Source coverage tied.

**Headings:** 7 sections + bulleted recommendations. This is procedural content where users genuinely scan-read; sectioning is helpful, not mechanical. The bullet list at the end is the right form for "practical recommendations."

**Compound footnotes:** 2.45 avg — appropriate for procedural rules that cite the regulation + the commentary in tandem.

**Verdict: V2 better.** (Note the small adjacency leak as the one regression.)

---

## 5. PROT — כישלון מערכתי באכיפת פרוטקשן ומחדל חקיקתי  *(V2 better; high avg src/seg)*

**Coverage:** 0.50 → 0.69. Cluster pathology: 11 adjacent runs in baseline → **0** in V2. avg src/seg **2.71**.

**Baseline excerpt:**
> "כן — בתנאים מסוימים … מחדל חקיקתי/מחדל ביצועי …¹² … חוק־היסוד של כבוד האדם וחירותו …¹³ … הכשל צריך להיות מתמשך, נרחב ובעל השפעה ממשית …¹²³ …
> כדי להוכיח כישלון מערכתי נדרשים ראיות … ⁵⁶⁷⁸"
> Heavy cluster of 4 markers in a row.

**V2 excerpt:**
> "**מסקנה מקוצרת** — כן — בכפוף לנסיבות, כישלון מערכתי, מתמשך ומהותי … יכול להיחשב מחדל חקיקתי …¹
> **קריטריונים מעשיים** —
> - דפוס וכרונולוגיה …²
> - חומרת כשלים ותשתיות … ³
> - קשר סיבתי מעשי …⁴
> - שילוב ראיות כמותיות ואיכותיות …⁵
> **סעדיים ותיקונים אפשריים ומגבלות שיפוטיות** … ⁶"

**Cleanliness:** dramatic improvement. Baseline had 34 superscripts and clusters of 4; V2 has 9 markers, no clusters.

**Underdeveloped?** V2 is shorter (3907 → 2321) but the constitutional foundation, the dual private/public dimension, the systemic-failure criteria, the evidentiary mix, and the remedies-with-judicial-restraint coda are all present. The criteria are even more cleanly stated as a bullet list. Some richness of the baseline's "weight of comptroller reports" sub-discussion is compressed but not lost.

**Headings:** very helpful here. PROT is a multi-part question (does X = Y? if so, how to prove it? what remedies? what evidence?). The 5 sections track exactly those parts.

**Compound footnotes:** avg 2.71 sources/segment — appropriate. A claim like "systemic failure requires a duration, scale, and causal nexus" is exactly the kind of statement that legitimately leans on constitutional doctrine + comptroller reports + academic writing simultaneously.

**Verdict: V2 better.**

---

## 6. R04 — יחס בין רשלנות והפרת חובה חקוקה  *(V2 worse — most material drop)*

**Coverage:** 0.64 → 0.57 (9 → 8 of 14). Prose 3710 → 1637 (−56%).

**Baseline excerpt — depth that V2 loses:**
> "מעמד הסעדים והמשמעות של פיצוי עונשי: יש להבחין בין סעד פיצוי נזיקי רגיל לבין סעד המכוון לחריגה תכליתית כמו פיצוי עונשי; האחרון עומד על תכלית שונה ויכולה להצדיק פרס מעבר לגובה הנזק …⁴
> השפעה של חקיקה שמקנה סעד אזרחי או סנקציה … חקיקות וייעודים פרלמנטריים מדגימים אפשרות לסנסציה שבה החוק מקנה גם סעד אזרחי וגם אמצעי אכיפה מנהלי …⁷ … כלים תובעניים־ייצוגיים.⁸
> מה שנשאר פתוח: השאלות המדויקות לגבי מידה בה יוחל פיצוי עונשי בנוסף לפיצוי נזיקי …⁹¹⁰"

**V2 excerpt — same conceptual territory, compressed:**
> "**השפעת חקיקה המקנה סעד אזרחי מפורש** — כאשר החוק מקנה סעד אזרחי מפורש … יכול לקבוע מגבלות … להעמיד לצדן סנקציות מנהליות … ימנע כפל גבייה … או יכתיב סדרי תעדוף בין מסלולים.⁴
> המלצות מעשיות לעורך דין: יש לטעון במקביל במסלולים המתאימים …"

**Cleanliness:** V2 clean (0 adj), but only 4 cited segments versus baseline's 9 footnotes.

**Is V2 underdeveloped or merely concise?** **Underdeveloped.** Multiple substantive sub-points are gone, not just trimmed:
- Punitive damages discussion (baseline ¶4) — entirely absent in V2.
- "Class-action / new statutory tools" angle (baseline note ⁸) — gone.
- Evidentiary-burden vs. causation distinction (baseline ¶5) is in V2 but in one sentence.
- "What remains open" reflective coda — gone, replaced by a generic recommendations line.

**Headings:** 5 sections on a 1637-char answer = ~325 chars/section. Feels mechanical. Each section is reduced to one or two sentences.

**Compound footnotes:** 2.5 avg — fine in principle, but the problem is the *count* (only 4 cited segments), not over-citation.

**Missing nuance:** punitive damages, class-action / regulatory-civil interplay, the open-question/scholarly-hedge tone — all dropped.

**Verdict: baseline better.**

---

## 7. R09 — אכיפת הבטחה מנהלית; הסתמכות / סמכות / שינוי נסיבות  *(V2 worse; highest avg src/seg = 3.0)*

**Coverage:** 0.88 → 0.75. Prose 3309 → 2401. avg src/seg **3.0** — highest in the suite.

**Baseline excerpt:**
> "**בחירת סעד** — שיקול מרכזי הוא האם לספק **אכיפה ספציפית** (צו יישום או מניעה נגד ביטול ההתחייבות) או **פיצוי הסתמכות**. כאשר ההבטחה ברורה, נגרם נזק חמור … בתי המשפט עשויים להורות על אכיפה או צו מניעה זמני … במקרים שבהם … חסרה סמכות מהותית — הפיצוי יכול להיות הסעד הראוי.²⁶⁴"

**V2 excerpt:**
> "**בחירת הסעד וההשלכות הפרוצדורליות** — בפועל בתי המשפט יאזנו בין אכיפה ספציפית … לבין סעד חלופי של פיצוי הסתמכות; אכיפה נדירה כאשר קיים אינטרס ציבורי כבד … יש לשקול צעדים זמניים מהירים …⁵"

**Cleanliness:** baseline 26 supers + 10 adjacent runs; V2 5 supers, 0 adjacent. **Huge** cleanliness win.

**Underdeveloped?** Partially. The doctrinal structure (threshold / reliance / authority / changed circumstances / remedy) is intact and mostly self-sufficient. But:
- The crucial **substantive-vs-procedural ultra vires** distinction (baseline ¶"טענת חוסר סמכות") is present in V2 but stated in one line.
- The **proportionality of remedy** discussion is also compressed.
- The baseline's three concrete "evidence priority" pointers (paragraph "השלכות פרוצדורליות") are folded into a generic recommendation.

**Headings:** 5 sections, reasonable for a multi-part hypothetical. Not mechanical.

**Compound footnotes:** avg 3.0 — highest. Looking at the segments themselves, the claims (e.g., "court may release authority from promise upon material change of circumstances, subject to proportionality review balancing reliance, good faith, and alternatives") legitimately rest on multiple sources (statute + judicial doctrine + scholarship). On this fixture **the multi-source density looks appropriate, not excessive**.

**Missing nuance:** moderate — the ultra-vires/procedural-defect distinction and the remedy-proportionality detail are flattened.

**Verdict: mixed, leaning baseline better on doctrinal depth; V2 better on cleanliness. Net: baseline.**

---

## 8. R18 — יסודות עוולת התרמית  *(V2 worse on depth, tied on coverage)*

**Coverage:** tied at 0.89 (8/9). Prose 2433 → 1398 (−43%). avg src/seg 2.2. Headings: 1.

**Baseline excerpt:**
> "**חובת גילוי, מחדל וחצי‑אמת** … בספרות על מצגי שווא בשווקים ובפסיקה פיננסית מודגש כי יחסי אמון, שליטה במידע או רגולציה ספציפית יכולים להציב חובה לגלות … בפסקי‑דין בהקשרים פיננסיים־בנקאיים נידונו יחסי חובת הגילוי וההשלכות בשוק.⁶ דיונים תאורטיים נוספים בוחנים מתי מעשים מחדליים מהווים עוולה נפרדת ומתי הם משתלבים בעוולת התרמית …⁷⁸"

**V2 excerpt:**
> "מחדל, חצי‑אמת וחובת גילוי: לא כל אי‑גילוי מהווה תרמית; חייבים לבחון האם נוצרה חובת גילוי או תיקון מצג מטעה, והאם המחדל או החצי‑אמת היו במודעות או בעצימת עיניים של המצג־המטעה.⁴"

**Cleanliness:** both clean (0 adjacent). V2 6 markers vs baseline 18.

**Underdeveloped?** Yes — the **financial / banking case-law thread** and the **mens-rea distinction (intent vs willful blindness)** are present but reduced to a single descriptor each. The baseline's deeper treatment of "duty to disclose grounded in fiduciary/regulatory relationships" is essentially gone.

**Headings:** only 1 heading + inline bolded labels. Actually feels more natural here than R04/L6.

**Compound footnotes:** 2.2 avg, appropriate; nothing looks excessive.

**Missing nuance:** financial-context case law, mens-rea gradation, the "tort vs. independent cause of action" sub-debate.

**Verdict: baseline better on doctrinal richness; V2 acceptable as a short summary but not as a research answer.**

---

## 9. L6 — יסודות עוולת הרשלנות  *(V2 worse; sectioning feels mechanical)*

**Coverage:** tied at 1.00 (8/8). Prose 2603 → 1439 (−45%). Headings: 5 sections on a 1439-char answer (~290 chars/section).

**Baseline excerpt:**
> "בית המשפט העליון דן בשאלה זו בהקשר של יחסי דירקטורים‑מיעוט והבהיר כי חובת זהירות יכולה לחול במקרים מסחריים כאשר מתקיימות קרבה וציפייה ריאלית כלפי הנתבע.² גם בפסיקה אחרת נבחנת לעתים שאלת היות החובה קונקרטית …³
> … מצבים מקצועיים … סטנדרט מקצועי/מומחה … הדיון התיאורטי וההבחנה … נדונו בכתיבה האקדמית הרלוונטית.⁴
> … עקרון החלוקה בין פגוע לעושה נדונו בפסיקה ובספרות בהקשר של מדידת האחריות …⁵"

**V2 excerpt:**
> "**קיום וחובת זהירות (היקף החובה)** — קביעת חובת זהירות מתחילה בהבחנה בין חובת זהירות מושגית לבין חובת זהירות קונקרטית ותלויה במבחני קרבה, צפיות ונימוקים נורמטיביים לגבי היקף האחריות.¹
> **סטנדרט זהירות וההפרה** — הסטנדרט הכללי הוא סטנדרט אובייקטיבי של 'אדם סביר' בהתנהגות …²"

**Cleanliness:** baseline 16 supers + 2 adjacent; V2 6 supers, 0 adjacent.

**Underdeveloped?** Yes. Specific examples that anchor the doctrine — the **director/minority shareholder Supreme Court example** for duty of care, the **professional-standard sub-distinction**, the **multi-causation contribution discussion** — are all dropped to one-line abstractions. V2 reads like a definition list, not a legal analysis.

**Headings:** mechanical. 5 sections each one short paragraph. The textbook structure ("five elements of negligence") is now visually identical to the structure of every other V2 answer (R04, R09, R18). The sectioning communicates structure but adds no information density.

**Compound footnotes:** 2.67 avg — appropriate per claim (each element of negligence does legitimately rest on statute + case + scholarship), so the multi-source density is **not** the problem here. The problem is that each segment carries less prose.

**Missing nuance:** the concrete pesika anchors are gone.

**Verdict: baseline better.** L6 is the clearest case where compression degrades the answer without any cleanliness gain that matters (baseline already had only 2 adjacency events).

---

## 10. R19 — סנקציות על הפרת חוק הגבלים עסקיים  *(mixed)*

**Coverage:** 1.00 → 0.86 (7 → 6). Prose 2940 → 1785. Cluster: baseline **12 adjacent**, V2 0.

**Baseline excerpt:**
> "1. עונש פלילי — מעמד בחומרים שסופקו … אינם כוללים בחומרים שסופקו ניסוח מפורש המטיל עונשי מאסר או אוחזים כעבירות פליליות …¹²³
> מכאן: לא ניתן לקבוע מתוך המקורות שסופקו כי הפרה תגרור באוניברסליות ענישה פלילית …¹²"

**V2 excerpt:**
> "**סנקציות פליליות** — החוק מקנה עיגון לסנקציות פליליות כהשלכה על עבירות הגבלים, כולל עונשים כגון מאסר וקנסות כלפי מפרים …¹"

**Cleanliness:** dramatic — baseline 34 supers, 12 adjacent; V2 8 supers, 0.

**Underdeveloped or just more direct?** This is the most interesting case. Baseline is **hedged to the point of being unhelpful** ("the supplied materials don't clearly state criminal liability…"). V2 is **direct and asserts criminal sanctions** including imprisonment. Substantively V2 is closer to the actual legal reality. But V2's confidence may be overshooting the verifier-usable evidence — it loses one source and one citation chain that the baseline used to support its hedging.

**Headings:** 5 sections, taxonomic (criminal / administrative / monetary / civil / collateral). Match the question; not mechanical.

**Compound footnotes:** 2.4 avg, appropriate.

**Missing nuance:** baseline's evidentiary-honesty hedge ("materials don't specify…") is gone. Whether that loss is good or bad is a judgment call — for an end-user it's an improvement (more confident, structurally correct); for a research-integrity user the baseline's epistemic humility is preferable.

**Verdict: mixed.** V2 wins on cleanliness and readability and is substantively right; baseline wins on epistemic discipline.

---

## Cross-fixture observations

1. **Headings are not uniformly mechanical.** Where the question has natural enumeration (R03 four-prong test, L3 conditions/exceptions/interfaces, R16 procedural buckets, PROT multi-part question), the sectioning helps. Where the answer has been compressed to 1400–1700 chars (R04, L6, R18), the same 5-section template feels mechanical and creates a "definition card" feel.
2. **Compound footnotes look appropriate, not excessive.** avg ≥ 2.5 segments (R09 3.0, PROT 2.71, L6 2.67, R10 2.75) all reflect claims that legitimately combine statute + case + scholarship. **No segment we reviewed cited sources that did not belong together.** The user is right that 2–3 sources/segment is not the metric to optimize.
3. **Under-development is real on R04, L6, R18, R09.** It is not the same problem as "too short." It is specifically: concrete case-law anchors (director/minority example in L6, financial-disclosure cases in R18, ultra-vires distinction in R09, punitive damages in R04) get collapsed into abstract sentences. The structured drafter is trading specificity for structure.
4. **PROT, R03, L3, R10, R16 are unambiguous wins.** Coverage up, clusters eliminated, no loss of doctrinal content. These five alone would justify the architecture.
5. **R19 is the most interesting case** — V2 is *better as an answer* even though it is "worse" by coverage delta and by epistemic-honesty standards. Worth a separate human read before deciding what to optimize.
6. **One V2 adjacency leak** appeared on R16 (4 adjacent runs in builder output) and L3 (1 run). Worth confirming whether this is a builder edge case or a structured-draft schema edge case, but not blocking.

## Verdict tally

- **V2 better:** L3, R03, R10, R16, PROT (5/10)
- **Baseline better:** R04, R09, L6, R18 (4/10)
- **Mixed:** R19 (1/10)

## Decision posture (review only — no implementation)

The V2 architecture is the right direction. The remaining gap is **not** over-citation, **not** rigid templates, and **not** schema or builder bugs. The remaining gap is that on doctrine-heavy questions whose strength comes from concrete pesika anchors (L6, R04, R09, R18), the structured drafter is reducing each anchor to a one-line abstraction. Any future change should aim at preserving those anchors, not at re-tuning sources-per-segment or imposing per-question-type behavior.

Stopping here.
