# Step 2.3 — Topic-Faithful V3 Planner (revised)

## Goal
Stop the V3 planner from drifting into generic constitutional anchors (Bank Mizrahi / Basic Law §8) on procedural, administrative, or contract questions — **without** banning legitimate constitutional analysis when the sub-question actually involves a right, a limitation clause, or judicial review of legislation.

No change to retrieval, fallback (Step 2.2), V2 ledger, drafter, or citation engine. Prompt + sanitizer + telemetry + fixtures only.

## Scope

### 1. `supabase/functions/legal-qa/legalResearchPlanV3.ts`

**Tool schema additions**
- New required field on plan: `doctrinal_frame` (enum):
  `constitutional | administrative | procedural_civil | procedural_admin | contract | criminal | tort | other`
- New optional field on each anchor: `constitutional_relevance_reason?: string`
  (≤200 chars, Hebrew). Required *only* for constitutional-type anchors when `doctrinal_frame !== "constitutional"`.

**System prompt additions**
- Declare frame taxonomy and instruct planner to set `doctrinal_frame` first, then choose anchors that match the frame.
- **Constitutional relevance gate** (replaces the earlier blocklist idea):
  Constitutional anchors (Basic Laws, פסקת הגבלה, Bank Mizrahi, judicial review canon) are allowed under a non-constitutional frame *only* when at least one of these holds, and the planner must state it in `constitutional_relevance_reason`:
  1. The user question explicitly mentions Basic Laws, constitutional rights, פסקת הגבלה, ביטול חקיקה, or ביקורת שיפוטית על חקיקה.
  2. A specific sub-question involves infringement of a constitutional right.
  3. Concrete doctrinal reason tying the constitutional anchor to *this* sub-question (e.g. positive duty to protect life/body/dignity/property; freedom of expression vs. temporary injunction).
- Three frame few-shots:
  - **Procedural (Q1 — temporary injunction):** frame=`procedural_civil`; anchors: תקנה 95 לתקנות סדר הדין האזרחי, סעיף 75 לחוק בתי המשפט, רע"א 4196/93 שפע בר. *Permitted constitutional anchor* example: Basic Law: Human Dignity §§2,4 with `constitutional_relevance_reason="צו מניעה נגד פרסום פוגע בחופש הביטוי"` — only when the question scenario involves publication/expression.
  - **Contract (Q5 — Apropim / §25):** frame=`contract`; anchors: ע"א 4628/93 אפרופים, ע"א 2825/97 מגדלי הירקות, סעיף 25 לחוק החוזים. No constitutional anchors.
  - **Administrative-exhaustion (Q7):** frame=`procedural_admin`; anchors: בג"ץ 991/91 פסטרנק, חוק בתי משפט לעניינים מינהליים, זמיר "הסמכות המינהלית". Bank Mizrahi forbidden unless the petition itself attacks legislation.

**Sanitizer logic (`sanitize` function)**
- After existing per-anchor validation, run a `frameGate` pass:
  - Identify constitutional anchors by: `type === "basic_law_section"` OR `name` matches a constitutional-canon regex (Bank Mizrahi / לשכת מנהלי ההשקעות / בג"ץ 5658/23 עילת הסבירות / פסקת הגבלה / ברק "מידתיות").
  - If `doctrinal_frame === "constitutional"` → keep all.
  - Else: keep the anchor only if `constitutional_relevance_reason` is non-empty (≥15 chars) **and** not a generic boilerplate string (reject "חשוב לנושא", "רלוונטי באופן כללי" etc. via a short reject list).
  - Drops are recorded, not silent: push `{anchor_id, name, reason}` into `frame_mismatch_dropped` array.
- Return the gated anchor list. If gating reduces anchors below 2, keep the plan but stamp `frame_gate_underflow=true` (V2 retrieval still proceeds via its own AnswerMap).

### 2. Telemetry — `qa_logs.metadata.v3_legal_research_plan`
Add:
- `doctrinal_frame: string`
- `frame_mismatch_dropped: Array<{anchor_id, name, reason}>` (default `[]`)
- `frame_mismatch_dropped_count: number`
- `constitutional_anchors_kept_with_reason: number` (anchors that passed the gate via `constitutional_relevance_reason` under a non-constitutional frame)
- `frame_gate_underflow?: boolean`

Update `summarizeLegalResearchPlanV3` to surface the above.

### 3. Fixtures + eval
- New file: `eval/_step2_3_frame_probe.mjs` (reuse Q1/Q5/Q7 harness from `_mini-q1-q5-q7-probe.mjs`).
- Add to `eval/regression/gold_anchors.json` (or a sibling `v3_frame_anchors.json`):
  - **Q1**: `doctrinal_frame ∈ {procedural_civil}`, expect ≥1 of `[תקנה 95, סעיף 75, רע"א 4196/93, שפע בר]`. Constitutional anchors allowed only if scenario triggers freedom-of-expression reasoning.
  - **Q5**: `doctrinal_frame === "contract"`, expect ≥2 of `[אפרופים, מגדלי הירקות, סעיף 25]`. Zero constitutional anchors accepted.
  - **Q7**: `doctrinal_frame ∈ {administrative, procedural_admin}`, expect ≥1 of `[פסטרנק, חוק בתי משפט לעניינים מינהליים, זמיר]`. Bank Mizrahi only with explicit reason.
  - **Q3 regression**: `doctrinal_frame === "constitutional"`, anchors unchanged (BL §8, BL §4, Bank Mizrahi all pass).
  - **Q-protection-money regression** (if a fixture exists or we add a stub): non-constitutional frame BUT BL §§2,4 kept because `constitutional_relevance_reason` cites positive duty to protect life/body.

## Acceptance gates (deep mode rerun)
- Q1: frame correct; ≥1 procedural seminal anchor present; any constitutional anchors carry a sub-question-specific reason.
- Q5: frame=`contract`; ≥2 contract seminals; zero constitutional anchors kept.
- Q7: frame admin-family; ≥1 exhaustion seminal; no Bank Mizrahi unless reasoned.
- Q3: unchanged behavior (Step 2.2 still green, footnotes 5–8).
- `frame_mismatch_dropped` populates with concrete entries on Q5/Q7 (proof the gate fires) and stays empty on Q3.
- No V1 fallback. No raw open-web citations. V2 ledger/drafter untouched.

## Out of scope
- Must-cite enforcement (Step 3) — still deferred until 2.3 is green.
- Any change to `anchorFallbackV3.ts`, `researchV2Pipeline.ts`, ledger, drafter, or citation engine.
- Adding new frame categories beyond the 8 listed.

## Risks
- Planner writes weak/boilerplate `constitutional_relevance_reason` to bypass the gate. Mitigation: minimum length + short boilerplate reject list; surface kept-with-reason count in telemetry for audit.
- Hybrid questions (e.g. administrative petition that attacks a regulation's constitutionality) may legitimately want frame=`administrative` *and* Bank Mizrahi. Covered by reason path; if it becomes common, add a `hybrid_constitutional: boolean` flag in a later pass.
