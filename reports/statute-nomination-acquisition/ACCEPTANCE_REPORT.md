# Acceptance report — statute_nomination_to_text_acquisition_v1

Suite: 7 sequential runs (D1, D3, R02, MAYA, MAYA-AMIR, B8, P02), single deploy,
raw telemetry in `reports/statute-nomination-acquisition/*.json`.

**Verdict: ACCEPTED — stable-initial / monitor.** One new defect found (cache
write never persists, pre-existing schema mismatch) and one diagnosed
acquisition gap (D1, legacy `.doc` statute source). Neither produced a wrong
answer; both are logged below with recommendations.

## 1. What changed

`officialSourceDiscovery` gained a statute lane. A nomination with
`category = "statute"` no longer falls through to `no_docket_no_live_lane`; it
is routed to the official statute acquisition primitive
(`acquireStatuteTextFromUrl`, the same bounded fetch/extract/preflight path used
by `statuteTextAcquisition`), with:

- statute title normalization (`normalizeStatuteTitleText`);
- search-first URL selection — only official statute hosts (`STATUTE_HOST_RE`)
  that retrieval already surfaced, listing pages excluded, capped at
  `MAX_URLS_PER_TARGET`;
- identity validation: ≥2 distinctive title tokens must appear in the acquired
  text (1 when the title yields only one distinctive token);
- section validation via `buildSectionVariants` when a section was nominated;
- injection as a normal candidate (`citable_as: "statute"`,
  `usable_for_holding: false`, `is_judgment_document: false`);
- a canonical-quote-registry short circuit so the deterministic quote path is
  never duplicated or displaced.

No verifier, source-integrity, claim-source-match, sufficiency or footnote rule
was relaxed. Injected statute rows pass through every existing gate.

## 2. Per-run table

| | D1 | D3 | R02 | MAYA | MAYA-AMIR | B8 | P02 |
|---|---|---|---|---|---|---|---|
| Terminal | yes | yes | yes | yes | yes | yes | yes |
| Runtime (pipeline) | 115.4s | 127.2s | 155.2s | 152.7s | 168.4s | 81.7s | 149.0s |
| Statute nominations | 1 | 1 | 2 | 2 | 1 | 0 (nomination skipped) | 0 |
| Statute targets selected | 1 | 1 | 1 | 2 | 1 | 0 | 0 |
| Statute lane invoked | yes | yes | yes | yes ×2 | yes (no-op) | no | no |
| Title normalization | `חוק-יסוד: כבוד האדם וחירותו` (unchanged) | `חוק בתי דין רבניים (נישואין וגירושין)` (unchanged) | `חוק יסוד: כבוד האדם וחירותו` (unchanged) | `חוק שיפוט בתי דין רבניים…` / `חוק-יסוד: כבוד האדם וחירותו` (unchanged) | `חוק שיפוט בתי דין רבניים…` (unchanged) | — | — |
| Section requested / validated | none | none | none | none / **8** (2nd target) | none | — | — |
| Official host | m.knesset.gov.il | nevo.co.il → fs.knesset.gov.il → gov.il | fs.knesset.gov.il → nevo.co.il | nevo/fs.knesset/fs.knesset | — | — | — |
| Acquisition path | `none` | `statute_official_url` | `statute_official_url` | `statute_official_url` / `none` | `none` | — | — |
| Body chars | 0 | 10,813 | 1,974 | 10,813 / 0 | 0 | — | — |
| Identity / section validation | not reached (fetch failed) | 5 tokens matched | 3 tokens matched | 6 tokens matched / not reached | not reached | — | — |
| Cache | miss, no write | miss, **write failed** | miss, **write failed** | miss ×2, **write failed** | miss | n/a | miss |
| Candidate injected | no | yes (`nominated-source:N3`) | yes (`nominated-source:N2`) | yes (`nominated-source:N1`) | no | no | no |
| Statute-lane source in footnotes | no | **yes** | no | no | no | n/a | n/a |
| Footnotes | 0 | 1 | 0 | 0 | 2 | 1 | 0 |
| Dangling / orphan markers | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| CPU kill / stale / stub | none | none | none | none | none | none | none |

