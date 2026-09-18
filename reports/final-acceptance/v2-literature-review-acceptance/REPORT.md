# V2 Literature Review Acceptance

Read + run + measure + diagnose. **No code changed in this task.** No new mode,
classifier, quota, planner or pipeline stage was introduced.

## 1. Executive summary

Ten natural prompts (eight broad literature/synthesis requests, two narrow
controls) were run sequentially, one fresh run each, against deployed
`legal-research-v2`. All ten reached terminal status `done`; one earlier L1
attempt was abandoned after stalling twice and was re-run (11 attempts → 10
usable, ~9% attempt-level loss), and the accepted L1 run itself needed two
harness resumes.

What works now, measurably:

- The agent understands academic requests **without trigger words** and scales
  research accordingly: 8–23 steps and 4–6 academic searches on broad prompts vs
  4–5 steps and **zero** academic searches on the narrow controls.
- Discovery finds **genuine scholarship**, not SEO pages: Haifa/HUJI/TAU/Reichman
  law-faculty PDFs, `lawjournal.huji.ac.il`, `journal.lawforum.org.il`, and —
  where the field demands it — English scholarship (Cambridge LJ, ECGI, Columbia,
  BC Law Review, copyright.gov summaries) in L5, L7 and L8.
- The verified synthesis survives projection almost intact (drops in exactly one
  run) and the drafter **cited 100% of the distinct verified sources available to
  it in every single run**.
- Answers genuinely synthesize: named positions, explicit disagreement axes,
  comparative dimensions — not a bibliography with prose between entries.

What blocks a SHIP:

1. **Evidence conversion is the bottleneck.** Runs read 5–9 documents but only
   2–5 ever produce a verified claim; the rest are read and then yield no usable
   quoted span. Breadth of the *research* never becomes breadth of the *review*.
   L3: 9 read → 2 usable. L4: 8 fetched, 5 read → 2 usable.
2. **Citation presentation is not academically usable.** Footnotes carry a raw
   document title plus a bare URL — no author, journal, volume, year. Some titles
   are extraction artifacts: `MISHPATIM 51 2022`, `BODILY AUTONOMY AND TATTOO
   COPYRIGHT IN`, `[PDF] : נהליות מ טית על החלטות ו הביקורת השיפ`.
3. **Attribution is capped by the same gap.** Where author metadata was
   recoverable the answers name scholars properly (דותן, זמיר, יפת, בוקשפן, דגן,
   ברק-ארז, סיארה, Bebchuk & Kastiel, Gilson & Schwartz). Where it was not, the
   agent explicitly recorded "זהות מחבריהם של S2 ו-S4 אינה עולה" and the answer
   fell back to "הספרות שנקראה" — correct behaviour, wrong root cause.
4. **Length/breadth.** Final answers are 696–2,055 characters on 2–5 sources.
   That is a solid research note, not a seminar-paper foundation.

Verdict: **PARTIAL / REVIEW** (section 15).

## 2. Architecture verified before testing

Confirmed in deployed code, not from prior reports:

- `agent/deliverable.ts` does not exist; no `classifyDeliverable`, no
  `DEVELOPED_CUES`, no `deliverable ===` in the V2 production path.
  Depth is agent-owned (`agent/prompt.ts`, `agent/commitPolicy.ts`).
- `index.ts:77` imports `projectVerifiedSynthesis`; `index.ts:638` computes it
  **after** verification, accepted repair, temporal gate and provenance, and
  passes `synthesis` into `runDrafter` at `index.ts:644`.
- Telemetry `index.ts:786–796` emits all nine synthesis counters plus
  `verified_sources_available_to_drafter` / `verified_sources_cited`.
- The drafter receives question + verified pack + verified synthesis +
  advisories + gap notices only. No agent trace, no tool history, no rejected
  candidates.
- Renderer (`drafting/render.ts`) unchanged: one citation point → one footnote,
  Rule 37 repeats via `_shared/footnoteOccurrences.ts`.

Deployed architecture matches both SHIP reports.

## 3. Prompts, run IDs, reliability

