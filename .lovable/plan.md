## למה המאמר "סעד החובה לחוקק" לא הופיע בתשובה

### אישור הקיום במאגר

- **document_id**: `02fa534c-9c4d-4e1f-96f9-69235480b5ee`
- **כותרת**: "סעד החובה לחוקק: הצעה למתווה הדרגתי"
- **source_type**: `journal_article`, **URL**: `https://lawjournal.huji.ac.il/article/12/1366`
- **chunks**: 60+ chunks, כולם עם embedding בממד 768 — מוכן לאחזור.

המאמר זמין ב-DB. הוא לא הופיע בתשובה בגלל שלושה כשלים מצטברים בצינור האחזור.

### שורש הבעיה (מבוסס על qa_log `4f5ea5bf-577f-463a-b130-93ebcdffa735`)

**1. Vector retrieval מחזיר 0 בכל ה-claims, בכל ההרצות האחרונות.**
`metadata.core.retrieval.per_claim[*].local_vector_count = 0` בכל חמשת ה-claims בריצה הזו, וכך גם ב-9 מתוך 10 ההרצות האחרונות (`vc=0`). היחיד שאיתר `vc=6` הוא חריג. המשמעות: `match_legal_chunks` למעשה מושבת בפועל — או `defaultEmbed` ב-`runCore.ts` מחזיר `null` (כשל ב-OpenAI / מכסה / 429), או `match_threshold=0.55` ב-`localVector` (`core/retrieval.ts:277`) גבוה מדי ל-text-embedding-3-small dim=768 בעברית, שבו cosine טיפוסי נופל סביב 0.40-0.55. בלי vector, אין דרך סמנטית להגיע למאמר שכותרתו אינה כוללת את המונח "מחדל חקיקתי".

**2. FTS לא מאתר את המאמר.**
הרצתי `search_legal_chunks_text('מחדל חקיקתי חלקי הסדר ראשי פגיעה בזכות', 30)` — המאמר לא בטופ-30. הסיבה: ה-FTS ב-Postgres עם `simple` config הוא לקסיקלי בלבד (בלי stemming עברי), והכותרת/citation של המאמר משתמשים ב-"חובה לחוקק" ולא ב-"מחדל חקיקתי". ב-chunk-level המונח כן מופיע, אבל הוא טובע מתחת לחציון של 500 ה-candidates ב-`chunk_cands`.

**3. Factual anchors לא עזרו.**
`factual_anchor_terms` שה-planner יצר: `["גביית דמי חסות (פרוטקשן)", "כישלון מערכתי באכיפה"]`. אלה עובדתיים-תחומיים, לא דוקטרינריים — לכן ה-pre-pass לא יחפש "מחדל חקיקתי" / "חובה לחוקק" וה-MMM כן הופיע אבל המאמר התאורטי הזה לא יכול היה להופיע דרך מסלול ה-anchors.

**4. כלים נוספים שנכשלו:**
- אין `exact_authority` עבור A1/A4 שתואם למאמר (ה-planner החזיר authorities שונים).
- Perplexity החזיר 0 candidates ל-C2 (`approved_web_count: 0`), כי הכלל ב-`APPROVED_WEB_SYSTEM` מסנן `scholarship` ומחייב primary authority בלבד.

### הצעת תיקון (שלוש פעולות ממוקדות, ללא שינוי DB)

**A. לתקן את ה-vector path — תיקון אחד שיפתור גם את MMM וגם את המאמר הזה וגם רגרסיות עתידיות.**
- ב-`supabase/functions/legal-qa/core/runCore.ts` (`defaultEmbed`): להוסיף לוג ברור כש-`OPENAI_API_KEY` חסר/הקריאה נכשלת, ולהחזיר טלמטריה ל-`qa_logs.metadata.core.embed_health = { ok, latency_ms, status }`. ככה נדע מיידית אם הבעיה היא חוסר key, 429, או באמת ציון נמוך.
- ב-`core/retrieval.ts:277`: להוריד את `match_threshold` מ-`0.55` ל-`0.35`. ב-text-embedding-3-small@768d לעברית, 0.55 מסנן כמעט את הכל. הציון הסופי (rerank/source-pack promotion) כבר מטפל בסינון איכותי. נשמור gate נוסף של 0.55 רק ב-`assembleSourcePack` להעלאה ל-`core` (זה ממילא קיים לפי `source-pack-classification`).

**B. הרחבת ה-factual_anchor pre-pass לכלול גם "concept anchors" מהשאלה.**
ה-planner יקבל בנוסף ל-`factual_anchor_terms` גם `concept_anchor_terms: string[]` — 1-3 ביטויים דוקטרינריים מרכזיים שמופיעים בשאלה (כאן: "מחדל חקיקתי חלקי", "חובה לחוקק"). ה-pre-pass ב-`retrieveForPlan` ירוץ vector+FTS גם על אלה ויזריק לכל claim. זה משריין מאמרים אקדמיים שכותרתם משתמשת בניסוח חלופי לאותו רעיון.

**C. לאפשר scholarship דרך Perplexity ל-claims שדורשים `doctrinal_definition`.**
ב-`prompts.ts` (`APPROVED_WEB_SYSTEM`): כשה-claim כולל `required_evidence: ["doctrinal_definition"]`, להחליף את הפרומפט בגרסה שמאפשרת `scholarship` עם whitelist של דומיינים אקדמיים (`lawjournal.huji.ac.il`, `law.tau.ac.il`, `idclawreview.com`, וכו'). זה fallback שלישוני.

### מה לא נדרש לשנות

- אין צורך לגעת ב-`search_legal_chunks_text`, ב-RLS, או ב-embedding pipeline.
- אין שינוי בטבלאות או ב-RPCs.
- כללי הציטוט (Rule 24 ל-journal_article) כבר ממופים נכון.

### אימות לאחר היישום

הרצה חוזרת של אותה שאלה צריכה להראות:
1. `metadata.core.embed_health.ok = true` (יחשוף אם זו באמת הבעיה).
2. `local_vector_count > 0` לפחות ל-C2 ו-C5.
3. `candidates` של C2 כולל `document_id = 02fa534c-9c4d-4e1f-96f9-69235480b5ee`.
4. הערת שוליים אחת לפחות לקרן רוזן-צבי / המחבר/ת של המאמר.

קבצים מושפעים: `supabase/functions/legal-qa/core/runCore.ts`, `core/retrieval.ts`, `core/prompts.ts`, `core/types.ts`. ללא מיגרציה.
