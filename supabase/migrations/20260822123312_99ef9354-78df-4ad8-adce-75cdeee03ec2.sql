CREATE OR REPLACE FUNCTION public.reap_stale_research_jobs(_max_age interval DEFAULT interval '12 minutes')
RETURNS TABLE(reaped_id uuid, prior_stage text, stale_seconds double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  j record;
  v_run_id text;
  v_answer text := 'החיפוש אחר מקורות הופסק באמצע העיבוד ולא ניתן היה להשלים תשובה משפטית מבוססת. ייתכן שאיתור גוף פסקי הדין דרש עיבוד כבד מדי. נסו להריץ שוב, לצמצם את השאלה, או לצרף את המסמך הרלוונטי.';
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

    UPDATE public.legal_research_jobs
       SET status = 'done',
           error = 'retrieval_interrupted_limitation',
           updated_at = now(),
           current_stage = NULL,
           result = jsonb_build_object(
             'answer', v_answer,
             'footnotes', '[]'::jsonb,
             'used_sources', '[]'::jsonb,
             'branch', 'retrieval_interrupted_limitation',
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
               'branch', 'retrieval_interrupted_limitation',
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
            'branch', 'retrieval_interrupted_limitation',
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
$fn$;

REVOKE ALL ON FUNCTION public.reap_stale_research_jobs(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_research_jobs(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_stale_research_jobs(interval) TO postgres;