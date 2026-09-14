# ReLex V2 — Authority Acquisition Orchestrator

**Type:** design only. No code, prompt, budget, config, data or deployment change was made. No
evaluation was rerun. Factual basis: `reports/batch3-acquisition-inspection/REPORT.md` and the
current repository state of `supabase/functions/legal-research-v2`.

---

## 1. Design summary

The inspection showed three separable defects in the path from "I know which authority I need" to
"I have a usable body":

1. `lookup_authority` synthesises two portal/search URLs per authority (`tools/lookupAuthority.ts:46-58`)
   and nothing else. Those two URLs are 403 / connection-reset / portal-stub in practice, so for
   6 authorities (class A) and 10 more (class F) the *only* candidate that ever existed was
   unfetchable.
2. 208 raw-web candidates were discovered and 14 fetched (6.7 %). Candidates are minted into a
   global `discovered` map with a `result_id` and then drop out of the model's working context; no
   deterministic component ever re-surfaces them against the authority that motivated the search.
3. 84 % of fetch actions are re-reads of already-stored bodies. The agent, having no visible untried
   candidate, retries `find` strings on a body that already failed to yield.

The proposal is deliberately narrow: **turn the existing `AcquisitionTargetRow` from a passive note
into a small, bounded candidate queue, and give the agent one new tool that drains it.** The
orchestrator never decides *which* authority matters, never ranks domains, never fetches
autonomously outside the tool the agent calls, and never relaxes admission. Discovery stays broad;
`checkIsActualDocument` + `corroborateAuthority` + span/support verification stay exactly as they
are.

Contract:

```text
agent opens target (authority_key + expected identity)
  → deterministic layer attaches concrete candidates from every source it already has
  → agent calls acquire_authority(authority_key)
      → ≤ 3 concrete candidate fetches, stop at first corroborated body
      → each attempt goes through the UNCHANGED tools/fetch.ts pipeline
  → outcome: acquired(source_id) | exhausted(reasons) | needs_discovery(no untried candidates)
```

Bounded by construction: the queue is finite, failed URLs are never retried (the ledger already
enforces this via `dead_acquisition_path`), and the per-target attempt budget is hard.

---

## 2. Proposed state / data model

### 2.1 Reused as-is (no change)

| Existing | Role in the orchestrator |
|---|---|
| `authorityKeyOf({docket, statute, section})` | the target identity key — unchanged |
| `AcquisitionTargetRow.{authority_key, label, opened_at, candidates, abandoned, abandon_reason}` | the target record |
| `AuthorityLedgerRow.{attempts, acquired_source_id, binding_basis}` | attempt history + the "already acquired" stop condition |
| `ledger.untriedCandidates(key)` | already computes candidates whose URL has not been attempted |
| `ledger.failedUrls / attemptOn / acquired / unresolvedTargets` | never-retry and stop logic |
| `SourceReadRow.{no_yield, missing_locators, exhausted}` | re-read loop prevention (section 8) |
| `LookupCandidate.{candidate_kind, authority_key, expected_identity, result_id, local_document_id}` | concrete-vs-discovery distinction already exists on the type |
| `AcquisitionLedgerJson` + `fromJSON/toJSON` + `seedResultIds` | resume/chunk persistence, already wired |

### 2.2 Minimal additions

**a) `TargetCandidate` gains four optional fields** (`tools/acquisitionLedger.ts`):

```ts
export interface TargetCandidate {
  result_id?: string;
  url?: string;
  label?: string;
  candidate_kind?: "document" | "local_document" | "discovery_entry";
  local_document_id?: string;   // NEW — local corpus rows are fetchable without a URL
  origin?: "local_corpus" | "official_search_entry" | "search" | "raw_web" | "derived";  // NEW
  attach_basis?: string;        // NEW — why this candidate was linked to this authority
  attempted_at?: string;        // NEW — set when the orchestrator consumes it
}
```

**b) `AcquisitionTargetRow` gains three optional fields:**

