

# שדרוג מנוע "מחקר משפטי" — תכנית מאושרת עם 3 חידודים

## עקרונות (אושרו)

- שדרוג תוספתי, לא rewrite. הפעלה רק ב-`taskMode === "legal_research"`.
- כל שלב חדש עם graceful fallback למסלול היום אם נכשל / OpenAI לא זמין.
- אובייקטים פנימיים (decomposition / source pack / claim map) **לא** מודלפים ל-response או ל-UI. נכתבים רק ב-`qa_logs.metadata` (פנימי לאדמין).
- ה-API החיצוני ממשיך להחזיר רק `{ answer, footnotes, source_urls }`.

## 3 החידודים (נכללים בתכנית)

1. **planner call יחיד**: decomposition + query-plan ממוזגים לקריאה אחת עם tool-call של schema מורכב (שני שדות). חוסך ~1.5s ונקודת כשל אחת.
2. **`support_strength` ב-claim map**: שדה חדש `"strong" | "partial" | "weak"` בכל claim, נפרד מ-`authority_level` (איכות המקור) ומ-`confidence` (ביטחון המודל). משמש את ה-drafter להבחין בין "X קובע במפורש" ל-"X משתמע".
3. **provenance hardening**: נוסיף 2 בדיקות:
   - serializer ייעודי לתשובה הסופית (`buildResponse`) שכולל רק `{ answer, footnotes, source_urls }` — שדות חדשים לעולם לא נדלפים בטעות.
   - footnote object ב-response יושלל ממנו `source` field (היום מוחזר `"local"|"perplexity"|"unverified"`). ה-UI לא משתמש בו ב-rendering, אבל הוא דולף. הסרתו תסיר את הקטגוריזציה הפנימית מה-payload.

## ארכיטקטורה (8 שלבים)

```text
Frame → [Decompose+Plan]→ Retrieve → Rank → Source-Pack → Claim-Map → Draft → Validators
         ^^^ planner call יחיד            (פנימי)        (פנימי)    (גרונד)   (קיים)
```

## Stage 0 — תשתית פרובידר

קובץ חדש `supabase/functions/legal-qa/aiProvider.ts`:
- `callPlanner(prompt, tools)` — `openai/gpt-5-mini` אם `OPENAI_API_KEY` קיים, אחרת `google/gemini-2.5-flash-lite` דרך Lovable Gateway.
- `callDrafter(systemPrompt, userPrompt)` — `openai/gpt-5` אם זמין, אחרת `google/gemini-2.5-flash`.
- `MODEL_CONFIG` enum מרוכז בראש הקובץ (`PLANNER_MODEL`, `DRAFTER_MODEL`) כדי להחליף בשורה אחת.
- כל קריאה עם try/catch + null fallback. אין hard-break אם OpenAI חסר.

**הערת מודלים**: בקשתך מציינת `gpt-5.4` / `gpt-5.4-mini`. הזמינים בפועל: `gpt-5` / `gpt-5-mini` / `gpt-5.2`. נשתמש ב-`gpt-5-mini` ל-planner ו-`gpt-5` ל-drafter. אם תרצה `gpt-5.2` ל-drafter — שורה אחת ב-`MODEL_CONFIG`.

## Stage A+B — Decomposition + Query Planning (קריאה אחת)

קובץ חדש `supabase/functions/legal-qa/decomposition.ts` עם schema מאוחד:

```ts
type DecomposedPlan = {
  decomposition: {
    main_issue: string;
    sub_issues: string[];                // 2-5
    question_type: "doctrinal" | "procedural" | "factual_legal" | "comparative" | "policy" | "mixed";
    requires_legislation: boolean;
    requires_caselaw: boolean;
    requires_secondary_sources: boolean;
    jurisdiction: "israel";
  };
  query_plan: Array<{
    sub_issue: string;
    legislation_query?: string;
    caselaw_query?: string;
    literature_query?: string;
    external_query?: string;
  }>;
};
```

מיקום ב-`index.ts`: בין שורה ~1043 ל-1045. timeout 10s. אם נכשל → `decomposedPlan = null` והשלבים הבאים מדלגים.

