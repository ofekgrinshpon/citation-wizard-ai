

# פורמליזציה של חוזים פנימיים — תכנית מאושרת עם 2 חידודים

## עקרונות (אושרו)
- שכתוב חוזים בלבד, לא rewrite. wrappers/mapping מעל הצנרת שעובדת.
- כל החוזים פנימיים. ה-API החיצוני ממשיך להחזיר רק `{ answer, footnotes, source_urls }`.
- 5 קבצים חדשים, 2 שעודכנו, אפס שינוי UI.

## 2 החידודים (נכללים)

### חידוד #1 — יישור `taskMode` למה שמגיע בפועל
בדיקת קוד אמיתית בסבב הקודם הראתה: ה-frontend שולח `taskMode: "research"` (לא `"legal_research"`), וה-edge function כבר תוקן בסבב הקודם להשוות מול `"research"`. בסבב הזה:
- כל ה-gates החדשים (`if (taskMode === ...)`) ישתמשו באותו קבוע מרוכז: `const RESEARCH_MODE = "research"` בראש `index.ts`.
- בדיקה ידנית של 4 ה-call sites הקיימים שתוקנו בסבב הקודם — מוודאים שכולם עקביים.
- אם בעתיד frontend ישנה ל-`legal_research` — רק שינוי קבוע אחד.

### חידוד #2 — `assertNoInternalLeak` ב-strip mode
במקום `throw` בכל סביבה:
```ts
const BANNED_KEYS = ["provenanceInternal", "decomposition", "claimMap", "sourcePack", "draftingNotes", "uncoveredSubIssues"];
const IS_DEV = Deno.env.get("DENO_ENV") !== "production"; // ברירת מחדל = dev

function sanitizeResponse(payload: object): object {
  // עובר רקורסיבית, מסיר שדות אסורים, מחזיר עותק נקי
  return deepStripKeys(payload, BANNED_KEYS);
}

function buildResponse(answer, footnotes, sourceUrls) {
  const cleanFootnotes = footnotes.map(f => {
    const { source, provenance, ...safe } = f;  // strip קיים
    return safe;
  });
  let payload = { answer, footnotes: cleanFootnotes, source_urls: sourceUrls };
  
  // strip אוטומטי תמיד (defense in depth)
  payload = sanitizeResponse(payload);
  
  // ב-dev בלבד: log warning כדי לתפוס bugs מוקדם
  if (IS_DEV) {
    const json = JSON.stringify(payload);
    for (const k of BANNED_KEYS) {
      if (json.includes(`"${k}"`)) console.warn(`[leak-guard] residual key after strip: ${k}`);
    }
  }
  return payload;
}
```
- production: strip שקט, אין 500 למשתמש.
- dev/staging: strip + console.warn לתפיסה מוקדמת.
- אין throw, לעולם.

## ארכיטקטורה (כפי שאושר)

```text
Frame → Decompose+Plan → Retrieve → Rank → SourcePack(V2) → ClaimMap(V2) → Draft(V2) → Validators
                              ↓                ↓                  ↓               ↓
                        contracts.ts ←── mapping wrappers ──── buildResponse + sanitize
```

## קבצים

| קובץ | פעולה |
|---|---|
| `supabase/functions/legal-qa/contracts.ts` | **חדש** — כל ה-types ב-camelCase: `LegalResearchDecomposition`, `LegalSourcePack(Item)`, `LegalClaimMap(Item)`, `LegalDraftingInput`. `BANNED_KEYS` מיוצא מכאן. |
| `supabase/functions/legal-qa/legalResearchDecomposition.ts` | **חדש** — wrapper על `decomposeAndPlan`. ממפה snake_case של ה-tool ל-camelCase. heuristic ל-`requiresCurrentSources` + `userDocumentsRelevant`. mapping של `questionType`. |
| `supabase/functions/legal-qa/legalSourcePack.ts` | **חדש** — `assembleSourcePack(sourceCards) → LegalSourcePack`. מיפוי authority ל-7 קטגוריות חדשות, פיצול ל-3 קבוצות (core/supporting/secondary), `id: number → "src-${id}"`. `summarizeSourcePack(pack)` ל-logging. |
| `supabase/functions/legal-qa/legalClaimMap.ts` | **חדש** — wrapper על `buildClaimMap`. מיפוי `support_strength → statementMode`: `strong→direct`, `partial→qualified`, `weak→qualified`+note, `allowed_to_state:false→omit`. חישוב `uncoveredSubIssues`. claimId רץ. |
| `supabase/functions/legal-qa/legalResearchModels.ts` | **חדש** — `LEGAL_RESEARCH_MODELS` enum מרוכז (`decomposition`/`claimMap`/`drafting` × `primary`/`fallback`). re-export ל-`aiProvider.ts`. |
| `supabase/functions/legal-qa/index.ts` | עריכות ממוקדות: קבוע `RESEARCH_MODE = "research"` למעלה; שלוש מעטפות mapping (V2) אחרי Stages A/C/D הקיימים; `buildDraftingPromptBlock(draftingInput)` משתמש ב-`statementMode` במקום `support_strength`; gate חדש `useStructuredDrafting`; metadata מורחב ב-INSERT; `sanitizeResponse` + `buildResponse` חדש. |
| `supabase/functions/legal-qa/aiProvider.ts` | re-export `MODEL_CONFIG` מ-`legalResearchModels.ts` (backward compat). |
| `mem://logic/legal-qa/research-contracts` | **חדש** — תיעוד 4 החוזים. |
| `mem://architecture/legal-qa-rag` | עדכון: 4 חוזים פורמליים + sanitize שקט. |
| `mem://index.md` | עדכון רשימה. |

