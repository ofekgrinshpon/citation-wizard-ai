# official_court_egress_path_v1 — validation report (relay live)

Relay: Hetzner VPS (IL egress), `https://2-28-58-146.sslip.io/fetch?url={url_encoded}`, curl path.
Secrets configured (`COURT_EGRESS_URL_TEMPLATE`, `COURT_EGRESS_TOKEN`, `COURT_EGRESS_HEADER_PREFIX`),
function redeployed. Runner: `scripts/legal-research-v1-court-egress-validation.ts`.
Raw per-run JSON: `reports/court-egress/<ID>.json`.

Verdict: **CONDITIONAL PASS.** The alternative egress works end-to-end (two previously
Edge-reset court.gov.il documents were fetched, extracted, identity-validated and cached),
all safety criteria hold, and no regression appeared. The one acceptance item not fully met
is *citation* of a relay-acquired judgment body.

## 1. Terminal state and runtime

| Run | Terminal | Wall ms | Footnotes | Dangling |
|---|---|---|---|---|
| D1 | yes | 101,175 | 0 | 0 |
| D3 | yes | 155,901 | 1 | 0 |
| MAYA-AMIR | yes | 145,010 | 1 | 0 |
| R02 | yes | 166,638 | 0 | 0 |
| MAYA | yes | 111,528 | 0 | 0 |
| NATION-STATE | yes | 111,240 | 1 | 0 |
| P02 | yes | 106,060 | 0 | 0 |
| B8 | yes | 94,730 | 1 | 0 |
| FRESH-SC (בג"ץ 6427/02) | yes | 205,257 | 0 | 0 |

9/9 terminal (the 8 requested plus B8 kept separate from Nation-State).

## 2. Did Edge-reset court URLs use the Hetzner fallback?

Yes — every `court.gov.il` fetch reset at the Edge (`error sending request … client error`)
and every reset triggered the relay lane. `court_egress.configured = true` in all runs.

| Run | Egress calls | Relay outcome |
|---|---|---|
| D1 | 1 | **200**, 6,899,227 B (`HebrewVerdicts/14/560/044/l30 … type=2`) |
| MAYA | 1 | **200 application/pdf, 364,164 B** (`HebrewVerdicts\15/390/073/t06`) |
| R02 | 2 (+1 skipped) | 502 ×2 → `repeated_egress_failure` |
| NATION-STATE | 2 (+1 skipped) | 502 ×2 → `repeated_egress_failure` |
| FRESH-SC | 2 (+1 skipped) | 502 ×2 → `repeated_egress_failure` |
| D3, MAYA-AMIR, P02, B8 | 0 | no court URL reached the fetch lane |

The 502s are **not** relay failures: the URLs are the derived `fileName=…_z01` / `elyon1 … z01.htm`
guesses, and the origin answers them with an HTML Exception page, which the relay refuses to
relay as a document. The cap and hard-stop behaved exactly as specified (max 3/run,
stop after 2 consecutive failures, third attempt skipped with `repeated_egress_failure`).

## 3. Nominated judgment body: acquired / validated / cached / injected / cited

Partly. D1: `בג"ץ 834/91 אולמרט נ' המדינה` — search-first official URL, direct Edge fetch reset,
relay returned the document, 13,298 chars extracted, `identity_validated = true`
(`name_tokens_with_corroboration`: 2 name hits + court match; docket/year not matched),
cached (`verified_legal_sources`, status `verified`, `acquisition_method =
search_first_official_by_name`), injected as `nominated-source:N1`.
It was **not cited** — D1's drafter still emitted the "no directly usable case law" notice
(0 footnotes). So: acquired ✅, validated ✅, cached ✅, injected ✅, cited ❌.

Two follow-ups this exposes (not in this track's scope):
- the identity pass used name tokens only while `docket_match = false` — the cached row's URL
  (`14044560`) is not obviously the 834/91 file; identity strictness for relay-acquired bodies
  should be revisited before such bodies are allowed to carry holdings;
- the `z01`/`_z01` URL derivation guesses are the sole cause of every relay 502 — removing them
  (the queued URL-correctness item) should convert R02 / NATION-STATE / FRESH-SC.

## 4. Cache writes

Succeeded, no errors (`cache_write_error: null` everywhere). Rows written during the sequence:

| Time | Category | Title | Chars | Validated | Status |
|---|---|---|---|---|---|
| 20:36:03 | statute | חוק-יסוד: כבוד האדם וחירותו | 0 | false | failed (negative cache, correct) |
| 20:36:09 | judgment | בג"ץ 834/91 אולמרט נ' המדינה | 13,298 | true | verified (**relay-acquired**) |
| 20:45:42 | statute | חוק בתי דין רבניים (נישואין וגירושין) | 1,998 | true | verified |
| 20:49:29 | statute | חוק סדר הדין האזרחי | 113,930 | true | verified |

R02 additionally consumed a cache **hit** (חוק-יסוד, 1,353 chars) and a strategy-scoped
cooldown on `aa:6821/93`, i.e. the negative-cache scoping still works.

## 5. P02

Safe refusal, and **byte-identical** to the `official_fetch_profile_v1` baseline:
"לא אותר במקורות הזמינים פסק הדין בעניין ע"א 99887/04/22 עצמו…" with an upload invitation,
0 footnotes, 0 egress calls (no fabricated court URL was even attempted).

## 6. B8

**Byte-identical** to the baseline answer (364 chars, 1 footnote, official Knesset PDF).
No regression.

## 7. Dangling footnotes

**0** across all 9 runs (markers vs. footnote list checked per run).

## 8. Block pages / HTML exception pages / metadata-only sources in the final answer

None. `block_pages_detected = 0` in every run; the relay rejected the origin's Exception pages
at the boundary (502) so they never reached extraction, the cache, or a footnote. The only
cited sources in the sequence are official statute texts (Knesset PDF for B8) — no metadata-only
source carried a holding.

## Acceptance checklist

| Criterion | Result |
|---|---|
| 8/8 terminal | **MET** (9/9) |
| 0 dangling footnotes | **MET** |
| 0 block / HTML exception pages cached or cited | **MET** |
| P02 safe refusal | **MET** (byte-identical) |
| B8 unchanged | **MET** (byte-identical) |
| ≥1 previously Edge-reset court judgment body acquired via relay and used safely | **PARTIAL** — acquired, extracted, identity-validated, cached and injected (D1); also a real 364 KB Supreme Court PDF pulled in MAYA; but no relay-acquired judgment was cited in a final answer |

## Next step

Remove the `z01` / `_z01` / `elyon1` URL-derivation guesses so the relay is only asked for URLs
that official discovery actually found; then re-run R02, NATION-STATE and FRESH-SC to close the
citation criterion.
