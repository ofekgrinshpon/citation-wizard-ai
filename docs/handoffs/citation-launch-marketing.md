# Citation-first launch presentation handoff

Base: c939aa55bf9e0a315eda6f892d6bd01e6b26fc96. Local branch: local/citation-launch-marketing.

## Inventory before editing

- `src/pages/Landing.tsx`: research-assistant hero/card, old mixed-product video, unconditional Bluebook/repeat wording, trial/week/month/semester cards, legacy fixed-term pricing and five-hour quotas, signup CTAs pretending to select plans.
- `src/components/guide/UserGuideModal.tsx`: shared sidebar/onboarding help; four tabs, including research assistant, old video with chapter controls; citation/bibliography/footnote images.
- `index.html`: English document language and citation-only title despite Hebrew UI.
- `src/pages/Profile.tsx`, `src/components/usage/UsageLimitsInfoDialog.tsx`, canonical `src/lib/plans.ts`: shared quota/pricing surfaces owned by the other task; intentionally not changed.
- `src/components/guide/{Sources,Research}EmptyState.tsx`: research-specific functional onboarding; preserve behavior. Both shared-guide links say “25 seconds”; parent should remove this suffix after integration.
- `src/components/BatchFootnoteBuilder.tsx`: tagline “העוזר המשפטי האוטומטי”; parent/Word owner should change to “אזכורים והערות שוליים” if still present after integration.
- Auth/AuthDialog do not contain research-first marketing claims. Legal policy text is separately owned and unchanged.

## Changes

Landing keeps existing gradient/logo/cards, describes citations, footnotes and bibliography, bounds Bluebook/repeat support, removes research marketing and old mixed-product video. Shared help keeps three real tool tabs, images, keyboard navigation and zoom; adds a clearly prelaunch text-only Word flow. Word guidance is informational, no upload or fake demo. Original source assets remain untouched.

`WordLaunchGuide` explains extraction, optional protected explanations, processing of all other text, review/approval and a new DOCX copy. It states bounded multiple-source/repeat support, ambiguity preservation/full-citation fallback and review of output formatting.

`LaunchPricing` shows only weekly/monthly cards and disables purchase unconditionally. Legacy prices, credit counts, 30-day duration, topups, trial and semester offers are not rendered. Canonical proposed weekly/monthly prices and allowances are now shown via the supplied offer contract.

## Required canonical contract / integration

Do not publish this patch alone. Owner task `01a18ae3-1fa1-7154-ab0b-cce2b1ed6020` owns `plans.ts`, server quotas, refunds and cycles. No canonical files or accounting logic changed here.

The canonical owner exports `CITATION_OFFERS`, `CitationOfferId`, `CITATION_CHECKOUT_ENABLED=false`, `CITATION_RENEWAL_DISCLOSURE` and `CITATION_UNIT_DISCLOSURE` from `src/lib/citationOffers.ts`. Exact field shape was supplied by the parent after initial handoff. **Keep legacy PLANS unchanged.**

`LaunchPricing` now imports CITATION_OFFERS directly and renders `label`, `priceLabel`, `allowanceLabel`, `interval` and stable `id`. The provisional PLANS adapter is removed. Offer IDs `citation_weekly_v1` and `citation_monthly_v1` remain display keys only; nothing assigns them to subscriptions. The buttons stay disabled unconditionally and have no checkout handler, even if the catalog flag later changes. The canonical renewal disclosure is reused. No stronger caching/zero-unit claim from CITATION_UNIT_DISCLOSURE is displayed because it has not been independently verified here.

**Patch dependency:** this branch does not contain the owner-controlled `src/lib/citationOffers.ts`; apply it in the quota checkout where that module exists. For validation only, the exact supplied export shape was temporarily copied from `/workspace/artifacts/citation-launch/citationOffers.fixture.ts`, then removed. This avoids duplicating or editing the canonical catalog. A standalone build of this fresh remote base without that owner module will fail module resolution.

The resulting cards show canonical ₪39/week/100 sources and ₪65/month/250 sources, automatically recurring until cancellation. Calendar month follows the owner's disclosure rather than a fixed 30-day duration. Re-download/embedding wording remains explicitly planned, pending owner validation. Profile's `CitationPlanOffers` is unchanged; both presentations consume the same catalog after integration.

**Known overlap:** quota commit `c0f30d31` also changes Landing/Profile. Parent should transfer this patch onto the quota checkout and resolve Landing deliberately, superseding its minimal landing copy with this fuller presentation where appropriate. Preserve quota Profile and accounting changes. Related owner commits: `9a304a4f`, `c0f30d31`, `e984c727`. None is merged or copied here. The presentation test now exercises CITATION_OFFERS labels and allowances; rerun against the owner checkout after transfer.

VAT handling remains unresolved and no inclusive/exclusive assertion is made. Purchase stays disabled even after metadata integration. Do not enable until separate authorization and payment acceptance work. Word remains explicitly prelaunch until owner integrates and validates unpublished workflow. Parent must reconcile Profile, usage dialog, shared onboarding labels, launch navigation and policy text; this patch neither deletes research backend features nor changes existing user data.

## Verification

See final task report for actual commands/results and local screenshot paths. Screenshots must remain in Codex/task, not mainchat. No push, PR, deployment, paid calls, real documents or external messages.

