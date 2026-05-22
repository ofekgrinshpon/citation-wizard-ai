# Post-retrieval engine fix — stop the citation_quality pipeline from undoing recall

The recall fix (A–E) is working: the Knesset MMM report on דמי חסות and the SSRN/huji scholarship are both arriving in the candidate pool. But the downstream **citation_quality** pass and **footnote builder** are dropping them on contradictory rules, leaking internal notes, and emitting hallucinated pinpoints. Six small, general-purpose fixes — no DB migration, no changes to drafter, verifier, ledger, batch footnote builder, Citation Review UI, or the citation engine's external surface.

## 1. Sync off_domain allowlist with TIER_A scholarship hosts

`citations.ts` `APPROVED_SCHOLARLY_HOSTS` is the gate for `off_domain:<host>`. `retrieval.ts` `TIER_A_SCHOLARSHIP_HOSTS` is what we deliberately query through the concept-anchor route. They drift: SSRN (`papers.ssrn.com`, `ssrn.com`), `jstor.org`, `openscholar.huji.ac.il`, `cris.huji.ac.il` are TIER_A but missing from `APPROVED_SCHOLARLY_HOSTS`, so `off_domain:papers.ssrn.com` kills exactly what we asked Perplexity to fetch.

Change: extract the host lists to one shared module (`core/approvedHosts.ts`) consumed by both `retrieval.ts` and `citations.ts`. `APPROVED_SCHOLARLY_HOSTS` becomes the superset of TIER_A scholarship. No new hosts beyond what TIER_A already approves — this is a consistency fix, not a widening.

## 2. Don't drop `uninformative_label` when the source is anchored

`citation_quality.ts:124-128` drops any LS where `declared_type === "none"` AND label is uninformative. The pre-pass at lines 233-268 rescues by host inference, but only for `origin === "approved_web"` with `support === "direct"` — and that path doesn't cover `local_text`/`local_vector` candidates carrying `factual_anchor === true` whose `source_type` is empty or generic ("דו"ח", "knesset_research" before normalization).

Change: extend the rescue pre-pass to also rescue LedgerSources where `metadata.factual_anchor === true` OR `metadata.concept_anchor === true`. Use the same host-inference + thin-metadata path, mark `partial`, add `anchor_inferred_type` error tag. Anchors retain their normalized `source_type` instead of being discarded for thin labels.

Off_domain still wins over rescue (existing precedence).

## 3. Sanitize verifier pinpoints before they reach the footnote builder

Footnote 4 read `שם, ב-שורה 1 של הקטע.` — verifier model returned the literal string "שורה 1 של הקטע" as `pinpoint`. `ledger.ts:217` copies `p.v.pinpoint` straight through; `footnotes.ts:168` wraps it with `withBetPrefix` and emits.

Change: add a `sanitizePinpoint(s)` helper in `core/ledger.ts` applied at line 217. Drop the pinpoint (set undefined) when it matches any of:
- meta-phrases: `/שורה\s*\d+/`, `/של ה?קטע/`, `/של ה?snippet/i`, `/בקטע/`, `/^הקטע$/`
- bare digits without unit: `/^\s*\d{1,3}\s*$/` (no `סעיף`/`פסקה`/`עמ`/`ס/ב/ה"ש` prefix)
- length > 40 chars (real pinpoints are short references)

Keep good pinpoints (`סעיף 25(ב)`, `פסקה 14`, `עמ' 221`). Telemetry counter `pinpoints_sanitized_per_claim` on the `runCore` retrieval metadata block.

## 4. Stop leaking the internal `הערה למערכת` line into `rendered_answer`

`citation_quality.ts:391` appends `הערה למערכת: הטענות הבאות נותרו ללא אסמכתא לאחר ביקורת איכות: …` directly to `rendered`. The text is already exposed structurally as `claims_lost_all_support` in the returned object.

Change: remove the append. The diagnostic survives in `metadata.core.citation_quality.claims_lost_all_support` and `status === "needs_review"`. Any UI surface that wants to show it can read the structured field. No user-facing leak.

## 5. Fix the `short_form_shape_invalid` self-collision

