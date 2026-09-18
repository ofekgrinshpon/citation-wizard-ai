#!/usr/bin/env bash
# ReLex V2 literature-review acceptance driver.
# Runs prompts strictly sequentially. Polls v2_eval_runs; if the checkpoint
# goes stale (worker killed, known stall) it kicks the production resume path
# and records the event. Harness-only; no product code involved.
set -u
OUT=/tmp/litrev
mkdir -p "$OUT"
STALE_MS=180000
MAX_MIN=40

for ID in "$@"; do
  echo "=== $ID launch $(date -u +%T)" >> "$OUT/log"
  RES=$(bun scripts/v2-litreview-acceptance.ts "$ID" 2>&1)
  echo "$RES" >> "$OUT/log"
  RUN=$(echo "$RES" | grep -o '"run_id":"[^"]*' | cut -d'"' -f4)
  [ -z "$RUN" ] && { echo "$ID LAUNCH_FAIL" >> "$OUT/log"; continue; }
  echo "$ID $RUN" >> "$OUT/runs"
  START=$(date +%s)
  RESUMES=0
  while :; do
    ROW=$(psql -tAc "select status||'|'||coalesce(agent_state->'resume'->>'paused_at','0') from v2_eval_runs where run_id='$RUN'")
    ST=${ROW%%|*}; CP=${ROW##*|}
    NOW=$(date +%s)
    case "$ST" in done|error|failed|timed_out)
      echo "$ID TERMINAL $ST after $((NOW-START))s resumes=$RESUMES" >> "$OUT/log"; break;; esac
    if [ $(( (NOW-START)/60 )) -ge $MAX_MIN ]; then
      echo "$ID GAVE_UP after $((NOW-START))s status=$ST resumes=$RESUMES" >> "$OUT/log"; break
    fi
    NOWMS=$((NOW*1000))
    if [ "$CP" != "0" ] && [ $((NOWMS-CP)) -gt $STALE_MS ]; then
      echo "$ID STALL detected age=$(( (NOWMS-CP)/1000 ))s -> resume $(date -u +%T)" >> "$OUT/log"
      curl -s -X POST "$SUPABASE_URL/functions/v1/legal-research-v2" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $VITE_SUPABASE_PUBLISHABLE_KEY" \
        -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" \
        -H "x-smoke-mode: 1" -H "x-smoke-token: $V2_EVAL_TOKEN_D" \
        -d "{\"resume_run_id\":\"$RUN\"}" >> "$OUT/log"
      echo "" >> "$OUT/log"
      RESUMES=$((RESUMES+1))
      sleep 30
    fi
    sleep 20
  done
  psql -tAc "select coalesce(result::text,'null') from v2_eval_runs where run_id='$RUN'" > "$OUT/$ID.json"
  psql -tAc "select status from v2_eval_runs where run_id='$RUN'" > "$OUT/$ID.status"
  echo "$ID saved $(date -u +%T)" >> "$OUT/log"
done
echo "DRIVER DONE $(date -u +%T)" >> "$OUT/log"