```ts
  attempts_used?: number;       // concrete fetch attempts spent on this target this cycle
  cycle?: number;               // incremented when the agent re-opens after discovery
  exhausted?: boolean;          // budget spent with no corroborated body
```

**c) Two derived helpers on `AcquisitionLedger`** (pure, no I/O):

- `concreteUntried(key): TargetCandidate[]` — `untriedCandidates(key)` minus
  `candidate_kind === "discovery_entry"`, minus anything whose normalised URL appears in
  `failedUrls(key)` or in the global failed-URL set, ordered by a **fixed, non-ranking** rule:
  `local_document` → `document` (origin `search`/`raw_web`, insertion order) → `derived`.
  Insertion order is the tiebreak; there is no scoring.
- `attemptsRemaining(key): number` — `MAX_ATTEMPTS_PER_TARGET_CYCLE - (attempts_used ?? 0)`.

Nothing else is added. No new table, no new store, no parallel architecture.

---

## 3. Candidate lifecycle

### 3.1 Concrete document candidate vs discovery entry

A candidate is **concrete** when it is directly fetchable into a body:

- a `legal_documents` row (`local_document_id`), or
- an HTTP(S) URL that is not a search/portal entry.

A candidate is a **discovery entry** when fetching it cannot yield a document: `Home/Search?query=`,
`gov.il/…/legalInfo?freeText=`, `nevo.co.il/laws/#/search/…`, `LawPrimary.aspx?…lawitemid=<term>` —
i.e. exactly what `lookup_authority` synthesises today, plus anything a URL already carries as a
query-shaped search path. The classification predicate is deterministic and lives next to the
existing `classifyJudgmentUrl` / `judgmentUrlEligibility` logic; it inspects **URL shape only**
(path segment named `search`, a free-text query parameter, an SPA hash route, a bare portal root) —
**never the domain**.

**Should discovery entries remain available?** Yes, but demoted: they stay in
`target.candidates` and remain visible to the agent as *search starting points a human could use*,
and they never consume an acquisition attempt. They are excluded from `concreteUntried`. This
preserves the current lookup output shape (`lookupAuthority.ts` already labels them
`candidate_kind: "discovery_entry"`) while making it impossible for a target to be "tried" three
times against three search pages.

### 3.2 Where concrete candidates come from

| Source | How it enters the target |
|---|---|
| Local corpus (`localRecords` in `lookupAuthority.ts`) | already produced with `local_match_basis`; attaches on `openTarget` with `origin: "local_corpus"` |
| `search` results | attached when the result's identity signals match the target (section 4) |
| `raw_web_search` results | same matcher, `origin: "raw_web"` |
| URLs already discovered elsewhere (e.g. a link the agent passes to `fetch` explicitly) | when `fetch` is called with an explicit `authority_key`, that URL is recorded as an attempted candidate |
| Already-fetched bodies that corroborate the same authority | not a candidate — `fetch.ts`'s existing `authority_reuse` path already satisfies the target directly |

### 3.3 States

```text
untried ──consumed──► attempted ──► acquired      (corroborated body; target closes)
   │                        ├────► rejected_identity   (body ok, identity refused)
   │                        ├────► not_a_document      (portal stub / too short)
   │                        └────► transport_failed    (403 / reset / 404)
   └──never──► discovery_entry (never consumed)
```

Every terminal state is already an `AcquisitionAttempt.outcome` value plus `reason`. No new
vocabulary.

---

## 4. Discovery → authority linking

A discovered result becomes a candidate for authority `K` when **either**:

1. **Explicit provenance** — the search was issued while `K` was the *active target* (the agent
   passes `for_authority: K` on `search` / `raw_web_search`, or the orchestrator issued the query
   itself during targeted discovery). This is the primary path and needs no text matching.
