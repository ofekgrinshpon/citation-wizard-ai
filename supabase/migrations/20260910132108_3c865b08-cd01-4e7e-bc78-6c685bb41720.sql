-- ══ Account-level concurrent operation protection ══════════════════════
CREATE TABLE IF NOT EXISTS public.active_operations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  operation_type text NOT NULL,
  project_id uuid,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text
);

GRANT SELECT ON public.active_operations TO authenticated;
GRANT ALL ON public.active_operations TO service_role;
ALTER TABLE public.active_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own active operation"
  ON public.active_operations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.operation_lock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event text NOT NULL,
  operation_type text,
  operation_id text,
  blocked_by_type text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.operation_lock_events TO service_role;
ALTER TABLE public.operation_lock_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read operation lock events"
  ON public.operation_lock_events FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_operation_lock_events_created_at
  ON public.operation_lock_events (created_at DESC);

-- ── Acquire ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acquire_operation_lock(
  _operation_type text,
  _operation_id text,
  _project_id uuid DEFAULT NULL,
  _stale_after interval DEFAULT '00:10:00'::interval
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_prev public.active_operations%ROWTYPE;
  v_row  public.active_operations%ROWTYPE;
  v_stale boolean := false;
  v_same boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;
  IF _operation_type IS NULL OR _operation_id IS NULL OR length(_operation_id) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_OPERATION');
  END IF;

  -- Admin/internal accounts may legitimately run parallel work (evaluation,
  -- smoke runs). No row is written, so they never block themselves.
  IF private.has_role(v_user, 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', true, 'bypass', true);
  END IF;

  SELECT * INTO v_prev FROM public.active_operations WHERE user_id = v_user FOR UPDATE;

  IF FOUND THEN
    v_same  := v_prev.operation_id = _operation_id;
    v_stale := v_prev.last_heartbeat_at < now() - _stale_after;
    IF v_prev.status = 'active' AND NOT v_same AND NOT v_stale THEN
      INSERT INTO public.operation_lock_events(user_id, event, operation_type, operation_id, blocked_by_type)
      VALUES (v_user, 'operation_lock_rejected', _operation_type, _operation_id, v_prev.operation_type);
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'OPERATION_IN_PROGRESS',
        'active_operation_type', v_prev.operation_type,
        'active_started_at', v_prev.started_at
      );
    END IF;
  END IF;

  INSERT INTO public.active_operations AS ao
    (user_id, operation_id, operation_type, project_id, status, started_at, last_heartbeat_at,
     released_at, release_reason)
  VALUES (v_user, _operation_id, _operation_type, _project_id, 'active', now(), now(), NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE
     SET operation_id      = EXCLUDED.operation_id,
         operation_type    = EXCLUDED.operation_type,
         project_id        = EXCLUDED.project_id,
         status            = 'active',
         started_at        = CASE WHEN ao.operation_id = EXCLUDED.operation_id AND ao.status = 'active'
                                  THEN ao.started_at ELSE now() END,
         last_heartbeat_at = now(),
         released_at       = NULL,
         release_reason    = NULL
   WHERE ao.status <> 'active'
      OR ao.operation_id = EXCLUDED.operation_id
      OR ao.last_heartbeat_at < now() - _stale_after
  RETURNING * INTO v_row;

  IF v_row.user_id IS NULL THEN
    -- Lost an exact race against a concurrent acquire.
    SELECT * INTO v_prev FROM public.active_operations WHERE user_id = v_user;
    INSERT INTO public.operation_lock_events(user_id, event, operation_type, operation_id, blocked_by_type)
    VALUES (v_user, 'operation_lock_rejected', _operation_type, _operation_id, v_prev.operation_type);
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'OPERATION_IN_PROGRESS',
      'active_operation_type', v_prev.operation_type,
      'active_started_at', v_prev.started_at
    );
  END IF;

  IF v_stale AND NOT v_same THEN
    INSERT INTO public.operation_lock_events(user_id, event, operation_type, operation_id, blocked_by_type)
    VALUES (v_user, 'stale_lock_recovered', _operation_type, _operation_id, v_prev.operation_type);
  END IF;

  INSERT INTO public.operation_lock_events(user_id, event, operation_type, operation_id)
  VALUES (v_user, 'operation_lock_acquired', _operation_type, _operation_id);

  RETURN jsonb_build_object('ok', true, 'reused', v_same, 'stale_recovered', (v_stale AND NOT v_same));
END;
$function$;

-- ── Release / heartbeat ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_operation_lock_for_user(
  _user_id uuid,
  _operation_id text,
  _reason text DEFAULT 'completed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.active_operations%ROWTYPE;
BEGIN
  UPDATE public.active_operations
     SET status = 'released', released_at = now(), release_reason = left(coalesce(_reason, 'completed'), 100)
   WHERE user_id = _user_id
     AND operation_id = _operation_id
     AND status = 'active'
  RETURNING * INTO v_row;

  IF v_row.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_released', true);
  END IF;

  INSERT INTO public.operation_lock_events(user_id, event, operation_type, operation_id, duration_ms)
  VALUES (
    _user_id, 'operation_lock_released', v_row.operation_type, v_row.operation_id,
    GREATEST(0, (EXTRACT(EPOCH FROM (now() - v_row.started_at)) * 1000)::int)
  );
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_operation_lock(
  _operation_id text,
  _reason text DEFAULT 'completed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;
  RETURN public.release_operation_lock_for_user(v_user, _operation_id, _reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.heartbeat_operation_lock_for_user(
  _user_id uuid,
  _operation_id text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.active_operations
     SET last_heartbeat_at = now()
   WHERE user_id = _user_id AND operation_id = _operation_id AND status = 'active'
  RETURNING true;
$function$;

REVOKE ALL ON FUNCTION public.release_operation_lock_for_user(uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.heartbeat_operation_lock_for_user(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.release_operation_lock_for_user(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_operation_lock_for_user(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_operation_lock(text, text, uuid, interval) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_operation_lock(text, text) TO authenticated, service_role;