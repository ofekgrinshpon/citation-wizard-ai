-- Manual rollout only, after reviewing Takbull's live signed success contract.
-- Does not open public checkout, send a payment, or change webhook verification.
BEGIN;

DO $gate$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc
     WHERE oid = 'public.settle_citation_pass_order(text,text,text,integer,text,integer,integer)'::regprocedure)
    IS DISTINCT FROM '3fc5a4ead861251782b64c9fed1d4502' THEN
   RAISE EXCEPTION 'Settlement definition drift; stop without changes';
 END IF;
END;
$gate$;

-- Keep the submitted offer for support/reconciliation when the customer paid
-- for a different offer on the hosted page. This is private ledger data.
ALTER TABLE public.citation_pass_orders ADD COLUMN original_offer_id text
 CHECK (original_offer_id IS NULL OR
        (status = 'settled' AND original_offer_id IN ('citation_week_pass_v1', 'citation_month_pass_v1')
         AND original_offer_id <> offer_id));

CREATE OR REPLACE FUNCTION public.settle_citation_pass_order(
 _reference text, _transaction_id text, _order_number text, _amount_ils integer,
 _currency text, _order_status integer, _status_code integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 o public.citation_pass_orders; uid uuid; c public.citation_pass_config; ts timestamptz:=now();
 paid_offer text; paid_sources integer;
BEGIN
 PERFORM public._require_usage_service();
 SELECT * INTO c FROM public.citation_pass_config WHERE singleton;
 IF NOT FOUND OR NOT c.settlement_enabled THEN RETURN jsonb_build_object('ok',false,'disabled',true); END IF;
 IF _reference IS NULL OR _reference !~ '^rlx_[0-9a-f]{32}$' OR _transaction_id IS NULL OR _transaction_id !~ '^[1-9][0-9]{0,19}$'
 OR _order_number IS NULL OR _order_number !~ '^[1-9][0-9]{0,19}$' OR (_order_status IS NULL OR _order_status NOT IN (2,3)) OR _status_code IS DISTINCT FROM 0
 OR _amount_ils IS NULL OR _amount_ils NOT IN (39,65) OR (_currency IS NOT NULL AND _currency<>'ILS') OR c.currency<>'ILS' OR c.page_id<>'3CxDl' THEN
   RETURN jsonb_build_object('ok',false,'error','PAYMENT_REJECTED');
 END IF;
 SELECT user_id INTO uid FROM public.citation_pass_orders WHERE reference=_reference;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','ORDER_NOT_FOUND'); END IF;
 -- Same lock order as citation consumption/refunds: profile, then order.
 PERFORM 1 FROM public.profiles WHERE id=uid FOR UPDATE;
 SELECT * INTO o FROM public.citation_pass_orders WHERE reference=_reference AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','ORDER_NOT_FOUND'); END IF;

 -- A later notification may acknowledge the exact settled purchase but must
 -- never resize or reissue a settled pass, even if ids match.
 IF o.status='settled' THEN
   IF o.transaction_id=_transaction_id AND o.provider_order_number=_order_number AND o.amount_ils=_amount_ils THEN
     RETURN jsonb_build_object('ok',true,'replayed',true);
   END IF;
   RETURN jsonb_build_object('ok',false,'error','SETTLEMENT_CONFLICT');
 END IF;
 IF EXISTS(SELECT 1 FROM public.citation_pass_orders WHERE transaction_id=_transaction_id OR provider_order_number=_order_number) THEN
   RETURN jsonb_build_object('ok',false,'error','TRANSACTION_ALREADY_USED');
 END IF;

 -- Amount is supplied only by the dedicated signed payment receiver and has
 -- already passed the closed allowlist. No amount from checkout input is trusted.
 paid_offer := CASE _amount_ils WHEN 39 THEN 'citation_week_pass_v1' ELSE 'citation_month_pass_v1' END;
 paid_sources := CASE _amount_ils WHEN 39 THEN 100 ELSE 250 END;
 UPDATE public.citation_pass_orders
 SET status='settled',transaction_id=_transaction_id,provider_order_number=_order_number,
     original_offer_id=CASE WHEN o.offer_id<>paid_offer THEN o.offer_id ELSE NULL END,
     offer_id=paid_offer,amount_ils=_amount_ils,source_count=paid_sources,sources_remaining=paid_sources,
     activated_at=ts,expires_at=public.citation_pass_expiry(ts,paid_offer)
 WHERE id=o.id;
 RETURN jsonb_build_object('ok',true,'replayed',false);
EXCEPTION WHEN unique_violation THEN
 RETURN jsonb_build_object('ok',false,'error','TRANSACTION_ALREADY_USED');
END;
$function$;

COMMIT;