2. **Identity match on discovery metadata** — deterministic, domain-blind:
   - **case targets:** the result's `possible_docket` (already computed by `detectDockets` in
     `rawWebSearch.ts:129`) normalises equal to the target docket, **or** the docket appears in the
     title/snippet in a `detectDockets`-recognised form.
   - **statute targets:** the statute's core name (existing `statute name` normalisation used by
     `corroborateAuthority`) appears in the title or snippet; if the target carries a section, a
     section variant from `buildSectionVariants` in the title/snippet is a *bonus*, never a
     requirement — the parent law is a perfectly good candidate for a section target (section 6).

Anything matching neither rule stays a global discovery result and is **not** attached — an
unrelated article that happens to cite a docket in passing will attach by rule 2 and then be
rejected at the unchanged identity gate, which is the correct division of labour: attachment is
cheap and reversible, admission is strict.

Attachment records `attach_basis` (`"explicit:for_authority"`, `"docket_in_title"`,
`"statute_name_in_snippet"`, `"local_case_number_exact"`, …) purely for telemetry and tests.

---

## 5. Bounded candidate execution

### 5.1 The new tool

`acquire_authority({ authority_key, max_attempts? })` — one new tool in
`agent/researchAgent.ts`, callable only for a target the agent already opened via
`lookup_authority` (or opened implicitly by this call with the same identity input).

Deterministic loop:

```text
1. if ledger.acquired(key)                → return {status:"already_acquired", source_id}
2. if target.abandoned || target.exhausted→ return {status:"exhausted", attempts}
3. queue = ledger.concreteUntried(key)
4. if queue empty                         → return {status:"needs_discovery", discovery_entries, hint}
5. for c of queue.slice(0, min(max_attempts ?? 3, attemptsRemaining(key))):
      result = runFetch(c)                 // UNCHANGED tools/fetch.ts
      attempts_used += 1; c.attempted_at = now
      if result corroborated identity      → return {status:"acquired", source_id, attempts}
6. mark target.exhausted = true
   return {status:"exhausted", per_candidate_reasons}
```

### 5.2 Limits

| Limit | Value | Rationale |
|---|---|---|
| `MAX_ATTEMPTS_PER_TARGET_CYCLE` | **3** | matches the requested 2–3; enough for official → mirror → local |
| `MAX_CYCLES_PER_TARGET` | **2** | one initial drain + one drain after targeted discovery; then permanently exhausted |
| Hard ceiling per target | **6 concrete fetches** | 3 × 2, unconditional |
| `MAX_CANDIDATES_EXPOSED` | **4** | how many untried candidates are ever shown in a tool result |
| Run-wide orchestrated fetches | counted in the existing `StopPolicy` fetch budget — **no new budget** |

**What counts as an attempt:** exactly one HTTP/local fetch that reaches `officialFetch` or the
local-corpus lane. These do **not** count: serving a URL already in the EvidenceStore, an
`already_read` hit, a `dead_acquisition_path` short-circuit, consuming a discovery entry (impossible
by construction), or `unsafe_url_blocked` (rejected before the network — it removes the candidate
and moves to the next one without spending the attempt).

**Immediate stop:** a corroborated body (`identity_corroborated === true`). Also immediate stop —
without spending the remaining budget — if `fetch` returns `authority_reuse`, i.e. an already-stored
body satisfies this key.

**Candidate rejection (removed from the queue, does not close the target):** unsafe URL,
already-failed URL, discovery-entry shape, duplicate normalised URL, and — after the attempt —
any non-`acquired` outcome.

**Targeted discovery** is allowed only when `status: "needs_discovery"` was returned, i.e. the
concrete queue is empty. The agent then issues a `search`/`raw_web_search` with `for_authority` set;
results attach by rule 1 of section 4; the target's `cycle` increments and a second drain is
permitted. Discovery is never issued while ≥1 concrete untried candidate exists — that is the
deterministic answer to "do not repeatedly search once enough untried candidates already exist".

**Exhausted** = `attempts_used` hit the ceiling with no corroborated body, or `cycle` reached
`MAX_CYCLES_PER_TARGET` with an empty queue. An exhausted target is reported to the agent once, is
excluded from the memo gate (section 9), and flows into `unresolved_authorities` exactly as today.

---

