# Verified Research Synthesis Handoff — Final Acceptance Report

## 1. Old (lossy) architecture

Research Agent → flat `ResearchMemo.claims[]` → verification → flat
`VerifiedEvidencePack` → `runDrafter()`. Everything the agent learned about
structure — dimensions of the issue, which source is primary law vs
scholarship, who disagrees with whom, chronological development, comparative
contrasts — was discarded at the memo boundary. The drafter behaved as a
claim-to-prose converter.

## 2. New schema (`types.ts`)

`ResearchSynthesis` (optional on `ResearchMemo`):
- `sections[] { heading, purpose?, claim_ids[] }`
- `source_roles[] { source_id, role, claim_ids[] }` — role ∈ primary_authority,
  scholarship_position, critique, historical_context, comparative_material,
  factual_context, user_document, other
- `relationships[] { kind, relationship_claim_id, related_claim_ids[] }` —
  kind ∈ agreement, disagreement, development, contrast, qualification, application

`VerifiedResearchSynthesis` is the projection of that structure onto the final
pack. Legacy memos (and resumed state) without the field work unchanged.

**Invariant — synthesis is not evidence.** A relationship may not carry a
substantive statement; the statement must exist as an ordinary evidence-backed
claim and the relationship points at it via `relationship_claim_id`. If that
claim fails verification, the relationship disappears.

## 3. Agent instructions (`agent/prompt.ts`)

`MEMO_TOOL` gained the optional `research_synthesis` object (bounded enums).
The system prompt now states: the memo is a handoff to a separate writer;
preserve the organization of the verified research; narrow questions may carry
minimal or no synthesis; never fabricate sections/relationships to fill fields;
synthesis may not introduce substantive propositions; prefer named scholarly
attribution ("X טוען כי…") when a readable academic source identifies the
author, never invent names. No genre classifier, no quotas, no modes.

## 4. Normalization (`drafting/synthesis.ts`, used by `normalizeMemo`)

Optional, fail-soft (`try/catch` — malformed synthesis degrades to `undefined`,
never crashes a run): trims strings, dedupes ids, bounds counts
(12 sections / 40 roles / 24 relationships / 24 claim refs) and lengths
(heading 120, purpose 240), coerces unknown roles to `other`, drops unknown
relationship kinds, removes duplicate roles/relationships. Claim normalization
untouched.

## 5. Verified projection

`projectVerifiedSynthesis(memo.research_synthesis, finalPack)`:
- sections keep only claim ids alive in the final pack; empty sections dropped
- source roles kept only for sources appearing in surviving verified claims;
  their claim refs filtered the same way
- relationships kept only when `relationship_claim_id` survives **and** at
  least one related claim survives
- returns `claim_refs_dropped` / `source_refs_dropped`

It runs in `index.ts` **after** verification, accepted repair, the temporal
gate and provenance annotation, immediately before `runDrafter` — never stale.

**Repair pairing:** accepted repairs replace `agent` wholesale
(`agent = { ...repaired, trace: [...] }`), so `agent.memo` is always the
accepted memo and its synthesis; a rejected repair leaves the original memo and
original synthesis. Mixing is structurally impossible.

## 6. Drafter input — before / after

