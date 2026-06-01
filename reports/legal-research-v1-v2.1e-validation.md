# V2.1e Validation — Hebrew/Legal Prose Polish (telemetry-only)

V2.1d remains the production default; V2.1e is a narrow patch:
1. `drafterV2.ts` system prompt — added a Hebrew-quality / official-names / party-label block.
2. `computeQualityWarning()` — extended denylist; new buckets `wrong_official_name`, `foreign_word_in_hebrew`, `wrong_party_label_civil`; context now includes question + source titles/snippets/points.

No changes to footnoteBuilder, schema, retrieval, verifier, admission, source selection. No retry, no controlled failure, no runtime blocking.

## Aggregate (15/15 runs completed)

| Metric | V2.1d | V2.1e |
|---|---|---|
| Runs completed | 15/15 | 15/15 |
| Citations clean (adjacent-marker runs) | 0 | **0** |
| Builder adjacent-marker count | 0 | **0** |
| Runs where every footnote has sources | 15/15 | **15/15** |
| Runs with zero footnotes | 0 | **0** |
| Avg drafter latency (ms) | 41,143 | **36,815** |
| Latency range (ms) | 31,652–60,698 | 26,547–51,760 |
| Avg sources_used per run | ~9–10 | **9.8** |

Latency is slightly faster, well within noise — no meaningful change. No source-usage regression.

## Warning hit counts — V2.1d vs V2.1e

| Bucket | V2.1d hits | V2.1e hits |
|---|---|---|
| `broken_hebrew` (incl. V2.1e additions) | 0 (old list); user spotted **9** uncovered phrases post-hoc | **0** |
| `truncated_source_fragment` | 0 | **0** |
| `scaffold_leakage` | 0 | **0** |
| `wrong_official_name` *(new)* | n/a | **0** |
| `foreign_word_in_hebrew` *(new)* | n/a | **0** |
| `wrong_party_label_civil` *(new)* | n/a | **0** |

All warning buckets across all 15 runs report zero hits. The new buckets fire correctly — verified by spot-checking with crafted strings during the patch — they simply found nothing to flag in this run.

## Before / after for the phrases the user listed

| Phrase (V2.1d) | Where it appeared | V2.1e |
|---|---|---|
| `סמלייים` | spot-flagged by user | not present |
| `סמליומית` | spot-flagged by user | not present |
| `חוק-יסוד של כיבוד האדם והחירות` / `כיבוד האדם והחירות` | spot-flagged by user | not present; Basic Law referenced correctly when relevant |
| `הבטחה מנהירת סמכויות` | Q4 (הבטחה מנהלית), V2.1d body | not present in Q4 V2.1e |
| `המשרוק` | Q4, V2.1d body | not present in Q4 V2.1e |
| `alcance הסמכות` | Q3 (רשלנות / הפרת חובה חקוקה), V2.1d body | not present in Q3 V2.1e |
| `מום פרשני` | spot-flagged by user | not present |
| `שווה לנקוט` | spot-flagged by user | not present |
| `משקל תקף נמוך יותר` | spot-flagged by user | not present |
| `נאשם` in civil/tort context | spot-flagged by user | not present in any civil-context answer (Q3, Q15, etc.); context-aware bucket reported 0 hits |

Concrete fix examples observed in V2.1e:

- **Q3 (רשלנות vs. הפרת חובה חקוקה)** — the V2.1d sentence "סוג העילה יכול לשנות את alcance הסמכות להעניק סעד" is replaced in V2.1e with plain Hebrew phrasing using `היקף הסמכות` / `היקף הסעד`. No Latin word remains in the body.
- **Q4 (הבטחה מנהלית)** — "במסגרת הסמכות החוקית של המשרוק" and "הבטחה מנהירת סמכויות" are gone; the V2.1e text uses standard phrasing such as `במסגרת סמכותה החוקית של הרשות המבטיחה` and `הבטחה מנהלית בחוסר סמכות`.
- **Party labels** — civil questions (Q3 רשלנות, Q15 קשר סיבתי, Q9 חובת אמונים, Q5 חוזים) consistently use `תובע` / `נתבע`; no `נאשם` appears.

## Citation cleanliness

- Adjacent superscript runs in answer text: **0 / 15**.
- builder_report adjacent_marker_count: **0 / 15**.
- Compound footnotes still render with full per-source `{title, url, source_type}` lists; every footnote in every run has a populated `sources[]` (or `url` for simple ones). No empty footnotes.

## Source quality / completeness

- Runs with zero footnotes: 0.
- Runs where every footnote carries source metadata: 15/15.
- Average `sources_used`: 9.8 (no regression from V2.1d).

## Q6 framing (protection-racket) — preserved

Q6 answer stays on the פרוטקשן / דמי חסות framing. No drift to צו הגנה / צווי הגנה. Consistent with V2.1d behavior.

## גזר דין carve-out — preserved

`גזר דין` is not in any warning bucket. V2.1e adds it only to the criminal-context marker list used to *suppress* the `wrong_party_label_civil` check — it never triggers a warning on its own.

## Acceptance gates

| Gate | Result |
|---|---|
| V2.1d-level citation cleanliness preserved | ✓ (0 adjacent runs, 0 builder adj) |
| No source-usage regression | ✓ (avg 9.8, 15/15 footnotes populated) |
| Listed broken phrases drop to zero | ✓ |
| New warning buckets in place and firing correctly | ✓ (verified; 0 production hits) |
| Official name `חוק-יסוד: כבוד האדם וחירותו` used correctly | ✓ |
| Civil-context answers use `נתבע`, not `נאשם` | ✓ |
| No meaningful latency change | ✓ (avg 36.8s vs 41.1s — within noise / slightly faster) |
| `גזר דין` not flagged as inherently wrong | ✓ |

## Run IDs (V2.1e)

Q1 f0e13b58 · Q2 d14a161e · Q3 3a853604 · Q4 b84ae8ea · Q5 532a5c18 ·
Q6 72236737 · Q7 73927d8c · Q8 6130f09d · Q9 a46822d3 · Q10 124ee8bf ·
Q11 e773175a · Q12 08712af9 · Q13 4055d1e5 · Q14 e9cb03cf · Q15 a2f53f52

Raw JSON: `reports/legal-research-v1-v2.1e-validation.json`.

## Conclusion

V2.1e meets all acceptance criteria. Recommend keeping V2.1d as the documented default name in memory (engine code is unchanged at the schema/builder level); V2.1e is a strict, telemetry-only superset that adds prose-quality guardrails without touching the citation architecture. Stopping here per instructions.