## 6. Court relay — concrete documents only

The relay must not become "route all court URLs". The orchestrator classifies a court URL into four
shapes, by **URL form only**, reusing `vendor/judgmentUrlEligibility.ts` and
`classifyJudgmentUrl`:

| Shape | Example | Orchestrator treatment |
|---|---|---|
| **Concrete court document** | `supremedecisions.court.gov.il/Home/Download?…type=2/4` with a real file id | concrete candidate; **eligible** for a relay slot |
| **Court search page** | `/Home/Search?query=…` | discovery entry; never fetched, never relayed |
| **Guessed / derived URL** | produced by a URL pattern guess (`classifyJudgmentUrl(...).guessed_pattern === true`) | concrete candidate of last position in the queue; **not** relay-eligible — `relayGate()`'s existing refusal is preserved |
| **Discovered concrete document** | a court/mirror document URL that came from a real search result (origin `search`/`raw_web`, not guessed) | concrete candidate; relay-eligible on the same terms as the official download |

The single change in behaviour is that the relay stops being starved by search-page URLs, because
search-page URLs stop being fetched at all. `relayGate()`, `isSafeFetchUrl`, redirect re-checking,
size ceilings and the block-page detector are untouched. No security control is weakened or bypassed.

---

## 7. Statutes

Two rules, neither of which hardcodes any statute.

### 7.1 Section targets are satisfiable from the parent body

`authorityKeyOf` already produces `statute:<name>` and `statute:<name>#<section>`. Add a derived
resolution step in the orchestrator (not in the verifier):

```text
target = statute:חוק הירושה#20
  parent_key = statute:חוק הירושה
  if ledger.acquired(parent_key) → body = EvidenceStore body of that source
     locateSection(body, "20")                      // evidence/sectionLocator.ts, unchanged
     found  → satisfy target:  ledger.note(target, {outcome:"acquired",
                 reason:"section_located_in_parent_body", identity_corroborated:true},
                 parent_source_id)
     absent → record sectionMissingInstruction(...) as a no-yield read on that source
              (ledger.noteRead) and continue with the normal candidate queue
```

This is the fix for the sharpest finding in the inspection: Q23 held the full חוק הירושה from
wikisource while `#20` and `#25` stayed unresolved, and Q29 held the full licensing law while
telling the user §7ג was unverifiable. `locateSection` is already deterministic, already bounded, and
already returns coverage bounds for the "absent" case — no new logic is needed, only the wiring.

**Crucially, the section must be *located*, not assumed.** `locateSection(...).found === false`
never satisfies the target (test case in section 11). `truncated` bodies that do not contain the
section are treated as "absent", not "unknown".

### 7.2 Statute discovery entries

`nevo.co.il/laws/#/search/<term>` and `LawPrimary.aspx?…lawitemid=<term>` are classified as
discovery entries by the section-3.1 predicate (SPA hash route; free-text query parameter). They stop
consuming attempts. For a statute target with an empty concrete queue the orchestrator returns
`needs_discovery` with the statute name + section as the suggested query context; the agent's
`search`/`raw_web_search` supplies real consolidated-text candidates, which attach by rule 2. No
statute-specific resolver, no source tier, no domain list.

**Worked shape for `חוק החוזים (חלק כללי), סעיף 13`:** parent `statute:חוק החוזים (חלק כללי)` is
opened alongside the section target; if the parent is ever acquired, §13 resolves from it; if not,
the section target drains its own concrete queue under the same 3-attempt bound.

---

## 8. Raw-web candidate handoff

Goal: candidates stay available without pushing 30 URLs into the prompt.

- **Server-side retention** — raw results already persist for the whole run in the `discovered` map
  with durable `result_id`s (`tools/resultIds.ts`, re-seeded on resume). Nothing new to store.
- **Attachment at discovery time** — when `raw_web_search` runs with `for_authority` set, or a
  result matches an open target by rule 2, the result is appended to that target's `candidates`
  immediately. This is the whole handoff: the candidate is now owned by the target rather than by a
  transient tool message.
