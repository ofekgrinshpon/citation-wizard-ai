# academic_draft_presentation_hygiene_v1

Follow-up to `academic_writing_intent_and_drafting_v1`. Detection and safety are correct; this track fixes how academic drafts are *presented*. Retrieval, acquisition, sufficiency thresholds, judgment identity, docket limitation, claim-source-match and citation rendering stay untouched except where they emit display text.

## 1. Prose genre enforcement

For genres `introduction`, `theoretical_background`, `topic_presentation`, `argument_paragraph`:

- Prompt rule stays, plus a **deterministic post-draft pass** that converts leading bullet markers (`-`, `•`, `*`, `1.`) into continuous prose sentences and merges short bullet-only paragraphs into one paragraph.
- Bullets are preserved only when the genre is `chapter_outline` or the user's question explicitly asks for a list/outline (רשימה, מתווה, ראשי פרקים, בנקודות).
- Also strip template-like `###` sub-headings from these genres.

## 2. Argument paragraph contract

When `academic_genre = argument_paragraph`:

- Prompt targets one paragraph, 150–300 words.
- Deterministic guard: if the draft returns multiple body blocks, keep the first substantive paragraph and merge the remainder only if the total stays inside the ceiling; otherwise truncate at the paragraph boundary nearest 300 words.
- No sub-headings, no "מבנה העבודה" framing.

## 3. One caveat only

Today the answer assembly can append, in sequence: `ACADEMIC_LIMITED_DRAFT_NOTICE_HE`, the reference-only section, `NARROW_LIMITED_DOCTRINAL_NOTICE_HE` / `LIMITED_DOCTRINAL_ANSWER_NOTICE_HE`, `matched.limitation_text`, and the processing-limit line appended in `index.ts`.

For `user_task_intent = academic_writing` all of these are suppressed and replaced by exactly one trailing note:

- thin pack (`academic_limited_draft` branch, or the limited-doctrinal/limitation paths would have fired):
  `הערת עבודה: זוהי טיוטה אקדמית ראשונית. לפני הגשה יש להשלים הפניות מדויקות לפסיקה ולספרות.`
- otherwise:
  `הערת עבודה: הטיוטה מבוססת על המקורות שאותרו, אך לפני הגשה יש לוודא התאמה מלאה להנחיות הקורס.`

Safety-critical branches (docket limitation, judgment-identity refusal, fabricated-docket refusal) keep their own text and are not academic-writing paths, so they are unaffected.

## 4. URL / body hygiene

- A deterministic scrub removes bare `http(s)://…` URLs and court download links from the academic answer body (footnotes keep their URLs untouched).
- Found-but-unread sources are not listed inline. If any are worth surfacing, they appear after the single caveat as a compact block titled `להמשך בדיקה` with at most 3 short titles and no URLs.

## 5. Topic drift guard

For academic writing:

- The drafter prompt is given the user's topic terms (from the question and the plan's claims) and instructed to use retrieved sources only to enrich that topic; unrelated doctrinal contexts must not be introduced.
- Deterministic assist: sources whose legal area does not overlap the question's area are demoted out of the drafting context for academic tasks (they remain in the pack, so no retrieval change) — e.g. religious-court material on a ministerial-appointments prompt.

## 6. Technical notes

- `stages/drafterV2.ts` — new `applyAcademicPresentationHygiene()` (bullet→prose, heading strip, URL scrub, argument-paragraph ceiling), the single-note assembly for academic answers, and the genre/topic prompt additions.
- `stages/metadataOnlyHoldingGate.ts` / `stages/claimSourceMatch.ts` — their trailing texts are suppressed by the caller for academic tasks; internal logic unchanged.
- `supabase/functions/legal-research-v1/index.ts` — skip the processing-limit line for academic answers.
- Telemetry: `academic_presentation_hygiene` report (bullets converted, urls stripped, notices suppressed, paragraph trimmed, sources demoted for drift).

## 7. Validation

- Unit fixtures for the hygiene pass (bullets → prose, URL scrub, argument-paragraph ceiling, single-notice selection).
- Live re-run of AW1, AW4, AW5, AW7, AW8 plus AW2/AW3 as controls, using the existing runner.
- Acceptance: AW1 prose intro, no gap opener, ≤1 caveat; AW4 prose, no raw URLs, ≤1 caveat; AW5 focused on ministerial/political appointments with no religious-court drift; AW7 one paragraph (150–300 words); AW8 usable topic presentation, ≤1 caveat; AW2 still source recommendation; AW3 still fires docket limitation.
- Report + full answers: `reports/academic-draft-presentation-hygiene/ACCEPTANCE_REPORT.md`, delivered in chat.
