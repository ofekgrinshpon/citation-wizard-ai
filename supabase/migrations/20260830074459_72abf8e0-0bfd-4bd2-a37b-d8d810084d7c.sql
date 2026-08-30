ALTER TABLE public.legal_research_jobs ADD COLUMN IF NOT EXISTS credit_request_id text;

CREATE OR REPLACE FUNCTION public.refund_credits_for_user(_user_id uuid, _request_id text, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  consume_row public.credit_ledger;
  prior public.credit_ledger;
  prof public.profiles;
BEGIN
  IF _user_id IS NULL OR _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ARGS');
  END IF;

  SELECT * INTO prior FROM public.credit_ledger
   WHERE user_id = _user_id AND request_id = _request_id AND event_type = 'refund' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true);
  END IF;

  SELECT * INTO consume_row FROM public.credit_ledger
   WHERE user_id = _user_id AND request_id = _request_id AND event_type = 'consume' LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  PERFORM set_config('app.credit_txn', '1', true);
  UPDATE public.profiles
     SET included_credits_remaining = included_credits_remaining + (-consume_row.included_delta),
         topup_credits_remaining = topup_credits_remaining + (-consume_row.topup_delta)
   WHERE id = _user_id
   RETURNING * INTO prof;
  PERFORM set_config('app.credit_txn', '0', true);

  INSERT INTO public.credit_ledger
    (user_id, request_id, event_type, amount, included_delta, topup_delta,
     balance_after_included, balance_after_topup, reason)
  VALUES
    (_user_id, _request_id, 'refund', -consume_row.amount,
     -consume_row.included_delta, -consume_row.topup_delta,
     prof.included_credits_remaining, prof.topup_credits_remaining, _reason);

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.refund_credits_for_user(uuid, text, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reap_stale_research_jobs(_max_age interval DEFAULT '12 minutes'::interval)
RETURNS TABLE(reaped_id uuid, prior_stage text, stale_seconds double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j record;
  v_run_id text;
  v_answer text := 'המחקר הופסק בגלל תקלה תשתיתית ולא הושלמה תשובה משפטית מבוססת. לא מוצגת תשובת ביניים. הקרדיטים על ההרצה הזו הוחזרו. אפשר להריץ שוב, לצמצם את השאלה, או לצרף את המסמך הרלוונטי.';
  v_updated int;
BEGIN
  FOR j IN
    SELECT * FROM public.legal_research_jobs
     WHERE status IN ('running','queued')
       AND updated_at < now() - _max_age
       AND created_at < now() - _max_age
     FOR UPDATE SKIP LOCKED
  LOOP
    v_run_id := NULLIF(j.result->>'run_id', '');

    IF j.credit_request_id IS NOT NULL THEN
      PERFORM public.refund_credits_for_user(j.user_id, j.credit_request_id, 'auto-refund: stale_worker_timeout');
    END IF;

    UPDATE public.legal_research_jobs
       SET status = 'timed_out',
           error = 'stale_worker_timeout',
           updated_at = now(),
           completed_at = now(),
           current_stage = NULL,
           progress_label_he = NULL,
           result = jsonb_build_object(
             'answer', '',
             'footnotes', '[]'::jsonb,
             'used_sources', '[]'::jsonb,
             'branch', 'infrastructure_timeout',
             'infrastructure_failure', true,
             'timed_out', true,
             'credits_refunded', (j.credit_request_id IS NOT NULL),
             'notice_he', v_answer,
             'run_id', v_run_id,
             'reaper_terminal_limitation_written', true,
             'prior_stage', j.current_stage,
             'retrieval_checkpoints', COALESCE(j.result->'retrieval_checkpoints', '[]'::jsonb)
           )
     WHERE id = j.id;

    IF v_run_id IS NOT NULL THEN
      UPDATE public.qa_logs q
         SET answer = v_answer,
             metadata = COALESCE(q.metadata, '{}'::jsonb) || jsonb_build_object(
               'trace_status', 'terminal',
               'branch', 'infrastructure_timeout',
               'infrastructure_failure', true,
               'terminal_result_written', true,
               'reaper_terminal_limitation_written', true,
               'reaped_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'prior_stage', j.current_stage
             )
       WHERE q.metadata->>'run_id' = v_run_id
         AND COALESCE(q.metadata->>'trace_status', '') <> 'terminal';
      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated = 0 THEN
        INSERT INTO public.qa_logs (
          user_id, project_id, question, answer, task_mode,
          footnotes, local_footnotes_count, perplexity_footnotes_count, total_footnotes,
          metadata
        ) VALUES (
          j.user_id, j.project_id, j.question, v_answer, 'legal_research_v1',
          '[]'::jsonb, 0, 0, 0,
          jsonb_build_object(
            'pipeline', 'legal-research-v1',
            'run_id', v_run_id,
            'trace_status', 'terminal',
            'branch', 'infrastructure_timeout',
            'infrastructure_failure', true,
            'terminal_result_written', true,
            'reaper_terminal_limitation_written', true,
            'prior_stage', j.current_stage
          )
        );
      END IF;
    END IF;

    reaped_id := j.id;
    prior_stage := j.current_stage;
    stale_seconds := EXTRACT(EPOCH FROM (now() - j.created_at))::double precision;
    RETURN NEXT;
  END LOOP;
END;
$$;