## חוזים (ב-`contracts.ts`)

```ts
type LegalResearchDecomposition = {
  mainIssue, subIssues[], questionType: "normative"|"applied"|"interpretive"|"current_status"|"comparative"|"mixed",
  domain?, jurisdiction: "israel", requiresLegislation, requiresCaselaw, requiresSecondarySources,
  requiresCurrentSources, userDocumentsRelevant, notes?
};

type LegalSourcePackItem = {
  sourceId: string, title, sourceType,
  authorityClass: "primary_legislation"|"primary_caselaw"|"secondary_official"|"secondary_academic"|"external_reference"|"user_document"|"unknown",
  date?, url?, caseNumber?, excerpt?, anchorPresent, usableForAnalysis, usableForCitation,
  provenanceInternal?: "local"|"perplexity"|"document"|"verified"|"unknown",   // INTERNAL — נפלט ע"י sanitize
  metadata?
};

type LegalSourcePack = { coreSources[], supportingSources[], secondarySources[] };

type LegalClaimMapItem = {
  claimId, claimText, subIssue, sourceIds[],
  authorityLevel: "high"|"medium"|"low", confidence: "high"|"medium"|"low",
  needsPinpoint, allowedToState, statementMode: "direct"|"qualified"|"omit", notes?
};

type LegalClaimMap = { claims[], uncoveredSubIssues[], draftingNotes? };

type LegalDraftingInput = {
  userQuestion, decomposition, sourcePack, claimMap,
  userDocumentContext?, responseStyle?: "short"|"regular"|"detailed"
};
```

## Mapping rules

| מ-tool (snake) | ל-contract (camel) |
|---|---|
| `question_type: "doctrinal"` | `interpretive` |
| `question_type: "factual_legal"` | `applied` |
| `question_type: "policy"` | `current_status` |
| `question_type: "procedural"` | `applied` |
| `support_strength: "strong"` + `allowed_to_state:true` | `statementMode: "direct"` |
| `support_strength: "partial"` + `allowed_to_state:true` | `statementMode: "qualified"` |
| `support_strength: "weak"` + `allowed_to_state:true` | `statementMode: "qualified"` + note "תמיכה חלשה" |
| `allowed_to_state: false` | `statementMode: "omit"` |
| `source_type: "primary_legislation"|"basic_law"` | `authorityClass: "primary_legislation"` → coreSources |
| `source_type: "supreme_court"|"district_court"|"labor_court"` | `authorityClass: "primary_caselaw"` → coreSources |
| `source_type: "knesset_research"|"protocol"` | `authorityClass: "secondary_official"` → supportingSources |
| `source_type: "academic_book"|"academic_article"` | `authorityClass: "secondary_academic"` → supportingSources |
| `source_type: "external_web"|"other"` | `authorityClass: "external_reference"|"unknown"` → secondarySources |
| `provenance: "document"` | `authorityClass: "user_document"` → coreSources |

## Gate ל-structured drafting

```ts
const allowedClaims = claimMapV2?.claims.filter(c => c.statementMode !== "omit") ?? [];
const useStructuredDrafting = !!(decompositionV2 && sourcePackV2 && claimMapV2 && allowedClaims.length >= 2);
```
אם `false` → drafter במסלול legacy (prompt הקיים, אפס שינוי התנהגות).

## Logging מורחב ב-`qa_logs.metadata`

```json
{
  "decomposition_v2": { "mainIssue": "...", "subIssues": [...], "questionType": "...", "requiresCurrentSources": true },
  "source_pack_summary": { "core": 4, "supporting": 3, "secondary": 2, "anchored": 7 },
  "claim_map_summary": {
    "total": 8, "direct": 4, "qualified": 3, "omit": 1,
    "uncovered_sub_issues": ["סוגיה נורמטיבית של פיטורים"]
  },
  "drafting_path": "structured" | "fallback",
  "models_used": { "decomposition": "openai/gpt-5-mini", "claim_map": "openai/gpt-5-mini", "drafting": "openai/gpt-5" }
}
```

## Fallback matrix

| תרחיש | התנהגות |
|---|---|
| `taskMode !== "research"` | אפס שינוי |
| `OPENAI_API_KEY` חסר | Gemini fallback אוטומטי (כבר עובד) |
| Decomposition נכשל | `decompositionV2 = null` → drafting legacy |
| Source pack < 2 פריטים | `sourcePackV2 = null` → drafting legacy |
| Claim map נכשל / 0 allowed | `claimMapV2 = null` → drafting legacy |
| Drafter (gpt-5) נכשל | retry Gemini (כבר ב-`aiProvider.ts`) |
| שדה פנימי דלף | strip שקט ב-prod, warn ב-dev — **ללא 500** |

## Latency

מעטפות mapping = ~5ms. `sanitizeResponse` = O(payload size) ≈ <1ms. אין קריאות LLM נוספות מעבר למה שכבר קיים בסבב הקודם.

## Deliverables

1. 4 חוזים פורמליים ב-`contracts.ts`.
2. 3 wrappers (`legalResearch{Decomposition,SourcePack,ClaimMap}.ts`).
3. config מודלים מרוכז (`legalResearchModels.ts`).
4. `RESEARCH_MODE` קבוע + mapping wrappers ב-`index.ts`.
5. `sanitizeResponse` שקט ב-`buildResponse`.
6. metadata מורחב ב-`qa_logs`.
7. **מומלץ למחזור הבא**: shadow A/B logger — logger בלבד שמריץ structured + legacy על 30 שאלות מ-`qa_logs` במקביל ומשווה citation density / dropped_count, ללא שינוי ל-end users.

