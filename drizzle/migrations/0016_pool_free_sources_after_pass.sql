DO $patch$
DECLARE body text; needle text; replacement text;
BEGIN
 body := pg_get_functiondef('public.begin_citation_request(uuid,text,text,text,text,jsonb)'::regprocedure);
 needle := $needle$  IF EXISTS(SELECT 1 FROM public.citation_pass_orders WHERE user_id=_user_id AND status='settled' AND expires_at>now_ts) THEN
    RETURN jsonb_build_object('ok',false,'execute',false,'error','INSUFFICIENT_CREDITS','block_reason','pass_exhausted');
  END IF;
  IF public._citation_trial_limited(prof) THEN$needle$;
 replacement := $replacement$  IF public._citation_trial_limited(prof)
     OR (EXISTS(SELECT 1 FROM public.citation_pass_orders WHERE user_id=_user_id AND status='settled' AND expires_at>now_ts)
         AND COALESCE((SELECT enabled FROM public.citation_trial_config WHERE singleton),false)) THEN$replacement$;
 IF (length(body)-length(replace(body,needle,'')))/length(needle) <> 1 THEN RAISE EXCEPTION 'Citation pool anchor drift'; END IF;
 body := replace(body,needle,replacement);
 EXECUTE body;
END;
$patch$;