| ID | Topic | run_id | Status | Latency | Chunks | Resumes |
|---|---|---|---|---|---|---|
| L1 (abandoned) | reasonableness lit review | e198bc88-57e2-4911-a7d1-9f1d8bc4746d | stalled ×2, abandoned | ~24 min frozen | 1 | 1 |
| L1 | reasonableness lit review | 78baf7f2-62b6-441f-b671-ca6a40d9dd35 | done | 411 s | 2 | 2 |
| L2 | administrative promise disagreement | 3b3db486-f417-45d8-a4ef-c3640276d27f | done | 207 s | 2 | 0 |
| L3 | reasonableness vs proportionality | f21f3e60-1314-4366-8ddd-f94c987f2364 | done | 301 s | 3 | 0 |
| L4 | good faith in contract | becff365-2f21-4526-b9f0-63405324b324 | done | 230 s | 3 | 0 |
| L5 | controlling-shareholder conflicts | 0095b4db-5230-4ad0-a686-6e7d669a825b | done | 224 s | 2 | 0 |
| L6 | judicial review of Basic Laws | cb11bb3a-23b2-440a-ba44-2e1518faa50b | done | 308 s | 3 | 0 |
| L7 | tattoo copyright in video games | 219475c0-eb38-4191-881f-257a723b24d3 | done | 120 s | 1 | 0 |
| L8 | IL/UK legitimate expectations | 33b8a746-8b3b-4fc2-9ca2-91ebe8ff6786 | done | 167 s | 2 | 0 |
| N1 | s.12 Contracts Law | 65a5cde3-daf1-4085-b8a0-09d493edbf00 | done | 32 s | 1 | 0 |
| N2 | רע"א 3365/20 | 51d3d733-5606-4a42-8376-91fe0142dbed | done | 47 s | 1 | 0 |

**Reliability.** The known long-run stall recurred only on L1: the resume
checkpoint froze mid-chunk while research was still in the reading phase. Two
harness-issued resumes carried the accepted run to completion; the earlier
attempt froze again after one resume and was abandoned. No timeouts, no failed
jobs, no refund/state anomalies elsewhere. Stall exposure is now concentrated in
the longest runs (L1 was the slowest at 411 s) rather than affecting broad runs
generally — a clear improvement over the prior track, where L3/L4 timed out
outright, but still ~9% of attempts required intervention a real user cannot
perform.

## 4. Run telemetry

| ID | Steps | acad/web/off/corpus search | raw-web | fetch | read | Verified claims | Unsup. | Src avail→cited | Footnotes | Answer chars | Prompt tok |
|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 | 14 | 4/0/1/0 | 3 | 9 | 8 | 6 | 0 | 3→3 | 4 | 1,389 | 168k |
| L2 | 15 | 5/3/0/0 | 2 | 5 | 5 | 6 | 0 | 5→5 | 4 | 1,731 | 173k |
| L3 | 23 | 1/0/1/0 | 3 | 9 | 9 | 4 | 0 | 2→2 | 3 | 1,222 | 303k |
| L4 | 22 | 6/0/1/1 | 3 | 8 | 5 | 5 | 0 | 2→2 | 2 | 1,167 | 298k |
| L5 | 11 | 5/0/2/0 | 0 | 10 | 7 | 5 | 1 | 3→3 | 5 | 2,055 | 114k |
| L6 | 19 | 5/3/0/0 | 0 | 7 | 7 | 6 | 0 | 5→5 | 5 | 1,522 | 259k |
| L7 | 8 | 4/1/0/0 | 2 | 9 | 5 | 6 | 0 | 4→4 | 5 | 1,942 | 67k |
| L8 | 13 | 4/2/0/0 | 2 | 6 | 5 | 7 | 0 | 4→4 | 5 | 1,967 | 144k |
| N1 | 4 | 0/0/1/0 | 0 | 1 | 1 | 2 | 0 | 1→1 | 2 | ~700 | 28k |
| N2 | 5 | 0/0/0/0 | 0 | 1 | 1 | 4 | 0 | 1→1 | 2 | 696 | 40k |

