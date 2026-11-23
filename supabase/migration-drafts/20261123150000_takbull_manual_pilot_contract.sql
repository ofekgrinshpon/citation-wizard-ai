-- DRAFT ONLY. Not a migration. Checkout, provider, receipt capture and quota
-- integration remain closed. Install nowhere before the release checklist passes.
BEGIN;
CREATE TABLE private.takbull_pilot_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 verified_merchant_ref text,
 CHECK(NOT enabled OR (verified_merchant_ref IS NOT NULL AND length(verified_merchant_ref) BETWEEN 1 AND 128))
);
INSERT INTO private.takbull_pilot_config(singleton) VALUES(true);

CREATE TABLE private.takbull_pilot_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id),
 offer_id text NOT NULL CHECK(offer_id IN ('citation_week_pass_v1','citation_month_pass_v1','citation_source_topup_50_v1')),
 amount_minor integer NOT NULL,
 currency text NOT NULL DEFAULT 'ILS' CHECK(currency='ILS'),
 sources integer NOT NULL,
 merchant_ref text NOT NULL CHECK(length(merchant_ref) BETWEEN 1 AND 128),
 parent_pass uuid REFERENCES private.takbull_pilot_orders(id),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 cancelled_at timestamptz,
 CHECK(cancelled_at IS NULL OR cancelled_at>=requested_at),
 UNIQUE(id,user_id),
 CHECK((offer_id='citation_week_pass_v1' AND amount_minor=3900 AND sources=100 AND parent_pass IS NULL)
    OR (offer_id='citation_month_pass_v1' AND amount_minor=6500 AND sources=250 AND parent_pass IS NULL)
    OR (offer_id='citation_source_topup_50_v1' AND amount_minor=1500 AND sources=50 AND parent_pass IS NOT NULL)),
 FOREIGN KEY(parent_pass,user_id) REFERENCES private.takbull_pilot_orders(id,user_id)
);
CREATE INDEX takbull_pilot_orders_owner ON private.takbull_pilot_orders(user_id);
CREATE TABLE private.takbull_pilot_receipts (
 order_id uuid PRIMARY KEY REFERENCES private.takbull_pilot_orders(id),
 transaction_ref text UNIQUE NOT NULL CHECK(transaction_ref ~ '^[A-Za-z0-9_-]{1,128}$'),
 document_ref text UNIQUE NOT NULL CHECK(document_ref ~ '^[A-Za-z0-9_-]{1,128}$'),
 paid_at timestamptz NOT NULL,
 starts_at timestamptz,
 ends_at timestamptz,
 unfulfilled_reason text CHECK(unfulfilled_reason IN ('DISABLED_RECONCILE','CANCELLED_RECONCILE','LATE_PAYMENT_RECONCILE','ACTIVATION_WINDOW_ELAPSED','EXPIRED_RECONCILE','OVERLAPPING_PASS_RECONCILE')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((starts_at IS NULL AND ends_at IS NULL AND unfulfilled_reason IS NOT NULL) OR
 (starts_at IS NOT NULL AND ends_at IS NOT NULL AND unfulfilled_reason IS NULL AND starts_at>=paid_at AND ends_at>starts_at))
);
CREATE TABLE private.takbull_pilot_refunds (
 order_id uuid PRIMARY KEY REFERENCES private.takbull_pilot_receipts(order_id),
 refund_ref text UNIQUE NOT NULL CHECK(refund_ref ~ '^[A-Za-z0-9_-]{1,128}$'),
 credit_document_ref text UNIQUE NOT NULL CHECK(credit_document_ref ~ '^[A-Za-z0-9_-]{1,128}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.takbull_pilot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.takbull_pilot_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.takbull_pilot_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.takbull_pilot_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.takbull_pilot_config,private.takbull_pilot_orders,private.takbull_pilot_receipts,private.takbull_pilot_refunds FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,UPDATE ON TABLE private.takbull_pilot_config TO service_role;

-- Internal helper, called only with the owner's profile lock. A base order is
-- not paid until a trusted receipt exists. Refunded plans never authorize add-ons.
CREATE FUNCTION private.takbull_pilot_active_pass(_user_id uuid,_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT o.id FROM private.takbull_pilot_orders o JOIN private.takbull_pilot_receipts r ON r.order_id=o.id
 WHERE o.user_id=_user_id AND o.parent_pass IS NULL AND r.starts_at<=_at AND r.ends_at>_at
 AND NOT EXISTS(SELECT 1 FROM private.takbull_pilot_refunds x WHERE x.order_id=o.id)
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.takbull_pilot_active_pass(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- Trusted server initiator ONLY; HTTP wrapper must verify the bearer token with
-- auth.getUser(), derive _user_id from that verified token, never request JSON.
-- No hosted URL or live charge is created by this RPC.
CREATE FUNCTION public.takbull_pilot_prepare(_user_id uuid,_offer_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cfg private.takbull_pilot_config; pass_id uuid; order_number uuid; amount int; quota int;
BEGIN
 PERFORM public._require_usage_service();
 SELECT * INTO cfg FROM private.takbull_pilot_config WHERE singleton FOR SHARE;
 IF cfg.enabled IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok',false,'code','DISABLED'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=_user_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_ELIGIBLE'); END IF;
 pass_id:=private.takbull_pilot_active_pass(_user_id,clock_timestamp());
 CASE _offer_id
 WHEN 'citation_week_pass_v1' THEN amount:=3900; quota:=100;
 WHEN 'citation_month_pass_v1' THEN amount:=6500; quota:=250;
 WHEN 'citation_source_topup_50_v1' THEN amount:=1500; quota:=50;
 ELSE RETURN jsonb_build_object('ok',false,'code','UNKNOWN_OFFER');
 END CASE;
 IF (_offer_id='citation_source_topup_50_v1' AND pass_id IS NULL) OR
    (_offer_id<>'citation_source_topup_50_v1' AND pass_id IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','NOT_ELIGIBLE');
 END IF;
 -- Avoid accumulating duplicate pending checkout rows. One owner lock protects creation.
 SELECT o.id INTO order_number FROM private.takbull_pilot_orders o
 WHERE o.user_id=_user_id AND o.offer_id=_offer_id AND o.parent_pass IS NOT DISTINCT FROM pass_id
 AND o.cancelled_at IS NULL AND o.merchant_ref=cfg.verified_merchant_ref AND o.requested_at>clock_timestamp()-interval '30 minutes'
 AND NOT EXISTS(SELECT 1 FROM private.takbull_pilot_receipts r WHERE r.order_id=o.id)
 ORDER BY o.requested_at DESC LIMIT 1;
 IF NOT FOUND THEN
  INSERT INTO private.takbull_pilot_orders(user_id,offer_id,amount_minor,sources,merchant_ref,parent_pass)
  VALUES(_user_id,_offer_id,amount,quota,cfg.verified_merchant_ref,pass_id) RETURNING id INTO order_number;
 END IF;
 RETURN jsonb_build_object('ok',true,'order_id',order_number,'amount_minor',amount,'currency','ILS');
END;
$$;

-- Trusted dashboard reconciler ONLY. Inputs come from authenticated merchant
-- evidence (not payer screenshots, redirects, webhook body or query strings).
-- _verified_order_ref is the server order UUID actually observed in provider
-- evidence; do not fill it from our order solely to make a comparison pass.
CREATE FUNCTION public.takbull_pilot_record_payment(_verified_order_ref uuid,_merchant_ref text,
 _transaction_ref text,_document_ref text,_amount_minor integer,_currency text,_observed_outcome text,
 _paid_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cfg private.takbull_pilot_config; o private.takbull_pilot_orders; paid private.takbull_pilot_receipts;
 ending timestamptz; now_at timestamptz; added uuid; reason text;
BEGIN
 PERFORM public._require_usage_service();
 SELECT * INTO cfg FROM private.takbull_pilot_config WHERE singleton FOR SHARE;
 SELECT * INTO o FROM private.takbull_pilot_orders WHERE id=_verified_order_ref;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','MISMATCH'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=o.user_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','MISMATCH'); END IF;
 SELECT * INTO o FROM private.takbull_pilot_orders WHERE id=_verified_order_ref;
 now_at:=clock_timestamp();
 IF _observed_outcome IS DISTINCT FROM 'confirmed_one_time_charge' OR
    o.amount_minor IS DISTINCT FROM _amount_minor OR o.currency IS DISTINCT FROM _currency OR
    o.merchant_ref IS DISTINCT FROM _merchant_ref OR
    _transaction_ref IS NULL OR _transaction_ref !~ '^[A-Za-z0-9_-]{1,128}$' OR
    _document_ref IS NULL OR _document_ref !~ '^[A-Za-z0-9_-]{1,128}$' OR
    _paid_at IS NULL OR _paid_at<o.requested_at OR _paid_at>now_at THEN
  RETURN jsonb_build_object('ok',false,'code','MISMATCH');
 END IF;
 SELECT * INTO paid FROM private.takbull_pilot_receipts WHERE order_id=o.id;
 IF FOUND THEN
  IF paid.transaction_ref=_transaction_ref AND paid.document_ref=_document_ref AND paid.paid_at=_paid_at AND
     NOT EXISTS(SELECT 1 FROM private.takbull_pilot_refunds WHERE order_id=o.id) THEN
   RETURN jsonb_build_object('ok',true,'replayed',true,'fulfilled',paid.starts_at IS NOT NULL,'code',paid.unfulfilled_reason,'activated_at',paid.starts_at,'expires_at',paid.ends_at);
  END IF;
  RETURN jsonb_build_object('ok',false,'code','CONFLICTING_OR_REVOKED_RECEIPT');
 END IF;
 IF cfg.enabled IS DISTINCT FROM true OR cfg.verified_merchant_ref IS DISTINCT FROM _merchant_ref THEN
  reason:='DISABLED_RECONCILE';
 ELSIF o.cancelled_at IS NOT NULL THEN
  reason:='CANCELLED_RECONCILE';
 ELSIF _paid_at>o.requested_at+interval '30 minutes' THEN
  reason:='LATE_PAYMENT_RECONCILE';
 ELSIF now_at>_paid_at+interval '24 hours' THEN
  reason:='ACTIVATION_WINDOW_ELAPSED';
 ELSIF o.parent_pass IS NOT NULL THEN
  SELECT r.ends_at INTO ending FROM private.takbull_pilot_receipts r
  WHERE r.order_id=o.parent_pass AND r.starts_at<=_paid_at AND r.ends_at>now_at
   AND NOT EXISTS(SELECT 1 FROM private.takbull_pilot_refunds x WHERE x.order_id=o.parent_pass);
  IF ending IS NULL THEN reason:='EXPIRED_RECONCILE'; END IF;
 ELSE
  -- Paid time proves settlement; only first successful fulfillment controls duration.
  ending:=CASE WHEN o.offer_id='citation_week_pass_v1' THEN now_at+interval '168 hours'
    ELSE (((now_at AT TIME ZONE 'Asia/Jerusalem')+interval '1 month') AT TIME ZONE 'Asia/Jerusalem') END;
  IF EXISTS(SELECT 1 FROM private.takbull_pilot_orders prior JOIN private.takbull_pilot_receipts r ON r.order_id=prior.id
    WHERE prior.user_id=o.user_id AND prior.parent_pass IS NULL AND r.starts_at<ending AND r.ends_at>now_at
    AND NOT EXISTS(SELECT 1 FROM private.takbull_pilot_refunds x WHERE x.order_id=prior.id)) THEN
   reason:='OVERLAPPING_PASS_RECONCILE';
  END IF;
 END IF;
 IF reason IS NOT NULL THEN ending:=NULL; END IF;
 INSERT INTO private.takbull_pilot_receipts(order_id,transaction_ref,document_ref,paid_at,starts_at,ends_at,unfulfilled_reason)
 VALUES(o.id,_transaction_ref,_document_ref,_paid_at,CASE WHEN reason IS NULL THEN now_at END,ending,reason)
 ON CONFLICT DO NOTHING RETURNING order_id INTO added;
 IF added IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ALREADY_USED_EVIDENCE'); END IF;
 RETURN jsonb_build_object('ok',true,'replayed',false,'fulfilled',reason IS NULL,'code',reason,
  'activated_at',CASE WHEN reason IS NULL THEN now_at END,'expires_at',ending);
END;
$$;

-- Trusted operator/verified owner cancellation. No provider cancellation is implied.
-- A racing settled charge is still recorded, but never granted after cancellation.
CREATE FUNCTION public.takbull_pilot_cancel_pending(_user_id uuid,_order_ref uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public._require_usage_service();
 PERFORM 1 FROM public.profiles WHERE id=_user_id FOR NO KEY UPDATE;
 UPDATE private.takbull_pilot_orders o SET cancelled_at=COALESCE(o.cancelled_at,clock_timestamp())
 WHERE o.user_id=_user_id AND o.id=_order_ref AND NOT EXISTS
 (SELECT 1 FROM private.takbull_pilot_receipts r WHERE r.order_id=o.id);
 RETURN jsonb_build_object('ok',FOUND);
END;
$$;
REVOKE ALL ON FUNCTION public.takbull_pilot_cancel_pending(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.takbull_pilot_cancel_pending(uuid,uuid) TO service_role;

-- Full refund only. Like confirmation, this records authenticated merchant
-- evidence; it does not contact Takbull or create a refund. Partial and charge-
-- back require policy/reconciliation in the operator workflow, not guessing.
CREATE FUNCTION public.takbull_pilot_record_full_refund(_order_ref uuid,_merchant_ref text,
 _original_transaction_ref text,_refund_ref text,_credit_doc_ref text,_observed_outcome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o private.takbull_pilot_orders; recorded uuid;
BEGIN
 PERFORM public._require_usage_service();
 SELECT * INTO o FROM private.takbull_pilot_orders WHERE id=_order_ref;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','MISMATCH'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=o.user_id FOR NO KEY UPDATE;
 IF NOT FOUND OR o.merchant_ref IS DISTINCT FROM _merchant_ref OR _observed_outcome IS DISTINCT FROM 'confirmed_full_refund' OR
    _refund_ref IS NULL OR _refund_ref !~ '^[A-Za-z0-9_-]{1,128}$' OR _refund_ref IS NOT DISTINCT FROM _original_transaction_ref OR
    _credit_doc_ref IS NULL OR _credit_doc_ref !~ '^[A-Za-z0-9_-]{1,128}$' OR
    NOT EXISTS(SELECT 1 FROM private.takbull_pilot_receipts r WHERE r.order_id=o.id AND r.transaction_ref=_original_transaction_ref AND r.document_ref<>_credit_doc_ref) THEN
  RETURN jsonb_build_object('ok',false,'code','MISMATCH');
 END IF;
 INSERT INTO private.takbull_pilot_refunds(order_id,refund_ref,credit_document_ref)
 VALUES(o.id,_refund_ref,_credit_doc_ref) ON CONFLICT DO NOTHING RETURNING order_id INTO recorded;
 IF recorded IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'replayed',false); END IF;
 RETURN jsonb_build_object('ok',EXISTS(SELECT 1 FROM private.takbull_pilot_refunds
  WHERE order_id=o.id AND refund_ref=_refund_ref AND credit_document_ref=_credit_doc_ref),'replayed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.takbull_pilot_prepare(uuid,text),public.takbull_pilot_record_payment(uuid,text,text,text,integer,text,text,timestamptz),public.takbull_pilot_record_full_refund(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.takbull_pilot_prepare(uuid,text),public.takbull_pilot_record_payment(uuid,text,text,text,integer,text,text,timestamptz),public.takbull_pilot_record_full_refund(uuid,text,text,text,text,text) TO service_role;
-- Account-scoped receipt view only. Does not claim that the paid meter is wired,
-- or equate sources purchased with sources remaining after use.
CREATE FUNCTION public.takbull_pilot_my_entitlement() RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH instant AS (SELECT clock_timestamp() t),
 active AS (SELECT private.takbull_pilot_active_pass(auth.uid(),t) id,t FROM instant)
 SELECT COALESCE((
  SELECT jsonb_build_object('active',true,'offer_id',o.offer_id,'base_sources_purchased',o.sources,
    'expires_at',paid.ends_at,'topup_sources_purchased',COALESCE((
     SELECT sum(child.sources) FROM private.takbull_pilot_orders child
      JOIN private.takbull_pilot_receipts child_paid ON child_paid.order_id=child.id
      WHERE child.parent_pass=o.id AND child_paid.starts_at<=a.t AND child_paid.ends_at>a.t
       AND NOT EXISTS(SELECT 1 FROM private.takbull_pilot_refunds x WHERE x.order_id=child.id)),0))
  FROM active a JOIN private.takbull_pilot_orders o ON o.id=a.id
   JOIN private.takbull_pilot_receipts paid ON paid.order_id=o.id
 ),jsonb_build_object('active',false));
$$;
REVOKE ALL ON FUNCTION public.takbull_pilot_my_entitlement() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.takbull_pilot_my_entitlement() TO authenticated;
COMMIT;