**אינטגרציה עם retrieval**: שאילתות מ-`query_plan` נוספות ל-`localSearchPromise` הקיים כקריאות `match_legal_chunks` / `match_legal_chunks_filtered("caselaw")` מקבילות. כל ה-hits נכנסים לאותו `mergedMap` (dedupe by chunk_id). Perplexity מקבל את `external_query` ארוז עם השאלה המקורית. **rerank הקיים נשאר ללא שינוי**.

לוג: `console.log("[plan]", sub_issues.length, "issues;", query_plan.length, "plans")`.

## Stage C — Source Pack Assembly

לאחר rerank ו-`sourceCards` הקיים. בנייה דטרמיניסטית בקוד:

```ts
type SourcePackEntry = {
  source_id: number;
  title: string;
  source_type: string;
  authority_class: "primary_legislation" | "basic_law" | "supreme_court" | "district_court" | "labor_court" | "knesset_research" | "academic_book" | "academic_article" | "protocol" | "external_web" | "other";
  date?: string;
  url?: string;
  provenance: "local" | "perplexity" | "document";   // INTERNAL — never serialized
  excerpt: string;
  case_number?: string;
  usable_for_analysis: boolean;     // excerpt > 300 chars
  usable_for_citation: boolean;     // metadata sufficient for citation
  anchor_present: boolean;          // url או local source אמיתי
};
```

