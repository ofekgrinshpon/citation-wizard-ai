## Manual quality review — V2.1c on 15 real questions

Read-only evaluation. No code, prompt, retrieval, verifier, admission, drafter, or footnoteBuilder changes. Approve this plan to run; I'll execute, then post the report and stop.

### Method

For each question:

1. POST to live `legal-research-v1` with `{ mode: "answer", question }` via `supabase--curl_edge_functions` (uses current preview auth so it runs as the logged-in user against the deployed V2.1c default path).
2. Capture `run_id` from the response.
3. After all runs finish, batch-pull rows from `qa_logs` (id, question, answer, footnotes, metadata) for analysis — no writes.

Runs are issued sequentially with a small gap so per-question telemetry stays clean. Expected wall time ~30–50 min based on prior reports (140–230 s per run).

### Question set (15)

1. כיצד זהות לאומית יכולה להיות אובייקט לקודיפיקציה? מבט השוואתי על קודיפיקציה של זהות במדינות דמוקרטיות *(repeat of the problem case)*
2. מה התנאים להחלת תקנת השוק במיטלטלין?
3. מה ההבדל בין רשלנות לבין הפרת חובה חקוקה?
4. מהם התנאים לאכיפת הבטחה מנהלית?
5. כיצד יש לפרש חוזה לאחר תיקון מס׳ 3 לחוק החוזים?
6. האם כישלון מערכתי באכיפת פרוטקשן יכול להקים טענה למחדל של המדינה?
7. מהם התנאים לצו מניעה זמני?
8. מה מעמד חופש הביטוי מול פגיעה בשם טוב?
9. מה ההבדל בין תביעה נגזרת לתביעה ייצוגית בהפרת חובת אמונים?
10. כיצד בתי משפט מאזנים בין ביטחון המדינה לזכויות יסוד?
11. מהן מגבלות השימוש במידע ביומטרי במגזר הציבורי?
12. כיצד מתמודדים עם אכיפה בררנית במשפט המנהלי?
13. מהי משמעות עקרון תום הלב בסעיף 39 לחוק החוזים?
14. מהם השיקולים בביקורת שיפוטית על החלטות רשויות אכיפה?
15. כיצד ניתן להוכיח קשר סיבתי במקרים של עמימות סיבתית?

Categories covered: black-letter doctrinal (2, 3, 7, 13), public/constitutional (4, 8, 10, 11, 12, 14), private-law (5, 9), scenario/application (6, 15), comparative/theoretical (1).

### Per-run report fields

`#`, question, `qa_log_id`, total ms, `verifier.usable` count, `used_sources` count, source-type histogram, full list of used source titles, relevance tags (direct / partial / weak / irrelevant) per source, missing source-type flags (case law / statute / scholarship / gov report / comparative), answer-quality verdict (good / acceptable / weak / bad), legal-depth verdict, Hebrew-quality verdict, citation-cleanliness verdict, suspected locus (retrieval / verifier-admission / drafter-source_refs / prose / none).

### Excerpts

3–5 short Hebrew quotes from strong answers and 3–5 from weak answers, each tagged with question number and the specific problem (broken syntax, awkward phrasing, abstract padding, mis-cited source, etc.).

### Aggregate report

- Counts: good / acceptable / weak / bad.
- How many runs had ≥1 weak or irrelevant source.
- How often comparative / academic sources were missing when the question called for them.
- How often V2 output was too short or too abstract.
- How often Hebrew read unnaturally.
- How often citations were clean.
- Whether Q1 (national-identity) reproduced the prior weak-source pattern, or improved on re-run.
- Final recommendation, picking exactly one: **no change / prompt-only change / retrieval investigation / admission-filter investigation / V2 drafter issue**.

### Out of scope (explicit)

No edits to `buildInputSources`, `runDrafterV2`, `footnoteBuilder`, V2/legacy prompts, classifier, admission gate, retrieval, Perplexity adapter, or the `legal-research-v1` edge function. No baseline writes, no fixture changes. Only side effect: 15 new rows in `qa_logs` (normal telemetry).

Approve to start the 15 runs.
