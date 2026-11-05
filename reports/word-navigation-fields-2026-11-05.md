# Isolated Word-only release candidate — 2026-11-05

Branch: `release/word-navigation-only` in `/workspace/relex-word-release`.
Base and rollback reference: `ee5547607137ac8fc570696a7984fc2b76337d53` (read-only remote main check agrees).
Source fix: `11ed049cf4767e8b026159a3ba340a8491afb709`, cherry-picked without conflict. The original broad development branch at `bca4582e` is preserved, including its unrelated untracked report. None of its other commits or recovery-test clock changes are part of this candidate.

## Exact isolation

Only these files differ from main:
- `src/lib/docxFootnoteRoundtrip.ts`
- `src/lib/docxFootnoteRoundtrip.test.ts`
- `src/components/WordFootnoteWorkflow.tsx`
- `src/test/wordFootnoteWorkflow.test.tsx`
- this report

The entire `supabase` tree is identical to main: `8461f724c9956b487cf135a764b663bfe5ca1cad`. Lockfile blob is identical: `874b78fdd3401deec2d1ce48b3c9320382c7b7bb`. No backend, schema, provider, auth, quota, dependency, environment, build configuration or activation-gate changes. The broader branch's separate `preserved`-status behavior in WordFootnoteWorkflow is explicitly NOT included. No new source-family completion is activated by this candidate.

## Behavior

Balanced complex TOC and PAGEREF fields in the body are preserved verbatim, never evaluated. Supported switches are bounded: TOC `o` (quoted numeric heading range), `h`, `z`, `u`, `* MERGEFORMAT`; PAGEREF ASCII bookmark name plus `h`, `p`, `* MERGEFORMAT`. Cached-result separator is required; split instructions and nested PAGEREF in TOC results are supported. PAGEREF targets need a unique numeric bookmark ID, unique matching end and start-before-end order. Other commands/switches, simple fields, text-box fields, malformed nesting and footnote anchors inside fields fail closed. Fields in notes, revisions, endnotes, altChunk and compatibility alternatives remain blocked.

Empty balanced paragraph-level spelling/grammar proof markers no longer cause a note to be skipped. Unsupported marker shapes leave that note uneditable and unchanged. Only approved text-node payloads change. Original bytes are untouched; body XML, bookmarks, field instructions/results, footer PAGE fields, relationships and all other uncompressed package entries remain identical. The UI displays the session's update-fields/pagination warning and no longer claims all body fields are unsupported.

Synthetic coverage includes 39 notes, 22 proof-marked notes, nested TOC/PAGEREF, footer PAGE, selected replacement, byte comparisons and re-import, plus malformed/conflicting structures. No private user document was acquired or modified. Actual Word opening, field recalculation, pagination and the user's exact field syntax remain unverified. Field/proof-marker preservation is not semantic recalculation; the downloaded copy needs review in Word.

## Validation

Dependencies are reused through a local node_modules symlink from the existing checkout with the same manifests/lockfile. This is not a fresh clean install. All commands execute with the isolated worktree as cwd.

- Focused round-trip/workflow tests: **73 passed**, 2 files, no failures.
- Application TypeScript, Node TypeScript, production build: exit 0.
- Full final suite: **4,433 passed, 4 skipped, zero failures**, 209 files passed / 1 skipped, 92.83 seconds, exit 0. Three skipped RPC-privilege tests are not production permission verification.
- Whitespace diff check: passed.
- Independent isolated-candidate review: no blocking findings; confirmed exactly five Word/report files, no broad foreign-engine or backend/gate/config changes, no new dependencies, and single-commit rollback. The reviewer noted that broad-checkout results were historical; this isolated report replaces those with the terminal results above.

Logs: `/tmp/word-isolated-focused.log`, `/tmp/word-isolated-app-types.log`, `/tmp/word-isolated-node-types.log`, `/tmp/word-isolated-build.log`, `/tmp/word-isolated-full.log`, `/tmp/word-isolated-checks.json`.

## Publication and rollback plan — not executed

1. Confirm Lovable's active linked branch and deployment environment in its UI; connector metadata exposes editor SHA/is_published, not the active branch, deployed function SHA or gate values. Recheck remote main immediately before integrating; stop on new commits and review rather than force-push.
2. Integrate this one Word-only commit into the confirmed branch, verify Lovable synchronization to that exact SHA, then publish the frontend snapshot only after the parent approves the verified target. There are no backend or migration changes to deploy. Do not activate shared-completion flags or modify existing environment values.
3. Verify login separately without AI, then test synthetic Word upload/inspection and local preservation. Clicking citation-generation controls can still invoke existing paid routes; no provider call is authorized while the proposed $1 budget is unanswered. Publication does not constitute provider-test authorization.
4. Preserve base `ee5547607137ac8fc570696a7984fc2b76337d53`. If rollback is needed after integration, revert only this candidate commit and publish the reverted frontend, preserving any intervening work. Do not reset/force-push or revert unrelated changes. No database or server rollback is required by this diff.

Parent reports SELECT 1 succeeds, but login and provider behavior remain unverified. No push, publication, production/settings changes or live/paid provider call occurred while preparing this candidate.

## Primary technical evidence

- Complex fields and nesting: https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.fieldchar?view=openxml-3.0.1 . Support is intentionally narrower than the full format.
- Spelling/grammar markers: https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.prooferror?view=openxml-3.0.1 . Unsupported placements remain preserved through skipped notes.
