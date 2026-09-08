# legal_research_v2_deliverable_aware_research_depth_v1 — acceptance report

## 1. Files changed

| File | Change |
| --- | --- |
| `supabase/functions/legal-research-v2/agent/deliverable.ts` | NEW — deterministic Hebrew cue classifier, `focused` \| `developed`, defaults to `focused`. |
| `supabase/functions/legal-research-v2/types.ts` | `Intake.deliverable: DeliverableKind`. |
| `supabase/functions/legal-research-v2/index.ts` | `buildIntake()` sets `deliverable: classifyDeliverable(question)`. |
| `supabase/functions/legal-research-v2/agent/prompt.ts` | Depth guidance in system prompt; deliverable line in user message. |
| `supabase/functions/legal-research-v2/agent/commitPolicy.ts` | Early-commit wording is deliverable-aware. |
| `supabase/functions/legal-research-v2/agent/researchAgent.ts` | Passes `intake.deliverable` into the commit signal. |
| `supabase/functions/legal-research-v2/drafting/draft.ts` | One prompt line: match answer development to requested product, no fixed length. |
| `src/test/legalResearchV2.deliverable.test.ts` | NEW — 6 tests. |

## 2. Early commit — before / after

Trigger logic is unchanged (`readable_count >= 3`, once per run, same position in the directive chain). Only the wording differs.

Before (single flat text):
> כבר קראת חומר שעשוי להספיק. או שתגיש עכשיו את תזכיר המחקר (submit_research_memo), או שתנסח לעצמך צורך מחקרי אחד ספציפי שטרם נענה — ורק אז תשתמש בכלי נוסף.

After — `focused`: identical to the above.

After — `developed`:
> קראת מספר מסמכים, אך המשתמש ביקש תוצר מחקרי מפותח. מספר המסמכים כשלעצמו אינו מעיד על מספיקות. בדוק עכשיו אם בסיס הראיות מתאים לעומק שהתבקש: האם הממדים המרכזיים של הסוגיה מיוצגים, האם יש ספרות או עמדות מתחרות משמעותיות, והאם הדין הראשוני הרלוונטי נקרא. אם התשובה שלילית — המשך לחקור בכיוון שחסר. רק אם בסיס הראיות כבר תומך בתוצר המפותח שהתבקש, הגש את תזכיר המחקר.

## 3. Research Agent instruction added (verbatim, system prompt)

> - עומק המחקר נגזר מהתוצר שהמשתמש ביקש, לא ממספר מקורות קבוע. בשאלה צרה על פסק דין, חוק, סעיף או אסמכתה מסוימת — מספר קטן של מקורות חזקים עשוי להספיק. בבקשה לסינתזה דוקטרינרית רחבה, ניתוח השוואתי, סקירת ספרות, פרק אקדמי, פרק מבוא, חקירת שאלת מחקר או משימת מחקר פתוחה אחרת — אל תפסיק רק משום שכמה טענות כבר ניתנות לאימות. לפני שאתה מגיש, שקול אם בסיס הראיות מתאים לתוצר שהתבקש: האם מיוצגים הממדים המרכזיים של הסוגיה, הדין הראשוני הרלוונטי במקום שבו הוא נדרש, ספרות אקדמית משמעותית ועמדות מתחרות מהותיות. המשך לחקור כאשר החומר הקיים היה מספיק רק לתשובה קצרה בעוד שהמשתמש ביקש תוצר אקדמי או אנליטי מפותח.
> - התאם את עומק התזכיר לתוצר: אם התבקש פרק, מבוא, סקירת ספרות, ניתוח השוואתי או סינתזה מפורטת — הכן תזכיר מחקר עשיר דיו כדי לתמוך בתשובה מפותחת, ולא בתשובת שאלה-תשובה קצרה.
> - scope: "academic" זמין לך לאיתור ספרות מחקרית. השתמש בו כשהוא מועיל למשימה — במיוחד בבקשות ספרותיות/אקדמיות — אך אין חובה להשתמש בכל scope בכל משימה.

User message adds one line per run: `developed` → "אופי התוצר שהתבקש: תוצר מחקרי מפותח … אל תסתפק בסבב גילוי וקריאה יחיד…"; `focused` → "אופי התוצר שהתבקש: תשובה ממוקדת … אל תרחיב מחקר מעבר לנדרש."

Drafter line: "התאם את מבנה התשובה ואת מידת פיתוחה לתוצר שהמשתמש ביקש … אין יעד אורך קבוע."

## 4. No quotas / modes / gates

No source counts, no academic-source minimums, no word counts, no source-type quotas, no research modes, no new sufficiency gate, no new stage, no refusal path. Verifier semantics, models, routing, and global budgets unchanged. V1 untouched.

## 5–8. Live results (deployed, one run each)

| | T1 academic intro | T2 literature review | T3 named authority |
| --- | --- | --- | --- |
| latency | 213.6 s | 165.9 s | 77.1 s |
| agent steps | 7 | 5 | 9 |
| searches | 8 (academic 3, official 5) | 8 (academic 4, corpus 2, official 2) | 2 (web 1, corpus 1) |
| fetches | 10 | 9 | 2 |
| sources read | 10 | 9 | 2 |
| cited | 6 | 6 | 1 |
| prompt / completion tokens | 102,114 / 11,432 | 90,643 / 7,473 | 62,576 / 3,358 |
| est. cost (Terra rates) | ~$0.30 | ~$0.25 | ~$0.16 |
| answer length | 3,286 chars | 3,730 chars | 1,273 chars |
| repair cycles | 1 | 0 | 0 |

Academic scope was used in T1 and T2 (the agent chose it for scholarship on constitutional identity and on the reasonableness doctrine) and not in T3, where the deliverable is a single named judgment — exactly the intended asymmetry. Cost is not recorded in telemetry; the figures above are derived from token counts.

Full answers are in `v2_eval_runs` under labels `depth-T1`, `depth-T2`, `depth-T3`.

## 9. Comparison with the previous academic-intro run

| | before (`f4c2044a`) | now (`473c7900`) |
| --- | --- | --- |
| searches | 6, all web, one burst | 8, academic + official |
| distinct documents read | 4 | 10 |
| cited | 5 | 6 |
| commit point | step 2, right after `early_commit` on `readable_count>=3` | step 7, after several discovery/read cycles |
| latency | 121 s | 214 s |
| product | short Q&A-shaped text | comparative introduction: Israel / Canada / France / Spain models plus two scholarly works |

## 10. Named-authority regression

T3 stayed focused: 2 searches, 2 fetches, 1 verified citation (Bavli judgment body), 77 s — matching the previous Bavli baseline (~78 s). No broad expansion, no extra academic scope, no latency regression.

## 11. Regressions

None observed. All citations verified, no fabricated sources, no invariant errors, no new refusals. Typecheck clean; full suite 49 files / 545 tests passing.
