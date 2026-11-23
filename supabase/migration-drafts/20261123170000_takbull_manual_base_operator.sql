-- DRAFT ONLY. Requires 1500 receipt and 1600 meter contracts.
BEGIN;
CREATE TABLE private.takbull_manual_operator_audit (
 actor_id uuid NOT NULL,
 order_id uuid NOT NULL REFERENCES private.takbull_pilot_orders(id),
 action text NOT NULL CHECK(action IN ('issued','recorded','refunded')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(order_id,action)
);
ALTER TABLE private.takbull_manual_operator_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.takbull_manual_operator_audit FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.takbull_manual_require_admin(_actor_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public._require_usage_service();
 IF private.has_role(_actor_id,'admin'::public.app_role) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.takbull_manual_require_admin(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.takbull_manual_base_intent(_owner uuid,_offer text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cfg private.takbull_pilot_config; o private.takbull_pilot_orders; price int; quota int;
BEGIN
 PERFORM public._require_usage_service();
 SELECT * INTO cfg FROM private.takbull_pilot_config WHERE singleton FOR SHARE;
 IF _offer IS NOT NULL AND cfg.enabled IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok',false,'code','DISABLED'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=_owner FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_ELIGIBLE'); END IF;
 IF _offer IS NOT NULL THEN
  CASE _offer
   WHEN 'citation_week_pass_v1' THEN price:=3900; quota:=100;
   WHEN 'citation_month_pass_v1' THEN price:=6500; quota:=250;
   ELSE RETURN jsonb_build_object('ok',false,'code','UNKNOWN_OFFER');
  END CASE;
  IF private.takbull_pilot_active_pass(_owner,clock_timestamp()) IS NOT NULL THEN
   RETURN jsonb_build_object('ok',false,'code','ALREADY_ACTIVE');
  END IF;
 END IF;
 SELECT x.* INTO o FROM private.takbull_pilot_orders x
 WHERE x.user_id=_owner AND x.manual_base
  AND (_offer IS NULL OR
   (x.cancelled_at IS NULL AND NOT EXISTS(SELECT 1 FROM private.takbull_pilot_receipts r WHERE r.order_id=x.id)))
 ORDER BY x.requested_at DESC LIMIT 1;
 IF NOT FOUND AND _offer IS NOT NULL THEN
  INSERT INTO private.takbull_pilot_orders(user_id,offer_id,amount_minor,sources,merchant_ref,manual_base)
  VALUES(_owner,_offer,price,quota,cfg.verified_merchant_ref,true) RETURNING * INTO o;
 END IF;
 IF o.id IS NULL THEN RETURN jsonb_build_object('ok',true,'status','none'); END IF;
 RETURN jsonb_build_object('ok',true,'order_id',o.id,'offer',o.offer_id,'amount_minor',o.amount_minor,'currency','ILS',
  'status',CASE
   WHEN EXISTS(SELECT 1 FROM private.takbull_pilot_refunds x WHERE x.order_id=o.id) THEN 'refunded'
   WHEN EXISTS(SELECT 1 FROM private.takbull_pilot_receipts r WHERE r.order_id=o.id AND r.ends_at>clock_timestamp()) THEN 'active'
   WHEN EXISTS(SELECT 1 FROM private.takbull_pilot_receipts r WHERE r.order_id=o.id AND r.ends_at IS NOT NULL) THEN 'expired'
   WHEN EXISTS(SELECT 1 FROM private.takbull_pilot_receipts r WHERE r.order_id=o.id) THEN 'reconcile'
   WHEN o.cancelled_at IS NOT NULL THEN 'cancelled'
   WHEN o.demand_ref IS NOT NULL THEN 'demand_issued'
   ELSE 'requested' END);
END;
$$;

CREATE FUNCTION public.takbull_manual_base_queue(_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM private.takbull_manual_require_admin(_actor);
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.requested_at) FROM
  (SELECT o.id AS order_id,o.user_id,o.offer_id,o.amount_minor,o.requested_at,o.cancelled_at,o.demand_ref,o.demand_issued_at,
      r.paid_at,r.starts_at AS activated_at,r.ends_at AS expires_at,r.unfulfilled_reason,r.transaction_ref,r.document_ref,
      x.recorded_at AS refunded_at
    FROM private.takbull_pilot_orders o LEFT JOIN private.takbull_pilot_receipts r ON o.id=r.order_id
    LEFT JOIN private.takbull_pilot_refunds x ON o.id=x.order_id
    WHERE o.manual_base
    ORDER BY (r.order_id IS NOT NULL) ASC,o.requested_at DESC LIMIT 100) q),'[]'::jsonb);
END;
$$;

CREATE FUNCTION public.takbull_manual_base_issue(_actor uuid,_order uuid,_demand_ref text,
 _observed_merchant text,_amount_minor integer,_currency text,_issued_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o private.takbull_pilot_orders;
BEGIN
 PERFORM private.takbull_manual_require_admin(_actor);
 SELECT * INTO o FROM private.takbull_pilot_orders WHERE id=_order AND manual_base;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','MISMATCH'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=o.user_id FOR NO KEY UPDATE;
 SELECT * INTO o FROM private.takbull_pilot_orders WHERE id=_order;
 IF o.cancelled_at IS NOT NULL OR _demand_ref IS NULL OR _demand_ref !~ '^[A-Za-z0-9_-]{1,128}$'
  OR _observed_merchant IS DISTINCT FROM o.merchant_ref OR _amount_minor IS DISTINCT FROM o.amount_minor
  OR _currency IS DISTINCT FROM o.currency OR _issued_at IS NULL OR _issued_at<o.requested_at OR _issued_at>clock_timestamp() THEN
  RETURN jsonb_build_object('ok',false,'code','MISMATCH');
 END IF;
 IF o.demand_ref IS NOT NULL THEN
  RETURN jsonb_build_object('ok',o.demand_ref=_demand_ref AND o.demand_issued_at=_issued_at,'replayed',true);
 END IF;
 BEGIN
  UPDATE private.takbull_pilot_orders SET demand_ref=_demand_ref,demand_issued_at=_issued_at WHERE id=_order;
 EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'code','ALREADY_USED_EVIDENCE');
 END;
 INSERT INTO private.takbull_manual_operator_audit(actor_id,order_id,action) VALUES(_actor,_order,'issued');
 RETURN jsonb_build_object('ok',true);
END;
$$;

-- Signed-in admin enters identifiers actually observed in merchant records. The
-- adapter must carry a source-specific attestation, never infer a settlement.
CREATE FUNCTION public.takbull_manual_base_settle(_actor uuid,_observed_order uuid,_observed_demand text,
 _merchant text,_transaction text,_document text,_amount_minor integer,_currency text,
 _outcome text,_paid_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o private.takbull_pilot_orders; outcome jsonb;
BEGIN
 PERFORM private.takbull_manual_require_admin(_actor);
 SELECT * INTO o FROM private.takbull_pilot_orders WHERE id=_observed_order AND manual_base;
 IF NOT FOUND OR _observed_demand IS NULL OR _observed_demand IS DISTINCT FROM o.demand_ref OR _paid_at IS NULL OR _paid_at<o.demand_issued_at THEN
  RETURN jsonb_build_object('ok',false,'code','MISMATCH');
 END IF;
 -- The core settlement enforces profile lock, unique receipts, window, price,
 -- expiry, cancellation, replay and reconciliation. Refunded rows cannot grant.
 outcome:=public.takbull_pilot_record_payment(_observed_order,_merchant,_transaction,_document,_amount_minor,_currency,_outcome,_paid_at);
 IF outcome->>'ok'='true' THEN
  INSERT INTO private.takbull_manual_operator_audit(actor_id,order_id,action) VALUES(_actor,_observed_order,'recorded') ON CONFLICT DO NOTHING;
 END IF;
 RETURN outcome;
END;
$$;

CREATE FUNCTION public.takbull_manual_base_refund(_actor uuid,_order uuid,_merchant text,
 _original_transaction text,_refund_ref text,_credit_document text,_outcome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE outcome jsonb;
BEGIN
 PERFORM private.takbull_manual_require_admin(_actor);
 IF NOT EXISTS (SELECT 1 FROM private.takbull_pilot_orders WHERE id=_order AND manual_base) THEN
  RETURN jsonb_build_object('ok',false,'code','MISMATCH');
 END IF;
 outcome:=public.takbull_pilot_record_full_refund(_order,_merchant,_original_transaction,_refund_ref,_credit_document,_outcome);
 IF outcome->>'ok'='true' THEN
  INSERT INTO private.takbull_manual_operator_audit(actor_id,order_id,action) VALUES(_actor,_order,'refunded') ON CONFLICT DO NOTHING;
 END IF;
 RETURN outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.takbull_manual_base_intent(uuid,text),public.takbull_manual_base_queue(uuid),
 public.takbull_manual_base_issue(uuid,uuid,text,text,integer,text,timestamptz),
 public.takbull_manual_base_settle(uuid,uuid,text,text,text,text,integer,text,text,timestamptz),
 public.takbull_manual_base_refund(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.takbull_manual_base_intent(uuid,text),public.takbull_manual_base_queue(uuid),
 public.takbull_manual_base_issue(uuid,uuid,text,text,integer,text,timestamptz),
 public.takbull_manual_base_settle(uuid,uuid,text,text,text,text,integer,text,text,timestamptz),
 public.takbull_manual_base_refund(uuid,uuid,text,text,text,text,text) TO service_role;
COMMIT;