### Completed local checks (2026-10-30)

- `npm run build`: passes (existing large-chunk and mixed-import warnings).
- `npx vitest run src/test/citationLaunchPresentation.test.tsx src/test/footnoteLocatorFidelity.test.ts src/test/footnoteOccurrenceRule37.test.ts`: 46 pass, 3 files. Includes legacy-price suppression, disabled purchase, canonical offer presentation and keyboard guide navigation.
- `npx tsc -p tsconfig.app.json --noEmit`: blocked by TS2345 in unchanged `src/lib/researchConversation.ts:179` (Supabase update record typing); no introduced-file errors after installing missing test peer.
- Chromium actual landing at 1440×1000, 390×844 and 320×740: no horizontal overflow, no page errors, two disabled purchase buttons, no old prices/research promise. Shared actual guide component mounted in a temporary local harness at those widths; three tabs and End-key navigation verified. Inspected desktop and mobile screenshots.
- All browser requests outside the local dev origin aborted; fake local Supabase URL/key used. No contact form submissions. External Google Fonts blocked; typography uses fallback. Hosted guide JPGs are absent in the checkout; `GuideIllustration` now falls back to an icon card and prevents zoom until loaded. Hosted image/zoom success path not visually verified here.
- Artifacts (outside commit): `/workspace/artifacts/citation-launch/` holds screenshots, browser script and temporary guide harness, result JSON and test/build/typecheck logs. Keep screenshots in this task only.

### Dependency limitations and local-only workaround

Default npm cache location was unavailable; used `/tmp/relex-npm-cache`. `npm ci` fails because package.json and lockfile differ (including TS 6 vs locked TS 5.8, missing SSL/Word/DB packages), plus plugin-basic-ssl 2.3 peer-requires Vite 6–8 while repo uses Vite 5. Installed with `npm install --ignore-scripts --legacy-peer-deps --package-lock=false --cache /tmp/relex-npm-cache --no-audit --no-fund`; no dependency files changed. Missing `@testing-library/dom` peer installed with `--no-save` and same flags. Unbuilt optional canvas package from ignored native scripts moved out of node_modules to `/tmp/relex-canvas-unbuilt` so jsdom uses its normal no-canvas fallback. These checks do not validate canvas/PDF functionality or a reproducible clean dependency install.

Live engine, auth/backend flows, payments, full test suite, real Word workflow, physical devices and hosted images are not validated by this presentation task. No authorization denial occurred; pending integration is ownership/scope, not an approval block.

Focused ESLint: 0 errors; the original react-refresh warning was removed with the provisional contract validator. The final offer-contract follow-up passes focused ESLint without warnings. `git diff --check` passes.

### Exact offer contract follow-up

The final integration follow-up was tested with the temporary owner-supplied module: logs are `tests-offer-contract.txt`, `build-offer-contract.txt`, `typecheck-offer-contract.txt`, and `browser-offer-contract.json` in the artifact folder. Screenshots were refreshed with the selected numeric prices displayed. No canonical catalog file is included in this patch.

## Consumer integration verification (2026-10-30)

Integrated locally onto `e984c727` in `codex/cloud-word-verification`. The reconstructed producer diff was verified as 45,334 bytes, SHA256 `0d0242d78dbb2b7f4647c3be3465812275d8ea294e0afc5683cdcd91a4d7db67`. Non-Landing changes passed `git apply --check`; Landing was reconstructed against the producer's exact baseline and deliberately reconciled with the consumer presentation. Its minimal offer component was replaced by LaunchPricing. Profile, canonical citationOffers, legacy PLANS, accounting drafts and functional Word code were preserved. Only the BatchFootnoteBuilder tagline changed; obsolete 25-second shared-guide labels were removed.

Final integrated checks against the real canonical catalog:

- Focused presentation, offer, account and footnote tests: 62 passed in 5 files.
- Full regression with outbound Node network blocked: 4,406 passed, 4 skipped; 209 files passed and 1 skipped.
- `tsc -p tsconfig.app.json --noEmit` and `tsc -p tsconfig.node.json --noEmit`: passed.
- Production build: passed with existing chunk warnings. Focused ESLint and diff whitespace checks passed.
- Actual Landing and UserGuideModal components in a local browser harness, with mocked authentication and external requests blocked: passed at 1440, 390 and 320 pixels. Verified canonical disabled offers, navigation, three guide tabs with keyboard navigation, prelaunch Word disclosure and no horizontal overflow or page errors. Desktop/mobile screenshots were visually reviewed and retained locally only.

Evidence is under `/workspace/relex-verification/`: `landing-full.log`, `landing-focused.log`, `landing-types-app.log`, `landing-types-node.log`, `landing-build.log`, `landing-eslint.log`, and `landing-browser-result.json`. Browser validation used actual components in an isolated harness, not authenticated live application flows. Missing hosted guide images exercised the icon fallback; successful hosted-image loading/zoom remains unverified. Mobile widths do not establish physical-device behavior. No production auth, database, payment or citation-provider calls were made; no deployment or remote push occurred. Checkout remains disabled and Word remains labelled prelaunch. Existing payment-cycle, statutory cancellation/refund, VAT, live-engine and native Microsoft Word validation gaps remain unresolved.
