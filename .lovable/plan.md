
# Marker-Boundary v2 — Tokenized Markdown (Option A, revised)

Revision of the previously-approved Option A direction with two safety fixes:
- **Fix #1**: post-render ambiguity is checked **token-aware before render**, never via a raw `[⁰-⁹]{2,}` regex on the rendered string. Valid `¹²` from a single `[[fn:12]]` token is allowed.
- **Fix #2**: tokenizer is **conservative on ambiguous raw runs** — when a superscript run admits two valid interpretations (e.g. `¹²` could be source 12 *or* adjacent 1+2), Phase 3 skips and preserves legacy output.

No LLM repair, no thin spaces, no commas, no marker movement, no prose rewrite, no retrieval/verifier/source/DB/frontend/sources-only changes.

---

## 1. Internal token

ASCII, regex-safe, never persisted, never returned:

```
[[fn:<positive integer>]]
```

Tokens exist only in memory inside `legal-research-v1/index.ts` between `applyCitationCleanup` and the single render boundary.

## 2. Pipeline

```text
drafter raw answer (Unicode superscripts)
  → applyCitationCleanup                                 (unchanged)
  → tokenizeSuperscripts(answer, used_sources)
       • per run, classify: unambiguous_single | unambiguous_split | ambiguous
       • ambiguous → return { ok:false, reason:"ambiguous_raw_superscript_run", sample }
       • unambiguous_split → split by greedy walk against used_sources.numbers (same algorithm as footnoteRerender.ts)
       • unambiguous_single → one [[fn:N]] token for the whole run
  → applyOccurrenceFootnotes(tokens, used_sources)       (operates on token stream, not chars)
       • assigns chronological occurrence numbers 1..K to each token instance
       • emits footnotes[] with full / שם. / <short>, לעיל ה״ש N.
       • token-adjacency guard: if any two tokens are directly adjacent
         (zero non-token chars between them) → skip,
         reason "adjacent_tokens_would_render_ambiguous"
  → token-model validation (see §6) — must pass before render
  → renderMarkersToSuperscripts(tokenStream)             (SINGLE boundary, the only superscript emitter)
  → assertNoTokenLeak(rendered)
       • on hit → rollback to legacy, reason "token_leak_detected"
  → runMarkerValidation(rendered, used_sources)
       • configured to understand multi-digit markers; no raw adjacent-superscript
         regex used as a hard failure here (see §6)
  → persist + return
```

## 3. Tokenizer classification rules

For each maximal run of Unicode-superscript digits in the cleaned answer, decode into one of three states using **only existing data already in scope** (the current `used_sources[].number` set and the run itself — no LLM, no metadata fetch):

Let `R` be the decimal value of the whole run read as one number (e.g. `¹²` → 12), and let `S = used_sources.numbers` be the set of currently-valid source numbers in the answer at this point (pre-Phase-3, so still legacy unique-source numbering).

1. **unambiguous_single** — `R ∈ S` **and** the run cannot be split into two-or-more numbers all of which are in `S`. → one token `[[fn:R]]`.
2. **unambiguous_split** — `R ∉ S` **and** the run can be uniquely split into a sequence whose every part is in `S`. → one token per part.
   - "Uniquely" means the greedy left-to-right split (existing `footnoteRerender.ts` algorithm) terminates with every part `∈ S` **and** no alternative split also satisfies that property. If multiple valid splits exist → fall through to ambiguous.
3. **ambiguous** — any other case, including:
   - `R ∈ S` *and* a valid split into ≥2 parts all `∈ S` exists (the canonical `¹²` problem when both `12` and `1`+`2` are valid sources);
   - No interpretation works (e.g. `²⁴⁵` where neither `245` nor any split is fully in `S`) — this is the existing "adjacent markers cluster" case;
   - Run length > 2 with no unique decomposition.
   - → skip Phase 3 entirely. Record `phase3.discarded_reason = "ambiguous_raw_superscript_run"` with up to 5 samples `{ run, context, candidates }`.

Concrete examples (assume `S = {1, 2, 7, 12}`):
| Run | R∈S | unique split? | classification |
|---|---|---|---|
| `¹²` | yes (12) | yes (1+2) | **ambiguous** → skip |
| `¹⁷` | no | yes (1+7) | unambiguous_split → `[[fn:1]][[fn:7]]` |
| `⁷` | yes | n/a | unambiguous_single → `[[fn:7]]` |
| `²⁴⁵` | no (245) | no | **ambiguous** (legacy cluster case) → skip |
| `¹²` with `S={1,2}` only | no (12) | yes (1+2) | unambiguous_split |
| `¹²` with `S={12}` only | yes | no split possible | unambiguous_single → `[[fn:12]]` |

This is strictly conservative: when in doubt, skip and ship legacy.

## 4. Token-adjacency guard

After Phase 3 produces the new token stream, scan: any two `[[fn:*]]` tokens with zero characters between them → skip, reason `"adjacent_tokens_would_render_ambiguous"`, restore legacy output. Multi-digit single tokens (`[[fn:12]]`) are immune because they are one token.

This is the *only* adjacency rule that survives. The previous raw-superscript regex `/[⁰-⁹]{2,}/u` is **removed as a hard gate** on the rendered output (kept only as a *report-only* counter labeled `multi_digit_marker_runs_count` in telemetry, so we can audit how many `¹²`-style legitimate runs appear in production).

## 5. Render boundary

`renderMarkersToSuperscripts(tokenStream)` is the **only** place that emits Unicode superscript digits. For each `[[fn:N]]` it emits `toSuperscript(N)`. For every text segment between tokens it emits the text verbatim.