`authority_class` נגזר מ-`source_type` + heuristics (URL contains `supreme.court` / "ס\"ח" בציטוט / וכו'). לוג ב-metadata: רק `[{source_id, authority_class, anchor_present}]` — ללא excerpt ו-ללא provenance.

## Stage D — Claim Map (עם `support_strength`)

קריאה שנייה של `callPlanner`. Input: `decomposition` + source pack מקוצר (id, title, authority_class, excerpt 400 chars).

```ts
type ClaimMap = Array<{
  claim: string;
  sub_issue: string;
  source_ids: number[];
  authority_level: "high" | "medium" | "low";       // איכות המקור
  support_strength: "strong" | "partial" | "weak";  // ⭐ חדש: חוזק התמיכה הטקסטואלית
  confidence: "high" | "medium" | "low";            // ביטחון המודל
  needs_pinpoint: boolean;
  allowed_to_state: boolean;
  notes: string;
}>;
```

System prompt קצר וקשוח:
- claim ללא source_ids → `allowed_to_state=false`.
- `support_strength=strong` רק אם ה-excerpt קובע במפורש את הטענה.
- `support_strength=partial` כשניתן להסיק / ניתן בעקיפין.
- `support_strength=weak` כשהקשר עקיף — חובה לציין כחוסר ודאות בתשובה.
- `authority_level=high` רק לחקיקה/עליון/חוקי-יסוד.

Fallback: אם call נכשל / `allowed_to_state` ריק → `claimMap = null`, drafter עובד בלי NEW BLOCK.

## Stage E — Grounded Drafting

החלפה ממוקדת ב-`systemPrompt` (שורות 1701–1907). נוסיף block חדש רק אם `claimMap !== null && allowedCount >= 2`:

```
═══ מפת טענות מאושרת ═══
אתה כותב מתוך מפת הטענות. כל טענה מהותית = claim עם allowed_to_state=true.
- support_strength="strong": ניתן לכתוב כקביעה.
- support_strength="partial": כתוב כ"משתמע / ניתן ללמוד".
- support_strength="weak": ציין רק כחוסר ודאות, או דלג.
- needs_pinpoint=true: חובה pinpoint בהערה (ס' X ל...).
- אסור להמציא טענות מחוץ למפה.

[JSON של claimMap]

מקורות זמינים:
[N] title — authority_class — citation
```

מבנה תשובה (מחליף את ההנחיה הקיימת לכותרות):
**תשובה קצרה** | **השאלה המשפטית** | **המסגרת הנורמטיבית** | **מקורות מרכזיים** | **ניתוח** | **חוסר ודאות** (אם רלוונטי) | **מסקנה**.

הקריאה עוברת ל-`callDrafter`. **output format זהה** → כל ה-pipeline אחרי שורה 1985 (parsing → matching → cleanup → validators → renumbering → filtering) נשאר ללא שינוי.

## Stage F — Logging & Provenance Hardening

1. **Migration**: `ALTER TABLE qa_logs ADD COLUMN IF NOT EXISTS metadata jsonb;`.
2. **Server-side INSERT** (שורה ~2819) מורחב עם `metadata`:
   ```json
   {
     "decomposition": {...},
     "query_plan_summary": [...],
     "source_pack_summary": [{source_id, authority_class, anchor_present}],
     "claim_map_summary": {total, allowed, by_strength: {strong, partial, weak}},
     "draft_path": "claim_map" | "fallback",
     "models_used": {planner, drafter}
   }
   ```
3. **Client-side INSERT** (`LegalQAChat.tsx` 1232–1257): מוסר עבור `legal_research` בלבד (שאר המצבים נשארים — הם short-circuit ולא לוגינים בשרת).
4. **Provenance hardening (חידוד #3)**:
   - נוסיף `buildResponse(answer, footnotes, source_urls)` helper שמחזיר רק 3 שדות אלה.
   - footnote object ייוצא **בלי** השדה `source` (היום זולג `"local"|"perplexity"|"unverified"`). UI לא משתמש בו לרינדור.
   - בדיקה ב-PR: `JSON.stringify(response)` לא מכיל `provenance`, `source_pack`, `claim_map`, או `decomposition`.

## Stage G — Validators (ללא שינוי)

כל הצנרת אחרי שורה 1985 נשארת מילה במילה: superscripts, dedup, reorder, supra rewrite, Rule 37.5/37.7/37.8, Hebrew year fix, legislation year completeness, protocol cleanup, `reasonFor` filters, orphan cleanup, citation density.

## קבצים שישתנו

| קובץ | שינוי |
|---|---|
| `supabase/functions/legal-qa/aiProvider.ts` | **חדש** — provider fallback + MODEL_CONFIG |
| `supabase/functions/legal-qa/decomposition.ts` | **חדש** — schemas + prompts (decomp+plan, claim-map) |
| `supabase/functions/legal-qa/index.ts` | תוספות בלבד: stages A-D בין 1043–1045; NEW BLOCK ב-prompt 1701–1907; `buildResponse` helper; metadata ב-INSERT 2819 |
| `src/components/LegalQAChat.tsx` | הסרת INSERT ל-qa_logs רק עבור `legal_research`; ללא שינוי UI |
| Migration | `ALTER TABLE qa_logs ADD COLUMN metadata jsonb` |
| `mem://logic/legal-qa/decomposition-and-claim-map` | חדש — תיעוד |
| `mem://architecture/legal-qa-rag` | עדכון |

## Fallback matrix

| תרחיש | התנהגות |
|---|---|
| `taskMode !== "legal_research"` | מסלול היום, אפס שינוי |
| `OPENAI_API_KEY` חסר | planner→Gemini Flash Lite, drafter→Gemini Flash |
| Decomp+plan timeout/error | דילוג על C/D, drafting במסלול היום |
| Claim map timeout/error / 0 allowed | drafting ללא NEW BLOCK |
| Drafter (gpt-5) error | retry אוטומטי עם Gemini 2.5 Flash |

## Latency צפוי

- planner call יחיד (decomp+plan ממוזגים): +2s.
- retrieval מקבילי: +0–0.5s.
- claim-map call: +2s.
- drafter (gpt-5 vs Gemini): +1–2s.
- **סה"כ overhead: ~5–6s** (חיסכון של ~1.5s מהמיזוג).

## Deliverables לאחר implementation

1. סיכום מה השתנה ב-flow.
2. רשימת objects פנימיים חדשים.
3. מודל בכל שלב + fallback.
4. רשימת קבצים.
5. follow-ups למחזור הבא: UI סטטוס שלבים פנימיים ("מפרק שאלה..."), שמירת claim map ב-DB עם FK ל-qa_log לניתוח retroactive, retrieval budget per sub-issue, A/B על 50 שאלות.