`citation_quality.ts:198-211`: for `is_repeated` markers the validator requires `שם / לעיל ה"ש N / legislation cross-form`. The Rule 37 builder at `footnotes.ts:182-198` only emits one of those forms when `default_pinpoint` is present and the prior occurrence is found. When the builder falls back to `שם.` for the same LS twice with empty pinpoint, the validator sometimes sees a canonical-string repeat instead (because `engine_used==="resolver"`, the first branch at line 198 fires for repeated entries that lack `is_repeated` short-form decoration) and rejects it as `short_form_shape_invalid`.

Change: in `validateFootnote` (line 196-204), gate the canonical-mismatch check with `!fn.is_repeated && fn.short_form_used !== true`. The shape gate (208-211) already handles repeats; the canonical-equality gate must not run for them. This removes the LS2×2 drop on C1 without touching footnote generation.

## 6. Improve anchor-driven approved_web query shape

Telemetry showed `factual_hits = 0` on every claim despite gov hosts being in scope. The query was `claim.text + " " + all anchor_terms.join(" ")` — long claim text + 2 factual terms produced a noisy Perplexity query against `search_domain_filter`.

Change in `retrieval.ts` anchor-web call site:
- Use **anchor terms only** as the query body, not `claim.text + terms`. Format: `factual_anchor_terms.join(" ") + " " + (one short doctrine word from claim.search_targets[0].doctrine)`. Max query length 120 chars.
- Pass `search_domain_filter` as the **bare host array** (already done) but log the resolved domains in `anchor_web` telemetry so we can see if Perplexity actually filtered or returned out-of-allowlist hits (already partially logged).
- If `factual_hits === 0` AND TIER_A_GOV_HOSTS produced nothing, retry once with `search_domain_filter` unset (still gated downstream by `off_domain`). Counter `anchor_web_unfiltered_retries`.

No other change to D's trigger logic.

## Files

- `supabase/functions/legal-qa/core/approvedHosts.ts` — **new**: shared `PRIMARY_HOSTS`, `APPROVED_SCHOLARLY_HOSTS`, `TIER_A_GOV_HOSTS`, `TIER_A_SCHOLARSHIP_HOSTS`.
- `supabase/functions/legal-qa/core/citations.ts` — import from approvedHosts; APPROVED_SCHOLARLY_HOSTS = superset of TIER_A scholarship.
- `supabase/functions/legal-qa/core/retrieval.ts` — import from approvedHosts; anchor-web query shape + retry (#6).
- `supabase/functions/legal-qa/core/citation_quality.ts` — extend rescue pre-pass to anchored LS (#2); remove `הערה למערכת` append (#4); gate canonical-mismatch with `!is_repeated` (#5).
- `supabase/functions/legal-qa/core/ledger.ts` — `sanitizePinpoint` helper applied at line 217 (#3).
- `supabase/functions/legal-qa/core/runCore.ts` — surface `pinpoints_sanitized_per_claim`, `anchor_web_unfiltered_retries`, `approved_web_rescued`, `anchor_label_rescued` counters.

## Not touched

- Citation engine (`citationResolver`, `citationEngine.ts`).
- Drafter prompts.
- Verifier prompt/logic.
- Footnote builder (`footnotes.ts`) output shape.
- Batch Footnote Builder, Citation Review UI.
- DB schema / migrations.

## Validation

Re-run the דמי חסות / פרוטקשן query and inspect `qa_logs.metadata.core`:

- `citation_quality.removed_citations` no longer contains `off_domain:papers.ssrn.com` (or `huji.ac.il` scholarship hosts).
- `citation_quality.removed_citations` no longer contains `uninformative_label` for anchored LS (`anchor_label_rescued ≥ 1`).
- `citation_quality.claims_lost_all_support` empty OR `status !== "needs_review"`.
- `answer` does NOT end with `הערה למערכת: …`.
- No footnote contains `שורה 1 של הקטע` or any sentence-shaped pinpoint.
- ≥1 footnote cites the MMM doc (`a6d79a7a…`) or the SSRN/huji scholarship article.

## Acceptance

- No hardcoded document ids, query terms, or article titles.
- One source of truth for approved hosts; TIER_A retrieval allowlist and off_domain filter cannot drift again.
- All counters land in `metadata.core` for regression tracking.
- No DB migration; forbidden modules untouched.
