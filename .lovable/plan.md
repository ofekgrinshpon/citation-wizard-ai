**מצאתי את הסיבה**

ה־UI כבר יודע למפות `queued` ל־`plan`, אבל בריצה הנוכחית ה־status endpoint מחזיר בפועל:

```text
status: running
checkpoint: null
metadata.pipeline_used: core_running
stage_runs: []
```

כלומר הבעיה אינה רק ב־frontend: במסלול Core החדש יש pre-insert שמחליף את המטא־דאטה של השורה ל־`pipeline_used: core_running` בלי לשמר `checkpoint: queued`. לכן ה־polling מקבל `checkpoint: null`, ו־`deepCheckpointToStages(null)` מחזיר `[]`, אז המסך נשאר בשורת ההתחלה “מתחבר למנוע המחקר” על 2%.

**תוכנית תיקון מינימלית**

1. **לתקן את pre-insert של Core Deep** ב־`supabase/functions/legal-qa/index.ts` כך שלא ימחק את ה־checkpoint:
   - לשמור `checkpoint: "queued"`
   - לשמור `checkpoint_at`
   - לשמור `stage_runs: []`
   - להשאיר `pipeline_used: "core_running"`

2. **להוסיף bridge קטן ל־Core onStage** באותו אזור בלבד:
   - כש־`runCore` קורא `onStage("plan", "running")`, לעדכן `metadata.checkpoint = "running"` או `"decomposition"`/`"plan"`
   - כש־`retrieval`, `verify`, `ledger`, `draft`, `enrich_citations` מתחילים/מסתיימים, לעדכן checkpoint תואם לשמות שה־frontend כבר מכיר.
   - זה יהיה logging/progress בלבד, בלי לשנות retrieval/verifier/drafter/citation logic.

3. **לעדכן את mapper רק אם צריך** ב־`src/lib/legalQa/deepCheckpointToStages.ts`:
   - להוסיף aliases חסרים כמו `plan`, `verify`, `ledger`, `draft`, `enrich_citations` אם ה־Core bridge ישתמש בשמות האלה.
   - להשאיר את התנהגות Fast/academic ללא שינוי.

4. **אימות**
   - לבדוק ש־`legal-qa-status` כבר לא מחזיר `checkpoint: null` בריצת Deep חדשה.
   - לוודא שה־UI יוצא מ־“מתחבר למנוע המחקר” אחרי poll ראשון ומתקדם דרך שלבי Core.

**מחוץ לתחום**

- לא נוגע ב־Q5.
- לא משנה timeout handling.
- לא משנה retrieval/verifier/drafter/citation/UI מעבר לתרגום התקדמות.