`assertNoTokenLeak(s)` runs `/\[\[fn:\d+\]\]/u.test(s)` on the final string. On hit → discard Phase 3, persist legacy, set `phase3.discarded_reason = "token_leak_detected"`.

`stripSup(rendered) === stripSup(drafter_post_cleanup)` is also asserted (prose-invariance).

## 6. Validation

**Token-model validation** (new, runs pre-render, AND-ed into `marker_validation.ok`):
- Every token instance maps to exactly one `footnotes[]` entry.
- Every `footnotes[i].source_number` resolves to a row in `used_sources[]`.
- Token-occurrence count `K` equals `footnotes.length`.
- No adjacent tokens.
- No ambiguous-run skip reason recorded.

**Rendered-string validation** (existing `runMarkerValidation`, adapted):
- Continue to enforce: `internal_id_leak === false`, every superscript run maps to exactly one footnote occurrence (via the already-existing greedy split, which now sees post-Phase-3 unique occurrence numbers `1..K`), `stripSup` equality.
- **Remove** any hard-fail use of `/[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/u` on the rendered string. The existing `no_adjacent_marker_clusters` boolean becomes a **report-only** field and is no longer AND-ed into `mv.ok`. The token-adjacency guard in §4 is the real safety net.
- Add report-only fields: `multi_digit_marker_runs_count`, `multi_digit_runs_from_single_token_count` (must equal each other on every applied fixture — see §8).

## 7. Files touched (≈4)

- `supabase/functions/legal-research-v1/stages/drafter.ts`:
  - add `tokenizeSuperscripts`, `renderMarkersToSuperscripts`, `assertNoTokenLeak`, `validateTokenModel`;
  - rewrite `applyOccurrenceFootnotes` to operate on token stream;
  - drop hard-fail use of raw adjacent-superscript regex on rendered output; keep as report-only counter.
- `supabase/functions/legal-research-v1/lib/types.ts`:
  - extend `CitationCleanupReport.phase3.discarded_reason` union with `"ambiguous_raw_superscript_run" | "adjacent_tokens_would_render_ambiguous" | "token_leak_detected"`;
  - add `MarkerValidation.multi_digit_marker_runs_count?: number`, `multi_digit_runs_from_single_token_count?: number`, `token_model_ok?: boolean`;
  - `no_adjacent_marker_clusters` demoted to report-only (kept in schema).
- `supabase/functions/legal-research-v1/stages/drafter.cleanup.test.ts`: extend with tokenizer-classification table tests, adjacency-token skip, leak detector, multi-digit single-token render, ibid/supra over tokens, prose-invariance, idempotency, conservative-skip on `¹²` ambiguity.
- `scripts/legal-research-v1-occurrence-footnotes-runner.ts`: emit `multi_digit_marker_runs_count`, `multi_digit_runs_from_single_token_count`, count of each new skip reason, and a per-fixture proof field `every_multi_digit_run_from_single_token: bool`.

**Untouched.** Retrieval, verifier, candidate pool, drafter prompt, `lib/sourcesOnly.ts`, all frontend, `footnoteRerender.ts`, DB schema, RLS, history rehydration.

## 8. Production-report new fields

Per fixture:
- `phase3.applied`, `phase3.discarded_reason` (one of the 6 reasons including the 2 new ones).
- `multi_digit_marker_runs_count` — rendered runs of length ≥2.
- `multi_digit_runs_from_single_token_count` — of those, how many originated from one `[[fn:N]]` token.
- `every_multi_digit_run_from_single_token` — boolean (must be `true` on every applied fixture; proves Fix #1).
- `tokenizer_ambiguous_skip_count`, `adjacent_token_skip_count`, `token_leak_count` (must be 0 on applied fixtures).
- Existing `stripSup` byte-equal proof, source-set unchanged proof, runtime delta.

## 9. Acceptance gates

- All existing hard grounding gates remain green on every fixture.
- For every applied fixture:
  - body marker tokens strictly `1..K` in order of appearance;
  - every rendered superscript run maps to exactly one footnote;
  - every multi-digit rendered run originated from one token (`every_multi_digit_run_from_single_token === true`);
  - `unique_source_count` unchanged vs cluster-prevention baseline;
  - repeat patterns produce `שם.` / `לעיל ה״ש N.` correctly on spot-check;
  - `stripSup(rendered) === stripSup(drafter_post_cleanup)`;
  - no `[[fn:` substring anywhere in persisted answer.
- For skipped fixtures: legacy outputs ship unchanged; reason is one of `ambiguous_raw_superscript_run`, `adjacent_tokens_would_render_ambiguous`, `token_leak_detected`, `multi_digit_occurrences_require_boundary_tokens` (kept as defense-in-depth), `marker_validation_failed`, `footnote_resolution_failed`, `no_markers`, `disabled_by_env`.
- Expected behavioral shift on the current 10-fixture corpus: skips caused by *legitimate* multi-digit superscripts (e.g. footnote 10, 12) should now **apply** instead of skipping, because the post-render raw-cluster regex is no longer a hard gate. Skips caused by genuine adjacent markers continue to be preserved as legacy.

## 10. Rollback

Env flag `LEGAL_RESEARCH_V1_OCCURRENCE_FOOTNOTES=off` reverts to today's behavior immediately. No DB or frontend state to undo. Tokenizer / renderer / leak detector become dead code under the flag.

## Out of scope (explicit)

LLM repair, thin/hair spaces, comma separators, drafter prompt changes, prose rewriting, marker movement, persisting tokens or segments, DB migrations, frontend renderer changes, sources-only changes, relaxation of token-adjacency guard, relaxation of tokenizer conservatism on ambiguous runs.
