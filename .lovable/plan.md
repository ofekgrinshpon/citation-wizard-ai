
# Plan — Claude Sonnet + Opus drafter A/B/C/D harness

Same controlled methodology as the gpt-5 comparison: each fixture runs the live pipeline once, then drafterV2 is re-invoked N−1 additional times against the **identical input pack** (same retrieval candidates, same verifier verdicts, same claims, same user-doc context). Only the drafter model varies. Served answer + footnotes stay on the production gpt-5-mini path. Comparison outputs live in `metadata.drafter_v2_full_compare.*`.

No change to: production default, retrieval, verifier, admission, source selection, schema, footnoteBuilder, citations, V2 prompt (except a single optional provider-format guard described below).

## Models under test

| Slot | Model | How called |
|---|---|---|
| A | `openai/gpt-5-mini` | Lovable AI Gateway (current production path) |
| B | `openai/gpt-5` | Lovable AI Gateway |
| C | `anthropic/claude-sonnet-4-5` (latest Sonnet) | Anthropic Messages API directly, `ANTHROPIC_API_KEY` |
| D | `anthropic/claude-opus-4-1` (latest Opus) | Anthropic Messages API directly, `ANTHROPIC_API_KEY` |

Exact Anthropic model IDs will be locked at implementation time against the Anthropic docs to make sure they're the current GA Sonnet/Opus; nothing else in the plan depends on the specific ID string.

## Prerequisites

1. **Secret**: `ANTHROPIC_API_KEY` must be added to project secrets. I will request it via the secrets tool at the start of build mode.
2. **No connector**: direct Anthropic Messages API. No OpenRouter, no gateway routing change.
3. No prompt change to V2 except, if Anthropic's structured-output path requires it, swapping the existing OpenAI tool-call schema invocation for Anthropic's `tools` / `tool_choice` block carrying the **same JSON schema**. Schema bytes are byte-identical; only the request wrapper differs per provider.

## Implementation scope (build mode)

All changes are gated behind the existing harness header `x-drafter-v2-compare-models` and inert in production.

1. **`supabase/functions/legal-research-v1/stages/drafterV2.ts`**
   - Extend `runDrafterV2` options: accept `provider: "openai" | "anthropic"` alongside the existing `forceModel` + `skipEscalation`.
   - Add a thin Anthropic adapter (~60 LOC) that:
     - Calls `https://api.anthropic.com/v1/messages` with the same system + user prompt strings used today.
     - Carries the existing V2 JSON schema via Anthropic `tools` + `tool_choice: {type: "tool", name: "emit_structured_answer"}` to force structured output.
     - Maps the tool-call arguments back to the same `DrafterV2Result` shape consumed by `footnoteBuilder` — no downstream change.
     - Captures `usage.input_tokens` / `usage.output_tokens` into `metadata.drafter.usage` so cost is measured, not extrapolated.
   - No change to default model selection, retry, or escalation logic.

2. **`supabase/functions/legal-research-v1/index.ts`**
   - Extend the existing compare branch (`x-drafter-v2-compare-models: full`) to accept `full+claude`. When set, run **three** extra drafter passes (B/C/D) sequentially after the served pass (A), all against the identical pack. Stash results under `metadata.drafter_v2_full_compare.{gpt5, sonnet, opus}`.
   - Served answer/footnotes still come from A.

3. **`scripts/legal-research-v1-drafter-model-comparison-claude.ts`** (new)
   - Mirror of existing `scripts/legal-research-v1-drafter-model-comparison.ts`, same 15 fixtures, same probe phrases, same Latin-token detector.
   - Triggers each fixture with the new header value, polls `qa_logs` by `run_id`, builds per-question rows for all 4 variants.
   - Concurrency = 2 (Anthropic burst caps + total runtime).

4. **Reports** (new, written under `reports/`):
   - `legal-research-v1-drafter-claude-comparison.json` — raw per-fixture metrics for all 4 models.
   - `legal-research-v1-drafter-claude-comparison.md` — aggregate verdict matching the structure requested below.

No frontend, schema, DB, retrieval, verifier, footnoteBuilder, or citation changes. No `supabase/config.toml` change.

## Metrics captured per (question, model)

Computed from the structured output + builder report + raw answer text — no LLM judging.

