# ReLex V2 — Zero-Claim Repair Acceptance Fix + Q23 Forensic Validation

Date: 2026-09-16 (UTC). Scope: one narrow verification-stage fix plus evaluation-only
observability, and one Q23 validation run. Support verification, acquisition, identity
gates, prompts, models, budgets and source ranking were not touched.

---

## 1. Confirmed root cause

`verification/repairPolicy.ts :: decideRepairAcceptance()` handled exactly one special
trigger (`central_issue_not_covered_after_narrowing`) and let every other trigger fall
through to the count rule:

```ts
return input.after.pack.claims.length >= input.before.pack.claims.length
```

A repair triggered by `no_verified_claims` (`decideResearchRepair()` line 80, reached when
`verification.pack.claims.length === 0`) therefore evaluated `0 >= 0 === true` and was
**accepted**, replacing the memo with an equally empty verified pack.

Telemetry then compounded it. `index.ts` reported:

```ts
central_issue_covered: coverage ? coverage.central_issue_covered : true,
```

For a `no_verified_claims` repair path no coverage assessment object is produced
(`decideResearchRepair` returns early without `coverage`), so `coverage === undefined` and
coverage was reported as **true** over a pack with zero claims — the invalid terminal state
described in the task (0 claims / 0 footnotes / limitation-only answer / covered = true).

Both conditions were confirmed by reading `repairPolicy.ts`, `centralIssueCoverage.ts`,
`index.ts` and the existing tests (`repairAcceptance.test.ts`, `emptyCoreSufficiency.test.ts`,
`legalResearchV2.latency.test.ts`) before any edit.

---

## 2. Exact code change

**`supabase/functions/legal-research-v2/verification/repairPolicy.ts`**

- `RepairAcceptance.reason` gains `verified_claims_produced` and `still_zero_verified_claims`.
- New branch before the count rule:

```ts
if (input.triggerReason === "no_verified_claims") {
  return input.after.pack.claims.length >= 1
    ? { accept: true, reason: "verified_claims_produced" }
    : { accept: false, reason: "still_zero_verified_claims" };
}
```

Exactly one verified claim suffices; no higher minimum, no claim/source/citation/length
threshold was introduced. All other triggers keep their previous semantics verbatim.

**`supabase/functions/legal-research-v2/index.ts`**

- Coverage telemetry no longer defaults to covered for an empty pack:

```ts
central_issue_covered: pack.claims.length === 0
  ? false
  : (coverage ? coverage.central_issue_covered : true),
central_coverage_ratio: pack.claims.length === 0 ? 0 : coverage?.coverage_ratio,
```

Non-empty packs are unchanged. The source-mode telemetry block was not modified.

- Evaluation-only forensics captured per run: `verification_forensics` (memo as first
  written, captured before any repair can replace it) and `verification_forensics_repaired`
  (repaired memo, when a repair cycle ran).

**`supabase/functions/legal-research-v2/verification/forensics.ts`** (new)

Deterministic reconstruction of the per-claim chain from the memo and the verification
outcome already produced: claim_id, proposition, importance, source_id, quoted span,
locator, body-read / identity / span stage outcome, support verdict, support reason, final
claim outcome, rejection reason. It makes no judgement, changes no verdict, and is never
rendered to the end user — it lives in telemetry only.

**`supabase/functions/legal-research-v2/types.ts`** — two optional telemetry fields.

Known limitation of the forensic view: when one claim cites the same source twice with
different locators, the `quoted_span` column reports that source's verified span for both
rows. Verdicts and outcomes are unaffected.

---

## 3. Tests

New: `src/test/zeroClaimRepairAcceptance.test.ts` (10 deterministic tests)

- 0 → 0 verified claims on a `no_verified_claims` repair → **reject**, reason
  `still_zero_verified_claims`.
- 0 → 1 verified claim → **accept**, reason `verified_claims_produced`.
- 1, 2 and 3 verified claims all accepted — no arbitrary minimum above one.
- Ordinary non-zero repair count semantics unchanged (reduced → reject, equal → accept).
- Central-insufficiency repair semantics unchanged (`coverage_restored`).
- Answer-mode telemetry: empty pack → `central_issue_covered = false`,
  `central_coverage_ratio = 0`; non-empty pack keeps the existing expression; source-mode
  telemetry block untouched.
