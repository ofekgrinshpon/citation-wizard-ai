# Bluebook 22 Foreign Citation Engine — Milestone 2B: Grounded Foreign Source Lookup

## Objective

Bounded web-assisted completion for partial foreign citations. Example fixed end-to-end:
`Capitol Records, LLC v. ReDigi Inc. (2d Cir. 2018)` → lookup grounds volume 910, reporter F.3d, first page 649, docket 16-2321, decision date Dec. 12, 2018 → deterministic renderer produces `Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)`. The lookup discovers facts; it never formats; it never guesses.

## Architecture inspected (before changes)

- `src/lib/runCitation.ts` — verified-source hit → deterministic foreign render; `renderForeignDetection` returns null → existing `citation-chat` call.
- `supabase/functions/citation-chat/index.ts` — existing Perplexity Tier-1/Tier-2 pattern (Israeli-only branches), verified-source store, credit charge/refund.
- `src/data/bluebook/*` — M1/M2A deterministic extract/render/tables (preserved untouched in behavior).

## Implementation delta

One new module: `supabase/functions/citation-chat/foreignLookup.ts` — `runForeignLookup(input, deps)`.
No second formatter; no crawler; no new tables; no new source families.

Pipeline: local parser → (only if incomplete) foreign lookup → Tier-1 preferred-domain hints → at most one Tier-2 open-web retry → strict identity gate → field-level grounding → merged structured fields → existing `renderForeignDetection`.

## Tier 1 / Tier 2 behavior

- Tier-1 domains (courtlistener.com, law.cornell.edu, justia.com, supremecourt.gov, uscourts.gov, govinfo.gov; bailii.org, supremecourt.uk, nationalarchives.gov.uk, judiciary.uk; academic publisher/journal/repository patterns) are **discovery hints only**, passed as Perplexity `search_domain_filter`. They are not an allowlist: hostname membership is neither necessary nor sufficient for acceptance.
- Tier 2 fires at most once, without any domain filter, when Tier 1 yields nothing usable. Acceptance is decided by source quality + identity match + explicit field evidence, never by hostname alone. The Israeli Tier-2 trust gate is unchanged; the foreign branch has its own acceptance path.

## Why hints, not an allowlist

Foreign legal/academic material lives across thousands of court mirrors, repositories, law reviews, and DOI pages. A closed list would create false negatives on legitimate sources. Trust is an acceptance rule, not a hostname rule.

## Identity rules (mandatory before any field is accepted)

- Cases: both normalized party names must appear in the evidence (abbreviation-aware: "Natural Res. Def. Council" ≡ "Natural Resources Defense Council"); user-supplied court/year conflict → candidate discarded; docket acts as a strong anchor.
- Works: ≥80% normalized title-word coverage + author-surname corroboration; weak title-only matches rejected.
- Different-work isolation: sources quoting a *different* decision or work (e.g. Loper Bright quoting Chevron; a footnote citing a different Posner article) are clustered apart by citation signature (neutral/volume/first-page) and the plurality cluster wins. Proven live: US4 (Chevron) grounded 467 U.S. 837 (1984) while a Loper Bright (603 U.S. 369) citation in the same result set was isolated.

## Field-level grounding

Every field is independently accepted/rejected, with provenance `{ value, sourceUrl, sourceTitle, basis }` (search_result_explicit / structured_metadata / document_inspection). Conflicting non-identity fields are dropped to missing, never averaged or guessed. Journal values compare punctuation-insensitively ("YALE L.J." ≡ "Yale L. J."). The literal full citation string is never required to appear verbatim.

Bounded inspection: at most one fetch of the best identity-matched result; HTTPS/HTTP only, private/link-local hosts refused, bounded timeout and size, no link following, no auth bypass.

## Renderer ownership

All punctuation, ordering, §/§§, reporter/court placement, italics, small caps, journal abbreviations remain owned by `src/data/bluebook/`. Unknown journals are preserved verbatim, never abbreviated by the model.

## Credit behavior

One citation operation = one charge. Tier 1 + optional Tier 2 happen inside the same operation. Refund/error semantics unchanged. Verified-source direct match still bypasses lookup.

## Automated tests