- **Compact exposure** — tool results and the per-step state block expose at most
  `MAX_CANDIDATES_EXPOSED = 4` untried concrete candidates **for unresolved targets only**, each as
  `{result_id, short title (≤80 chars), host, origin}`. That is ≈4 lines per unresolved authority,
  bounded and stable, versus the current full result lists.
- **No memory requirement on the model** — the agent never has to recall a search from 12 turns ago:
  `acquire_authority` drains the queue server-side, and the compact list is re-derived from the
  ledger on every step, surviving compaction and chunk resume.

---

## 9. Re-read behaviour

Targeted re-reading stays allowed and unchanged in mechanism. One deterministic nudge, built purely
on existing ledger concepts:

```text
when fetch is called with {source_id, find/section} and
     ledger.readState(source_id).exhausted === true            // NO_YIELD_EXHAUSTION_THRESHOLD = 3
  or ledger.knownMissingLocator(source_id, locator) === true
and some unresolved target has ≥1 concrete untried candidate
  → the read still executes (never blocked),
    but the result carries a deterministic note:
    "מקור <S> כבר מוצה עבור <locator>. קיימים מועמדים שלא נוסו עבור <authority_key>: R12, R31."
```

The `already_read_noop` suppression that exists today remains the hard stop for literal repeats.
This is a message, not a ranking engine: no scoring, no forced ordering, no new policy object. The
84 %-re-read pathology is addressed mainly by making an alternative *visible and one call away*,
which it currently is not.

---

## 10. Memo interaction — options compared

Precondition check before `submit_research_memo` (deterministic, cheap):

```text
blocking = exists target T where:
      T is open (not abandoned, not exhausted)
  AND T is central (the agent marked it central, or it backs a core claim in the memo)
  AND !ledger.acquired(T.key)
  AND ledger.concreteUntried(T.key).length > 0
  AND ledger.attemptsRemaining(T.key) > 0
```

| Option | Behaviour | Pros | Cons |
|---|---|---|---|
| **A — block once** | reject the memo one time per run with the candidate list; agent decides | keeps the agent in control; agent can abandon the target explicitly; cheap | costs a model round-trip; agent may just resubmit |
| **B — auto-attempt** | orchestrator silently drains ≤1 candidate, then accepts the memo | zero extra model calls; deterministic | evidence can appear after drafting started; the memo may not reflect it; hidden work |
| **C — hybrid (recommended)** | **auto-attempt one candidate** for the single highest-value blocking target, and **if it acquires a body, reject the memo once** with "a new body was acquired for K — incorporate or abandon"; if it fails, accept the memo | only pays a round-trip when it actually produced something; never silently discards new evidence; strictly bounded | slightly more logic than A |

**Recommendation: C.** Infinite-loop safety: the gate fires **at most once per run**
(`memo_gate_fired` flag on the ledger), only for one target, and only spends attempts inside the
existing per-target ceiling. If the gate has fired, the memo is always accepted.

---

## 11. Test plan (deterministic, no network)

New file `src/test/acquisitionOrchestrator.test.ts` (Vitest, fake fetch impl, in-memory ledger),
plus additions to `src/test/statuteSectionAcquisition.test.ts`.

