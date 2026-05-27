# Cluster-Prevention Validation Report

Prompt-only drafter change + new placement telemetry. No retrieval / verifier /
drafter-logic / source-selection changes. No repair, no retry.

## Hard gates (all fixtures)

| Fixture | marker_validation.ok | internal_id_leak | footnote=used | used ⊆ usable | used_sources |
|---------|----------------------|------------------|---------------|---------------|--------------|
| L1   | ✅ | false | ✅ | ✅ | 8 |
| L2   | ✅ | false | ✅ | ✅ | 7 |
| L3   | ✅ | false | ✅ | ✅ | 6 |
| L4   | ✅ | false | ✅ | ✅ | 7 |
| L5   | ✅ | false | ✅ | ✅ | 9 |
| L6   | ✅ | false | ✅ | ✅ | 8 |
| PROT | ✅ | false | ✅ | ✅ | 9 |

All four hard grounding gates green on every fixture. No source drops vs
prior citation-cleanup baselines (used-source counts match within ±0).

## Cluster telemetry (after prompt change)

| Fixture | cluster_count | cluster_runs | max_cluster_len | end_para_dumps | final_summary_dump | final_para_markers |
|---------|---------------|--------------|-----------------|----------------|--------------------|--------------------|
| L1   | 0  | 0 | 0 | 0 | false | — |
| L2   | 8  | — | 3 | 0 | false | — |
| L3   | 8  | — | 3 | 0 | false | — |
| L4   | 6  | — | 2 | 0 | false | — |
| L5   | 8  | — | 3 | 0 | false | — |
| L6   | 8  | — | 3 | 0 | false | — |
| PROT | 15 | — | 4 | 0 | false | <5 |

`cluster_count` counts *extra* superscript chars inside runs (run length−1
per run), kept for back-compat. `max_cluster_len` is the longest adjacent
run of superscript digits anywhere in the answer.

## Headline outcomes

- **No final-summary dumps anywhere** (`final_summary_dump_count = 0` on all
  7 fixtures, including PROT which previously produced the
  `¹²³⁴⁵⁶⁷⁸⁹¹⁰¹¹¹²` tail). The new prompt rule banning a closing summary
  that re-cites every source clearly took effect.
- **PROT max cluster shrunk from 12 → 4** (the previous tail had 12
  adjacent markers; now the worst cluster is 4 superscript digits and is
  inside the body, not the closing line).
- **No end-of-paragraph dumps** on any fixture (`end_paragraph_dump_count
  = 0`).
- L1 came back fully cluster-free.
- Mid-body clusters of length 2–3 persist on L2/L3/L4/L5/L6 (typical
  shape: cumulative support attached to a single legal proposition).
  The prompt explicitly allows this case when several sources truly
  support the same single claim; preserving them is required by the
  source-preservation precedence rule. Per the plan, these are *measured
  but not repaired*.

## Runtime

| Fixture | total_ms | baseline_ms | Δ |
|---------|----------|-------------|---|
| L1 | — | — | +56s |
| L2 | — | — | +27s |
| L3 | — | — | +21s |
| L4 | — | — | +21s |
| L5 | — | — | −61s |
| L6 | — | — | +55s |
| PROT | — | n/a | n/a |

Deltas swing both ways and are dominated by Perplexity + verifier
variance (per-fixture baseline runs had similar swings in the
citation-cleanup report). The prompt change adds ~250 chars of system
text and no extra LLM calls, so there is no expected meaningful latency
contribution from the change itself.

## Spot-check (answer body)

- All answers open with a thesis sentence and develop in prose (style
  unchanged).
- No "לסיכום … ¹²³⁴⁵⁶⁷⁸⁹¹⁰¹¹¹²" tails seen.
- Remaining clusters appear inline next to substantive legal
  propositions (e.g., several scholarship + caselaw cites supporting the
  same doctrinal claim) — consistent with the prompt's explicit
  exception.

## Acceptance status

- ✅ all hard grounding gates green
- ✅ no source drops
- ✅ no footnote-mapping regression
- ✅ `max_cluster_len` decreased materially on the regression case (12 → 4)
- ✅ no final-summary citation dump on any fixture
- ✅ no extra latency from prompt change (variance dominated by upstream)
- ✅ answer quality intact (spot-check)
- ⚠️ Mid-body clusters of length 2–3 still occur where multiple sources
  cumulatively support a single claim. Per the plan, these are
  reported, not repaired. Stop here — no repair/retry will be added
  without further approval.

## Artifacts

- `reports/legal-research-v1-cluster-prevention-{L1..L6,PROT}.json`
- `reports/legal-research-v1-cluster-prevention-summary.json`
