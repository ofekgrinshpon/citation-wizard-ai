**Goal**

Extend the v1 draft style guide with a 9th, deliberately minor section: **הקשר משווה** — how to weave foreign-law terms (DSA, GDPR, US case law, common-law doctrines) into Hebrew academic prose without breaking register or grounding.

**Where it lands**

- Appended after section 8 in `ACADEMIC_STYLE_GUIDE` inside `supabase/functions/legal-qa/academicStyleGuide.ts`.
- Synthesizer prompt in `eval/distill-style-guide.mjs` updated from "שמונה סעיפים בדיוק" → "תשעה סעיפים בדיוק", with section 9 listed as "הקשר משווה — שילוב מונחים ומקורות זרים".
- Memory note `style-guide-v1.md` updated: dimensions list 8 → 9.
- Char budget: section adds ~1,100 chars; total stays well under the 12,000 hard cap (~7,900 after).

**Proposed Hebrew text for section 9 (for review)**

```
**9. הקשר משווה — שילוב מונחים ומקורות זרים**
- *הופעה ראשונה של מונח זר*: לכתוב בעברית עם הלעז בסוגריים, לא להפך. דוגמה: "חובת זהירות מוגברת על פלטפורמות (duty of care לפי ה־Digital Services Act, להלן: DSA)". הופעות חוזרות — בעברית בלבד או בקיצור הזר אם הוטמע ("לפי ה־DSA").
- *מקור זר כאסמכתה*: לעולם לא להפנות למקור זר כאילו הוא דין מחייב בישראל. הניסוח: "ב־X אומצה גישה לפיה…", "בית המשפט העליון בארה"ב קבע בעניין X כי…", ואז — אם רלוונטי — "גישה דומה / שונה ניתן לזהות בפסיקה הישראלית ב…".
- *מבנה פסקה משווה*: (א) הצגת הדין הישראלי, (ב) הצגת הדין הזר במשפט–שניים, (ג) הצבעה על דמיון/הבדל ספציפי, (ד) מסקנה ביחס לשאלה הישראלית. אסור להציג דין זר בלי לחזור לישראל בסוף הפסקה.
- *תעתיק מול תרגום*: מונח דוקטרינרי שאין לו מקבילה עברית מקובלת — בלעז עם הסבר קצר בהופעה ראשונה ("chilling effect — אפקט מצנן על חופש הביטוי"). מונח שיש לו מקבילה — בעברית ("proportionality" → "מידתיות", לא "פרופורציונליות").
- *שמות פסקי דין זרים*: באנגלית בכתב נטוי במקור הראשון (Marbury v. Madison), עם הפניית שוליים מלאה לפי כלל 36; בהמשך הפרק — בקיצור מקובל ("עניין Marbury").
- *אסור*: לערבב לעז ועברית בתוך אותו צירוף ("ה־scope של ה־duty"); להציג מקור זר בלי לעגן את הרלוונטיות לדין הישראלי; להפנות ל"המשפט המשווה" כקטגוריה מופשטת בלי לציין תחום שיפוט קונקרטי.
```

**Open question (1)**

Section 9 currently allows reuse of the foreign abbreviation after first introduction (e.g. "לפי ה־DSA"). Approve, or require Hebrew-only after intro?

**Out of scope**

- No retrieval, no telemetry change, no eval changes. Pure style-guide content edit + version bump on the next promotion to corpus-derived v1.