| # | Test | Expectation |
|---|---|---|
| 1 | first candidate corroborates | 1 attempt, `status:"acquired"`, no second fetch issued |
| 2 | first candidate 403, second corroborates | 2 attempts, acquired, order = queue order |
| 3 | previously failed URL present in candidate list | never fetched; `dead_acquisition_path` not even reached |
| 4 | 4 concrete candidates all fail | exactly 3 attempts, `status:"exhausted"`, `target.exhausted === true` |
| 5 | raw result with matching docket in title | attached, `attach_basis:"docket_in_title"` |
| 6 | raw result about an unrelated topic | not attached |
| 7 | queue = [search-page URL, concrete doc URL] | search-page never fetched; concrete fetched first |
| 8 | parent statute body in store + section target | `locateSection` hit → target satisfied with parent `source_id`, **0 fetches** |
| 9 | parent statute body lacks the section | target NOT satisfied; `noteRead` no-yield recorded; queue still drained |
| 10 | source exhausted (3 no-yield) + untried candidate | re-read executes and the result carries the alternative-candidate note |
| 11 | target already `acquired_source_id` | `acquire_authority` returns `already_acquired`, 0 fetches |
| 12 | memo submission with viable untried candidate | gate fires once, one attempt, memo rejected only if that attempt acquired |
| 13 | memo submission after target exhausted | memo accepted, no gate |
| 14 | `toJSON` → `fromJSON` round trip mid-drain | `attempts_used`, `cycle`, `attempted_at`, candidate list all preserved |
| 15 | unsafe URL candidate | dropped pre-network, attempt **not** counted, next candidate tried |
| 16 | corroboration/verification invariants | identity gate, `checkIsActualDocument`, span/support verification produce byte-identical results for the same body (regression guard against admission weakening) |
| 17 | guessed court URL | concrete but last in queue and **not** relay-eligible |
| 18 | discovery only after empty queue | with a concrete untried candidate present, `acquire_authority` never returns `needs_discovery` |

Existing suites that must stay green unchanged: `rawWebSearch.test.ts`,
`authorityCorroborationSelfIdentity.test.ts`, `statuteSectionAcquisition.test.ts`,
`resultIdDurability.test.ts`, `legalResearchV2.*`.

---

## 12. Exact files to change

| File | Change | Size |
|---|---|---|
| `tools/acquisitionLedger.ts` | 4 optional `TargetCandidate` fields, 3 optional `AcquisitionTargetRow` fields, `concreteUntried`, `attemptsRemaining`, `noteAttemptConsumed`, `markExhausted`, memo-gate flag | ~90 lines |
| `tools/acquisitionOrchestrator.ts` | **new** — candidate classification (concrete vs discovery entry), attachment matcher, the bounded drain loop, statute parent-body resolution | ~200 lines |
| `tools/lookupAuthority.ts` | tag synthesised URLs as discovery entries (already partly done), pass `origin`/`local_document_id` into the opened target | ~20 lines |
| `tools/rawWebSearch.ts` | accept optional `for_authority` and pass it through on results (no behavioural change to the search itself) | ~10 lines |
| `tools/search.ts` | same optional `for_authority` passthrough | ~10 lines |
| `agent/researchAgent.ts` | register `acquire_authority`; attach discovery results to open targets; compact untried-candidate exposure; memo gate (option C) | ~120 lines |
| `tools/fetch.ts` | accept an orchestrator-supplied `authority_key` + attempt accounting callback; emit the re-read note from §9. **No change to safety, extraction, identity or admission.** | ~30 lines |
| `agent/prompt.ts` | describe `acquire_authority` and the queue semantics | ~15 lines |
| `types.ts` + telemetry in `index.ts` | `orchestrated_attempts`, `targets_acquired`, `targets_exhausted`, `candidates_attached`, `section_from_parent_hits`, `memo_gate_fired` | ~20 lines |
| `src/test/acquisitionOrchestrator.test.ts` | new suite (18 cases) | ~350 lines |

Untouched by design: `EvidenceStore`, `verification/*`, `drafting/*`, `sources/*`,
`vendor/judgmentBodyForm.ts`, `shared/urlSafety.ts`, `vendor/courtEgress.ts`, `agent/stopPolicy.ts`
(no new budget), `data/canonicalAuthorities.ts`.

---

## 13. Scenario walk-throughs

**A — Q18 style (חוק החוזים §13).** `lookup_authority` opens
`statute:חוק החוזים (חלק כללי)#13`; its two synthesised URLs are classified as discovery entries, so
the concrete queue is empty → `needs_discovery`. The agent runs one `raw_web_search` with
`for_authority` set; 8 results, 3 carry the statute name in title/snippet → attached as concrete
candidates. `acquire_authority` fetches ≤3 of them, stopping at the first body whose own text
corroborates the statute name (the fs.knesset bill PDF still fails
`statute_title_absent_from_body` and simply advances the queue). If a consolidated-text copy
corroborates, `locateSection(body, "13")` resolves the section from that same body — one HTTP fetch
total, versus the two portal stubs and zero usable bodies observed.

