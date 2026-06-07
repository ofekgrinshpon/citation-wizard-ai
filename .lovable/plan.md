# Diagnostic Experiment: Tier-1 vs Tier-2 Curated vs Open Web (C)

Goal: determine whether a hypothetical fully-open-web Tier-3 would materially beat the current Tier-2 curated fallback, or only add noise. **No production code changes.** Outputs are diagnostic-only.

## Constraints (locked)

- No changes to `citation-chat`, `citation-refill`, `_shared/trustedHosts.ts`, validators, prompts, or the trust gate.
- Variant C must never produce user-facing citations; it runs in an isolated script and writes to a report file only.
- No new env flag in production functions. The script uses its own Perplexity key from env.

## Scope of work

1. **Add a diagnostic-only script** at `scripts/tier-comparison-experiment.ts` (Deno, run via `deno run -A`). It:
   - Loads the 25–30 source test set from a new `eval/tier-comparison/fixtures.json`.
   - For each source, runs three independent Perplexity queries:
     - **A. Tier-1 allowlist** — `search_domain_filter` = current Tier-1 official allowlist (subset of `TRUSTED_HOSTS`).
     - **B. Tier-2 curated** — `search_domain_filter` = full Tier-2 trusted-host list, plus post-hoc trust gate + docket-anchor gate + strict party verification (reuses the exact predicates from `_shared/trustedHosts.ts` and the matcher logic from `citation-chat/index.ts`, imported, not duplicated).
     - **C. Open web** — no `search_domain_filter`, no trust gate. Result is classified but never promoted.
   - Extracts: selected URL, host, host classification (official / academic / database / news / blog / wiki / random-PDF), canonical citation, docket, parties, article title/author, publication details, missing fields.
   - Cross-checks each variant's output against a `gold` field in the fixture (docket, parties, title/author, pub details).
   - Flags false positives and near-neighbor substitutions (e.g. 4769/24 → 5819/24) using a small adjacency check on docket numbers in the fixture.
   - Classifies C vs B per case: `materially_better | slightly_better | same | same_but_noisier | worse | false_positive`.

2. **Fixtures** at `eval/tier-comparison/fixtures.json` — 25–30 entries:
   - 14 from the previous experiment set (carry over from existing eval fixtures).
   - 5–7 newer/obscure Supreme Court dockets.
   - 5 Israeli academic articles (משפטים, עיוני משפט, הפרקליט, מחקרי משפט, דין ודברים).
   - 3–5 noisy/partial queries (truncated names, missing year, ambiguous docket).
   - Explicit near-neighbor pairs incl. **בג"ץ 4769/24 vs 5819/24**, plus 1–2 more adjacent pairs.
   - Each entry: `{ id, query, type, gold: { docket?, parties?, title?, author?, pub_year?, journal?, volume?, page? }, neighbors?: string[] }`.

3. **Report** written to `reports/tier-comparison-<timestamp>.md` and `.json`:
   - Per-source table with all required columns (found, URL, host, trusted-under-Tier-2, host class, canonical citation, docket OK, parties OK, article OK, pub-details OK, missing fields, FP/near-neighbor, C-vs-B usefulness, C-vs-B completeness, C-introduced-untrusted).
   - Aggregate counts per classification bucket.
   - Acceptance verdict computed from the rules below.
   - Recommendation block (one of the two specified outcomes).

4. **Acceptance logic** (encoded in the script):
   - Pass for Tier-3 consideration **only if**: C has ≥4 `materially_better` cases where B failed, AND C false-positive rate ≤ B false-positive rate + small epsilon, AND C contributes additional *correct* fields (not just extra URLs) in those wins.
   - Otherwise recommendation = "Keep Tier-2 curated only. Do not implement open-web Tier-3."
   - If pass: recommendation = "Do not enable open web by default. Propose admin/diagnostic Tier-3 design (separate doc, follow-up task)."

## Files to add (all diagnostic, no prod imports changed)

- `scripts/tier-comparison-experiment.ts`
- `eval/tier-comparison/fixtures.json`
- `eval/tier-comparison/README.md` (how to run, how to read the report)
- `reports/.gitkeep` already exists; outputs land in `reports/`.

## Files read but **not modified**

- `supabase/functions/_shared/trustedHosts.ts` (import predicates)
- `supabase/functions/citation-chat/index.ts` (lift docket-anchor + strict-party matcher logic into the script via copy, not edit, to avoid coupling — small duplication is acceptable for a one-off diagnostic)

## How to run

```text
PERPLEXITY_API_KEY=... deno run -A scripts/tier-comparison-experiment.ts \
  --fixtures eval/tier-comparison/fixtures.json \
  --out reports/
```

Runtime budget: 3 Perplexity calls × ~30 sources ≈ 90 calls. Sequential with small concurrency (4) to stay polite. Expect ~3–6 minutes.

## Deliverable

After running, I post:
- The markdown report (or a tight summary + link to the file).
- The aggregate verdict.
- The recommendation (one of the two specified).
- **Stop.** No production changes proposed in this turn regardless of outcome.

## Out of scope

- Any change to `citation-chat`, `citation-refill`, trust gate, validators, prompts.
- Building a real Tier-3 path.
- Admin UI for diagnostic results.
- News / Mako / blog admission anywhere in prod.
