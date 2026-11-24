-- Checkout remains CLOSED until the owner-supplied page contract is verified.
CREATE TABLE public.citation_pass_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 checkout_enabled boolean NOT NULL DEFAULT false,
 settlement_enabled boolean NOT NULL DEFAULT false,
 page_url text DEFAULT 'https://paypage.takbull.co.il/3CxDl',
 page_id text NOT NULL DEFAULT '3CxDl' CHECK(page_id='3CxDl'),
 currency text NOT NULL DEFAULT 'ILS' CHECK(currency='ILS'),
 CHECK(NOT checkout_enabled OR settlement_enabled),
 CHECK(NOT checkout_enabled OR page_url IS NOT NULL)
);
GRANT ALL ON public.citation_pass_config TO service_role;
ALTER TABLE public.citation_pass_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.citation_pass_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id),
 reference text NOT NULL UNIQUE DEFAULT ('rlx_'||replace(gen_random_uuid()::text,'-','')) CHECK(reference ~ '^rlx_[0-9a-f]{32}$'),
 offer_id text NOT NULL CHECK(offer_id IN ('citation_week_pass_v1','citation_month_pass_v1')),
 amount_ils integer NOT NULL,
 source_count integer NOT NULL,
 sources_remaining integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled')),
 transaction_id text UNIQUE,
 provider_order_number text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 activated_at timestamptz,
 expires_at timestamptz,
 CHECK((offer_id='citation_week_pass_v1' AND amount_ils=39 AND source_count=100) OR
       (offer_id='citation_month_pass_v1' AND amount_ils=65 AND source_count=250)),
 CHECK(sources_remaining BETWEEN 0 AND source_count),
 CHECK((status='pending' AND transaction_id IS NULL AND provider_order_number IS NULL AND activated_at IS NULL AND expires_at IS NULL) OR
       (status='settled' AND transaction_id IS NOT NULL AND provider_order_number IS NOT NULL AND activated_at IS NOT NULL AND expires_at IS NOT NULL)),
 CHECK(transaction_id IS NULL OR transaction_id ~ '^[1-9][0-9]{0,19}$'),
 CHECK(provider_order_number IS NULL OR provider_order_number ~ '^[1-9][0-9]{0,19}$')
);
GRANT ALL ON public.citation_pass_orders TO service_role;
ALTER TABLE public.citation_pass_orders ENABLE ROW LEVEL SECURITY;
CREATE INDEX citation_pass_orders_account ON public.citation_pass_orders(user_id, expires_at);