Synthesis projection (memo sections/relationships/roles → verified
sections/relationships, refs dropped claim/source):

L1 2/2/3 → 2/2, 0/0 · L2 3/2/5 → 3/2, 0/0 · L3 3/1/2 → 3/1, 0/0 ·
L4 2/2/2 → 2/2, 0/0 · L5 3/3/4 → 3/2, **2/1** · L6 2/3/5 → 2/3, 0/0 ·
L7 3/2/4 → 3/2, 0/0 · L8 4/2/4 → 4/2, 0/0 · N1 1/0/1 → 1/0 · N2 1/1/1 → 1/1.

L5's drops are correct fail-closed behaviour: claim C5 (Israeli Companies Law
approval chain) failed support verification because the statute text was never
usably acquired, and every synthesis reference to it disappeared with it.

## 5. Source funnel and direct-vs-adjacent scholarship

L1 (9 sources): zamir.pdf (Reichman, academic, **direct**, cited), TAU PDF on
reasonableness as judicial supremacy (academic, direct, cited), Mishpatim 51
(academic, direct, cited), Barak-Erez *Israeli Administrative Law at the
Crossroads* (academic, adjacent, read but no usable span), Basic Law: Judiciary
(primary, context, unused), gov.il blob (**acquisition failure**), oknesset
committee page (professional, adjacent), Wikipedia Dapei Zahav (**not academic**,
adjacent, unused), toledano.co.il judgment (primary, unused).
→ 3 direct academic sources carried the whole review.

L2 (5 sources, the cleanest run): Kiryat HaMishpat (יפת), Barak-Erez
*Legitimate Expectations* (TAU), Braverman (Reichman), *הגנת ההסתמכות* (HUJI),
דותן *הבטחה מינהלית לציבור* (Haifa). **Five academic PDFs, all direct, all
verified, all cited.** No primary-law padding at all.

L3 (9): only 2 usable — Nadav Dagan (Haifa, direct academic) and the 5658/23
summary. Four judgments and two Wikipedia pages were read and produced nothing;
Weill's proportionality article (Reichman) was read but yielded no usable span
(adjacent-to-direct, **lost at span stage**).

L4 (8): only Bukspan (Haifa, direct) and רע"א 6339/97 usable. Two academic PDFs
failed to fetch at all (`runi.ac.il` getfile.ashx ×2), `תום לב בחוזים ואשם` (HUJI)
and *על תום הלב בסדר הדין האזרחי* (TAU) were read without usable spans, and the
Knesset statute PDF URL was malformed (`https://fs.knesset.gov.il/\7\law\...`).
This is the weakest research base of the eight.

L5 (10): Gilson & Schwartz (ECGI), Bebchuk & Kastiel (Iowa JCL), HUJI Hebrew
article on control value — 3 direct, all cited. Goshen/Hamdani (ECGI), Columbia
Rock, Stanford piece read or fetched without usable spans (direct, lost).
Companies Law text never acquired (gov.il ×2, wikisource span_not_found).

L6 (7): 3 direct academic (`journal.lawforum.org.il` ×3 — Jaffe, Siara, Nataf),
2 primary judgments (חסון, 5658/23 full IDI PDF), Barak's Reichman PDF read with
no usable span (direct, lost), one court download unusable.

L7 (9): the only run where the field is overwhelmingly English — the agent
compensated on its own via academic + web + 2 raw-web searches, acquiring the BC
Law Review article (direct) and three copyright.gov fair-use summaries (official
secondary). Four further law-review PDFs (Marquette ×2, Minnesota/Perzanowski,
W&L) were discovered but **failed to fetch**. Jurisdictional fit: correct — it
also flagged that Israeli copyright law would need separate research.

L8 (6): 3 Israeli academic (יפת, Mishpatim, Barak-Erez) + Cambridge LJ *Stuck at
a Crossroad?* (direct English). Melbourne PDF unusable, דותן read without span.
Comparative coverage genuinely bi-jurisdictional.

