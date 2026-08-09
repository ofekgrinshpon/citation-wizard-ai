# Final Human Smoke Test — Pre-Closed-Beta

Date: 2026-08-09 · No product code changes. Read-only validation + manual grading.

Artifacts:
- Part A exports: `reports/metadata-only-holding-gate/*.json`, `reports/final-validation-suffvis/*.json`
- Part B exports: `reports/beta-smoke/partB/{S1..S5}.json`, `SUMMARY.json`
- Runner (read-only): `scripts/legal-research-v1-beta-smoke-partB.ts`

---

## Part A — existing answers (8 items)

| ID | Query | Branch | Drafted | Sources | Read-in-full | Reference-only | Metadata-only holdings | Stub | Grade |
|----|-------|--------|---------|---------|--------------|----------------|------------------------|------|-------|
| R02 | בנק המזרחי — מה נקבע | – | yes | 2 | ע"א 6821/93 (body), gov.il doc | 0 | 0 | no | **Pass** |
| G07 | מבחן ההשתלבות | insufficient_sources_limitation | no (refusal) | 0 | 0 | 0 | 0 | no | **Beta-pass with caveat** |
| G08 | מבחני מידתיות | – | yes | 4 | בג"ץ 6732/20, gov.il judgment | 0 | 0 | no | **Beta-pass with caveat** |
| G10 | צוואות הדדיות | – | yes | 3 | 0 (statute-based) | 0 | 0 | no | **Beta-pass with caveat** |
| G13 | בטלות יחסית | – | yes | 6 | פסק-דין (בטלות יחסית) | 0 | 0 | no | **Beta-pass with caveat** |
| G15 | שיתוף ספציפי בדירת מגורים | – | yes | 3 | 0 | דנג"ץ 8537/18 (disclosed) | 0 | no | **Beta-pass with caveat** |
| P02 | ע"א 99887-04-22 (fake docket) | docket_limitation | no (refusal) | 0 | 0 | 0 | 0 | no | **Pass** |
| B8 | ציטוט ס' 1 לחוק יסוד: כבוד האדם | canonical_quote_registry | yes | 1 | Knesset official PDF | 0 | 0 | no | **Pass** |

