# academic_drafter_prompt_conflict_cleanup_v1 — Acceptance Report

Status: **ACCEPTED** (mechanics + acceptance criteria), with one residual naturalness gap noted below.

## What changed

### 1. Academic hedging cleanup
New module `stages/academicPromptCleanup.ts` rewrites `SYSTEM_PROMPT_V2` **only** when
`user_task_intent === "academic_writing"`. The generic evidence/hedging contract that mandated
retrieval-process phrasing is replaced by one academic rule: caution is expressed through
doctrinal language ("ניתן לטעון", "נראה כי", "יש להבחין", "הדיון מחייב זהירות"), never as a report
about the search. Support calibration (direct / partial / mixed) and the ban on strong unsupported
claims are preserved verbatim.

Note: the replacement text deliberately does **not** quote the banned phrases — quoting them was
itself priming the model.

### 2. Blacklist priming removed
Three broken-Hebrew blacklist blocks (with dozens of coined-compound examples) are gated off for
academic runs and replaced by one positive register rule plus the substantive, example-free
requirements (exact statute names, correct party labels, rephrase-if-unsure).

### 3. Rhythm rules as ceilings
`stages/academicStyleGuide.ts`: "4–7 sentences" / "18–28 words" became "do not normally exceed
7 sentences per paragraph" and "prefer clear, relatively short sentences; there is no numeric
sentence-length target".

### 4. Bottom-line-first gated off for prose genres
Disabled for `introduction`, `theoretical_background`, `topic_presentation`, `generic_academic`;
retained for `argument_paragraph`, `chapter_outline`, `research_question` and all non-academic modes.

### 5. Continuous academic flow
Added to the academic slice in `drafterV2.ts`: each paragraph must continue the previous one and
must not reopen as if it were a list item.

### 6. Argument paragraph simplification
One paragraph, 150–300 words, claim → counterargument → distinction → resolution. Duplicate
topic-sentence/register pressure removed for this genre. Trimming below 340 words only at natural
sentence boundaries; if no boundary is in range the paragraph is left intact.

### 7. Hygiene softening (`stages/academicPresentationHygiene.ts`)
- `bulletsToProse`: ≤3 items → prose sentences; >3 items → preserved as separate prose paragraphs
  (no more disguised single-paragraph list).
- `enforceSingleParagraph`: higher safe ceiling, cuts only at sentence/paragraph boundaries.
- `stripUrlsFromProse`: new `repairPunctuationResidue` fixes "ראו , וגם", empty parens, doubled
  punctuation and stray spaces.
- `dropTopicDrift`: position-independent decision, keeps ≥3 paragraphs, and repairs the connective
  opening ("לעומת זאת", "כמו כן"…) of the paragraph that followed a dropped one.
- `stripHeadings`: headings are folded into the following paragraph as its opening sentence — no
  orphan heading lines.

### 8. Canned phrase fingerprints removed
The fixed attribution formulas were removed for academic runs and replaced by "attribution is
phrased in your own words and varied; there is no fixed template". The substantive ban on
unsupported holdings remains.

### 9. Telemetry
`academic_prompt_cleanup: { applied, genre, academic_hedge_contract_disabled,
blacklist_blocks_disabled, bottom_line_rule_disabled, unmatched_gates, rhythm_rules_as_ceilings,
hygiene_softened, paragraph_trimmed, bullets_converted_or_preserved, drift_paragraphs_dropped }`.

`unmatched_gates` is the drift alarm: if the system prompt is edited and a gate stops matching, it
is reported instead of silently no-op'ing. Verified against the live `SYSTEM_PROMPT_V2`:
`unmatched_gates: []` for every academic genre; prompt shrinks 12,625 → 10,306 chars.

## Unit tests

`bunx vitest run src/test/academic*` → **45/45 pass** (8 new prompt-cleanup fixtures, 18 hygiene,
7 style guide, 12 intent).

## Live validation — AW1, AW4, AW7, AW8

Deployed engine, real runs (`ONLY=AW1,AW4,AW7,AW8`).

| id | genre | branch | words | notes | URLs | bullets | banned hedge phrases |
|----|-------|--------|-------|-------|------|---------|----------------------|
| AW1 | introduction | academic_limited_draft | 509 | 1 | 0 | 0 | none |
| AW4 | theoretical_background | academic_limited_draft | 600 | 1 | 0 | 0 | none |
| AW7 | argument_paragraph | — | 207 | 1 | 0 | 0 | none |
| AW8 | generic_academic | academic_limited_draft | 466 | 1 | 0 | 0 | none |

Latency: 142–243 s per run — same band as the pre-cleanup style-model runs. No extra LLM call.

### Acceptance checklist
- No extra LLM call by default — **pass** (prompt-only + deterministic hygiene).
- No material latency increase — **pass**.
- AW1 free of retrieval-process hedges and of "מהווה חורג סמכות" / "מבחנים קליניים" /
  "סעדות פרשניות" — **pass**. It now opens with framing and the research question rather than a
  legal bottom line.
- AW4 free of "מטרה פרק זה" / "סקירת עניין שיפוטית" and reads as theoretical background — **pass**.
- AW7 is one coherent paragraph, 207 words, full claim → counterargument → distinction → resolution
  arc, not clipped — **pass**.
- Exactly one "הערת עבודה" — **pass** (all four).
- Citations / footnote markers intact — **pass** (superscript markers preserved; footnote payloads
  unchanged).
- No new sources, case names, holdings, or strengthened authority — **pass** (no retrieval,
  sufficiency, matching or citation code touched).
- Hygiene invariants: no URLs in body, no bullets in prose genres — **pass**.

## Residual gap (not in scope, recommend monitoring)

Blacklist removal eliminated the priming, but a few coined or malformed compounds still surface
occasionally: AW1 "מבקשת המחקר", AW4 "מסורת היקול התכנית־משפטי־ערכי", "שמינוייה של המבחן",
AW7 "במיכון מבחני המידה", "רף ייתכנות גבוה". These are model-level Hebrew morphology slips, not
prompt conflicts — the conflicting-instruction hypothesis is now closed, so a narrow
`hebrew_academic_prose_naturalness_v1` track (targeted positive register examples, or a cheap
deterministic morphology check) would be the right next step if this matters for beta.

Separately, the AW7 follow-up block still shows a scraped page title with marketing text and an
emoji ("… - המאגר המשפטי הטוב בישראל ובחינם ⚖️") — a `displayTitleHygiene` gap, unrelated to this
track.

## Artifacts
- `reports/academic-drafter-prompt-conflict-cleanup/results-cleanup.json` — raw run payloads.
