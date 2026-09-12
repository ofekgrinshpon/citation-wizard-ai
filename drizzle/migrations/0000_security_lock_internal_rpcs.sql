-- Security hardening: internal/service-only RPCs were reachable by anon/authenticated
-- via PostgREST (blanket platform grants overrode earlier REVOKE ... FROM PUBLIC).

-- 1) Defense in depth: caller guards inside the cross-user lock helpers.
CREATE OR REPLACE FUNCTION public.heartbeat_operation_lock_for_user(_user_id uuid, _operation_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  ok boolean;
BEGIN
  -- service_role / internal callers have no auth.uid(); end users may only touch their own lock.
  IF caller IS NOT NULL AND caller <> _user_id THEN
    RETURN false;
  END IF;
  UPDATE public.active_operations
     SET last_heartbeat_at = now()
   WHERE user_id = _user_id AND operation_id = _operation_id AND status = 'active'
  RETURNING true INTO ok;
  RETURN COALESCE(ok, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_operation_lock_for_user(_user_id uuid, _operation_id text, _reason text DEFAULT 'completed'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  found_row public.active_operations;
BEGIN
  IF caller IS NOT NULL AND caller <> _user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  UPDATE public.active_operations
     SET status = 'released',
         released_at = now(),
         release_reason = COALESCE(_reason, 'completed')
   WHERE user_id = _user_id
     AND operation_id = _operation_id
     AND status = 'active'
   RETURNING * INTO found_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_released', true);
  END IF;

  INSERT INTO public.operation_lock_events (user_id, event, operation_type, operation_id, duration_ms)
  VALUES (_user_id, 'released', found_row.operation_type, _operation_id,
          GREATEST(0, (EXTRACT(EPOCH FROM (now() - found_row.started_at)) * 1000)::int));

  RETURN jsonb_build_object('ok', true, 'released', true);
END;
$function$;

-- 2) Lock down execution to service_role only for internal/system RPCs.
REVOKE EXECUTE ON FUNCTION public.heartbeat_operation_lock_for_user(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_operation_lock_for_user(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_operation_lock_for_user(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_operation_lock_for_user(uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role, postgres;

REVOKE EXECUTE ON FUNCTION public.rebuild_hnsw_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_hnsw_index() TO service_role;

REVOKE EXECUTE ON FUNCTION public.reset_or_renew_credits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_or_renew_credits() TO service_role, postgres;

REVOKE EXECUTE ON FUNCTION public.grant_referral_bonus_if_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_referral_bonus_if_eligible(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refund_credits_for_user(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits_for_user(uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_legal_chunk_embeddings(jsonb) TO service_role;
