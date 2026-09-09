# v2_acquisition_ledger_wrong_authority_binding_forensic_audit_v1

READ-ONLY. No code, prompt, model, verifier, fetch, ledger or deployment change. No rerun.

Job `19e7e428-880e-4a63-94ad-0bcca47b8d08` / run `6bfc981e-f0b0-442b-87b9-a3109be4d6f1`.
Evidence: persisted `result.debug.telemetry.acquisition_ledger`, `source_funnel`, `agent_turns`;
code `tools/fetch.ts`, `tools/acquisitionLedger.ts`, `tools/lookupAuthority.ts`, `verification/verify.ts`.

## 1. Ledger chronology for the statute authority

| time (UTC) | key | url | source | outcome | ledger write |
|---|---|---|---|---|---|
| 23:14:11.889 | `statute:חוק יחסי ממון בין בני זוג, התשל"ג-1973#5` | nevo `/laws/#/search/...סעיף 5` (lookup_authority official-search entry) | S1 | failed `too_short_for_a_document` | attempt row |
| 23:14:34.359 | `statute:חוק יחסי ממון בין בני זוג, תשל"ג-1973` (no ה prefix) | `fs.knesset.gov.il/7/law/7_lsr_208084.PDF` | S4 | **acquired** | `acquired_source_id=S4` |
| 23:14:34.481 | `statute:...(תיקון מס' 4), התשס"ט-2008` | `fs.knesset.gov.il/17/law/17_lsr_300050.pdf` | S5 | **acquired** | `acquired_source_id=S5` |
| 23:14:34.806 | `statute:חוק יחסי ממון בין בני זוג, התשל"ג-1973` | `www.nevo.co.il/law_html/law01/289_001.htm` | S6 | **acquired**, reason `body_read_with_matching_identity` | `acquired_source_id=S6` ← **wrong binding created here** |
| step 10 (chunk 2) | same key | corpus/Wikisource consolidated copy | — | never fetched, never appended to store (absent from `source_funnel`) | none — served `already_read S6` via `authority_reuse` |

Telemetry corroboration: `authority_reacquisitions_prevented: 2`, `already_read_actions: 24`.

## 2. What the ledger key represents

`authorityKeyOf({docket, statute, section})` (acquisitionLedger.ts:56) builds
`statute:<verbatim statute string><#section>` from the **agent's `expected_identity`** — i.e. **A: what the agent REQUESTED**, with a fraction of B (search/lookup metadata is what the agent copies into the request).
It is not C: nothing about the fetched body enters the key. Verbatim string keying also means
`תשל"ג-1973` and `התשל"ג-1973` are two distinct authorities (rows 2 and 4 above), so the genuine
Knesset original did not occupy the key the agent later used.

Identity layers, distinct and unlinked:
- URL identity — `normalizeUrlKey` dedupe in the evidence store.
- source_id identity — evidence store record.
- authority-key identity — requested-label string only.
- requested authority — `expected_identity`.
- fetched-document identity — `entry.identity_fields` extracted from the body; consulted for dockets only.

## 3. When is authority binding created?

`tools/fetch.ts` (~line 543), immediately after extraction and before anything else:

```
acquired = entry.is_actual_document && identityMatched
ledger.note(authorityKey, {outcome: acquired ? "acquired" : ...}, acquired ? entry.source_id : undefined)
```
`identityMatched` is initialised `true` and is only recomputed when `expected_identity.docket` is present.
**For statutes there is no identity test at all.** Binding therefore happens:
after fetch success and after the readable-body check, but **before** any document-identity check,
before verifier `checkIdentity`, and before memo submission.

## 4. The wrong Nevo document

- Discovered/constructed as a statute candidate and fetched with `expected_identity.statute = "חוק יחסי ממון בין בני זוג, התשל\"ג-1973"`.
- Body fetched fine: title `חוק מרשם האוכלוסין, תשכ"ה-1965` — a different law.
- `is_actual_document = true`, no docket expected → `identityMatched = true` → outcome `acquired`, reason `body_read_with_matching_identity` (the reason string is false on its face).
- Never submitted as evidence: `source_funnel` S6 shows `identity_basis: "not_submitted_as_evidence"`, `identity_verified:false`, `cited:false`.
- Mismatch detected nowhere in the run.