Schema / structural:
- `schema_ok` (boolean) and `schema_failure_reason` if any
- count of `source_refs` not present in `verifier.usable` (unknown refs)
- forbidden marker / superscript / footnote text emitted by the model
- builder report: `adjacent_marker_count`, `repaired_marker_count`, `used_sources`
- answer-text adjacent superscript runs

Prose / quality (deterministic probes — same as gpt-5 A/B):
- Hebrew artifact probe list: `המשרוק`, `מום פרשני`, `שגיאות מוסיקליות`, `שווה לנקוט`, `משקל תקף נמוך יותר`, `סיכי דה`, `סמלייים`, `סמליומית`, `הבטחה מנהירת`
- Civil/criminal mixup probes: `זיכוי`, `נאשם`, `הנאשם` (flagged only in civil-context questions)
- Latin-token detector (≥2 Latin chars outside footnote/URL lines)
- Answer length (chars)
- Source coverage: `|used_sources| / |verifier.usable|`
- Framing preservation: detect the user-question key noun-phrase in the opening 200 chars (cheap "did the answer address what was asked" check)

Performance / cost:
- Drafter latency (ms) from gateway/API call wall-clock
- Input + output tokens (now logged for all four)
- Per-call USD estimate using published per-token rates at run time, recorded in the JSON so the markdown report can be regenerated if pricing changes

## Report structure

Top-level aggregate table (4 columns A/B/C/D) plus per-question table with the same verdict scheme as the prior report: **materially better / slightly better / similar / worse / failed**, judged on the deterministic metrics above (not on free-form opinion).

Special-attention section answers exactly the user's five Claude-specific questions:
1. Does Claude reduce weird Hebrew artifacts vs gpt-5-mini? (probe-hit delta)
2. Does Claude match or beat gpt-5 on Hebrew legal prose? (Latin + probe + length parity)
3. Does Claude obey the structured JSON / source_refs schema reliably? (schema_ok rate + unknown-refs rate)
4. Does Claude avoid adding its own citations/superscripts? (forbidden-marker + adjacent-run counts)
5. Does Claude create new Israeli legal terminology issues? (civil/criminal probe + manual flag list)

Aggregate verdict section:
- best raw quality
- best cost-quality tradeoff
- fastest acceptable model
- recommended answer-mode drafter
- Claude viability for production (gates: schema ≥95%, 0 forbidden markers, Latin = 0, no new Hebrew artifact class)

## Cost & runtime estimate (for the experiment, not production)

- 15 fixtures × 4 model runs = 60 drafter calls
- Token volume per call ≈ 6k in / 3.5k out (V2 prompt + schema + claims pack)
- Rough total experiment cost: <$5 (Sonnet + Opus dominate)
- Total wall-clock at concurrency 2: ~25–30 min

## Revert path

- Remove `ANTHROPIC_API_KEY` secret (or just leave it; inert without the header).
- Revert `drafterV2.ts` provider param + Anthropic adapter (≈60 LOC, one file).
- Revert `index.ts` compare branch extension.
- Delete the new script + reports.
- No DB migration, no frontend change, no production default touched at any point.

## Stop condition

Stop after the Claude comparison report is generated and surfaced. Do not change the production drafter, do not promote any model, do not change credit pricing. The follow-on decision (gpt-5 vs Claude vs hybrid for production) is a separate request.

## Technical details

- Anthropic Messages API endpoint: `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
- Structured output via Anthropic `tools` array with one function-shaped tool whose `input_schema` is the existing V2 JSON schema (same object pulled from `lib/schemas.ts`). `tool_choice: {type: "tool", name: ...}` forces the model to emit a tool call rather than free text — the existing V2 parser then reads `content[].input` instead of OpenAI's `tool_calls[0].function.arguments` (one-line branch in the adapter).
- No streaming — the harness, like today's drafter, consumes the whole response at once.
- All four model calls share **the exact same** `claims`, `verifier.usable`, `user_doc_excerpt`, and prompt strings. The pack is built once per fixture in `index.ts` and passed by reference to each `runDrafterV2` invocation.
- Concurrency limited at the script level to 2 fixtures in flight (6 in-flight model calls) to stay under Anthropic's default tier-1 RPM.
