## Feature B1 — Topic Reality Check (mini-retrieval + Perplexity fallback)

מטרה: בשלב `suggest_topics`, המערכת לא תנחש "מקורות זמינים" אלא תאמת אותם — קודם מול ה-DB המקומי (HNSW + text), ואם המאגר דליל, תצא לחיפוש מהיר ב-Perplexity. המשתמש יראה badge עם מספר המקורות שאומתו לכל שאלה.

### Backend — `supabase/functions/legal-qa/index.ts`, בלוק `academicStep === "suggest_topics"` (~שורות 2317–2392)

**Stage 1 — Query expansion (planner קל):**
- קריאה ל-`gpt-5-mini` (`reasoning_effort: "minimal"`, timeout 8s) עם tool-call JSON:
  ```
  { queries: string[] }  // 3–4 ניסוחים: השאלה הרחבה + 2–3 וריאציות ממוקדות
  ```
- אם הקריאה נכשלת/timeout → fallback ל-`[question, extractKeywords(question)]`.

**Stage 2 — Hybrid local retrieval (parallel לכל ה-queries):**
- לכל query:
  - embedding דרך `/v1/embeddings` (`google/gemini-embedding-001`, 3072) + RPC `match_legal_chunks` עם `match_threshold=0.55`, `match_count=8`.
  - במקביל, `search_legal_chunks_text` עם `keywords` עבור אותו query, `match_count=8`.
- מאחדים תוצאות לפי `document_id`, סכימה ציון `vector_score + 0.4*text_score`, שולפים `legal_documents` עבור הטופ 12 (title, source_type, citation, source_url).
- מסננים placeholders ידועים ("פרטי מסמך", "ללא כותרת" — אותו broken_title filter שכבר קיים).

**Stage 3 — Perplexity fallback (only if `localHits < 4`):**
- env flag חדש: `TOPIC_REALITY_PPLX_ENABLED` (default `true`); דורש `PERPLEXITY_API_KEY` קיים.
- קריאה אחת ל-`sonar` (לא pro, לחיסכון), timeout 15s, עם `search_domain_filter: ["nevo.co.il","supremedecisions.court.gov.il","lite.takdin.co.il","mishpatim.ac.il","tau.ac.il","huji.ac.il"]` + `search_recency_filter: "year"` להטיה לחומר רלוונטי.
- prompt: "הצג עד 6 מקורות משפטיים ישראליים (חקיקה, פסיקה, מאמרים) שרלוונטיים לנושא: <topic>. החזר JSON: `{sources: [{title, source_type, why_relevant}]}`" עם `response_format: json_schema`.
- כל מקור Perplexity מסומן `origin: "external"` (לעומת `origin: "local"`). לא מבצעים promotion ל-`legal_documents` בשלב הזה.

**Stage 4 — Prompt rewrite:**
- מזריקים ל-system prompt בלוק חדש:
  ```
  === מקורות שאומתו לנושא ===
  מקומיים (N): <שמות מתוך ה-DB>
  חיצוניים (M): <שמות מ-Perplexity, אם רץ>
  ```
- ה-prompt מתעדכן: "בכל שאלה, תחת 'מקורות זמינים', ציין **רק** מקורות מהרשימה שלמעלה. ציין `[מאגר]` ליד מקורות מקומיים ו-`[חיצוני]` ליד מקורות שנמצאו ברשת. אם פחות מ-3 מקורות סך הכל — סמן את השאלה בתג `⚠️ כיסוי דל`."
- ה-LLM ממשיך לייצר את 3 השאלות כרגיל; אסור לו להמציא מקורות שלא ברשימה.

**Stage 5 — Response shaping:**
- `buildResponse` extras מקבל שדה חדש:
  ```ts
  topicCoverage: {
    queries: string[],
    localHits: number,
    externalHits: number,
    sources: Array<{ title, source_type, origin: "local"|"external", url?: string }>,
    minCoverageReached: boolean  // localHits + externalHits >= 3
  }
  ```
- אם `minCoverageReached === false` ו-`localHits + externalHits === 0` → מחזירים `answer` עם הודעת אזהרה במקום השאלות:
  > "לא מצאתי מקורות מספקים לנושא הזה במאגר ובחיפוש מהיר. נסה לצמצם את הנושא, לבחור זווית ספציפית יותר, או לנסח אותו אחרת."

**Telemetry:** `qa_logs.metadata.topic_reality_check = { queries, localHits, externalHits, pplx_called, pplx_duration_ms, total_duration_ms }`. Stage telemetry מתווסף כ-`stage_runs: ["topic_planner","topic_retrieval","topic_pplx"]`.

### Frontend — `src/components/LegalQAChat.tsx`

**A. הצגת badges מתחת לכל שאלה (~שורה 2064, רנדור `lastAcademicAction === "suggest_topics"`):**
- אם `result.topicCoverage` קיים, מציגים מתחת לכל שאלה (או פעם אחת מעל שלוש השאלות) שורת badges:
  - `📚 X במאגר` (rendered אם `localHits > 0`, צבע `bg-primary/15 text-primary`)
  - `🌐 Y מהרשת` (rendered אם `externalHits > 0`, צבע `bg-accent/15 text-accent-foreground`)
  - `⚠️ כיסוי דל` אם `minCoverageReached === false`, `bg-destructive/10 text-destructive`
- accordion קטן "ראה מקורות שנמצאו" שמציג רשימה (title + source_type + `[מאגר]/[חיצוני]`, ועם link אם `url`).

**B. Empty state:** אם backend החזיר את הודעת האזהרה, אין שאלות לבחירה; מציגים card עם הטקסט + כפתור "נסה נושא אחר" שמחזיר את ה-wizard ל-`enter_topic`.

**C. אין שינויי persistence:** `topicCoverage` חי רק בתגובה הנוכחית — לא נשמר ב-`academic_sessions` (זה חד-פעמי לבחירת השאלה).

### Performance & cost

- Stage 1 (planner): ~0.8–1.5s
- Stage 2 (4 embeddings + 4 RPCs במקביל): ~1.0–1.5s
- Stage 3 (Perplexity, רק כשנדרש): ~3–6s
- **Total typical:** 2–3s; **worst case (Perplexity fired):** 5–7s.
- ה-UI מציג spinner קיים; אפשר להרחיב את `StageProgressList` עם stage `topic_check` (אופציונלי, לא חוסם להשקה).

### Feature flags

- `TOPIC_REALITY_CHECK_ENABLED` (default `true`) — כיבוי גלובלי, חוזר להתנהגות הנוכחית.
- `TOPIC_REALITY_PPLX_ENABLED` (default `true`) — כיבוי רק של ה-fallback ל-Perplexity (DB-only mode).
- `TOPIC_REALITY_MIN_HITS` (default `4`) — סף שמפעיל את Perplexity.

### קבצים שייגעו

- `supabase/functions/legal-qa/index.ts` — בלוק suggest_topics: planner + retrieval + Perplexity + prompt injection + response shaping + telemetry.
- `src/components/LegalQAChat.tsx` — `topicCoverage` typing, badges, empty-state card, "ראה מקורות" accordion.
- `.lovable/memory/features/academic-writing-mode/topic-reality-check.md` — תיעוד חדש + עדכון `mem://index.md`.

### מחוץ ל-scope

- Promotion של מקורות Perplexity ל-`legal_documents` (Stage 3 רק מאמת קיום, לא מטמיע).
- Hybrid BM25 — נסתפק ב-text + vector הקיימים.
- מטמון של תוצאות לפי נושא (אם משתמש בודק את אותו נושא פעמיים, רץ מחדש).

האם לאשר ולעבור ליישום?