Origin of the defect: **ledger binding semantics**, not search metadata, not fetch, not lookup.

## 5. The correct Wikisource/corpus copy

The corpus lane (post-ranking-fix) surfaced `חוק יחסי ממון בין בני זוג`
(document `c82414f9-16b5-42a0-954d-54d4308d909a`). At step 10 the agent issued a fetch for it with the
same `expected_identity.statute`. Control never reached HTTP: the `authority_reuse` branch fired
because `ledger.get(key).acquired_source_id = S6` and `normalizeUrlKey(S6.url) !== normalizeUrlKey(candidate)`,
returning `alreadyReadPayload(store, S6)` with the instruction "האסמכתה כבר הובאה ואומתה זהותית (S6)…".
No source row exists for it in `source_funnel`, confirming no append and no read.
So yes: the correct statute was suppressed **solely** because the key was already occupied.

## 6. Does verifier identity protect the ledger?

No. `verify.ts` runs only over memo-submitted evidence pairs and its default verdict is
`"no explicit identity claim to contradict"`. Consequences:
- authority-level dedupe happens with zero verifier involvement;
- a mismatched source can and did poison authority reuse;
- there is no correction path — the ledger exposes `note`/`noteRead` only, no invalidate/rebind;
- rows record `attempted` vs `acquired`, but "acquired" means "readable body arrived", not "verified to be this authority".

## 7. Generality

Systemic. The same code path serves statutes and cases; only the docket branch offers protection, and
that branch checks a number substring, not the authority. Any named authority whose first readable
candidate is the wrong document permanently occupies its key for the run and suppresses every later
correct candidate. Statutes are strictly worse: zero identity gate.

## 8. Relation to `lookup_authority`

`lookup_authority` produced the dead nevo search-entry URL bound at 23:14:11 (`#5` key) — bad candidate
production, and a known separate defect. It did **not** produce the poisoning binding: S6 came in as a
normal statute candidate. Even with perfect candidates the ledger remains vulnerable, because
"first readable body wins the key" is unconditional.

## OUTPUT

1. **Exact event:** `ledger.note(...)` in `tools/fetch.ts` at 23:14:34.806Z, binding
   `statute:חוק יחסי ממון בין בני זוג, התשל"ג-1973 → S6 (nevo law01/289_001.htm)`.
2. **Why equivalent:** the key is the requested label; `acquired` required only
   `is_actual_document && identityMatched`, and `identityMatched` is vacuously true without an expected docket.
3. **Before identity verification:** yes — before any body-identity check and before the verifier.
4. **Why the correct source was suppressed:** the `authority_reuse` short-circuit in `runFetch` returned
   S6's cached payload instead of fetching the corpus copy.
5. **Verifier chance:** none — S6 was never submitted as evidence, and verifier identity never flows back.
6. **Systemic**, not statute-specific (statutes are the unguarded worst case).
7. **`lookup_authority` is one producer of bad candidates, not the root cause.**
8. **Narrowest component to change:** the "acquired" decision in `tools/fetch.ts` — a body may bind an
   authority key only when the body's own identity corroborates the requested authority
   (docket for cases, statute title for statutes); otherwise record the attempt without `acquired_source_id`.
9. **Invariant to preserve:** authority-level reuse may suppress a later candidate only when the bound body
   was positively identified as that authority; unproven bindings must never suppress a fetch. Verifier
   strictness, span/support/temporal rules and evidence semantics stay unchanged.
10. **Do NOT change:** verifier and its checks, span/support/temporal logic, models, budgets, prompts,
    drafter, Academic Writing Guide, V1, routing, corpus ranking, `lookup_authority`, URL dedupe,
    no-yield advisory behaviour; do not add legislation modes, quotas or source blocking.
