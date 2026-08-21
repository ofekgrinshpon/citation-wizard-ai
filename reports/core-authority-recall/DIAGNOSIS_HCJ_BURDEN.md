# core_authority_discovery_v1 — added fixture: HCJ burden of proof

Query: "מה נטל ההוכחה בעתירות לבג״ץ? על מי מוטל הנטל? על העותר תמיד?"
Runs: `92262c01-3eaf-4a03-ac82-d1d8cff6dfb3` (10:26), `01518732-b79d-4354-aed7-53f5eff0c631` (10:28, analysed here)
Mode: `doctrine_explanation`. Read-only. No code changed.

## 1. Sources used (7 used_sources, 5 footnotes, 6 markers)

| # | Source | Tier | Text | Directly supports HCJ burden doctrine? |
|---|---|---|---|---|
| 1 | בג"ץ 466/07 גלאון (court.gov.il PDF) | official_primary | full_text, `has_holding_text: false` | No — identity confirmed, but no holding text on burden |
| 2 | בג"ץ 466/07 (adalah.org mirror) | primary_mirror | full_text, no holding | Duplicate of #1, adds nothing |
| 3 | ע"א 6709/22 מלונות פתאל (law-firm blog) | secondary_commentary | excerpt | No — civil interim-relief commentary |
| 4 | דורנר, "דרכי הוכחה בבג״ץ" | secondary_commentary | metadata_only (16 chars) | Topically on point, but **no text** |
| 5 | הרנון, "דיני הראיות" | secondary_commentary | metadata_only (11 chars) | No — general evidence law |
| 6 | "נטל השכנוע וחובת הראיה בדיני המסים" | secondary_commentary | excerpt | No — tax law |
| 7 | openscholar blog (generic title) | secondary_commentary | metadata_only | No |

`lead_ref: null` (`shape_not_eligible`). Hierarchy counts: 2 usable_judgment, 1 statute, **4 commentary**. Verifier: only 3 `direct` verdicts out of 30; 13 partial, 10 unrelated, 4 tangential.

Net: **zero sources carry HCJ burden-of-proof holding text.** The doctrine in the answer is model knowledge with decorative citations.

## 2. Authorities that should have been retrieved and were not

Never searched, never found:
- חזקת התקינות המנהלית (e.g. בג"ץ 4374/15 התנועה לאיכות השלטון; עע"מ 1786/12 ג'ולאני)
- חובת ההנמקה — סעיף 2א לחוק לתיקון סדרי המינהל (החלטות והנמקות), תשי"ט-1958
- חוק בתי המשפט לעניינים מינהליים + תקנות סדר הדין בבג"ץ / תקנה 20 לתקנות סדר הדין בבית המשפט הגבוה לצדק
- צו על תנאי as the burden-shifting device (once nisi issues, the respondent must show cause)
- סעד ביניים בבג"ץ: ראיות לכאורה / מאזן הנוחות

## 3. Why civil/commercial noise entered

Planner queries were generic ("נטל ההוכחה", "העברת נטל הראיה") with no administrative-law lock. Retrieval therefore pulled medical-negligence, tort and tax material. Six such items were dropped (`class_unknown_not_admitted_for_scholarship`, `discovery_only`), but the tax article (#6) and the civil interim-relief blog (#3) survived because they are topically "burden of proof" and pass role match. The planner emitted **14 queries, none** containing חזקת התקינות / צו על תנאי / חובת הנמקה / נטל השכנוע.

## 4. Over-promotion of secondary sources

4 of 7 used sources are commentary; 3 of them are `metadata_only` (11–29 chars of text). `has_holding_text: false` on every source, yet the drafter still cited them as support. The metadata-only holding gate blocked judgments but not commentary, so commentary filled the authority vacuum instead of triggering a sufficiency limitation.

## 5. Compound footnotes

`compound_footnote_count: 3` out of 5 footnotes; `mixed_hierarchy_footnotes_count: 3` (split applied). Average 1.6 sources per cited segment. Effect: a primary judgment with no holding text is bundled with tax/evidence commentary in the same footnote, so the reader cannot tell which source supports which proposition — and the weakest source is invisible behind the strongest.

## 6. Recommended fix (one, general)

**`claim_facet_expansion_v1`** — deterministic doctrinal-facet decomposition between analyzer and planner.

- For each claim, derive named facets from the claim text using a general facet lexicon (burden of persuasion / evidentiary burden / duty to explain / presumption of regularity / interim relief standard / form of relief), not a per-query hardcode.
- Emit one targeted query per facet, each conjoined with the claim's legal-area lock (here: administrative/HCJ terms), so generic "burden of proof" can never retrieve tort/tax pages unanchored.
- Carry the facet tag on candidates through to the drafter: a proposition may only be footnoted by sources verified against the same facet, and commentary alone cannot carry a facet with zero primary support — that facet gets an explicit limitation instead.

This one change addresses items 2–5 together: it fills the missing procedural authorities, blocks off-domain noise, stops commentary from substituting for primary support, and naturally splits compound footnotes because footnotes become facet-scoped.

Not recommended: any fixture-specific docket seeding for this query.
