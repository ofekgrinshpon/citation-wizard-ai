# Post-acquisition quality audit (no code changes)

Track status: **judgment-text-acquisition = stable-initial (closed).**
Audit is read-only over the validation draws in `reports/judgment-text-acquisition/`
(`C2b` = success draw, `C2` = failure draw, `C1`, `M1`, `M2`, `B8`, `B2`).

## 1. C2 — success draw (acquisition fired)

| Field | Value |
|---|---|
| Acquired judgment | **בע״מ 5620/24 פלוני נ׳ פלונית** (`supremedecisions.court.gov.il/.../Download?...`) |
| Method | `direct_file_fetch` (extension-less court Download endpoint), 1066 ms |
| Acquired text length | **40,798 chars** → stored 3,999 chars available to drafter |
| `text_usability` | `metadata_only → full_text`; `has_holding_text = true` |
| Snippet to drafter | **1200 chars** (`reason: leading_judgment`, `expanded: true`) — 1 of 12 sources expanded |
| Attempts | 2 (1 success, 1 `no_local_document_match`), eligible_count 5, 1277 ms total |
| Answer length | 2,731 chars, no deterministic branch (real drafted answer) |

Synthesis roles in `used_sources` (12):
- `leading_candidate` × 3 — ע״א 52/80 שחר נ׳ פרידמן (`metadata_only`), **בע״מ 5620/24 (`full_text`)**, psakdin wrapper (`primary_mirror`, metadata_only)
- `applying_candidate` × 2 — ע"א 1000-92, בע"מ 1681/04 (both `metadata_only`)
- `secondary_commentary` × 7 (one `full_text`, one `substantive_excerpt`)

### Assessment of the answer

- **Materially better than the previous generic doctrine essay: yes, but partially.**
  It now opens bottom-line-first, is organized by doctrinal function (definition →
  conditions → scope/exceptions → asset types → remedies → procedure/evidence →
  trends), and it carries a per-move footnote. The previous C2 output was a flat
  descriptive essay; this one has an argumentative spine and a practical closing rule.
- **Is it a real line-of-authority answer? No — not yet.**
  The body never names a single case. There is no "leading rule per X, applied in Y,
  limited in Z" chain; the authority structure exists only in the metadata
  (`synthesis_role`) and in the footnote targets, not in the prose. The skeleton the
  synthesis mode is supposed to produce (leading rule / leading cases / applications /
  limits / current test) is **not** surfaced.
- Leading rule: stated generically (חזקת שיתוף) ✔ but unattributed to a case ✘.
  Applications: present as contexts (אזרחי / רבני / ידועים בציבור) ✔, uncited to
  specific judgments ✘. Limits/distinctions: present (ידועים בציבור requires concrete
  proof; non-real-estate assets unsettled) ✔. Current operative test: closest is the
  fact-mapping paragraph — descriptive, not a crisp multi-factor test ✘.
- **Overstatement from the single acquired judgment: no.** The only `full_text`
  source is a 2024 בע״מ, and the answer does not project it as *the* rule; the remedies
  and evidentiary paragraphs are where its text plausibly lands, and they are hedged
  appropriately. The failure mode here is under-use, not overstatement.
- **Citation support per doctrinal move: formally yes, substantively weak.** Every
  paragraph carries a footnote, but 9 of 12 used sources are `metadata_only`, so most
  moves are backed by titles rather than holding text. Footnote 1 compounds three
  different judgments of different roles into one marker.
- Residual defect: the answer ends with a source-thinness disclaimer
  ("הטקסטים המסופקים כאן הם קטעים קצרים…"), i.e. research prose the sharpness rules
  were meant to suppress.

## 2. C2 — failure draw (acquisition failed, limitation fired)

| Field | Value |
|---|---|
| Attempts | 2 of 2, eligible_count 2, 1458 ms |
| Attempt 1 | `supreme.court.gov.il/Pages/Overview.aspx` (wrapper) → `no_downloadable_file_on_wrapper` |
| Attempt 2 | gov.il PDF titled ע״א 52/80 שחר נ׳ פרידמן → `no_local_document_match` (direct fetch yielded no usable text) |
| Result | all candidates remain `metadata_only`; max snippet 395 |
| Branch | `insufficient_sources_limitation`, answer 425 chars |

- **Honest and non-frustrating: yes.** It states no direct case-law source was found,
  explicitly refuses analogy from another legal field, offers three next actions
  (upload a source / sharpen the question / request another search), and lists what
  *was* found "לידיעה בלבד" without deriving rules from it.
- **Avoids thin synthesis: yes.** No doctrine is stated. This is the correct branch.
- Minor: the listed "what was found" includes psakdin wrapper pages, which reads
  slightly noisy but is labelled as non-operative.

## 3. C1 — framing correction

Preserved. Acquisition ran (2 attempts, 0 successes, 277 ms) and changed nothing.
The answer still opens with the premise correction — "לא נמצאה … הלכה מוכרת שמכונה
בשם 'הלכת יורש אחר יורש' … אינו מוצג כאן כשם הלכה רשמי" — then discusses חוק הירושה,
testamentary interpretation and תקנות סדר הדין as the nearby institution. ✔

## 4. Controls

| Case | mode | acquisition | branch | outcome |
|---|---|---|---|---|
| M1 (ע״א 6821/93) | `specific_case` | disabled | `docket_limitation` | unchanged refusal + upload invitation ✔ |
| M2 (§6 חוק החברות) | `statute_section_definition` | disabled | – | unchanged, s1 `full_text` statute, 379-char snippet ✔ |
| B8 (canonical quote) | `canonical_quote` | disabled | `canonical_quote_registry` | verbatim §1 quote, unchanged ✔ |
| B2 (בג״ץ 6698/95) | `specific_case` | disabled | `docket_limitation` | unchanged refusal ✔ |

No stubs, no verifier failures, no acquisition activity in any non-synthesis mode.

## 5. Acceptance

| Criterion | Verdict |
|---|---|
| Success draw materially better than previous essay | **Partial pass** — structure and permission improved; prose is still doctrine-shaped, not authority-shaped |
| Failure draw honest, not frustrating | **Pass** |
| C1 still corrects the premise | **Pass** |
| M1/M2/B8/B2 unchanged | **Pass** |
| No stubs / verifier failures | **Pass** |

## 6. Next bottleneck (diagnostic only, no proposal executed)

Acquisition is no longer the constraint; **synthesis rendering** is. Two observations:

1. Only 1 of 5 eligible candidates could be upgraded under the 2-attempt cap, so the
   pack still contains 9 `metadata_only` sources — including the actual landmark
   (ע״א 52/80 שחר נ׳ פרידמן), which stayed metadata-only in both draws.
2. Even with one `full_text` leading judgment at a 1200-char budget, the drafter does
   not emit the line-of-authority skeleton: `synthesis_role` reaches the model as
   metadata but is not converted into named-case prose ("נקבע בע״א …; יושם ב…; סויג ב…").

So the candidate next tracks are (a) raising acquisition reach for the *landmark*
specifically, and (b) a synthesis-mode drafting skeleton that requires case names and
role attribution in the body. No implementation started.