- Forensics: verified and support-rejected chains reconstructed correctly; empty input
  yields no rows.

**Full suite: 892 passed / 892, 79 files.** `tsgo --noEmit -p tsconfig.app.json`: clean.
Deployed `legal-research-v2`.

---

## 4. Q23 validation run

One sequential run on the deployed build, exact prompt, no tuning.
Run id `846e9733-4c11-4277-812e-82193e3a1d07`, label `recovery-fix-Q23`.

| metric | value |
|---|---|
| final verified claims | 5 |
| footnotes | 1 |
| central covered | true |
| central coverage ratio | n/a (no assessment; pack non-empty) |
| repair triggered | no (`repair_skip_reason = no_unsupported_core_claims`) |
| repair accepted/rejected | n/a — no repair cycle |
| repair acceptance reason | null |
| unsupported claims | 0 |
| support verdicts | supports 3, supports_partially 3, does_not_support 0 |
| rejected evidence | none |
| invariant errors | none |
| unresolved authorities | `case:1511/05`, `case:2098/97` |
| latency | 216,558 ms |
| prompt tokens | 90,996 |
| steps | 8 |
| unsupported material reaching output | none |

### Pre-repair (and final — no repair occurred) evidence table

| claim | proposition (abridged) | quoted span (abridged) | source | span verified | support verdict | support reason | final outcome |
|---|---|---|---|---|---|---|---|
| C1 | סעיף 20 — דרך עשיית צוואה בעדים; עד שלא חתם באותו מעמד = אי-קיום דרישת הצורה | "20. צוואה בעדים תהיה בכתב… העדים יאשרו באותו מעמד בחתימת ידם…" | S1 חוק הירושה (סעיף 20) | ok | supports | accepted by support verifier | verified |
| C2 | סעיף 25(א) — סמכות ריפוי בהחלטה מנומקת בהיעדר ספק ברצון החופשי | "25. (א) התקיימו מרכיבי היסוד בצוואה… רשאי הוא, בהחלטה מנומקת, לקיימה…" | S1 (סעיף 25(א)) | ok | supports | accepted by support verifier | verified |
| C3 | סעיף 25(ב)(2) — מרכיבי היסוד בצוואה בעדים; חובת הוכחת ההבאה בפני שני עדים | "(2) בצוואה בעדים כאמור בסעיף 20 – הצוואה בכתב והמצווה הביאה בפני שני עדים;" | S1 (סעיף 25(ב)(2)) | ok | supports_partially | accepted by support verifier | partially supported |
| C4 | רצון אחרון ברור אינו מספיק — נדרשים גם מרכיבי יסוד והיעדר ספק | "התקיימו מרכיבי היסוד… ולא היה… ספק כי היא משקפת את רצונו החופשי והאמיתי" | S1 (סעיף 25(א)) | ok | supports | accepted by support verifier | verified |
| C5 | מסקנה יישומית מותנית: קיום לפי סעיף 25 בכפוף להוכחת כתב, הבאה בפני שני עדים והיעדר ספק | "(2) בצוואה בעדים… הצוואה בכתב והמצווה הביאה בפני שני עדים;" | S1 (סעיף 25(ב)(2) + 25(א), שתי ראיות) | ok | supports_partially | accepted by support verifier | partially supported |

### Repaired evidence table

None — no repair cycle occurred in this run (`verification_forensics_repaired` is empty).

### Final Q23 output (verbatim)

