# V2 Attachments Integration + V1 Production Retirement

## 1. Previous routing problem

`researchFunctionFor({ hasAttachments })` routed **any** request carrying a file to
`legal-research-v1`. A single attachment therefore silently downgraded the whole
request to the legacy pipeline (legacy verification, legacy footnotes, legacy
telemetry). This branch is removed: routing now depends only on
`RESEARCH_PIPELINE`, which is `"v2"`.

## 2. Attachment extraction architecture

V1's extraction logic was moved, not rebuilt:

- `supabase/functions/_shared/userDocumentsCore.ts` — pure core: file/byte caps,
  MIME whitelist, storage-path ownership validation, chunking, page-map
  assembly, locator formatting, the document-content vs legal-authority rule.
  No npm/Deno imports, fully unit-testable.
- `supabase/functions/_shared/userDocuments.ts` — IO wrapper: downloads owned
  objects from `user-documents`, PDF via unpdf (page-by-page), DOCX via mammoth,
  per-file errors isolated so one bad file never aborts the batch.

All pre-existing safety limits preserved: max files, max bytes, extraction
timeout, total/per-file text caps, docket-matched expanded limits, ownership
check on every storage path.

## 3. V2 EvidenceStore integration

`evidence/userDocumentSources.ts` extracts, then appends each document to the
append-only EvidenceStore as a first-class source (`origin: "user_document"`,
sha256 content hash, identity fields, page map, file metadata). The agent
receives only a compact manifest (`S1 — lease.pdf — user-uploaded document —
3 pages` + short head excerpt) and re-reads targeted windows with the existing
`fetch({ source_id, query })` tool. No whole-document dump into model context.
The legacy `attachment_text` field remains only as a backwards-compatible
fallback when no manifest exists.

## 4. Evidence semantics and safeguards

- A user document may support **document-content** claims ("בסעיף 7 להסכם נקבע…").
- It may **not** support a general legal proposition. Verification CHECK 1b
  rejects such pairs with `user_document_not_legal_authority`.
- An uploaded judgment/statute becomes legal authority only after the same
  deterministic docket/title/body identity corroboration used for acquired
  authorities. Filename is never evidence.
- No "attachments are trusted" shortcut: uploaded sources pass the normal
  span-exists, span-supports, identity and temporal gates.

## 5. Locators and citations

Page provenance survives extraction → EvidenceStore → served excerpt → verified
source → footnote (`lease שצורף, עמ' 2`). DOCX uses stable chunk locators
(`מקטע 1`); Word page numbers are never invented. Footnotes carry no URL for
private documents, and never expose storage paths, source ids or hashes.

## 6. Resume persistence

Attachments are preloaded only on the first chunk; the serialized agent state
carries the store and the manifest, so a resumed worker still sees and can
re-read every uploaded source. Covered by a dedicated serialize/restore test.

## 7. Frontend routing

`src/config/researchPipeline.ts` — `researchFunctionFor()` ignores attachments.
`LegalResearchV1Panel` submits to V2 with the same attachment payload; upload UX
unchanged. Rollback remains a single line: `RESEARCH_PIPELINE = "v1"`.

## 8. V1 retirement audit

| Reference | Classification |
| --- | --- |
| `RESEARCH_FUNCTIONS.v1` in `researchPipeline.ts` | rollback only |
| `legal-research-v1` edge function directory | rollback / dead path |
| `src/test/*`, `eval/*` imports of V1 stages | test/eval |
| `useUsageStats`, `useUserUsage`, `QAHistorySidebar`, `LegalQAChat` | historical rows (read-only) |
| `LegalSourceSearchPanel` submit → `legal-research-v1` | **fixed this task**: now submits to V2 with `mode: "source_search"` |

No normal production path reaches V1. Nothing deleted.

## 9. Tests

