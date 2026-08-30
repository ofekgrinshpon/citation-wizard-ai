# academic_writing_intent_and_drafting_v1

When a user asks ReLex to *write* academic text ("כתוב פרק מבוא לסמינריון…"), the system currently answers as if it were a doctrinal research question and opens with a source-gap report. This track makes the pipeline recognise academic-writing requests and return an actual academic draft in the requested genre, while keeping every existing safety rule intact.

## Scope

Untouched: retrieval, source acquisition, judgment identity validation, docket limitation, claim-source-match, citation rendering, found-only support rules.

Changed: intent vocabulary, deterministic intent detection, drafter genre instructions, and the sufficiency-refusal path for this one intent.

## 1. New intent vocabulary

Add to the shared plan vocabulary:

- `user_task_intent: "academic_writing"`
- `answer_strategy: "draft_academic_text"`

Both are added to the analyzer's JSON schema enums so the model can plan them, with schema guidance describing them as "the user asks the system to write academic prose (מבוא, רקע תיאורטי, פסקת טיעון, מתווה פרקים)".

## 2. Deterministic detection (does not depend on the model)

A new deterministic detector runs inside the source-use-intent stage and can force the plan to `academic_writing` / `draft_academic_text`:

- writing verbs + academic object: כתוב/נסח/ניסחו/הרחב + פרק מבוא, מבוא, רקע תיאורטי, פרק תיאורטי, הצגת נושא, פסקה אקדמית, פרק ראשון, מתווה פרקים, סמינריון, עבודה אקדמית, עבודת גמר;
- "שאלת המחקר … היא" framing combined with a writing verb.

Guards (detection is suppressed / not applied):

- the request is explicitly source-seeking ("תן לי מקורות", "מצא פסיקה", "ביבליוגרפיה", "רשימת קריאה") → stays `source_recommendation` / `literature_map`;
- an explicit docket appears in the question → existing docket safety floors keep priority (`case_holding`, judgment body required); academic writing may only ride along as the secondary intent.

When academic writing is detected the plan sets `secondary_sources_can_support: true`, keeps `found_only_can_support_claims: false`, and records an override string in telemetry (`academic_writing_intent_detected`).

## 3. Drafting behaviour

In the drafter, an `academic_writing` plan swaps the answer contract:

- produce continuous Hebrew academic prose in the requested genre — no bullet-point research report, no "מקורות שאותרו" opening, no research-gap framing as the lead;
- for an introduction chapter, cover (as appropriate): framing of the legal problem, doctrinal background, the research question, the central tension, why it matters, and the planned structure of the paper;
- treat legal concepts named by the user (e.g. "עקרון הפרדת הרשויות") as the user's topic, not as claims that need source anchoring — the negative-existence "לא נמצא עיגון מספק לשם…" framing is not emitted for concepts that come from the prompt;
- unsupported specific holdings remain forbidden: no attributing rulings to courts without an acquired judgment body, no invented citations, no citing found-only or metadata-only sources;
- caveats are consolidated into at most one short note **after** the draft, e.g. "הטיוטה מנוסחת כמבוא אקדמי ראשוני. יש להשלים בהמשך הפניות מדויקות לפסיקה ולספרות." When citations are thin the draft is additionally labelled "טיוטה ללא השלמת הפניות מלאות". No caveat sentences scattered through the prose.

## 4. Sufficiency path

Thin sources must not block drafting. For `academic_writing` plans the `insufficient_sources_limitation` branch is replaced by an *academic limited draft* branch: the draft is produced from the general framework, cautious formulations are required, and the post-draft note is appended. Docket limitation, statute-section limitation and canonical-quote branches keep priority and are unchanged.

## 5. Technical notes

- `lib/types.ts` — extend `USER_TASK_INTENTS` and `ANSWER_STRATEGIES`.
- `lib/schemas.ts` — extend the analyzer tool enums + description.
- `stages/sourceUseIntent.ts` — new `detectAcademicWritingRequest()` and the override, plus `isAcademicWritingTask()` helper; safety floors keep their current precedence order.
- `stages/drafterV2.ts` — genre instruction block, suppression of gap-report lead and scattered caveats, single post-draft note, new `deterministic_branch: "academic_limited_draft"`.
- `stages/sourceSufficiency.ts` — academic-writing exemption from the refusal branch (never from the anchor/docket gates).
- `stages/negativeExistenceGuard.ts` — skip prompt-derived concept rewriting when the plan is academic writing.
- Telemetry: plan overrides, detected intent, branch, citation count.

## 6. Validation

**Stage 1 — fixture tests** (new Deno/vitest test file): the six classification fixtures from the brief (intro chapter → academic_writing; "תן לי מקורות" → literature_map/source_recommendation; "מה הדין" → doctrinal_explanation; "סכם את בג״ץ X" → case_holding + judgment body; "רקע תיאורטי" → academic_writing; "מצא פסיקה על…" → source_recommendation/case_law_synthesis).

**Stage 2 — mini live smoke** (3 runs): the reading-in / separation-of-powers introduction, one literature-map prompt, one case-holding safety prompt. Acceptance exactly as specified: prose intro, no "במקורות שאותרו לא נמצא" opening, no unsupported binding case law, short post-draft note only, literature map still returns sources, case-holding safety unchanged.

**Stage 3 — 5-prompt evaluation**: introduction, theoretical background, research-question refinement, chapter outline, argument paragraph. Report detected intent, output genre, citation count, caveat style, and whether the text is usable.

Results written to `reports/academic-writing-intent/ACCEPTANCE_REPORT.md`.
