# ACCEPTANCE REPORT — academic_writing_intent_and_drafting_v1

Status: **ACCEPTED with defects (default-on / monitor)**
Function: `legal-research-v1` (deployed)
Run date: 2026-08-30 · 8 live queries (AW1–AW3 Stage-2 smoke, AW4–AW8 Stage-3 eval)
Runner: `scripts/legal-research-v1-academic-writing-validation.ts`
Raw telemetry + full answers: `reports/academic-writing-intent/results.json`

## 1. What shipped

1. **Intent vocabulary** (`lib/types.ts`, `lib/schemas.ts`)
   `academic_writing` added to `UserTaskIntent`, `draft_academic_text` to `AnswerStrategy`,
   optional `academic_genre` on `SourceUsePlan`
   (`introduction` / `theoretical_background` / `research_question` / `chapter_outline` /
   `argument_paragraph` / `topic_presentation` / `generic_academic`).

2. **Deterministic detection** (`stages/sourceUseIntent.ts`)
   `detectAcademicWritingRequest()` pairs a writing verb (כתוב / נסח / חבר / ניסוח)
   with an academic object (פרק מבוא, רקע תיאורטי, סמינריון, שאלת מחקר, מתווה פרקים,
   פסקת טיעון, עבודת גמר). Guards: an explicit docket demotes academic writing to a
   secondary intent; source-seeking phrasing ("תן לי מקורות") suppresses the override.

3. **Sufficiency exemption** (`stages/sourceSufficiency.ts`)
   `academic_writing` tasks pass the gate on thin packs with reason
   `academic_writing_draft_allowed` → branch `academic_limited_draft` instead of refusal.

4. **Drafter genre rules** (`stages/drafterV2.ts`)
   Hebrew prose instructions per genre, bullets suppressed except for `chapter_outline`,
   no source-gap opener, `scrubNegativeExistenceClaims` skipped for academic tasks
   (user-named concepts treated as topic framing), single trailing
   `ACADEMIC_LIMITED_DRAFT_NOTICE_HE`.

5. **Fixtures** — `src/test/academicWritingIntent.test.ts`, 12/12 passing.

## 2. Results

| ID | task | strategy | genre | branch | gap opener | bullets | fn | len | s |
|---|---|---|---|---|---|---|---|---|---|
| AW1 פרק מבוא — קריאה לתוך החוק | academic_writing | draft_academic_text | introduction | academic_limited_draft | no | 0 | 5 | 4193 | 183 |
| AW2 "תן לי מקורות" (control) | source_recommendation | recommend_sources | — | — | no | 7 | 1 | 1898 | 157 |
| AW3 בג"ץ 9999/99 (fake docket, control) | case_holding | summarize_case | — | docket_limitation | yes (correct) | 0 | 0 | 342 | 86 |
| AW4 רקע תיאורטי — מידתיות | academic_writing | draft_academic_text | theoretical_background | — | no | **6** | 1 | 3555 | 172 |
| AW5 ניסוח שאלת מחקר | academic_writing | draft_academic_text | research_question | — | no | 1 | 2 | 3083 | 182 |
| AW6 מתווה פרקים | academic_writing | draft_academic_text | chapter_outline | academic_limited_draft | no | 5 (allowed) | 3 | 1807 | 152 |
| AW7 פסקת טיעון אקדמית | academic_writing | draft_academic_text | argument_paragraph | academic_limited_draft | no | 0 | 1 | 2155 | 137 |
| AW8 הצגת נושא — הבטחה מנהלית | academic_writing | draft_academic_text | generic_academic | — | no | 0 | 2 | 2528 | 137 |

## 3. Acceptance checks

| Criterion | Result |
|---|---|
| Academic writing requests detected | **Pass** — 6/6 academic prompts planned `academic_writing / draft_academic_text`, genre correct in all six |
| Control prompts unaffected | **Pass** — AW2 stayed `source_recommendation`; AW3 fired `docket_limitation` and refused the fabricated docket |
| Genre-appropriate prose | **Partial** — AW1/AW7/AW8 clean prose; AW6 correctly listed as an outline; **AW4 rendered 6 bullets** and AW5 one, against the prose rule |
| No source-gap opener | **Pass** — 0/6 academic answers open with "במקורות שאותרו…" |
| Refusal replaced by limited draft | **Pass** — thin-pack runs produced `academic_limited_draft` drafts (AW1, AW6, AW7), no `insufficient_sources_limitation` |
| User-named concepts not treated as unsupported claims | **Pass** — "הפרדת רשויות", "פרשנות תכליתית", "הבטחה מנהלית" all carried as topic framing, no non-existence claims |
| Single consolidated caveat | **Fail** — see defect D2 |
| No fabricated authority | **Pass** — all footnotes built deterministically from acquired sources; no invented case names or holdings |
| Runtime | 137–183 s, in line with the existing pipeline |

## 4. Defects found (open)

- **D1 — bullets leak into prose genres.** AW4 (`theoretical_background`) produced a
  6-bullet answer and AW5 one bullet, although the prompt forbids lists outside
  `chapter_outline`. The instruction is advisory only; there is no deterministic
  post-draft bullet-to-prose conversion for academic genres.
- **D2 — caveats are not consolidated.** Several runs end with two or three stacked
  notices: the academic draft note, the generic `מגבלת ביסוס` block, and the
  processing-limit note (`קריאת גוף פסקי הדין הופסקה…`). The track required one
  trailing note.
- **D3 — raw URL leaked into the AW4 body.** A court `…&type=4` download URL appears in
  the answer text rather than in a footnote — display-hygiene gap on that path.
- **D4 — academic note not always attached.** `has_academic_notice` is true only on the
  three `academic_limited_draft` runs; AW4/AW5/AW8 drafted on thin packs without the
  academic note (they carry the generic `מגבלת ביסוס` block instead).

## 5. Recommendation

Keep the track default-on. Open a small follow-up
(`academic_draft_presentation_hygiene_v1`) covering D1–D4: deterministic bullet
suppression for prose genres, one merged trailing caveat block, and URL scrubbing from
academic bodies. No safety regression was observed, so this is presentation-level work.
