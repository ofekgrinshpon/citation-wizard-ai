-- DRAFT ONLY. NOT EXECUTED. Requires separate owner review and approval.
-- Durable per-run + per-UTC-day reservation ledger for ordinary public
-- research calls routed directly to OpenAI (V2_ORDINARY_TRANSPORT=openai_direct).
-- Without this table/RPCs the route fails closed before any dispatch.
-- Amounts are list-price upper-bound estimates, never invoice guarantees.

CREATE TABLE public.research_native_spend (
  attempt_id   uuid PRIMARY KEY,
  run_id       uuid NOT NULL,
  reserved_usd numeric(12,6) NOT NULL CHECK (reserved_usd > 0),
  settled_usd  numeric(12,6) NULL CHECK (settled_usd IS NULL OR settled_usd >= 0),
  state        text NOT NULL DEFAULT 'reserved'
               CHECK (state IN ('reserved','settled','uncertain','released')),
  utc_day      date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'settled' OR (settled_usd IS NOT NULL AND settled_usd <= reserved_usd))
);
CREATE INDEX research_native_spend_run_idx ON public.research_native_spend (run_id);
CREATE INDEX research_native_spend_open_idx ON public.research_native_spend (state) WHERE state IN ('reserved','uncertain');
CREATE INDEX research_native_spend_day_idx ON public.research_native_spend (utc_day) WHERE state = 'settled';

REVOKE ALL ON public.research_native_spend FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.research_native_spend TO service_role;
ALTER TABLE public.research_native_spend ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (bypasses RLS) can read/write.

-- Reserve: one global advisory lock serializes all reservations so BOTH caps
-- hold under concurrency. An existing attempt_id returns 'duplicate' and never
-- authorizes a dispatch (even if job/amount match).
CREATE OR REPLACE FUNCTION public.reserve_ordinary_native_spend(
  p_attempt_id uuid, p_run_id uuid, p_usd numeric, p_run_cap numeric, p_day_cap numeric
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run numeric; v_day numeric; v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF p_usd IS NULL OR p_usd <= 0 OR p_run_cap IS NULL OR p_run_cap <= 0
     OR p_day_cap IS NULL OR p_day_cap <= 0 THEN RETURN 'error'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('research_native_spend'));
  IF EXISTS (SELECT 1 FROM research_native_spend WHERE attempt_id = p_attempt_id) THEN
    RETURN 'duplicate';
  END IF;
  SELECT COALESCE(SUM(CASE WHEN state IN ('reserved','uncertain') THEN reserved_usd
                           WHEN state = 'settled' THEN settled_usd ELSE 0 END), 0)
    INTO v_run FROM research_native_spend WHERE run_id = p_run_id;
  IF v_run + p_usd > p_run_cap THEN RETURN 'run_cap'; END IF;
  -- Open liability counts on every day (carries across UTC day changes);
  -- settled spend counts on its own UTC day.
  SELECT COALESCE(SUM(CASE WHEN state IN ('reserved','uncertain') THEN reserved_usd
                           WHEN state = 'settled' AND utc_day = v_today THEN settled_usd ELSE 0 END), 0)
    INTO v_day FROM research_native_spend;
  IF v_day + p_usd > p_day_cap THEN RETURN 'day_cap'; END IF;
  INSERT INTO research_native_spend (attempt_id, run_id, reserved_usd) VALUES (p_attempt_id, p_run_id, p_usd);
  RETURN 'reserved';
END $$;

-- Transitions only out of 'reserved'; a second call is a no-op returning false,
-- so a resume can never double-settle or double-release.
CREATE OR REPLACE FUNCTION public.settle_ordinary_native_spend(p_attempt_id uuid, p_usd numeric)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (
    UPDATE research_native_spend SET state = 'settled', settled_usd = p_usd,
      utc_day = (now() AT TIME ZONE 'utc')::date, updated_at = now()
    WHERE attempt_id = p_attempt_id AND state = 'reserved' AND p_usd >= 0 AND p_usd <= reserved_usd
    RETURNING 1) SELECT EXISTS (SELECT 1 FROM u);
$$;
CREATE OR REPLACE FUNCTION public.mark_ordinary_native_spend_uncertain(p_attempt_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (UPDATE research_native_spend SET state = 'uncertain', updated_at = now()
    WHERE attempt_id = p_attempt_id AND state = 'reserved' RETURNING 1) SELECT EXISTS (SELECT 1 FROM u);
$$;
CREATE OR REPLACE FUNCTION public.release_ordinary_native_spend(p_attempt_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (UPDATE research_native_spend SET state = 'released', updated_at = now()
    WHERE attempt_id = p_attempt_id AND state = 'reserved' RETURNING 1) SELECT EXISTS (SELECT 1 FROM u);
$$;

REVOKE ALL ON FUNCTION public.reserve_ordinary_native_spend(uuid, uuid, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_ordinary_native_spend(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_ordinary_native_spend_uncertain(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ordinary_native_spend(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ordinary_native_spend(uuid, uuid, numeric, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ordinary_native_spend(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_ordinary_native_spend_uncertain(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ordinary_native_spend(uuid) TO service_role;