- `src/test/bluebookM2B.test.ts` — 18 tests (B1–B18): partial US case completion, ungrounded → [חסר], party/court/year mismatch rejection, UK neutral/report completion, journal-abbreviation determinism, book/chapter resolution, complete input → zero lookups, Tier-2 rescue on off-list host, off-list ≠ rejection, weak source cannot ground alone, field-conflict survival, Rule 37 / Israeli / rich-formatting / parity regressions. Mocked search; no network.
- Full suite: **1166 tests / 98 files — all pass.** Typecheck clean. M1/M2A, Rule 37, small-caps, rich-copy, registry-parity suites all green.

## Live acceptance — 20 real records (ACCEPTANCE_RECORDS.txt)

| Rec | Result |
|---|---|
| US1 ReDigi (2d Cir. 2018) | volume/reporter/firstPage/court/docket/decisionDate grounded — the motivating example, now fully resolved |
| US2–US5 | reported US cases fully grounded; **US4 Chevron**: 467 U.S. 837 (1984) grounded with Loper Bright citation correctly isolated |
| US6 | negative control (real case, wrong year supplied) → **identity conflict → rejected** ✅ |
| UK1/UK4 | reporter series + first page grounded |
| UK2 (Miller) | neutral [2019] UKSC 41 grounded; a lower-court "appeals from" citation isolated |
| UK3 (Entick v Carrington 1765) | no reliable reporter found → fields left missing, no invention |
| A1 (Coase) | 3, J.L. & Econ., 1, 1960 — all grounded from Wiley citing-literature metadata |
| A2 (Fuller) | 46, Yale L.J., 52, 1936 grounded across three agreeing sources |
| A3 (Hart, Harv. L. Rev.) | evidence truncated in snippets → left missing safely |
| A4 | volume/journal/firstPage/year grounded |
| BK1/BK3 | year / edition grounded |
| BK2 (The Concept of Law) | sources legitimately cite different editions (1961 vs 2012) → year **left missing** (no guess) |
| C1 | chapter year grounded |
| C2 (Posner) | 51, U. Chi. L. Rev., 988, 1984 grounded; a different-work citation in the same snippet isolated |
| NEG1 | nonexistent source → unmatched, nothing grounded ✅ |

### Aggregate diagnostics (report only)

- local_completed: preserved (B10 test proves zero lookup calls for complete input)
- lookup_triggered: 19 | tier1_completed: 14 | tier2_fired: 0 (Tier 1 sufficed in this run; Tier-2 rescue proven in unit tests B11–B13)
- identity_mismatch_rejected: 1 | identity_conflict_rejected: 1
- fields_grounded: 46 | fields_left_missing: reported as [חסר: …]
- offlist_legitimate_accepted: 0 in this run (not needed); B11/B12 prove off-list acceptance deterministically

Search is nondeterministic; every deterministic render in the records was manually inspected — no invented reporter, page, court, year, author, journal, edition, or DOI.

## Known limitations

- US database-only completion from bare "Name (2d Cir. 2018)" grounds docket/court/date when reporters are absent — the renderer then emits [חסר: volume/reporter/עמוד] rather than a Westlaw guess (correct per spec).
- Books with multiple real editions and no user-supplied edition leave year missing (BK2) — conservative by design.
- Very old UK reports (Entick) may ground only what evidence states.
- Snippet truncation can prevent extraction; bounded page inspection mitigates when identity is strong.

## Remaining unsupported foreign materials

C.F.R., Federal Register, legislative materials, Restatements, UCC, court rules, EU/international families — out of scope, unchanged. STOP RULE honored: no further expansion.

## Acceptance invariants

A. No guessing ✅ · B. Broad discovery survives (unit-proven B11/B12; Tier-2 path live) ✅ · C. Strict identity ✅ · D. Field-level grounding ✅ · E. One formatter ✅ · F. Local fast path preserved ✅ · G. Israeli engine preserved ✅ · H. Rule 37 preserved ✅ · I. Credits unchanged ✅

BLUEBOOK 22 MILESTONE 2B — SHIP

LOCAL FAST PATH: PRESERVED
FOREIGN LOOKUP: ACTIVE
TIER 1 DOMAINS: DISCOVERY HINTS ONLY
TIER 2 OPEN WEB: BOUNDED
OFF-LIST LEGITIMATE SOURCES: ACCEPTABLE
IDENTITY GATE: ACTIVE
FIELD-LEVEL GROUNDING: ACTIVE
DETERMINISTIC FORMATTER: SOLE FORMATTER
RULE 37: PRESERVED
ISRAELI CITATION ENGINE: PRESERVED
CREDIT COST: UNCHANGED
NEW SOURCE FAMILIES: NONE
