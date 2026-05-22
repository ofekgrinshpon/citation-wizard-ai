## למה מסמך הממ"מ על "גביית דמי חסות" לא הופיע בתשובה

### אישור הקיום במאגר

המסמך אכן קיים ונטען במלואו:

- **document_id**: `a6d79a7a-14a8-47bd-82f9-ee1747e9f6a9`
- **כותרת**: "גביית דמי חסות – ניתוח נתוני דיווח לכנסת – תיקון"
- **citation**: ד"ר נורית יכימוביץ-כהן, הכנסת – מרכז המחקר והמידע (2025)
- **source_type**: `knesset_research`
- **URL**: `https://main.knesset.gov.il/.../incident.aspx?rid=8225&businessType=1`
- **chunks**: 9 מתוכם 9 עם embedding מלא — מוכן לאחזור hybrid (FTS + HNSW).

אין כאן בעיית הזנה, אין בעיית embedding, ואין בעיית RLS (הטבלה ציבורית לקריאה).

### למה הוא לא נמצא — שורש הבעיה

בדקתי את `qa_logs` של הריצה האחרונה לאותה שאלה (`9f9a2f7b-4b0d-4a08-a53f-14af5a379fa4`). הפלן שה-planner ייצר כולל ארבע טענות (C1–C4), וכל ה-`search_targets` שלהן נסובים סביב **הדוקטרינה המשפטית בלבד**:

```text
hebrew_terms: "מחדל חקיקתי", "מחדל חקיקתי חלקי", "הסדר חקיקתי לקוי",
              "ביקורת שיפוטית על מדיניות אכיפה", "חובת אכיפה",
              "חובות הגנה חיוביות", "ריסון שיפוטי", "עבירת סחיטה באיומים" …
```

**המילים "דמי חסות" / "פרוטקשן" — המקבע העובדתי של השאלה — נושלו מכל ה-search_targets.** מאחר ש-`pickTextQuery` ו-`pickVectorQuery` ב-`core/retrieval.ts` מזינים אך ורק את `hebrew_terms` (ובכל הצרה — את `thesis`/`doctrine`) ל-`search_legal_chunks_text` ול-`match_legal_chunks`, כל שאילתות האחזור היו דוקטרינריות. מסמך שכותרתו "גביית דמי חסות" אינו תואם ל-"מחדל חקיקתי חלקי" לא ב-FTS ולא ב-cosine — לכן הוא לא נכנס לאף `ClaimRetrievalPack`, לא הגיע ל-source pack, ולא יכול היה להופיע בטיוטה.

מבחינת זרימה: `metadata.retrieval` ו-`metadata.sourcePack` ב-qa_logs ריקים — לא בגלל כשל ריצה, אלא כי הם נשמרים תחת `metadata.core.*` במבנה הנוכחי. בדיקה ידנית של ה-`plan.claims[*].search_targets` מאשרת את ההסבר.

### הצעת תיקון (frontend ו/או planner-prompt, ללא שינוי DB)

עריכה ב-`supabase/functions/legal-qa/core/prompts.ts` (פרומפט ה-planner) + תוספת קלה ב-`retrieval.ts`:

1. **כלל חדש בפרומפט ה-planner**:
   "כל claim שמערב נושא עובדתי קונקרטי מהשאלה (תופעה, עבירה, מוסד, מגזר, אזור גאוגרפי, גוף ציבורי) חייב לכלול לפחות `search_target` אחד שבו `hebrew_terms` כולל את **המונח העובדתי כפי שמופיע בשאלה** (כאן: "דמי חסות", "פרוטקשן", "סחיטה באיומים בצפון") — בנוסף ל-search_targets הדוקטרינריים."
2. **שדה אופציונלי `factual_anchor_terms: string[]`** ברמת ה-`PlanV1` שמכיל את אותם מונחים עובדתיים שחולצו ישירות מהשאלה. ה-planner מחויב להחזיר אותם גם אם הוא לא משייך אותם ל-claim ספציפי.
3. **`retrieveForPlan`**: לפני הלולאה על ה-claims, להריץ pass נוסף של `localText` + `localVector` על `factual_anchor_terms` ולשתול את התוצאות כ-candidates משותפים לכל claim שהמסמך תואם לו לפי `source_type_filter` (או — אם אין מסנן — לכל claim). זה משריין שכנים עובדתיים (כמו דו"חות ממ"מ ועבודות הכנסת) שאליהם הדוקטרינה לבדה לא היתה מגיעה.
4. **לוג**: לשמור את `factual_anchor_terms` ב-`qa_logs.metadata.core.factual_anchors` כדי שנוכל להריץ regression מהירה.

### מה לא נדרש לשנות

- אין צורך לגעת ב-`match_legal_chunks_filtered` או ב-RLS.
- אין צורך לשנות את שכבת ה-Perplexity / ה-source pack — ברגע שה-MMM נכנס ל-candidate set, שאר הצינור (ranking, claim map, drafter) כבר מטפל בו.
- אין שינוי בכללי הציטוט: `knesset_research` כבר ממופה דרך Rule 8 ב-`citationEngine`.

### אימות לאחר היישום

הרצה חוזרת של אותה שאלה צריכה להראות:

- ב-`metadata.core.plan.factual_anchor_terms` — נוכחות של "דמי חסות"/"פרוטקשן".
- ב-`metadata.core.retrieval.*` — candidate עם `document_id = a6d79a7a-…` לפחות בטענה אחת.
- בתשובה הסופית — לפחות הערת שוליים אחת שמצטטת את הדו"ח של נורית יכימוביץ-כהן (2025).

קבצים מושפעים: `supabase/functions/legal-qa/core/prompts.ts`, `core/types.ts`, `core/retrieval.ts`. אין מיגרציית DB.