### Notes per item
- **R02 — Pass.** Legally correct on constitutional supremacy, judicial review and the limitation clause; drafted from the exact judgment body. Secondary gov.il support is explicitly hedged.
- **G07 — Beta-pass with caveat.** Safe, correctly-worded refusal ("לא נמצאה במקורות פסיקה ישירה"), no non-existence claim, no analogical drift. But the integration test is core Israeli labour law — this is a retrieval over-refusal, not a knowledge gap. Embarrassment risk: moderate (looks weak, not wrong).
- **G08 — Beta-pass with caveat.** Doctrinally correct. **Cosmetic defect:** internal reference labels leak into prose ("המופיע ב-s5", "ב-s1"). Must not ship to a public launch; tolerable in a supervised beta.
- **G10 — Beta-pass with caveat.** Accurate reading of s. 8א to the Succession Law (written notice while both alive; disclaimer before distribution; restitution after). No case law at all — presented honestly as such.
- **G13 — Beta-pass with caveat.** Correct doctrinal description and balancing factors. No named leading authority; source title is generic ("פסק-דין"). Title-recovery gap.
- **G15 — Beta-pass with caveat.** Opens with "לא נמצא עיגון מספק" then gives a statute-anchored discussion — slightly self-contradictory framing. Reference-only disclosure block works correctly (דנג"ץ 8537/18 listed as located-but-unread, no holding derived).
- **P02 — Pass.** Fake docket → deterministic refusal, invites upload, cites nothing. Exactly the target behaviour.
- **B8 — Pass.** Byte-identical canonical quote from the official Knesset PDF.

**Part A checks:** no metadata-only holdings (gate reports: 0 across all), no absolute non-existence claims (all phrased "לא נמצא במקורות"), no stubs/placeholders, no fabricated dockets. Read-in-full vs reference-only is explicit wherever reference-only sources exist.

---

## Part B — fresh unseen queries (5 items, run sequentially)

| # | Query | Result | Branch | Sources | Read-in-full | Reference-only | Beta-pass |
|---|-------|--------|--------|---------|--------------|----------------|-----------|
| 1 | הלכת אפרופים | **refused** | insufficient_sources_limitation | 0 | – | – | yes (weak) |
| 2 | בג"ץ חסון / חוק הלאום | drafted | – | 4 | s1, s3 | 0 | yes |
| 3 | הרמת מסך — ס' 6 לחוק החברות | **refused** | statute_section_limitation | 1 | – | – | yes |
| 4 | תום לב במו"מ — ס' 12 לחוק החוזים | drafted | – | 3 | s2 | 0 | yes |
| 5 | בטלות יחסית מול בטלות מוחלטת | drafted | – | 5 | s1, s2 | 0 | yes |

1. **אפרופים — refused (safe).** Retrieval found only one unrelated article; answer says no direct case law was found in the sources and invites upload/refinement. No fabrication, no non-existence claim. **But** this is the single most famous Israeli contract-interpretation ruling — a refusal here is the biggest credibility risk in the batch. Beta-pass only because it is safe and clearly labelled; top of the post-beta backlog.
2. **בג"ץ חסון — drafted, good.** Correct holding: petitions dismissed, the Nation-State Basic Law was not struck down; narrow "abuse of constituent power" review acknowledged with a very high threshold; harmonious interpretation with equality; narrow reading of the Arabic-language and settlement clauses. Source support: בג"ץ 5555/18 body read in full. **Caveats:** footnote title carries a scraper artifact ("כנסת ירושלים"), and the URL is a law-firm blog mirror rather than the court site. Cosmetic/authority-quality issue, not a correctness issue.
3. **ס' 6 לחוק החברות — refused (correct discipline).** Refuses to state cumulative piercing conditions without a verified authoritative text, and forbids reconstructing from secondary sources — this is the intended behaviour. **Caveat:** a stray irrelevant footnote ("חילוט מניות", HUJI law journal) is attached to a refusal that cites nothing. Should be suppressed before public launch.
4. **תום לב במו"מ — drafted, acceptable.** Section 12(a)/(b) accurately reproduced, remedies via ss. 10/13/14 correct, doctrinal tests reasonable, limitations flagged. **Caveat:** the canonical line of authority (קל בנין, פנידר) is absent; support leans on one Supreme Court case plus a family-court decision. Under-authoritative, not wrong.
5. **בטלות יחסית מול מוחלטת — drafted, acceptable.** The distinction, the balancing factors (severity of defect, rights infringement, reliance, third-party effects) and the remedial consequences are correctly presented, with an honest note that no unified statutory anchor exists. **Caveat:** case support is loosely relevant (רע"א 2299/23, בג"ץ 6824/07) and the leading בטלות יחסית authorities are not cited.

**Part B checks:** 0 stubs/placeholders, 0 metadata-only holdings (gate applied, `metadata_only_holdings_remaining: 0` everywhere), 0 absolute non-existence claims, 0 fabricated dockets, 0 unsafe legal statements, no CPU kills, no verifier failures.

> Note: an earlier pass of the runner reported `len=0` for all five — that was a harness artifact (it read the `qa_logs` row before the answer column was written). The polling condition was corrected in `scripts/legal-research-v1-beta-smoke-partB.ts`; the numbers above are re-read from the completed rows.

---

## Acceptance verdict

| Criterion | Status |
|---|---|
| No unsafe answers | ✅ |
| No stubs/placeholders | ✅ |
| No fake certainty | ✅ (all thin answers carry explicit limitation blocks) |
| No metadata-only holdings | ✅ (gate active, 0 remaining in every run) |
| ≥ 8/13 beta-pass or better | ✅ **13/13** — 3 clean Pass, 10 beta-pass with caveat, 0 fail-before-beta |
| Failures are safe refusals / labelled limitations | ✅ (P02, G07, S1, S3 are all clean refusals) |

**Cleared for closed supervised beta.**

## Caveats to brief testers on
1. Retrieval variance: famous doctrines (אפרופים) can still return a refusal instead of an answer.
2. Statute-section questions may refuse when the official text can't be verified (ס' 6 לחוק החברות).
3. Some source titles are scraped artifacts; some judgments are cited via mirror sites rather than the court archive.
4. Answers may cite fewer/less canonical authorities than a lawyer would expect.
5. Cosmetic: internal `s1`/`s5` reference labels can leak into prose (seen in G08).

## Post-beta backlog (unchanged ranking, reconfirmed by this run)
1. Retrieval variance / topical sufficiency (S1, G07)
2. Statute-section acquisition (S3, G11/G12)
3. Citation pruning / source-soup + stray footnotes on refusals (S3, S5)
4. Title recovery & authoritative-URL preference (S2, G13)
5. Court PDF extraction hardening
6. Cosmetic: strip internal ref labels from prose (G08)