Per-run failure reasons where applicable:

- D1 — `fetch_failed:acquisition_failed:statute_binary_not_text_extractable`
- MAYA (2nd target) — `unsupported_statute_source:no_official_statute_url`
- MAYA-AMIR — `not_attempted:retrieval_already_has_body` (correct suppression:
  retrieval had already produced usable text for the same statute)
- P02 — no statute nominations; the single judgment target failed `http_403`
- B8 — nomination skipped entirely (`nomination_skipped`), 0 discovery targets

## 3. The headline result

**Zero statute nominations died as `no_docket_no_live_lane` (was 4 of 4 in the
previous suite).** Of 6 statute targets selected across the suite:

| Outcome | Count |
|---|---|
| Body acquired + identity validated + injected | 3 |
| Correctly suppressed (retrieval already had the body) | 1 |
| Specific, actionable failure reason | 2 (D1 binary, MAYA no official URL) |
| Silent `no_docket_no_live_lane` drop | **0** |

**D3 went from 0 footnotes to 1 footnote**, and the statute lane's acquired body
(`חוק בתי דין רבניים`, gov.il PDF, 10,813 chars) is one of the two sources
behind that compound footnote — this is the first end-to-end
nomination → discovery → acquisition → citation path in the suite.

## 4. Special-attention items

### 4.1 D1 — `statute_binary_not_text_extractable`

Diagnosis: **source format, not a PDF/preflight bug and not a lane wiring bug.**

The only official statute URL retrieval surfaced for
`חוק-יסוד: כבוד האדם וחירותו` in that run was
`m.knesset.gov.il/Activity/Constitution/Documents/H19-12-2005_12-43-13_piskat.doc`
— a **legacy OLE2 `.doc`**, not a PDF. The failure is raised by the existing
`looksBinary()` guard in `statuteTextAcquisition.ts:238`, which deliberately
refuses to run the Hebrew decoder over opaque binaries; that guard was added in
`retrieval_budget_enforcement_v1` precisely because a knesset `.doc` was killing
the isolate (F05). So:

- not a PDF extraction/preflight issue — no PDF was involved;
- the lane *is* using the same acquisition primitive as the working path
  (R02 acquired a `.PDF` from `fs.knesset.gov.il` through it, 1,974 chars);
- the gap is that `.doc` has no extraction lane at all, anywhere in the system,
  and the lane had no second URL to fall back to in that run;
- correct, safe behaviour: D1 emitted a limitation with 0 footnotes and cited
  nothing it could not read.

Not fixed here — it is not a wiring bug inside the statute lane.

### 4.2 MAYA — `unsupported_statute_source:no_official_statute_url`

The failing target was **`חוק-יסוד: כבוד האדם וחירותו`, section 8** (the
limitation clause) — nomination N3. The other MAYA statute target
(`חוק שיפוט בתי דין רבניים (נישואין וגירושין)`) acquired 10,813 chars.

Assessment:

- title is **correct, not hallucinated** — this is the real Basic Law;
- normalization did **not** fail (`title_normalization_changed: false`, the
  title was already canonical);
- the law does not exist under a different official name;
- the failure is **correct and should remain a limitation**: retrieval produced
  no official statute-host URL for it in that run, and the lane refuses to
  invent one or to reach a non-official host. `urls_attempted` is empty, so no
  network cost was incurred.

The MAYA answer carries an explicit Hebrew grounding limitation and 0 footnotes.
Note that the pre-existing **zero-citable-source floor defect (R2 in the
conversion diagnosis) is still open**: MAYA again emits ~1,300 chars of
doctrinal prose with 0 footnotes, softened only by the limitation paragraph.
That is unchanged by this track and remains the highest-severity open item.

### 4.3 B8 — canonical quote safe

- `deterministic_branch: canonical_quote_registry`
- nomination skipped → **0 discovery targets, statute lane never invoked**
- answer text **byte-identical** to the previous suite's B8 answer
- 1 footnote, 0 dangling markers, 81.7s (fastest run in the suite)