Before: question + verified claims/sources + gap notices + advisories.
After: the same, plus one compact organizational block ("מבנה המחקר המאומת —
ארגון בלבד, אינו ראיה"). Chain-of-thought isolation preserved: no agent
messages, tool trace, search queries, rejected candidates, discovery snippets,
failed fetches or unverified propositions are ever included (asserted by test).

Drafter system prompt additions: use the structure to understand the
intellectual shape; reorganize freely; no mechanical reproduction of sections;
no gratuitous headings for narrow questions; don't flatten disagreement /
development / comparison; named attribution over "בספרות נטען" when verified;
comparative answers organized by dimension; chronology preserved only when
verified; prefer separate blocks where support sets materially differ.

**Drafter model: unchanged.**

## 7. Telemetry (evaluation only, never quotas)

`memo_synthesis_sections|relationships|source_roles`,
`verified_synthesis_sections|relationships`,
`synthesis_claim_refs_dropped`, `synthesis_source_refs_dropped`,
`verified_sources_available_to_drafter`, `verified_sources_cited`.

## 8. Tests

`src/test/researchSynthesisHandoff.test.ts` (12): normalization tolerance and
bounding; A rejected claim drops from a section; A2 empty section dropped;
B rejected relationship claim removes the relationship; B2 survival case;
C unknown source role dropped; D temporal-gate removal cannot survive;
G legacy memo → null projection; isolation (verified content present, agent
trace / unverified ids absent); legacy call-site parity.
Repair cases E/F hold structurally (accepted repair replaces the memo wholesale).

Full suite: **83 files / 984 tests passed**. `tsgo --noEmit`: clean.
Deployed: `legal-research-v2`. No V1 changes.

## 9. Live acceptance (deployed V2, sequential, one run each)

| Run | Steps | Verified claims | Sources avail / cited | memo sec/rel/roles | verified sec/rel | refs dropped (claim/src) | Latency |
|---|---|---|---|---|---|---|---|
| L1 scholarly disagreement | 19 | 6 | 3 / 3 | 4/4/4 | 4/4 | 0 / 1 | 249 s |
| L2 literature review | 8 | 5 | 4 / 4 | 3/3/5 | 3/2 | 2 / 1 | 121 s |
| L3 reasonableness vs proportionality | — | — | — | — | — | — | **timed_out** |
| L4 good-faith evolution | — | — | — | — | — | — | **timed_out** |
| C1 comparative IL/UK | 14 | 5 | 2 / 2 | 2/2/2 | 2/2 | 0 / 0 | 154 s |
| N1 narrow statute | 4 | 2 | 1 / 1 | 1/0/1 | 1/0 | 0 / 0 | 30 s |

Interpretation:
- Useful synthesis was produced in every completed broad run and survived
  projection correctly; drops (L2: 2 claim refs, 1 source ref; L1: 1 source
  ref) are exactly the references to material that did not survive verification
   — the fail-closed path working.
- L1 named positions (דותן, ברק-ארז) rather than anonymous "בספרות נטען";
  the disagreement is explained as a disagreement, not two unrelated paragraphs.
- C1 organizes around the comparative dimension; primary law and scholarship
  are distinguished.
- **N1 stayed direct and compact** (405 chars, one heading, 30 s, 4 steps) —
  the richer handoff did not turn narrow answers into seminar papers.
- Pack utilization: every completed run cited 100% of the distinct verified
  sources available to the drafter.

Anonymous-attribution audit: none of the completed answers used
"בספרות נטען" / "חוקרים טוענים" / "המחקר סבור" / "הכתיבה האקדמית" as a
substitute for an available verified attribution.

## 10. Risks / open items

- **Long-run timeouts (pre-existing, not introduced here):** L3 and L4 ended
  `timed_out` during the reading phase, before the drafter and before any
  synthesis code runs. The job table shows timeouts on 2026-09-08 (7),
  09-10, 09-13 on earlier builds. Tracked separately as the known long-run
  stall issue; not a synthesis regression.
- Synthesis quality is model-dependent; there is no floor and no quota by design.
- L1's opening heading was a full sentence — cosmetic drafter style, not a
  handoff defect.

RESEARCH → DRAFTER SYNTHESIS HANDOFF — SHIP

DRAFTER RECEIVES VERIFIED RESEARCH STRUCTURE: YES

RAW AGENT REASONING / TOOL TRACE EXPOSED TO DRAFTER: NO

VERIFIED CLAIMS REMAIN THE ONLY SUBSTANTIVE WRITING BASIS

DRAFTER MODEL: UNCHANGED
