
CREATE OR REPLACE FUNCTION public.consume_usage_batch(_batch_id text, _group_size integer, _reason text, _request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  uid uuid := auth.uid();
  processed int;
  charge int;
  res jsonb;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;
  IF _batch_id IS NULL OR length(_batch_id) < 4 OR _group_size IS NULL OR _group_size < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_BATCH');
  END IF;

  -- Serialize concurrent items of the same batch so the group counter is exact.
  PERFORM pg_advisory_xact_lock(hashtext(uid::text || ':' || _batch_id));

  SELECT count(*) INTO processed FROM public.credit_ledger
   WHERE user_id = uid
     AND event_type = 'consume'
     AND metadata->>'batch_id' = _batch_id
     AND request_id <> _request_id;

  charge := CASE WHEN processed % _group_size = 0 THEN 1 ELSE 0 END;

  res := public.consume_credits(charge, _reason, _request_id);

  IF COALESCE((res->>'ok')::boolean, false) THEN
    UPDATE public.credit_ledger
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('batch_id', _batch_id,
                                            'batch_index', processed,
                                            'group_size', _group_size)
     WHERE user_id = uid AND request_id = _request_id AND event_type = 'consume';
  END IF;

  RETURN res || jsonb_build_object('batch_id', _batch_id, 'batch_index', processed, 'charged', charge);
END;
$function$;