The registry short circuit was therefore never even needed here, because
nomination does not run for canonical-quote intents at all — a second layer of
protection.

### 4.4 P02 — fake-docket refusal safe

- `deterministic_branch: docket_limitation`, 0 footnotes, 0 dangling markers
- no statute nominations, 1 judgment target, `http_403`, nothing injected
- answer is the refusal + upload offer, no substitute authority

No nomination, discovery, statute or cache path weakened the refusal.

## 5. New defect found: verified-source cache writes never persist

Every successful statute acquisition reported:

```
cache_write_error: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
```

`verifiedSourceCache.ts:312` upserts with
`onConflict: "source_category,normalized_docket,statute_title,statute_section,body_text_hash"`,
but the table's unique index is
`verified_legal_sources_dedupe_idx UNIQUE (source_category, COALESCE(normalized_docket,''), COALESCE(statute_title,''), COALESCE(statute_section,''), body_text_hash)`
— an **expression index**, which PostgREST cannot match to a bare column list.

Consequences (all benign in this suite, none affecting answers):

- no positive cache row is ever written, for statutes *or* judgments;
- every run re-acquires from the origin (visible as `cache_misses: 1–2`,
  `cache_hits: 0`, `cache_writes: 0` in all runs);
- **no orphan rows** were created — the write fails atomically.

Note this is pre-existing, not introduced here; the statute lane is simply the
first path that reached a successful write often enough to expose it. Negative
caching (`recordSourceFailure`) does work — the judgment cooldowns from the
prior suite fired in D1/D3/R02/MAYA-AMIR as designed.

## 6. Acceptance criteria

| Criterion | Result |
|---|---|
| No statute actionable nomination fails with `no_docket_no_live_lane` | **PASS** — 0 occurrences (was 4) |
| Several nominated statutes acquire bodies or fail with specific statute reasons | **PASS** — 3 bodies, 1 correct suppression, 2 specific reasons |
| At least one previously 0-footnote run gains a valid statute footnote | **PASS** — D3, 0 → 1, statute body among the cited sources |
| No citation without acquired/validated statute text | **PASS** — every injection passed token identity; D1/MAYA-N3 injected nothing and cited nothing |
| B8 unchanged | **PASS** — byte-identical answer, canonical branch, lane not invoked |
| P02 safe | **PASS** — `docket_limitation`, 0 footnotes, nothing injected |
| No verifier / source-integrity / footnote loosening | **PASS** — no gate touched; statute rows marked `usable_for_holding: false` |
| No CPU kills, stale jobs, stubs, dangling markers, orphan rows | **PASS** — 7/7 terminal, 82–168s, 0 dangling markers, 0 orphan cache rows |

## 7. Recommended next fix

**Judgment search-first discovery** (`official_judgment_search_first_v1`).

Rationale: the statute lane is stable and the remaining binding constraint is
now case-law bodies. Across this suite, **every** judgment target was
`not_attempted` (negative-cache cooldown from the previous suite's derivation
failures) or `http_403`. R02 still refuses on the canonical Mizrahi judgment,
and MAYA-AMIR again shows the structural problem: nomination derived
`בג"ץ 8497/00` while the real case retrieval found is `8638/03`. Deterministic
derivation from a model-supplied docket cannot be repaired by more probing — it
needs search-first resolution of the true document, with identity validation
before citation. Two cheap prerequisites belong in the same track: keying the
negative cache on (docket, strategy) so the fix is not shadowed for 7–60 days,
and fixing the `onConflict` mismatch above so verified bodies actually persist.

D1's `statute_binary_not_text_extractable` is **not** recommended as the next
fix: a `.doc` (OLE2) extraction lane is a new binary-parsing surface behind the
guard that exists specifically to prevent isolate death, so it is neither
isolated nor low-risk. A cheaper mitigation, if D1 matters sooner, is to prefer
non-`.doc` official URLs and keep probing the remaining candidates instead of
stopping at the first binary — a small ordering change inside the statute lane.