Full suite **952/952** across 81 files, `tsgo` clean. 28 attachment tests in
`src/test/v2Attachments.test.ts` cover owned PDF/DOCX, unsupported MIME, wrong
user path, oversized file, timeout, empty PDF, multiple files, truncation,
docket-matched limits, contract-content claim, contract vs legal authority,
matching uploaded judgment, wrong-docket judgment, irrelevant file, separate
file identities, resume survival, no internal ids in citations, Rule 37 with
mixed attachment/external sources, compound footnote.

## 10. Live acceptance matrix

All runs submitted to `legal-research-v2` by the signed-in QA account.

| Test | Run id | Result |
| --- | --- | --- |
| T1 — DOCX contract, clause question | `3d6102f8-7d2a-4c93-8b49-3ca8372291bb` | PASS — clause 7 read correctly, cited `lease שצורף, מקטע 1`, marker ¹ |
| T2 — same contract + enforceability/caselaw | `84db6c07-0beb-40f8-b602-1afdf1a11c3b` | PASS — statute supplies the law, contract supplies the clause; compound footnote 2 = attachment + `חוק החוזים (תרופות), לעיל ה"ש 1` |
| T3 — uploaded judgment as authority | not run live | deterministic tests only (see §11) |
| T4 — PDF extraction + page locator | `b84812c5-f338-47e5-a4bf-2f9f9455ad5e` | PASS — sections 7 and 8 read, locator `עמ' 2` correct, `שם.` repeats |
| T5 — irrelevant attachment | `f8515ee7-8575-47da-b147-230a8a701ffb` | PASS — recipe preloaded, never cited, normal external research |
| T6 — two files | `6226da51-3c40-40e4-9895-56977ecd088f` | PASS — S1/S2 identities separate, compound footnote 3 = `lease…, לעיל ה"ש 2; letter…, לעיל ה"ש 1` after fix |
| T7 — attachment + repeated external authority | covered by T2/T5 | PASS — Rule 37 `שם.` / `לעיל ה"ש` correct alongside an attachment |

Routing telemetry (`pipeline: legal-research-v2`, `attachment_count`,
`attachment_documents_loaded`, `attachment_chars_loaded`,
`attachment_sources_preloaded`, `attachment_sources_cited`,
`attachment_extract_errors`, `attachment_authority_rejections`) is recorded;
T4/T5/T6 show it directly, T1/T2 predate the telemetry deploy but ran on the
same V2 endpoint and cite preloaded attachment sources.

## 11. Defect found and fixed during acceptance

T6 exposed a real repeat-label bug: `extractShortSourceLabel` matched the
legislation lead word `צו` **inside** the word `שצורף`, collapsing
`lease שצורף` to `צורף`, so two different uploaded documents produced identical
`לעיל ה"ש` labels. Hebrew has no `\b`, so the lead words are now anchored to a
string start or separator. Fixed in `_shared/footnoteOccurrences.ts` and the
browser twin `src/lib/footnoteRepeatRules.ts`, with three new tests. No research
or verification behaviour touched.

The V1 compound-footnote defect (merged titles, lost second URL) is **not**
fixed: it exists only on the retired production path.

## 12. Remaining risks

- T3 (live uploaded judgment used as named authority) was not exercised against
  a real judgment file; identity behaviour rests on deterministic tests C/D.
- T1/T2 lack explicit routing telemetry rows (pre-deploy), proven by endpoint
  and citations instead.
- Long-run stalls remain a general infrastructure issue, unrelated to attachments.

## 13. V1 deletion plan

Keep `supabase/functions/legal-research-v1` deployed and in-repo through the
initial beta stability window. Once V2 attachment traffic is stable and no
rollback has been needed, delete the function directory and the V1 branch of
`researchFunctionFor`, migrating any still-needed test helpers into `_shared`.

V2 ATTACHMENTS + V1 PRODUCTION RETIREMENT — PARTIAL

NORMAL LEGAL RESEARCH PRODUCTION TRAFFIC: V2 ONLY

V1 PHYSICAL DELETION: DEFERRED UNTIL POST-MIGRATION STABILITY CHECK