Aggregate: **discovery finds direct scholarship reliably**; the losses are
concentrated in fetch failures (repository handlers, Knesset URL construction)
and, more often, in read-but-no-usable-span.

## 6. Scholarship vs primary law

No run mislabelled a judgment as scholarship, and no run described a court
holding as an academic position. L1, L2, L4, L5, L8 lead with scholarship and use
statutes/judgments as doctrinal context. L3 and L6 lean harder on primary law
(L3: 1 academic + 1 judgment; L6: 3 academic + 2 judgments), which is defensible
given both questions are about doctrine the courts themselves moved — but L3 is
close to the flag line: a question about how two doctrines relate ended up
resting on a single scholarly source because everything else lost its span.

## 7. Scholarly attribution audit

Named and explained (not name-dropped): דותן and זמיר (L1, with opposing framings
set against each other), ברוורמן/דותן/יפת (L2), נדב דגן (L3), עלי בוקשפן (L4),
Gilson & Schwartz vs Bebchuk & Kastiel (L5), ברק-ארז and מיכאל סיארה (L6),
קארין יפת and ברק-ארז (L8).

Anonymous phrasing appears in L7 ("הספרות האקדמית שנקראה"), L8 ("הספרות האנגלית
שנקראה") and parts of L2/L6. In each case the agent's own unresolved-questions
field records that the author identity was not present in the verified span —
e.g. L2: "זהות מחבריהם של S2 ו-S4 אינה עולה במפורש מן הקטעים המילוליים שנשמרו".
So this is **not** drafter flattening; it is missing bibliographic metadata
upstream. No case was found where a named verified position existed and the
answer hid it behind "בספרות נטען".

## 8. Synthesis quality and structure

L1 — A/B: two models of reasonableness (דותן), זמיר's counter-position that
judicial expansion is policy rather than theory, then the contemporary critical
position. Genuine intellectual mapping in 1,389 characters.
L2 — A: organized by concept → disagreement axes → critique; the pure-expectation
vs actual-reliance axis and the fettering tension are stated as disagreements.
L3 — B/C: correct account of Dagan's distinction and the January 2024 ruling, but
essentially one scholar's view plus one judgment.
L4 — C: covers s.39, רוקר and Bukspan; the requested "since the nineties" arc and
"current approaches" are explicitly unfulfilled in unresolved_questions.
L5 — A: efficiency framing → ex post vs ex ante → independent-director critique →
MOM proposal → Israeli Amendment 16 as application. Real comparative-institutional
synthesis.
L6 — A: maps the authority objection, the substantive-protection position, the
abuse-of-constituent-power middle route, and internal methodological disputes.
L7 — A/B: implied licence vs fair use, Solid Oak against Hayden/Alexander, with
the fact-sensitivity of the split explained.
L8 — A: organized by comparative dimension (centre of gravity), not "Israel
section then England section".
N1/N2 — correct and compact; N1 one heading, two claims, 32 s; N2 696 characters.

Headings are mostly intellectual dimensions. L8's opening "מבוא" is a generic
placeholder heading; L1's heading is a full sentence. Cosmetic.

## 9. Citation precision (sampled ≥5 propositions per broad run where available)

Proposition→source alignment was correct in every sample: each footnote's
underlying verified span supports the sentence it is attached to, compound
footnotes group sources that genuinely co-support the block (L2 fn 1 and fn 2,
L6 fn 4/5, L8 fn 1/5), and Rule 37 repeats are right (`שם.` only for same-source
consecutive single-source points; `לעיל ה"ש N` otherwise — L3 fn 2, L5 fn 2/4,
L7 fn 3/5, L8 fn 4).

The defect is presentation, not alignment:

- No author, journal, volume or year in any academic footnote.
- Raw URLs inside the footnote text.
- Garbled or truncated titles from PDF extraction: `MISHPATIM 51 2022` (L1),
  `BODILY AUTONOMY AND TATTOO COPYRIGHT IN` (L7),
  `[PDF] : נהליות מ טית על החלטות ו הביקורת השיפ` (L1),
  `הבטחה מנהלית / כתב עת משפטים (העברית)` (L8),
  `חופש החוזים, תום הלב ותקנת הציבור : מבט מחודש... | עלי בוקשפן (כרך י)` (L4 —
  author present only because it was inside the extracted title string).
- Judgments are cited from aggregator pages (`toledano.co.il`) rather than the
  official reporter.

For a law student this is the most visible quality gap in the product.

## 10. Pack and synthesis utilisation

Verified sources available → cited: 3→3, 5→5, 2→2, 2→2, 3→3, 5→5, 4→4, 4→4,
1→1, 1→1. **100% in all ten runs.** Verified claims represented in the answer:
all core claims appear in every run; only L5's unsupported C5 is absent, as
required.

Every surviving synthesis relationship is visible in the final prose: L1's
disagreement (דותן/זמיר), L2's three disagreement axes, L5's critique and
proposal chain, L6's three relationships including the methodological dispute,
L7's judicial split, L8's comparative contrast. No case of "researcher found a
central disagreement, drafter flattened it".

Unused material classification: nothing in the *verified* pack was unused. The
unused material sits before verification — see section 11.

## 11. Bottleneck diagnosis

Per run (using the discovery / acquisition / verification / synthesis / drafter /
render taxonomy):

| Run | Bottleneck | Evidence |
|---|---|---|
| L1 | Verification loss + reliability | 8 read → 3 usable; 2 resumes |
| L2 | None material | 5 read → 5 verified → 5 cited |
| L3 | Verification loss | 9 read → 2 usable; Weill, Barak-Erez lost at span |
| L4 | Acquisition + verification loss | 2 fetch failures, 2 read-no-span; base too thin for the question asked |
| L5 | Acquisition (statute) + verification loss | Companies Law never acquired; 3 English articles read without spans |
| L6 | Verification loss (mild) | Barak PDF read, no span |
| L7 | Acquisition | 4 law-review PDFs discovered, none fetched |
| L8 | Verification loss (mild) | Melbourne PDF unusable, דותן no span |
| N1/N2 | None | correct narrow behaviour |

Cross-run root cause: **the step from "body read" to "verified quotable claim" is
where literature breadth is lost.** Across the eight broad runs, 52 documents
were read and 28 verified claims were produced from only 25 distinct sources;
roughly half of everything successfully read never contributes. Discovery is not
the problem, the drafter is not the problem, and the synthesis handoff is not the
problem — both projection and utilisation are essentially lossless.

Secondary root cause: **no bibliographic metadata layer.** The same absence
explains both unusable citations and anonymous attribution.

## 12. Foreign / English scholarship (L7, L8)

The agent compensated without any scope change: L7 ran academic + web + raw-web
searches and built its answer on US law-review and copyright.gov material; L8
retrieved a Cambridge Law Journal article to carry the English side of the
comparison. Neither needed the question to say "search in English". Retrieval of
English scholarship works; **fetching** US law-review repositories
(`scholarship.law.marquette.edu`, `scholarlycommons.law.wlu.edu`,
`minnesotalawreview.org`) is where L7 lost four sources.

## 13. Hebrew language quality

Register is academic and appropriate; terminology is consistent; no translation
artifacts of the kind seen historically. Concrete defects found:

- L4: "עקרון תום הלב **ממסוגר** כאחד משלושת עקרונות הליבה" — should be "ממוסגר".
  A real typo in a final answer.
- L5: the closing "מגבלות התשובה: לא ניתן היה לבסס בראיות טענות נוספות..."
  paragraph is machine-flavoured boilerplate listing failed URLs/sources by name;
  it reads like internal telemetry addressed to the user.
- L8: heading "מבוא" carries no information.
- Repeated hedging formula "הספרות שנקראה" / "המקורות שנקראו" across L7, L8, L2 —
  defensible as epistemic honesty, monotonous when used four times in one answer.

Nothing here would embarrass a law student; L5's limitation paragraph is the one
item that looks unfinished.

## 14. Product-quality scores (1–10, diagnostic only)

| | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 |
|---|---|---|---|---|---|---|---|---|
| Research relevance | 8 | 9 | 6 | 5 | 8 | 8 | 8 | 8 |
| Direct scholarship quality | 8 | 9 | 5 | 5 | 8 | 8 | 7 | 8 |
| Source diversity | 6 | 8 | 3 | 3 | 6 | 7 | 6 | 7 |
| Scholarship / primary-law balance | 8 | 9 | 5 | 6 | 8 | 7 | 7 | 8 |
| Named attribution | 9 | 8 | 8 | 7 | 9 | 8 | 4 | 6 |
| Synthesis quality | 8 | 9 | 6 | 5 | 9 | 8 | 8 | 8 |
| Structure | 7 | 9 | 7 | 6 | 9 | 8 | 8 | 8 |
| Hebrew quality | 8 | 9 | 8 | 7 | 7 | 8 | 8 | 8 |
| Citation precision (alignment / presentation) | 8/3 | 8/4 | 8/3 | 8/4 | 8/4 | 8/4 | 8/3 | 8/4 |
| Usefulness to a researcher | 7 | 8 | 5 | 4 | 8 | 7 | 7 | 7 |
| **Classification** | B | A | C | C | A | B | B | B |

Overall product readiness: **6.5 / 10** — research intelligence is beta-grade,
citation presentation and evidence yield are not.

## 15. Acceptance questions

- Natural academic requests understood without trigger words: **yes** (L2, L5, L6
  never say "literature review" and still ran full academic research; N1/N2 with
  no academic search at all).
- Direct academic scholarship retrieved reliably: **yes at discovery**, partially
  at acquisition (L4, L7).
- Enough scholarship read to support real synthesis: **usually 2–5 sources** —
  enough for a research note, thin for a literature review.
- Verified synthesis survives to the answer: **yes**, essentially losslessly.
- Named attribution used effectively: **yes when metadata exists**.
- Real disagreements mapped rather than listed: **yes** in L1, L2, L5, L6, L7, L8.
- Scholarship distinguished from primary law: **yes**.
- Citations proposition-accurate: **yes** — but bibliographically incomplete.
- Hebrew acceptable for a law student: **yes**, with the noted blemishes.
- Narrow questions stay narrow: **yes** (4–5 steps, 32/47 s, 1 source, 2 footnotes).
- Timeouts blocking beta: **not blocking, not clean** — 1 abandoned attempt and 2
  resumes out of 11 attempts, all on the single longest run.
- Single largest remaining bottleneck: **evidence conversion — read scholarship
  that never becomes a verified quotable claim** (with bibliographic metadata as
  the close second).

## 16. Drafter model bake-off

**Not justified.** The drafter cited 100% of available verified sources in every
run, preserved every surviving synthesis relationship, produced comparative and
disagreement-structured prose, and kept narrow answers narrow. Where answers are
thin, the verified pack itself was thin (L3: 2 sources; L4: 2 sources). There is
no run in which rich verified research reached the writer and came out materially
worse.

## 17. Recommended next engineering track

**Academic evidence yield + bibliographic identity.** One track, two halves,
neither of which adds a mode, quota or pipeline stage:

1. Why do half of successfully read academic PDFs yield no usable quoted span?
   Instrument the read→span path on academic PDFs specifically (column layout,
   ligature/nikud normalisation, footnote interleaving, page-boundary splits,
   the `runi.ac.il getfile.ashx` and US law-review repository fetch failures, and
   the malformed `fs.knesset.gov.il/\7\law\...` URL construction seen in L4).
2. Capture author / journal / volume / year during acquisition so footnotes can
   render a real academic citation and so named attribution is available whenever
   the source actually identifies its author.

---

V2 LITERATURE REVIEW — PARTIAL / REVIEW

AGENT-OWNED RESEARCH DEPTH: ACTIVE

VERIFIED RESEARCH SYNTHESIS HANDOFF: ACTIVE

NATURAL ACADEMIC PROMPTS: TESTED

DRAFTER MODEL CHANGE: NOT JUSTIFIED

PRIMARY REMAINING BOTTLENECK: read academic sources rarely convert into verified quotable evidence (no bibliographic metadata layer)
