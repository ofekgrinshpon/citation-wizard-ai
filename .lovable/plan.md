## What you saw

You typed `ע"א 248/86` into אזכור אחיד and got back:

```
ע"א 248/86 [חסר: שם המערער/העותר] נ' [חסר: שם המשיב] ([חסר: שם מאגר] [חסר: תאריך מלא])
```

That looks like Perplexity failed completely. It didn't. The case **was** found — its parties, date, and database were almost certainly returned in the JSON. The pipeline then **deliberately blanked them out** because of a guard that, in this specific case, fires a false positive.

## Why this happens (technical)

`citation-chat/index.ts` runs the Perplexity case-law search restricted to a trusted domain set:

```
nevo.co.il, court.gov.il, supreme.court.gov.il,
takdin.co.il, lite.takdin.co.il, psakdin.co.il
```

After Perplexity responds, it runs a **docket-anchor guard** (`urlContainsDocket` in `supabase/functions/_shared/trustedHosts.ts`) that requires at least one returned `search_result.url` to reference the docket via one of these channels:

1. **plain** — URL path contains literal `248/86`, `248-86`, or `248_86`
2. **supreme_hebrew_verdicts** — `/HebrewVerdicts/86/870/089/…` (Supreme Court e-filing encoding)
3. **supreme_filename** — filename token `86089870.<ext>`
4. **supreme_net_verdicts** — `/NetVerdicts/.../1986-X-248-…`

If **no** returned URL matches, the code (line 1676 in `citation-chat/index.ts`) blanks out party1, party2, date, court, isPublished, padi_volume/part/page, databaseName, then renders the `[חסר: …]` placeholders.

For **ע"א 248/86** (decided 1989, a 1986-filing Supreme Court appeal):

- The case predates Supreme Court electronic publication. There is no `supreme.court.gov.il` or `supremedecisions.court.gov.il` page for it, so channels 2–4 are not reachable.
- Perplexity's actual hits are typically `nevo.co.il/psika_word/elyon/…doc` (or `…pdf`). Nevo's URLs use an **opaque internal slug** — the literal string `248/86` is **not in the URL path**. So channel 1 also misses.
- Result: `anchoredResults.length === 0` → entire payload is nulled out → user sees the empty-placeholder citation.

Other sources that do mention `248/86` literally (versa.cardozo, Hebrew Wikipedia, IDI commentary, journal articles, faculty syllabi, padi.gov.il scans, פסקדין mirrors) are filtered out **before** the guard ever runs, by `search_domain_filter`.

So this is a structural blind spot for **pre-electronic-era Supreme Court cases (filed before ~1995)**, not a bug in Perplexity or in your query.

## Proposed minimal fix

One narrow change to the docket-anchor guard, plus one optional follow-up. Backend only. No schema changes. No prompt rewrites.

### 1. Snippet-anchor fallback for trusted hosts (`trustedHosts.ts` + `citation-chat/index.ts`)

Currently the guard accepts a result **only if the URL itself** references the docket. Extend it so that, **for results already on a trusted domain**, a result also counts as anchored when the **snippet or title** contains the literal docket (`248/86`, `248-86`, or `248_86`, after Unicode normalization).

This is safe because:

- The search was already filtered to trusted legal databases — we're not opening the door to blogs/news.
- A trusted-host result whose snippet repeats the exact docket is, in practice, the same case page rendered through a slug-style URL.
- It does not weaken modern-case protection: those still have URL-level docket matches, which take precedence.

Concretely, add a `titleOrSnippetContainsDocket(text, docket)` helper next to `urlContainsDocket`, then in `citation-chat/index.ts` (around line 1660) treat a result as anchored when EITHER the URL matches OR (the host is in the trusted set AND the snippet/title contains the docket literal).

### 2. (Optional, only if step 1 is not enough) Add a small allowlist of pre-electronic-era mirrors

For Supreme Court cases with `year < 1995`, allow the `search_domain_filter` to also include `versa.cardozo.yu.edu` and `padi.gov.il`. These are recognized academic / official mirrors for old Supreme Court judgments. Strictly gated to old-year cases so modern cases continue to use the existing strict filter.

I'd hold off on step 2 until we confirm step 1 alone resolves ע"א 248/86 and similar.

## What I won't touch

- The verified_sources autocomplete (unrelated; this came up in a previous turn).
- The Perplexity prompt itself — the search is already correct.
- The trusted-host list for modern cases.
- The party-verification sub-guard (`partyVerification: "both" | "caption_marker" | …`). It runs **after** the docket-anchor passes and is correct in its own scope.
- The legal-research / source-search pipeline (different code path).

## Validation

After implementing step 1, re-run:

- `ע"א 248/86` → should now render full citation with parties, date, פד"י reference.
- `ע"א 1554/95` (קסטנבאום) → should still render correctly (URL-anchored, unchanged path).
- `בג"ץ 6427/02` (התנועה לאיכות השלטון) → unchanged.
- A made-up docket like `ע"א 99999/86` → should still produce `[חסר: …]` (no trusted-host result will mention it).

## Files touched (step 1 only)

- `supabase/functions/_shared/trustedHosts.ts` — add `titleOrSnippetContainsDocket` (or extend `urlContainsDocketVia` with an additional `snippet` channel).
- `supabase/functions/citation-chat/index.ts` — change the anchor check around line 1660 to also accept snippet-anchored trusted-host results; log the new `via=trusted_snippet` channel for telemetry.

Shall I proceed with step 1?