CREATE TABLE public.citation_pass_usage (
 user_id uuid NOT NULL REFERENCES public.profiles(id),
 request_id text NOT NULL,
 order_id uuid NOT NULL REFERENCES public.citation_pass_orders(id),
 state text NOT NULL DEFAULT 'in_progress' CHECK(state IN ('in_progress','succeeded','failed','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_id),
 FOREIGN KEY(user_id,request_id) REFERENCES public.citation_usage_requests(user_id,request_id)
);
GRANT ALL ON public.citation_pass_usage TO service_role;
ALTER TABLE public.citation_pass_usage ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.get_citation_checkout_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
 SELECT jsonb_build_object('enabled',COALESCE((SELECT checkout_enabled AND settlement_enabled AND page_url IS NOT NULL FROM public.citation_pass_config WHERE singleton),false));
$$;
REVOKE ALL ON FUNCTION public.get_citation_checkout_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_citation_checkout_status() TO anon,authenticated,service_role;

CREATE FUNCTION public.create_citation_pass_order(_user_id uuid,_offer_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE o public.citation_pass_orders; c public.citation_pass_config;
BEGIN
 PERFORM public._require_usage_service();
 SELECT * INTO c FROM public.citation_pass_config WHERE singleton;
 IF NOT FOUND OR NOT c.checkout_enabled OR NOT c.settlement_enabled OR c.page_url IS NULL THEN
   RETURN jsonb_build_object('ok',false,'error','CHECKOUT_CLOSED');
 END IF;
 IF _offer_id IS NULL OR _offer_id NOT IN ('citation_week_pass_v1','citation_month_pass_v1') THEN
   RETURN jsonb_build_object('ok',false,'error','UNKNOWN_OFFER');
 END IF;
 PERFORM 1 FROM public.profiles WHERE id=_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','PROFILE_NOT_FOUND'); END IF;
 -- A reference is generated per checkout, never per user and never recycled.
 INSERT INTO public.citation_pass_orders(user_id,offer_id,amount_ils,source_count,sources_remaining)
 VALUES(_user_id,_offer_id,CASE _offer_id WHEN 'citation_week_pass_v1' THEN 39 ELSE 65 END,
 CASE _offer_id WHEN 'citation_week_pass_v1' THEN 100 ELSE 250 END,
 CASE _offer_id WHEN 'citation_week_pass_v1' THEN 100 ELSE 250 END) RETURNING * INTO o;
 RETURN jsonb_build_object('ok',true,'reference',o.reference,'page_url',c.page_url,'order_id',o.id);
END;
$$;
REVOKE ALL ON FUNCTION public.create_citation_pass_order(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_citation_pass_order(uuid,text) TO service_role;

-- No payload storage, no customer data, no entitlement from an unsigned call.
-- The only caller is the dedicated HMAC-verifying server function.
CREATE FUNCTION public.citation_pass_expiry(_start timestamptz,_offer_id text) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog,public AS $$
 SELECT CASE _offer_id WHEN 'citation_week_pass_v1' THEN _start + interval '168 hours'
 WHEN 'citation_month_pass_v1' THEN ((_start AT TIME ZONE 'Asia/Jerusalem')+interval '1 month') AT TIME ZONE 'Asia/Jerusalem' END;
$$;
REVOKE ALL ON FUNCTION public.citation_pass_expiry(timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.citation_pass_expiry(timestamptz,text) TO service_role;

CREATE FUNCTION public.settle_citation_pass_order(_reference text,_transaction_id text,_order_number text,
 _amount_ils integer,_currency text,_order_status integer,_status_code integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE o public.citation_pass_orders; uid uuid; c public.citation_pass_config; ts timestamptz:=now();
BEGIN
 PERFORM public._require_usage_service();
 SELECT * INTO c FROM public.citation_pass_config WHERE singleton;
 IF NOT FOUND OR NOT c.settlement_enabled THEN RETURN jsonb_build_object('ok',false,'disabled',true); END IF;
 IF _reference IS NULL OR _reference !~ '^rlx_[0-9a-f]{32}$' OR _transaction_id IS NULL OR _transaction_id !~ '^[1-9][0-9]{0,19}$'
 OR _order_number IS NULL OR _order_number !~ '^[1-9][0-9]{0,19}$' OR _order_status IS DISTINCT FROM 2 OR _status_code IS DISTINCT FROM 0
 OR _amount_ils IS NULL OR _amount_ils NOT IN (39,65) OR (_currency IS NOT NULL AND _currency<>'ILS') OR c.currency<>'ILS' OR c.page_id<>'3CxDl' THEN
   RETURN jsonb_build_object('ok',false,'error','PAYMENT_REJECTED');
 END IF;
 SELECT user_id INTO uid FROM public.citation_pass_orders WHERE reference=_reference;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','ORDER_NOT_FOUND'); END IF;
 -- Same lock order as citation consumption/refunds: profile, then order.
 PERFORM 1 FROM public.profiles WHERE id=uid FOR UPDATE;
 SELECT * INTO o FROM public.citation_pass_orders WHERE reference=_reference FOR UPDATE;
 IF o.amount_ils<>_amount_ils THEN RETURN jsonb_build_object('ok',false,'error','AMOUNT_MISMATCH'); END IF;
 IF o.status='settled' THEN
   IF o.transaction_id=_transaction_id AND o.provider_order_number=_order_number THEN
     RETURN jsonb_build_object('ok',true,'replayed',true);
   END IF;
   RETURN jsonb_build_object('ok',false,'error','SETTLEMENT_CONFLICT');
 END IF;
 IF EXISTS(SELECT 1 FROM public.citation_pass_orders WHERE transaction_id=_transaction_id OR provider_order_number=_order_number) THEN
   RETURN jsonb_build_object('ok',false,'error','TRANSACTION_ALREADY_USED');
 END IF;
 UPDATE public.citation_pass_orders SET status='settled',transaction_id=_transaction_id,provider_order_number=_order_number,
 activated_at=ts,expires_at=public.citation_pass_expiry(ts,offer_id)
 WHERE id=o.id;
 RETURN jsonb_build_object('ok',true,'replayed',false);
EXCEPTION WHEN unique_violation THEN
 RETURN jsonb_build_object('ok',false,'error','TRANSACTION_ALREADY_USED');
END;
$$;
REVOKE ALL ON FUNCTION public.settle_citation_pass_order(text,text,text,integer,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_citation_pass_order(text,text,text,integer,text,integer,integer) TO service_role;

CREATE FUNCTION public.get_citation_pass_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
 RETURN jsonb_build_object('ok',true,'checkout_enabled',(public.get_citation_checkout_status()->>'enabled')::boolean,
 'passes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'offer_id',offer_id,'status',
 CASE WHEN status='pending' THEN 'pending' WHEN expires_at<=now() THEN 'expired' WHEN sources_remaining=0 THEN 'exhausted' ELSE 'active' END,
 'activated_at',activated_at,'expires_at',expires_at,'used_ratio',round((source_count-sources_remaining)::numeric/source_count,4)) ORDER BY created_at DESC)
 FROM (SELECT * FROM public.citation_pass_orders WHERE user_id=auth.uid() ORDER BY created_at DESC LIMIT 20) p),'[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_citation_pass_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_citation_pass_status() TO authenticated,service_role;

DO $gate$
BEGIN
 IF md5(pg_get_functiondef('public._citation_refund_receipt(uuid,text)'::regprocedure)) <> '701db38b4d3839c10f095111fafb8ba9' THEN RAISE EXCEPTION 'Citation usage schema drift: _citation_refund_receipt'; END IF;
 IF md5(pg_get_functiondef('public.begin_citation_request(uuid,text,text,text,text,jsonb)'::regprocedure)) <> 'e3bd4901250c48f97b3d5b68101ba05a' THEN RAISE EXCEPTION 'Citation usage schema drift: begin_citation_request'; END IF;
 IF md5(pg_get_functiondef('public.finish_citation_request(uuid,text,uuid,text,text,jsonb)'::regprocedure)) <> 'af46de7de882b7259387565c19952982' THEN RAISE EXCEPTION 'Citation usage schema drift: finish_citation_request'; END IF;
 IF md5(pg_get_functiondef('public._citation_trial_limited(public.profiles)'::regprocedure)) <> 'aafec0ca97bfc483052434d7df017bc4' THEN RAISE EXCEPTION 'Citation usage schema drift: _citation_trial_limited'; END IF;
END;
$gate$;

DO $patch$
DECLARE body text; needle text; replacement text;
BEGIN
 body := pg_get_functiondef('public.begin_citation_request(uuid,text,text,text,text,jsonb)'::regprocedure);
 needle := $needle$  trial_used integer; trial_limit integer;$needle$;
 replacement := $replacement$  trial_used integer; trial_limit integer;
  pass_order public.citation_pass_orders;$replacement$;
 IF (length(body)-length(replace(body,needle,'')))/length(needle) <> 1 THEN RAISE EXCEPTION 'Citation patch anchor drift'; END IF;
 body := replace(body,needle,replacement);
 needle := $needle$  IF public._citation_trial_limited(prof) THEN$needle$;
 replacement := $replacement$  -- Paid sources use their own ledger, no legacy credits or five-source batch grouping.
  SELECT * INTO pass_order FROM public.citation_pass_orders
   WHERE user_id=_user_id AND status='settled' AND expires_at>now_ts AND sources_remaining>0
   ORDER BY expires_at,id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    INSERT INTO public.citation_usage_requests(user_id,request_id,fingerprint,batch_id,retry_of_request_id,batch_anchor_request_id,charged_units,state,attempt_token)
    VALUES(_user_id,_request_id,_fingerprint,_batch_id,_retry_of_request_id,NULL,1,'in_progress',token);
    INSERT INTO public.citation_recovery_payloads(user_id,request_id,input,expires_at)
    VALUES(_user_id,_request_id,_recovery_input,now_ts+interval '24 hours');
    UPDATE public.citation_pass_orders SET sources_remaining=sources_remaining-1 WHERE id=pass_order.id;
    INSERT INTO public.citation_pass_usage(user_id,request_id,order_id) VALUES(_user_id,_request_id,pass_order.id);
    RETURN jsonb_build_object('ok',true,'execute',true,'status','in_progress','request_id',_request_id,
      'attempt_token',token,'charged',1,'admin',false,'citation_pass',true,
      'retry_of_request_id',_retry_of_request_id,'retry_parent_refund_receipt',parent_receipt);
  END IF;
  IF EXISTS(SELECT 1 FROM public.citation_pass_orders WHERE user_id=_user_id AND status='settled' AND expires_at>now_ts) THEN
    RETURN jsonb_build_object('ok',false,'execute',false,'error','INSUFFICIENT_CREDITS','block_reason','pass_exhausted');
  END IF;
  IF public._citation_trial_limited(prof) THEN$replacement$;
 IF (length(body)-length(replace(body,needle,'')))/length(needle) <> 1 THEN RAISE EXCEPTION 'Citation patch anchor drift'; END IF;
 body := replace(body,needle,replacement);
 EXECUTE body;
 body := pg_get_functiondef('public.finish_citation_request(uuid,text,uuid,text,text,jsonb)'::regprocedure);
 needle := $needle$  UPDATE public.citation_trial_sources SET state=_outcome$needle$;
 replacement := $replacement$  IF EXISTS(SELECT 1 FROM public.citation_pass_usage WHERE user_id=_user_id AND request_id=_request_id) THEN
    UPDATE public.citation_pass_usage SET state=_outcome WHERE user_id=_user_id AND request_id=_request_id;
    IF _outcome='failed' THEN
      UPDATE public.citation_pass_orders SET sources_remaining=sources_remaining+1
      WHERE id=(SELECT order_id FROM public.citation_pass_usage WHERE user_id=_user_id AND request_id=_request_id);
    END IF;
  END IF;
  UPDATE public.citation_trial_sources SET state=_outcome$replacement$;
 IF (length(body)-length(replace(body,needle,'')))/length(needle) <> 1 THEN RAISE EXCEPTION 'Citation patch anchor drift'; END IF;
 body := replace(body,needle,replacement);
 needle := $needle$  IF _outcome = 'failed' AND NOT EXISTS(SELECT 1 FROM public.citation_trial_sources$needle$;
 replacement := $replacement$  IF _outcome = 'failed' AND NOT EXISTS(SELECT 1 FROM public.citation_pass_usage WHERE user_id=_user_id AND request_id=_request_id) AND NOT EXISTS(SELECT 1 FROM public.citation_trial_sources$replacement$;
 IF (length(body)-length(replace(body,needle,'')))/length(needle) <> 1 THEN RAISE EXCEPTION 'Citation patch anchor drift'; END IF;
 body := replace(body,needle,replacement);
 EXECUTE body;
 body := pg_get_functiondef('public._citation_refund_receipt(uuid,text)'::regprocedure);
 needle := $needle$  IF EXISTS(SELECT 1 FROM public.citation_trial_sources$needle$;
 replacement := $replacement$  IF EXISTS(SELECT 1 FROM public.citation_pass_usage WHERE user_id=_user_id AND request_id=_request_id) THEN
    RETURN jsonb_build_object('status',CASE WHEN request.state='failed' THEN 'refunded' ELSE 'retained' END,
      'refunded',request.state='failed','units_refunded',CASE WHEN request.state='failed' THEN 1 ELSE 0 END,'request_id',_request_id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.citation_trial_sources$replacement$;
 IF (length(body)-length(replace(body,needle,'')))/length(needle) <> 1 THEN RAISE EXCEPTION 'Citation patch anchor drift'; END IF;
 body := replace(body,needle,replacement);
 EXECUTE body;
 body := pg_get_functiondef('public._citation_trial_limited(public.profiles)'::regprocedure);
 needle := $needle$   AND (COALESCE((_prof).plan = 'trial',false)$needle$;
 replacement := $replacement$   AND NOT EXISTS(SELECT 1 FROM public.citation_pass_orders WHERE user_id=(_prof).id AND status='settled' AND expires_at>now())
   AND (COALESCE((_prof).plan = 'trial',false)$replacement$;
 IF (length(body)-length(replace(body,needle,'')))/length(needle) <> 1 THEN RAISE EXCEPTION 'Citation patch anchor drift'; END IF;
 body := replace(body,needle,replacement);
 EXECUTE body;
END;
$patch$;
