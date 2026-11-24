-- Signed-in admins can verify the payment flow before public checkout opens.
CREATE OR REPLACE FUNCTION public.get_citation_checkout_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
 SELECT jsonb_build_object('enabled',COALESCE((SELECT
 (checkout_enabled OR COALESCE(private.has_role(auth.uid(),'admin'::public.app_role),false))
 AND settlement_enabled AND page_url IS NOT NULL FROM public.citation_pass_config WHERE singleton),false));
$$;

CREATE OR REPLACE FUNCTION public.create_citation_pass_order(_user_id uuid,_offer_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS $$
DECLARE o public.citation_pass_orders; c public.citation_pass_config;
BEGIN
 PERFORM public._require_usage_service();
 SELECT * INTO c FROM public.citation_pass_config WHERE singleton;
 IF NOT FOUND OR NOT c.settlement_enabled OR c.page_url IS NULL
 OR (NOT c.checkout_enabled AND NOT COALESCE(private.has_role(_user_id,'admin'::public.app_role),false)) THEN
   RETURN jsonb_build_object('ok',false,'error','CHECKOUT_CLOSED');
 END IF;
 IF _offer_id IS NULL OR _offer_id NOT IN ('citation_week_pass_v1','citation_month_pass_v1') THEN
   RETURN jsonb_build_object('ok',false,'error','UNKNOWN_OFFER');
 END IF;
 PERFORM 1 FROM public.profiles WHERE id=_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','PROFILE_NOT_FOUND'); END IF;
 INSERT INTO public.citation_pass_orders(user_id,offer_id,amount_ils,source_count,sources_remaining)
 VALUES(_user_id,_offer_id,CASE _offer_id WHEN 'citation_week_pass_v1' THEN 39 ELSE 65 END,
 CASE _offer_id WHEN 'citation_week_pass_v1' THEN 100 ELSE 250 END,
 CASE _offer_id WHEN 'citation_week_pass_v1' THEN 100 ELSE 250 END) RETURNING * INTO o;
 RETURN jsonb_build_object('ok',true,'reference',o.reference,'page_url',c.page_url,'order_id',o.id);
END;
$$;