**B — Q22 style (30 raw results, several precedents).** Each precedent has its own target. A raw
result attaches only to the target whose docket it carries, so the 30 results distribute into small
per-authority queues; results matching nothing stay unattached. Each target drains ≤3 candidates and
stops on the first corroborated judgment. Upper bound for two precedents: **6 fetches**, versus the
0-of-30 actually fetched.

**C — Q23 style (חוק הירושה §20 and §25).** The full law is already acquired under
`statute:חוק הירושה`. Both section targets resolve via §7.1: `locateSection(body,"20")` and
`("25")` hit, both targets are satisfied with the parent `source_id`, **zero fetches**, and the nevo
404 never happens.

**D — good existing answer.** First concrete candidate corroborates → `status:"acquired"` on attempt
1, queue abandoned, no discovery issued, no additional search. The mechanism is invisible on the
happy path; its only cost there is one bookkeeping write.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Over-fetching (6 fetches/target × many targets) | hard per-target ceiling, `acquire_authority` is agent-invoked (except the one memo-gate attempt), and all fetches count against the existing run-wide fetch budget |
| Wrong candidate attached to a target | attachment is not admission — the unchanged identity gate rejects it, costing one attempt; `attach_basis` makes this auditable |
| Known PDF self-identity false negatives (1715/97, 7052/03) burn attempts | out of scope by instruction; the effect is bounded (≤3 attempts) and strictly better than today's unbounded re-read loop |
| Discovery-entry predicate misclassifies a real document URL as a search page | URL-shape rules only, covered by tests; misclassification demotes, never deletes — the agent can still fetch the URL directly |
| Resume/chunk state divergence | all new fields live inside `AcquisitionLedgerJson`, which is already serialised and restored |
| Agent ignores the new tool | the memo gate (option C) guarantees at least one orchestrated attempt per run where a viable candidate exists |

---

## 15. Why this is smaller and better than the alternatives

- **vs. "fetch every search result":** a bounded per-authority queue caps work at 3 attempts and
  stops on success; the naive version would multiply the 208-candidate pool by the fetch cost.
- **vs. source tiers / domain rankings:** no ranking table to maintain, no tier to be wrong about;
  ordering is local-first then insertion order, and correctness still comes from body corroboration.
- **vs. hardcoding authorities or bulk ingestion:** no data to curate or go stale; works for
  authorities nobody anticipated.
- **vs. a prompt-only fix:** the inspection shows the model already receives `ledger.advice()` text
  and does not act on it. Determinism, not persuasion, is what closes the handoff.
- **vs. a new agent architecture:** this is one new tool, one new module and optional fields on an
  existing serialised structure. The agent still chooses which authorities matter and when to stop.

---

## 16. Recommended implementation sequence

1. Ledger fields + `concreteUntried` / `attemptsRemaining` + serialisation tests (no behaviour change).
2. Candidate classification (concrete vs discovery entry) + attachment matcher + their tests.
3. `tools/acquisitionOrchestrator.ts` drain loop against a fake fetch impl — tests 1–4, 7, 11, 15, 18.
4. Statute parent-body section resolution — tests 8, 9.
5. Wire `acquire_authority` into `researchAgent.ts` + prompt + telemetry.
6. Raw/search `for_authority` passthrough + compact candidate exposure — tests 5, 6.
7. Re-read note — test 10.
8. Memo gate, option C — tests 12, 13.
9. Full suite + `deno check`, then a two-question smoke (Q18 + Q23 shapes) before any batch rerun.

Steps 1–4 are independently shippable and inert until step 5.

---

ACQUISITION ORCHESTRATOR DESIGN READY — AWAITING REVIEW

NO CODE CHANGED.