```
## קיום צוואה בעדים עם פגם בחתימת אחד העדים

סעיף 20 לחוק הירושה קובע כי צוואה בעדים תהיה בכתב, תישא תאריך, ותיחתם בידי המצווה בפני שני עדים לאחר שהצהיר בפניהם כי זו צוואתו. כמו כן, נדרש כי העדים יאשרו באותו מעמד, בחתימת ידם על פני הצוואה, שהמצווה חתם והצהיר כאמור. לפיכך, מצב שבו אחד העדים לא חתם באותו יום או באותו מעמד על גבי הצוואה, מהווה אי-קיום של דרישת הצורה וההליך הקבועה בחוק, ואין מדובר בצוואה העומדת בדרישות הצורניות הרגילות.[^1]

עם זאת, היעדר חתימתו של אחד העדים אינו פוסל את הצוואה באופן מוחלט. סעיף 25(א) לחוק מקנה לרשם לענייני ירושה או לבית המשפט סמכות לקיים צוואה חרף פגם או חסר בפרט או בהליך, לרבות אלו הנדרשים בסעיף 20, וזאת בהחלטה מנומקת. סמכות הריפוי מותנית בשני תנאים מצטברים: האחד, שהתקיימו מרכיבי היסוד בצוואה; והשני, שלא קיים ספק כי הצוואה משקפת את רצונו החופשי והאמיתי של המצווה.[^1]

בצוואה בעדים, מרכיבי היסוד הנדרשים לשם הפעלת סמכות הריפוי מוגדרים בסעיף 25(ב)(2), והם כי הצוואה תיערך בכתב וכי המצווה יביאה בפני שני עדים. במקרה הנדון, בהנחה שהמסמך כתוב וששני אנשים אכן נכחו במעמד, עצם היעדר חתימתו של העד אינו שולל את קיומו של מרכיב היסוד, אך יש להוכיח כי המצווה אכן הביא את הצוואה בפניהם. אם לא יוכח קיומו של מרכיב יסוד זה, לא ניתן יהיה להסתייע בסעיף 25 לשם ריפוי הפגם.[^1]

אשר לטענה כי המסמך משקף בבירור את רצונו האחרון של המצווה, טענה זו אכן חיונית לשם קיום התנאי השני שבסעיף 25. עם זאת, אין די בה לבדה. על מנת לקיים את הצוואה, נדרש שיתקיימו מרכיבי היסוד כאמור, וכן נדרשת עמידה ברף הוכחה מחמיר של היעדר כל ספק מצד הערכאה המוסמכת באשר לכך שהצוואה משקפת את רצונו החופשי והאמיתי של המצווה. רק בהתקיים תנאים אלו במצטבר, ניתן יהיה לקיים את הצוואה חרף הפגם בחתימת העד.[^1]

[^1]: חוק הירושה, תשכ"ה-1965, סעיף 20 https://www.nevo.co.il/law_html/law00/72178.htm
```

Unresolved questions were disclosed by the run itself: no usable judgment body was obtained
(`ע"א 1511/05`, `ע"א 2098/97`), so the burden-of-proof and evidentiary-threshold case law is
explicitly absent rather than asserted.

### Central coverage telemetry

Pack is non-empty (5 claims), so the new empty-pack branch did not fire and the pre-existing
semantics applied unchanged: `central_issue_covered = true`, no ratio (no assessment
object), `sufficiency_assessed = false`. The fixed branch is covered by deterministic tests;
this run simply did not reach the invalid state.

---

## 5. Q23 diagnosis

In this run the statute chain was clean end to end: every evidence pair passed body read,
identity and span, and the support verifier returned **zero** `does_not_support` verdicts
(3 supports, 3 supports_partially). The earlier Q23 failure mode — statute evidence lost at
support verification, ending in zero verified claims — **did not reproduce**. What remains
is that both requested judgments were never converted into a readable body, so the
case-law half of the question (ריפוי הפגם בפסיקה, נטל ההוכחה) is answered from statute only
and carries a single footnote.

**Q23 PRIMARY FAILURE — OTHER**

Specifically: judgment-body acquisition failure for `case:1511/05` and `case:2098/97`, not
claim breadth, not quote selection, not a support-verifier false negative. Evidence: all six
forensic rows show `span: ok` and a supporting verdict; no rejected evidence exists in the
run; the two unresolved authorities never reached the verification stage at all. The earlier
support-stage loss is not observable on the current build, so its cause cannot be attributed
from this run's data.

---

## 6. Remaining issue recommendation (not implemented here)

1. Judgment acquisition for `ע"א 1511/05` / `ע"א 2098/97` remains the live Q23 bottleneck —
   the same residual class as the exact-authority recovery work, and the natural next task.
2. Q23 run-to-run variance is significant (an earlier run on this build ended limitation-only
   with the statute lost downstream). The new `verification_forensics` field now makes the
   support stage inspectable whenever that recurs; recommend re-running Q23 once more and
   comparing forensic rows before choosing a support-stage fix.
3. No support-verifier change should be made on present evidence.

---

ZERO-CLAIM REPAIR FIX — SHIP

NO SUPPORT-VERIFIER BEHAVIOUR CHANGED.
