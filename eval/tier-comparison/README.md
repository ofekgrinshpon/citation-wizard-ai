# Tier Comparison Diagnostic

Diagnostic-only A/B/C experiment. **No production changes. No user-facing output.**

- **A**: Tier-1 allowlist (TRUSTED_LEGAL).
- **B**: Tier-2 curated (TRUSTED_LEGAL ∪ TRUSTED_PUB) + docket-anchor + strict-party check.
- **C**: Fully open web, no domain filter, no trust gate. Result classified only — never promoted.

## Run

```
PERPLEXITY_API_KEY=... deno run -A scripts/tier-comparison-experiment.ts \
  --fixtures eval/tier-comparison/fixtures.json \
  --out reports/
```

Outputs `reports/tier-comparison-<ts>.md` and `.json`.

## Acceptance for Tier-3

C must have ≥4 `materially_better` cases where B failed, AND C's false-positive rate ≤ B's + small ε, AND C's wins must contribute additional *correct* fields (not just URLs). Otherwise recommendation is: keep Tier-2 only.
