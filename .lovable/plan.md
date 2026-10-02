# Incident answer: legal-research-v2, 2026-10-02 02:13–02:38 UTC (read-only)

I ran two queries that return only metadata: the event type, the timestamp, the execution id, the version, and the status code. I read no message text, no app log content and no payloads. I made no edits.

## Observed platform lifecycle (function_logs)
| UTC | Event |
|---|---|
| 02:13:33.2 | boot (lock acquired 02:13:37) |
| 02:15:13.5 | boot |
| 02:16:53.9 | shutdown (no error event) |
| 02:19:36.9 | **CPU Time exceeded** + shutdown |
| 02:20:13.2 | shutdown (no error event) |
| 02:23:01.4 / 02:23:03.2 | boot x2, watchdog resume #0 at 02:23:03.5 |
| 02:25:20.264 | **CPU Time exceeded** + shutdown |
| 02:29:00.8 / 02:29:01.6 | boot x2, resume #1 at 02:29:01.9 |
| 02:32:01.791 | **CPU Time exceeded** + shutdown (exec 5fcc62d7, version 351) |
| 02:35:01.3 / 02:35:02.9 | boot x2, resume #2, HTTP 202 in 442 ms |
| 02:35:40.8 | shutdown (no error event) |

No wall-clock, memory, early-drop or other limit events appear in this window. The edge request log shows one request only: POST 202 at 02:35:03.

## Correlation with the stalls
- Attempt 1 began 02:19:23.761. The CPU kill came 13 s later, at 02:19:36.9.
- Attempt 2 began 02:25:20.247. A CPU kill is logged at 02:25:20.264, 17 ms later. But a heartbeat was written at 02:25:50, after that kill. So that kill probably came from a second worker running at the same time (two boots at 02:23). It may not be the worker that was making the call. I can't confirm which, because the execution id isn't returned for that row.
- Attempt 3 began 02:31:12.552 and had a heartbeat at 02:31:42.6. The CPU kill came at 02:32:01.8. This worker started at 02:29:00.8, so it had run about 181 s of wall-clock time.

## Verified vs inferred
- **Verified (platform metadata):** each of the three stalls lines up with a platform "CPU Time exceeded" shutdown. The worker that died in stall 3 had run about 181 s, so this wasn't a wall-clock kill. No memory or wall-clock termination was recorded.
- **Not observed:** any network, stream or database-write failure in the lifecycle metadata. Heartbeat write errors would only appear in application logs, which I didn't read. So heartbeat-write errors are **unverified**, not ruled out.
- **Inferred (generic Supabase documentation, not observed here):** a per-request CPU-time budget of about 2 s of CPU, not wall time. I can't read this function's configured CPU, memory or wall-clock limits or its tier from the metadata.
- **Hypothesis only:** the CPU use comes from heavy synchronous work during the downstream repair calls. Candidates are SSE parsing and JSON work on large replayed reasoning payloads or checkpoints. This hasn't been measured.

## Deployment version
- The platform reports deployment version **351** (id `…_0da654a2…_351`) for every event in the window.
- The metadata has no link between version 351 and git commit 4a2b6c8. I can't verify that it matches.

## Gaps the owner needs from support
1. The configured CPU-time, memory and wall-clock limits, and the plan tier, for function 0da654a2 at version 351.
2. Which execution id ran the call that started at 02:25:20.247, and whether two workers overlapped at 02:23–02:25.
3. Which deploy, by time or commit, created version 351, so it can be matched to 4a2b6c8.
4. Optional: per-execution CPU-time figures, if the platform can export them.
