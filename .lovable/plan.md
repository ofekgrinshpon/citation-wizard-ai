**Findings**

I checked the latest `qa_logs`, Edge Function logs, and the Core retrieval code. The backend itself is healthy. The last failures are two different failure modes:

1. **08:30 run failed in the planner**
   - `qa_logs.id = 5ceb384a-0a57-4f61-bd62-4d2ff56580c5`
   - Stage telemetry: `plan` ran for `90002ms` and failed with `planner_threw:The signal has been aborted`.
   - Cause: Core planner uses `openai/gpt-5` with a hard 90s timeout. The expanded planner prompt + Deep query caused the planner to hit the timeout before producing a plan.

2. **08:33 run passed retrieval but failed citation quality**
   - `qa_logs.id = 7bb50422-3be4-4900-9cb2-eedc9117eccf`
   - Retrieval found the expected anchor sources:
     - MMM / Knesset source: `גביית דמי חסות – ניתוח נתוני דיווח לכנסת – תיקון`
     - MMM / Knesset source: `סחיטת דמי חסות`
     - Journal article: the concept layer did inject a `journal_article` candidate.
   - But the final result failed at `citation_quality` with `insufficient_verified_sources`.
   - Quality summary: `ok: 2`, `partial: 4`, `failed: 3`; one claim lost all support (`C3`).
   - Root cause: the source recall fix worked partially, but the quality gate still dropped several sources as `uninformative_label`. That means sources entered retrieval/ledger, but their final canonical citation text was too weak or generic for the final footnote quality pass.

3. **08:38 run appears stuck/running, not a completed failure yet**
   - `qa_logs.id = 8636f639-fca0-4179-9b83-f38d264094cf`
   - It still contains the placeholder answer `מעבד שאלה…`, no Core metadata, and no stage telemetry.
   - This usually means the async worker was pre-inserted but has not written a terminal result yet. The status endpoint has a 6-minute watchdog, so it will eventually surface as failed if the background worker never completes.

**Important regression detail**

The latest retrieval change did bring back the desired source families. The failure is now mostly downstream of retrieval:

- Anchors are present.
- Concept layer is present.
- The article layer is no longer totally starved.
- But citation quality rejects too many ledger sources because the citation labels/canonical output are not considered sufficiently informative.

There is also one retrieval-side issue still visible:

- For claims that require binding law and have too few primary local hits, `needPrimary` filters anchor candidates through `isPrimaryLaw`.
- That preserves primary law, but it can also suppress secondary anchors like MMM/journal sources on claims where those sources are needed as factual/doctrinal support.
- In the 08:33 run, concept injection happened only once, not broadly across doctrinal claims.

**Plan**

1. **Fix planner timeout without weakening the answer**
   - Update Core planner to use the faster planning model already aligned with the research architecture (`openai/gpt-5-mini`) instead of full `openai/gpt-5` for the planning-only JSON stage.
   - Keep the drafter on the stronger model path.
   - Preserve the same PlanV1 schema and no DB changes.

2. **Make the async failure row explicit**
   - Ensure a background worker timeout/crash updates the existing `qa_logs` row with a terminal `failed` checkpoint and a clear `stage_runs` reason, instead of leaving only `מעבד שאלה…` until the watchdog infers failure.
   - This is operational telemetry only; no schema change.

3. **Preserve primary-law protection without starving secondary anchors**
   - Keep `needPrimary` for the main candidate budget.
   - Do not let it eliminate all factual/concept secondary anchors when a claim explicitly needs `scholarship`, `doctrinal_definition`, or factual context.
   - Implement this as a general rule: primary-law claims still reserve primary slots, while secondary anchor slots may survive only for non-primary evidence needs and still go through the verifier.
   - No hardcoded document IDs, titles, or query-specific strings.

4. **Repair citation label quality for local secondary sources**
   - For local `knesset_research` and `journal_article` candidates, ensure `title`, `citation`, `source_type`, `source_url`, and publication metadata from `legal_documents` metadata are carried into the final citation-quality stage when available.
   - Local DB metadata should override weaker web metadata.
   - This addresses the `uninformative_label` drops without changing the citation engine, verifier, ledger, footnote builder, Citation Review UI, or Batch Footnote Builder.

5. **Validate against the failed runs**
   - Re-run the same query.
   - Confirm:
     - Planner does not time out.
     - `concept_anchor_candidates.injected_into_claims >= 1` remains true.
     - MMM and journal candidates survive into ledger/citation quality when verified.
     - `citation_quality.status` is not `insufficient_verified_sources` for this run.
     - No migration and no forbidden modules touched.

**Files I would touch after approval**

- `supabase/functions/legal-qa/core/planner.ts`
- `supabase/functions/legal-qa/core/retrieval.ts`
- Possibly the Core citation-quality metadata handoff path inside `supabase/functions/legal-qa/core/runCore.ts`
- Possibly async failure handling in `supabase/functions/legal-qa/index.ts`

**Files I will not touch**

- Citation engine
- Drafter logic
- Verifier logic
- Ledger logic
- Footnote builder
- Citation Review UI
- Batch Footnote Builder
- Database schema / migrations