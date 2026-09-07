# legal_research_v2_research_agent_model_bakeoff_v1 — Evaluation Report

Evaluation only. V2 architecture, tools, prompts, budgets, verifier (`google/gemini-3.7-flash`)
and drafter (`google/gemini-3.1-pro-preview`) were held constant. Only the Research Agent model
varied, via an evaluation-only per-run override. 12 runs, 4 questions × 3 models, one run each,
no retries needed (0 infrastructure failures).

Transport note: both OpenAI candidates reject function tools on `/v1/chat/completions` when
reasoning is enabled (HTTP 400). They were therefore called through `/v1/responses` with
`reasoning.effort: "medium"`. Same messages, same tool schemas, same budgets — transport only.

## Candidates
| Role | Model |
|---|---|
| Agent A | `google/gemini-3.1-pro-preview` (baseline) |
| Agent B | `openai/gpt-5.6-terra` |
| Agent C | `openai/gpt-5.6-sol` |

## Per-run results

| Run | Model | Wall (s) | Steps | Model calls | Bodies read | Verified claims | Cited | Prompt tok | Completion tok | Est. cost |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Q1 doctrinal (HCJ/rabbinical property) | Gemini | 156 | 24 | 27 | 1 | 2 | 1 | 335,367 | 10,573 | $0.80 |
| Q1 | Terra | 136 | 6 | 8 | 4 | 3 | 2 | 74,691 | 5,973 | $0.22 |
| Q1 | Sol | 241 | 15 | 18 | 7 | 5 | 4 | 354,271 | 9,168 | $1.60 |
| Q2 named case (Bavli 1000/92) | Gemini | 87 | 16 | 18 | 2 | 2 | 1 | 196,259 | 5,959 | $0.47 |
| Q2 | Terra | 57 | 6 | 7 | 1 | 0 (refusal) | 0 | 19,756 | 1,995 | $0.06 |
| Q2 | Sol | 142 | 8 | 11 | 5 | 3 | 3 | 90,815 | 6,523 | $0.49 |
| Q3 statute/synthesis (protection money) | Gemini | 169 | 16 | 18 | 4 | 3 | 3 | 181,736 | 10,769 | $0.49 |
| Q3 | Terra | 107 | 4 | 6 | 4 | 6 | 3 | 61,219 | 5,459 | $0.19 |
| Q3 | Sol | 171 | 6 | 8 | 3 | 8 | 2 | 107,598 | 8,984 | $0.61 |
| Q4 literature (reasonableness) | Gemini | 71 | 7 | 9 | 4 | 3 | 2 | 39,962 | 6,121 | $0.15 |
| Q4 | Terra | 94 | 3 | 5 | 5 | 5 | 3 | 23,370 | 5,586 | $0.11 |
| Q4 | Sol | 169 | 7 | 9 | 4 | 11 | 4 | 112,847 | 8,179 | $0.62 |

Costs are ESTIMATED from the gateway catalog prices (Gemini Pro / Terra: $2/M in, $12/M out;
Sol: $4/M in, $20/M out). Totals include the fixed verifier and drafter calls.

## Aggregates

| Metric | Gemini | Terra | Sol |
|---|---:|---:|---:|
| Avg wall time | 121 s | 98 s | 181 s |
| Total prompt tokens | 753,324 | 179,036 | 665,531 |
| Total verified claims | 10 | 14 | 27 |
| Total cited sources | 7 | 8 | 13 |
| Total bodies read | 11 | 15 | 19 |
| Est. cost / 4 runs | $1.91 | $0.59 | $3.32 |
| Est. cost / run | $0.48 | $0.15 | $0.83 |
| Invariant errors / fabricated citations | 0 | 0 | 0 |

## Qualitative review (answers read without model labels attached)

- **Q1 doctrinal.** Sol strongest: five-claim, two-stage standard of review (non-appellate
  restraint + Bavli-based ultra vires when a religious/moral consideration tips property
  division), citing 8928/06, 4868/03 and DNGC 8537/18. Terra materially the same doctrine,
  tighter, with one official `supremedecisions` source. Gemini weakest: two claims, one
  citation, and that citation is a law-firm-hosted PDF.
- **Q2 named case.** Gemini cited Bavli itself; Sol reasoned correctly but leaned on the
  English Versa/Cardozo secondary corpus; Terra fetched the judgment, hit severe encoding
  corruption in the returned text windows, and refused rather than paraphrase — a correct
  refusal, but zero product value on this run.
- **Q3 statute/synthesis.** Sol clearly best: eight claims mapping s.428A(a)–(c) elements,
  the evidentiary presumption, forfeiture, and the tort routes (assault, breach of statutory
  duty, joint tortfeasors), on Knesset primary PDFs. Terra was well-structured but relied on a
  pre-2023 Knesset research paper and therefore stated there is no dedicated offence — a
  substantive currency error. Gemini reached Amendment 146 but cited an unrelated insurance PDF.
- **Q4 literature.** Terra best: the only run to cite genuine scholarship (Mautner, Bitton,
  Zamir PDFs). Sol was broadest (11 claims, historiographical dispute in HCJ 5658/23) but
  mixed academic and blog/Wikisource sourcing. Gemini cited Wikipedia plus the judgment PDF.

## Scores (/25: depth 5, verified output 5, source quality 5, honesty/discipline 5, efficiency 5)

| Model | Depth | Verified output | Source quality | Discipline | Efficiency | Total |
|---|---:|---:|---:|---:|---:|---:|
| Gemini 3.1 Pro | 2 | 2 | 2 | 4 | 2 | **12** |
| GPT-5.6 Terra | 3 | 3 | 4 | 5 | 5 | **20** |
| GPT-5.6 Sol | 5 | 5 | 4 | 4 | 2 | **20** |

## Decision

**Not a tie in practice: the baseline loses, and the choice is between the two OpenAI models.**

- Recommended default Research Agent: **`openai/gpt-5.6-terra`** — 3.2× cheaper than the
  current baseline and 5.6× cheaper than Sol, fastest, fewest wasted steps, the best
  scholarship retrieval, and more verified output than the baseline.
- Recommended for depth-critical work: **`openai/gpt-5.6-sol`** — nearly 2× the verified claims
  and citations of Terra, but ~$0.83/run and ~181 s.
- **`google/gemini-3.1-pro-preview` should not remain the Research Agent.** It burned the most
  prompt tokens (753K over four runs), took the most steps, read the fewest bodies, and produced
  the weakest sourcing.

Known Terra risks to watch before promotion: currency of statutory sources (Q3) and the
encoding-corruption refusal path (Q2).

No winner has been implemented. Defaults are unchanged; the override remains evaluation-only.
