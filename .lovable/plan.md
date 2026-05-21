
## Root cause

When you submit a Deep query, `legal-qa` queues an async worker and **pre-inserts a `qa_logs` row** with `answer = "מעבד שאלה…"` and `metadata.pipeline_used = "core_running"`, so a crash leaves a trace.

The polling endpoint `supabase/functions/legal-qa-status/index.ts` derives status like this:

```ts
function deriveStatus(metadata, hasAnswer) {
  if (hasAnswer) return "completed";   // ← bug
  if (metadata?.checkpoint === "failed") return "failed";
  ...
  return "running";
}
```

`hasAnswer` is true the instant the placeholder row exists. So the very first poll (≈1s after submit) returns:

```json
{ "status": "completed", "answer": "מעבד שאלה…", "footnotes": [], "total_footnotes": 0 }
```

The client sees `status=completed` with no footnotes and renders the "failed to generate" error card. Confirmed in the DB right now:

| run_id | pipeline_used | answer | footnotes |
|---|---|---|---|
| `bf4f3a4d…` | `core_running` | `מעבד שאלה…` | 0 |
| `97337a29…` | `core_running` | `מעבד שאלה…` | 0 |

Both rows are still stuck on `core_running` — the background worker never updated them. So in the UI you got two false "completed" responses while the worker was still going.

A secondary signal in the same window:

```
2026-05-21T20:13:17Z ERROR [core retrieval vec] C1: canceling statement due to statement timeout
```

That's the local pgvector retrieval (`match_legal_chunks` RPC) hitting Postgres `statement_timeout` for claim C1. The retrieval code already swallows it and returns `[]`, so this is **not** what failed the run from the UI's perspective — but it's a real performance issue that can leave Deep runs with thinner local hits.

So there are two issues, in priority order.

## Plan

### Fix 1 — Status endpoint must not treat placeholder as completed (the actual UI failure)

`supabase/functions/legal-qa-status/index.ts`:

- Update `deriveStatus`:
  - A run is `completed` only when both `answer` exists **and** `metadata.pipeline_used` is one of the terminal states (`core`, `core_failed`, `v3`, `v4`, `legacy`, etc.) — i.e. **not** `core_running`. Equivalently: `metadata.checkpoint === "completed"` OR `pipeline_used !== "core_running"` with a non-placeholder answer.
  - Add an explicit guard: if `answer === "מעבד שאלה…"` (the known placeholder), force status to `running`.
- Also stop returning `answer`, `footnotes`, etc. in the response when status is `running` / `queued` — only emit them on `completed` or `failed`. (Today the placeholder leaks out and confuses the client.)

Optional small addition: include `metadata.pipeline_used` in `progress` so we can spot stuck `core_running` rows from the client.

### Fix 2 — Mark stuck `core_running` rows as failed if the worker never finishes

The async dispatcher in `legal-qa/index.ts` already catches background crashes and writes `checkpoint: "failed"`, but **silent EdgeRuntime kills** (CPU/wall-time) leave the row at `core_running` forever.

- Add a server-side timeout check in `legal-qa-status`: if `pipeline_used === "core_running"` AND `created_at` is older than N minutes (e.g. 6 min — Deep budget is ~3–4 min), return `status: "failed"` with `reason: "worker_timeout"`. Don't mutate the row from the status endpoint; just project the state.
- The client already handles `failed` (shows the error card with Try Again), so no client change needed for this.

### Fix 3 — pgvector timeout on C1 (lower priority, separate follow-up)

The `[core retrieval vec] C1: canceling statement due to statement timeout` line means `match_legal_chunks` is too slow on some claim embeddings. Out of scope for this hotfix — flagging only. Possible follow-ups (not in this plan): a) lower `match_count`, b) split into two RPC calls, c) raise `statement_timeout` for that one RPC via `SET LOCAL`. Will open a separate investigation if you want.

## Files

- `supabase/functions/legal-qa-status/index.ts` — rewrite `deriveStatus` + response payload gating.

## Validation

1. Submit a Deep query from the UI. Within 1–2s the status poll should return `status: "running"` (not `completed`).
2. Wait normally; once the worker finishes and writes the real answer + footnotes, the next poll flips to `status: "completed"` with the real content.
3. Force a crash by sending a malformed body or killing the worker; verify the row eventually reads `status: "failed"` (either via existing checkpoint or via the new 6-min watchdog).
4. Re-check the two stuck rows from this session — they should now report `status: "failed"` (worker_timeout) instead of `completed`.

## Out of scope

- The `[core retrieval vec]` statement_timeout itself (Fix 3 — flag only).
- Any change to the Core pipeline or to `legal-qa` worker logic.
- Any UI change — the client already handles `running` / `completed` / `failed` correctly.
